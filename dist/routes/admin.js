"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const uuid_1 = require("uuid");
const knex_1 = __importDefault(require("../config/knex"));
const auth_1 = require("../middleware/auth");
const whatsappBot_1 = require("../services/whatsappBot");
const whatsappBot_2 = require("../services/whatsappBot");
const router = (0, express_1.Router)();
// Semua route admin wajib auth + role admin
router.use(auth_1.requireAuth, auth_1.requireAdmin);
// ─── GET /api/admin/stats ─────────────────────────────────────────────────
router.get('/stats', async (_req, res) => {
    try {
        const [users, orders, stores, products, ragDocs] = await Promise.all([
            (0, knex_1.default)('users').count('id as count').first(),
            (0, knex_1.default)('orders').count('id as count').first(),
            (0, knex_1.default)('stores').where({ is_active: true }).count('id as count').first(),
            (0, knex_1.default)('products').where({ is_active: true }).count('id as count').first(),
            (0, knex_1.default)('rag_documents').count('id as count').first(),
        ]);
        const revenue = await (0, knex_1.default)('orders')
            .where({ status: 'selesai' })
            .sum('platform_fee as total')
            .first();
        const recentOrders = await (0, knex_1.default)('orders')
            .join('products', 'orders.product_id', 'products.id')
            .orderBy('orders.created_at', 'desc')
            .limit(10)
            .select('orders.id', 'orders.status', 'orders.total_amount', 'orders.created_at', 'products.name as product_name');
        const usersByRole = await (0, knex_1.default)('users')
            .groupBy('role')
            .select('role')
            .count('id as count');
        res.json({
            success: true, data: {
                users: Number(users?.count || 0),
                orders: Number(orders?.count || 0),
                stores: Number(stores?.count || 0),
                products: Number(products?.count || 0),
                ragDocs: Number(ragDocs?.count || 0),
                revenue: Number(revenue?.total || 0),
                recentOrders,
                usersByRole,
            },
        });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// ─── GET /api/admin/users ─────────────────────────────────────────────────
router.get('/users', async (req, res) => {
    try {
        const { page = 1, limit = 20, role, q } = req.query;
        let query = (0, knex_1.default)('users').orderBy('created_at', 'desc');
        if (role)
            query = query.where({ role });
        if (q)
            query = query.where(function () {
                this.where('name', 'like', `%${q}%`).orWhere('phone', 'like', `%${q}%`);
            });
        const users = await query.limit(Number(limit)).offset((Number(page) - 1) * Number(limit))
            .select('id', 'name', 'phone', 'email', 'role', 'is_verified', 'created_at');
        res.json({ success: true, data: users });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// ─── PATCH /api/admin/users/:id/role ─────────────────────────────────────
router.patch('/users/:id/role', async (req, res) => {
    try {
        const { role } = req.body;
        if (!['petani', 'konsumen', 'distributor', 'admin'].includes(role)) {
            res.status(400).json({ success: false, error: 'Role tidak valid' });
            return;
        }
        await (0, knex_1.default)('users').where({ id: req.params.id }).update({ role, updated_at: new Date().toISOString() });
        res.json({ success: true, message: `Role diupdate ke ${role}` });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// ─── DELETE /api/admin/users/:id ─────────────────────────────────────────
router.delete('/users/:id', async (req, res) => {
    try {
        if (req.params.id === req.user.id) {
            res.status(400).json({ success: false, error: 'Tidak bisa hapus akun sendiri' });
            return;
        }
        await (0, knex_1.default)('users').where({ id: req.params.id }).delete();
        res.json({ success: true, message: 'User dihapus' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// ─── GET /api/admin/wa-status ─────────────────────────────────────────────
router.get('/wa-status', (_req, res) => {
    res.json({ success: true, data: (0, whatsappBot_1.getWAStatus)() });
});
// ─── POST /api/admin/wa-connect ───────────────────────────────────────────
router.post('/wa-connect', (_req, res) => {
    (0, whatsappBot_2.connectWhatsApp)().catch(err => console.error('WA connect error:', err));
    res.json({ success: true, message: 'Mencoba menghubungkan WA Bot... Cek terminal untuk QR' });
});
/**
 * POST /api/admin/wa-pairing-code
 * Request 8-char code for phone-entry pairing
 */
router.post('/wa-pairing-code', async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) {
            res.status(400).json({ success: false, error: 'Nomor HP wajib diisi' });
            return;
        }
        const code = await (0, whatsappBot_1.getWAPairingCode)(phone);
        res.json({ success: true, data: { code } });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// ─── GET /api/admin/rag-docs ──────────────────────────────────────────────
router.get('/rag-docs', async (_req, res) => {
    try {
        const docs = await (0, knex_1.default)('rag_documents').orderBy('created_at', 'desc')
            .select('id', 'title', 'source_type', 'is_global', 'chunk_count', 'created_at');
        res.json({ success: true, data: docs });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// ─── PATCH /api/admin/rag-docs/:id/global ────────────────────────────────
router.patch('/rag-docs/:id/global', async (req, res) => {
    try {
        const { is_global } = req.body;
        await (0, knex_1.default)('rag_documents').where({ id: req.params.id }).update({ is_global: !!is_global });
        res.json({ success: true, message: is_global ? 'Dokumen dijadikan global' : 'Dokumen dijadikan private' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// ─── DELETE /api/admin/rag-docs/:id ─────────────────────────────────────
router.delete('/rag-docs/:id', async (req, res) => {
    try {
        await (0, knex_1.default)('rag_chunks').where({ document_id: req.params.id }).delete();
        await (0, knex_1.default)('rag_documents').where({ id: req.params.id }).delete();
        res.json({ success: true, message: 'Dokumen dihapus' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// ─── POST /api/admin/run-migration ─────────────────────────────────────────
router.post('/run-migration', async (_req, res) => {
    try {
        const [batchNo, log] = await knex_1.default.migrate.latest();
        res.json({ success: true, data: { batchNo, migrations: log, message: log.length === 0 ? 'Sudah up to date' : `${log.length} migration berhasil dijalankan` } });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// ─── GET /api/admin/komoditas ─────────────────────────────────────────────
router.get('/komoditas', async (_req, res) => {
    try {
        const data = await (0, knex_1.default)('komoditas').orderBy('nama');
        res.json({ success: true, data });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// ─── POST /api/admin/komoditas ────────────────────────────────────────────
router.post('/komoditas', async (req, res) => {
    try {
        const { nama, kategori, satuan, deskripsi } = req.body;
        if (!nama || !kategori || !satuan) {
            res.status(400).json({ success: false, error: 'nama, kategori, satuan wajib' });
            return;
        }
        const id = (0, uuid_1.v4)();
        await (0, knex_1.default)('komoditas').insert({ id, nama, kategori, satuan, deskripsi: deskripsi || null });
        res.status(201).json({ success: true, data: { id } });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// ─── GET /api/admin/settings ─────────────────────────────────────────────────
// Ambil semua settings, sembunyikan nilai secret kecuali ditandai reveal
router.get('/settings', async (_req, res) => {
    try {
        const settings = await (0, knex_1.default)('app_settings').orderBy('group').orderBy('key');
        // Sensor nilai secret
        const masked = settings.map((s) => ({
            ...s,
            value: s.is_secret && s.value ? '••••••••' : s.value,
        }));
        res.json({ success: true, data: masked });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// ─── PATCH /api/admin/settings ───────────────────────────────────────────────
// Update satu atau banyak setting sekaligus: body = { key: value, ... }
router.patch('/settings', async (req, res) => {
    try {
        const updates = req.body;
        const now = new Date().toISOString();
        for (const [key, value] of Object.entries(updates)) {
            // Jika value adalah masked (tidak berubah), skip
            if (value === '••••••••')
                continue;
            await (0, knex_1.default)('app_settings').where({ key }).update({ value, updated_at: now });
        }
        res.json({ success: true, message: 'Pengaturan berhasil disimpan' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// ─── POST /api/admin/settings/test-smtp ──────────────────────────────────────
router.post('/settings/test-smtp', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            res.status(400).json({ success: false, error: 'Email penerima diperlukan' });
            return;
        }
        const { sendEmail } = await Promise.resolve().then(() => __importStar(require('../services/emailService')));
        const ok = await sendEmail(email, '✅ Test Email AgriHub', '<h2>AgriHub SMTP berfungsi dengan baik! 🌾</h2><p>Jika Anda menerima email ini, konfigurasi SMTP sudah benar.</p>');
        if (ok)
            res.json({ success: true, message: `Email test dikirim ke ${email}` });
        else
            res.status(500).json({ success: false, error: 'SMTP belum dikonfigurasi atau gagal kirim. Cek konfigurasi.' });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
exports.default = router;
//# sourceMappingURL=admin.js.map
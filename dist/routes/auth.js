"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const uuid_1 = require("uuid");
const knex_1 = __importDefault(require("../config/knex"));
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
/**
 * POST /api/auth/register
 * Daftar user baru (phone + password atau Puter OAuth)
 */
router.post('/register', async (req, res) => {
    try {
        const { phone, name, email, password, puter_user_id } = req.body;
        if (!phone || !name) {
            res.status(400).json({ success: false, error: 'Phone dan nama wajib diisi' });
            return;
        }
        const exists = await (0, knex_1.default)('users').where({ phone }).first();
        if (exists) {
            res.status(409).json({ success: false, error: 'Nomor HP sudah terdaftar' });
            return;
        }
        const password_hash = password ? await bcryptjs_1.default.hash(password, 10) : null;
        const id = (0, uuid_1.v4)();
        const now = new Date().toISOString();
        await (0, knex_1.default)('users').insert({
            id, phone, name, email: email || null, password_hash,
            role: 'konsumen', is_verified: false,
            puter_user_id: puter_user_id || null,
            created_at: now, updated_at: now,
        });
        // Buat wallet otomatis
        await (0, knex_1.default)('wallets').insert({
            id: (0, uuid_1.v4)(), user_id: id, balance: 0, pending_balance: 0,
            total_earned: 0, total_withdrawn: 0,
            created_at: now, updated_at: now,
        });
        const token = jsonwebtoken_1.default.sign({ id }, process.env.JWT_SECRET || 'secret', { expiresIn: '30d' });
        const user = await (0, knex_1.default)('users').where({ id }).first();
        res.status(201).json({ success: true, data: { user, token } });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Gagal daftar' });
    }
});
/**
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
    try {
        const { phone, password, puter_user_id } = req.body;
        let user;
        if (puter_user_id) {
            // Puter OAuth login
            user = await (0, knex_1.default)('users').where({ puter_user_id }).first();
        }
        else {
            if (!phone || !password) {
                res.status(400).json({ success: false, error: 'Phone dan password wajib diisi' });
                return;
            }
            user = await (0, knex_1.default)('users').where({ phone }).first();
            if (!user?.password_hash) {
                res.status(401).json({ success: false, error: 'Akun tidak ditemukan' });
                return;
            }
            const valid = await bcryptjs_1.default.compare(password, user.password_hash);
            if (!valid) {
                res.status(401).json({ success: false, error: 'Password salah' });
                return;
            }
        }
        if (!user) {
            res.status(404).json({ success: false, error: 'User tidak ditemukan' });
            return;
        }
        const token = jsonwebtoken_1.default.sign({ id: user.id }, process.env.JWT_SECRET || 'secret', { expiresIn: '30d' });
        const { password_hash: _, ...safeUser } = user;
        res.json({ success: true, data: { user: safeUser, token } });
    }
    catch {
        res.status(500).json({ success: false, error: 'Gagal login' });
    }
});
/**
 * GET /api/auth/me
 */
router.get('/me', auth_1.requireAuth, async (req, res) => {
    try {
        const user = await (0, knex_1.default)('users').where({ id: req.user.id }).first();
        const wallet = await (0, knex_1.default)('wallets').where({ user_id: req.user.id }).first();
        const { password_hash: _, ...safeUser } = user;
        res.json({ success: true, data: { user: safeUser, wallet } });
    }
    catch {
        res.status(500).json({ success: false, error: 'Gagal fetch user' });
    }
});
/**
 * PATCH /api/auth/puter-token
 * Simpan token OAuth Puter.js user
 */
router.patch('/puter-token', auth_1.requireAuth, async (req, res) => {
    try {
        const { token } = req.body;
        await (0, knex_1.default)('users').where({ id: req.user.id }).update({
            puter_token: token,
            updated_at: new Date().toISOString(),
        });
        res.json({ success: true, message: 'Puter Token berhasil disimpan' });
    }
    catch {
        res.status(500).json({ success: false, error: 'Gagal simpan token' });
    }
});
/**
 * PATCH /api/auth/link-whatsapp
 * Tautkan WhatsApp LID/JID ke account ini
 */
router.patch('/link-whatsapp', auth_1.requireAuth, async (req, res) => {
    try {
        const { lid } = req.body;
        if (!lid) {
            res.status(400).json({ success: false, error: 'LID tidak ditemukan' });
            return;
        }
        await (0, knex_1.default)('users').where({ id: req.user.id }).update({
            whatsapp_lid: lid,
            updated_at: new Date().toISOString(),
        });
        res.json({ success: true, message: 'WhatsApp ID berhasil ditautkan' });
    }
    catch {
        res.status(500).json({ success: false, error: 'Gagal tautkan WhatsApp' });
    }
});
/**
 * GET /api/auth/check-phone/:phone
 */
router.get('/check-phone/:phone', async (req, res) => {
    try {
        const { phone } = req.params;
        const user = await (0, knex_1.default)('users').where('phone', 'like', `%${phone.slice(-9)}%`).first();
        res.json({
            success: true,
            exists: !!user,
            name: user?.name // Kirim nama jika ada untuk menyapa
        });
    }
    catch {
        res.status(500).json({ success: false, error: 'Gagal cek nomor' });
    }
});
exports.default = router;
//# sourceMappingURL=auth.js.map
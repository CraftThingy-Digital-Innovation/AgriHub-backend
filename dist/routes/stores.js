"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const uuid_1 = require("uuid");
const knex_1 = __importDefault(require("../config/knex"));
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
/** GET /api/stores — List toko */
router.get('/', async (req, res) => {
    try {
        const { kabupaten, search, page = 1, limit = 20 } = req.query;
        let query = (0, knex_1.default)('stores').where('is_active', true);
        if (kabupaten)
            query = query.where({ kabupaten });
        if (search)
            query = query.where('name', 'like', `%${search}%`);
        const stores = await query.limit(Number(limit)).offset((Number(page) - 1) * Number(limit));
        res.json({ success: true, data: stores });
    }
    catch {
        res.status(500).json({ success: false, error: 'Gagal fetch toko' });
    }
});
/** GET /api/stores/me — Toko milik sendiri (Utama & Cabang) */
router.get('/me', auth_1.requireAuth, async (req, res) => {
    try {
        const stores = await (0, knex_1.default)('stores').where({ owner_id: req.user.id });
        res.json({ success: true, data: stores });
    }
    catch {
        res.status(500).json({ success: false, error: 'Gagal fetch toko' });
    }
});
/** POST /api/stores — Daftar toko (Utama atau Cabang) */
router.post('/', auth_1.requireAuth, async (req, res) => {
    try {
        const { name, kabupaten, provinsi, kecamatan, postal_code, address, area_id, product_types, description, latitude, longitude, parent_store_id } = req.body;
        if (!parent_store_id) {
            // Jika tidak ada parent, ini adalah toko utama. User hanya boleh punya 1 toko utama.
            const existingMain = await (0, knex_1.default)('stores').where({ owner_id: req.user.id, is_main_branch: true }).first();
            if (existingMain) {
                res.status(409).json({ success: false, error: 'Anda sudah memiliki toko utama. Silakan tambahkan sebagai cabang.' });
                return;
            }
        }
        else {
            // Cabang. Pastikan parent_store_id valid dan dimiliki oleh user.
            const parentStore = await (0, knex_1.default)('stores').where({ id: parent_store_id, owner_id: req.user.id }).first();
            if (!parentStore) {
                res.status(404).json({ success: false, error: 'Toko utama tidak referensial atau bukan milik Anda' });
                return;
            }
        }
        if (!name || !kabupaten || !provinsi) {
            res.status(400).json({ success: false, error: 'name, kabupaten, provinsi wajib' });
            return;
        }
        // Generate store code unik
        const storeCode = `TM-${Math.floor(1000 + Math.random() * 9000)}`;
        const id = (0, uuid_1.v4)();
        const now = new Date().toISOString();
        await (0, knex_1.default)('stores').insert({
            id, owner_id: req.user.id, store_code: storeCode,
            name, kabupaten, provinsi,
            kecamatan: kecamatan || null,
            postal_code: postal_code || null,
            address: address || null,
            area_id: area_id || null,
            latitude: latitude || null, longitude: longitude || null,
            product_types: JSON.stringify(product_types || []),
            description: description || null,
            parent_store_id: parent_store_id || null,
            is_main_branch: parent_store_id ? false : true,
            is_active: true, rating: 0, total_orders: 0,
            created_at: now, updated_at: now,
        });
        res.status(201).json({ success: true, data: await (0, knex_1.default)('stores').where({ id }).first() });
    }
    catch (err) {
        console.error('Create store error:', err);
        res.status(500).json({ success: false, error: 'Gagal buat toko' });
    }
});
/** PATCH /api/stores/:id */
router.patch('/:id', auth_1.requireAuth, async (req, res) => {
    try {
        const store = await (0, knex_1.default)('stores').where({ id: req.params.id, owner_id: req.user.id }).first();
        if (!store) {
            res.status(404).json({ success: false, error: 'Toko tidak ditemukan' });
            return;
        }
        await (0, knex_1.default)('stores').where({ id: req.params.id }).update({ ...req.body, updated_at: new Date().toISOString() });
        res.json({ success: true, data: await (0, knex_1.default)('stores').where({ id: req.params.id }).first() });
    }
    catch {
        res.status(500).json({ success: false, error: 'Gagal update toko' });
    }
});
exports.default = router;
//# sourceMappingURL=stores.js.map
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
/** GET /api/stores/me — Toko milik sendiri */
router.get('/me', auth_1.requireAuth, async (req, res) => {
    try {
        const store = await (0, knex_1.default)('stores').where({ owner_id: req.user.id }).first();
        res.json({ success: true, data: store || null });
    }
    catch {
        res.status(500).json({ success: false, error: 'Gagal fetch toko' });
    }
});
/** POST /api/stores — Daftar toko baru */
router.post('/', auth_1.requireAuth, async (req, res) => {
    try {
        const existing = await (0, knex_1.default)('stores').where({ owner_id: req.user.id }).first();
        if (existing) {
            res.status(409).json({ success: false, error: 'Anda sudah memiliki toko' });
            return;
        }
        const { name, kabupaten, provinsi, kecamatan, postal_code, address, area_id, product_types, description, latitude, longitude } = req.body;
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
            is_active: true, rating: 0, total_orders: 0,
            created_at: now, updated_at: now,
        });
        res.status(201).json({ success: true, data: await (0, knex_1.default)('stores').where({ id }).first() });
    }
    catch {
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
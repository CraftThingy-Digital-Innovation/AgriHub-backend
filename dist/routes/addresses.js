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
// GET /api/users/addresses -> Get list of addresses for the logged in user
router.get('/', auth_1.requireAuth, async (req, res) => {
    try {
        const addresses = await (0, knex_1.default)('user_addresses')
            .where({ user_id: req.user.id })
            .orderBy('is_default', 'desc')
            .orderBy('created_at', 'desc');
        res.json({ success: true, data: addresses });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Gagal mengambil alamat' });
    }
});
// POST /api/users/addresses -> Add new address
router.post('/', auth_1.requireAuth, async (req, res) => {
    try {
        const { label, recipient_name, recipient_phone, full_address, provinsi, kabupaten, kecamatan, postal_code, latitude, longitude, biteship_area_id, is_default } = req.body;
        // If this is set to default, unset other defaults
        if (is_default) {
            await (0, knex_1.default)('user_addresses').where({ user_id: req.user.id }).update({ is_default: false });
        }
        const id = (0, uuid_1.v4)();
        await (0, knex_1.default)('user_addresses').insert({
            id,
            user_id: req.user.id,
            label: label || 'Alamat',
            recipient_name,
            recipient_phone,
            full_address,
            provinsi,
            kabupaten,
            kecamatan,
            postal_code,
            latitude,
            longitude,
            biteship_area_id,
            is_default: is_default ? true : false,
        });
        const newAddress = await (0, knex_1.default)('user_addresses').where({ id }).first();
        res.status(201).json({ success: true, data: newAddress });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Gagal menyimpan alamat baru' });
    }
});
// DELETE /api/users/addresses/:id -> Delete an address
router.delete('/:id', auth_1.requireAuth, async (req, res) => {
    try {
        const deleted = await (0, knex_1.default)('user_addresses')
            .where({ id: req.params.id, user_id: req.user.id })
            .del();
        if (deleted)
            res.json({ success: true });
        else
            res.status(404).json({ success: false, error: 'Alamat tidak ditemukan' });
    }
    catch {
        res.status(500).json({ success: false, error: 'Gagal menghapus alamat' });
    }
});
exports.default = router;
//# sourceMappingURL=addresses.js.map
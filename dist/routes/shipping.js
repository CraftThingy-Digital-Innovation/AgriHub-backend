"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const uuid_1 = require("uuid");
const knex_1 = __importDefault(require("../config/knex"));
const auth_1 = require("../middleware/auth");
const biteshipService_1 = require("../services/biteshipService");
const router = (0, express_1.Router)();
// ─── POST /api/shipping/check-ongkir ─────────────────────────────────────
router.post('/check-ongkir', async (req, res) => {
    try {
        const { origin_postal_code, destination_postal_code, weight_gram, couriers } = req.body;
        if (!origin_postal_code || !destination_postal_code || !weight_gram) {
            res.status(400).json({ success: false, error: 'origin_postal_code, destination_postal_code, weight_gram wajib' });
            return;
        }
        const rates = await (0, biteshipService_1.checkOngkir)({ origin_postal_code, destination_postal_code, weight_gram: Number(weight_gram), couriers });
        res.json({ success: true, data: rates });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message || 'Gagal cek ongkir' });
    }
});
// ─── POST /api/shipping/book ──────────────────────────────────────────────
router.post('/book', auth_1.requireAuth, async (req, res) => {
    try {
        const { order_id, courier_code, courier_service, items, origin, destination } = req.body;
        if (!order_id || !courier_code || !courier_service) {
            res.status(400).json({ success: false, error: 'order_id, courier_code, courier_service wajib' });
            return;
        }
        const order = await (0, knex_1.default)('orders').where({ id: order_id, seller_id: req.user.id }).first();
        if (!order) {
            res.status(404).json({ success: false, error: 'Pesanan tidak ditemukan atau bukan milik Anda' });
            return;
        }
        if (!['dibayar', 'diproses'].includes(order.status)) {
            res.status(400).json({ success: false, error: 'Pesanan harus berstatus "dibayar" dulu' });
            return;
        }
        const shipment = await (0, biteshipService_1.createShipment)({
            orderId: order_id, origin, destination, courier_code, courier_service,
            items: items || [{ name: 'Produk Pertanian', quantity: order.quantity, value: order.total_amount, weight: 1000 }],
        });
        // Update order dengan resi
        await (0, knex_1.default)('orders').where({ id: order_id }).update({
            status: 'dikirim',
            shipping_resi: shipment.waybill_id,
            shipping_courier: courier_code,
            biteship_order_id: shipment.shipment_id,
            updated_at: new Date().toISOString(),
        });
        // Simpan ke shipment_orders
        await (0, knex_1.default)('shipment_orders').insert({
            id: (0, uuid_1.v4)(), order_id,
            courier: courier_code, service: courier_service,
            waybill_id: shipment.waybill_id,
            biteship_order_id: shipment.shipment_id,
            tracking_id: shipment.tracking_id,
            status: 'booked',
            created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        });
        res.json({ success: true, data: shipment });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message || 'Gagal booking pengiriman' });
    }
});
// ─── GET /api/shipping/track/:waybillId ──────────────────────────────────
router.get('/track/:waybillId', auth_1.requireAuth, async (req, res) => {
    try {
        const { courier } = req.query;
        if (!courier) {
            res.status(400).json({ success: false, error: 'Query "courier" wajib' });
            return;
        }
        // Cek cache dulu (simpan 30 menit)
        const cached = await (0, knex_1.default)('shipment_tracking_cache')
            .where({ waybill_id: req.params.waybillId })
            .where('fetched_at', '>', new Date(Date.now() - 30 * 60 * 1000).toISOString())
            .first();
        if (cached) {
            res.json({ success: true, data: JSON.parse(cached.response_data), cached: true });
            return;
        }
        const tracking = await (0, biteshipService_1.trackShipment)(req.params.waybillId, String(courier));
        // Update cache
        await (0, knex_1.default)('shipment_tracking_cache').insert({
            id: (0, uuid_1.v4)(), waybill_id: req.params.waybillId, courier: String(courier),
            response_data: JSON.stringify(tracking),
            fetched_at: new Date().toISOString(),
        }).onConflict('waybill_id').merge();
        res.json({ success: true, data: tracking });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message || 'Gagal tracking resi' });
    }
});
// ─── GET /api/shipping/search-area ───────────────────────────────────────
router.get('/search-area', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) {
            res.status(400).json({ success: false, error: 'Query "q" wajib' });
            return;
        }
        const areas = await (0, biteshipService_1.searchArea)(String(q));
        res.json({ success: true, data: { areas } });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message || 'Gagal cari area' });
    }
});
exports.default = router;
//# sourceMappingURL=shipping.js.map
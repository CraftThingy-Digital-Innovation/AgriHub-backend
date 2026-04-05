"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const uuid_1 = require("uuid");
const knex_1 = __importDefault(require("../config/knex"));
const auth_1 = require("../middleware/auth");
const shared_1 = require("../shared");
const router = (0, express_1.Router)();
/** POST /api/orders — Buat pesanan baru */
router.post('/', auth_1.requireAuth, async (req, res) => {
    try {
        const { product_id, quantity, notes } = req.body;
        if (!product_id || !quantity) {
            res.status(400).json({ success: false, error: 'product_id dan quantity wajib' });
            return;
        }
        const product = await (0, knex_1.default)('products').where({ id: product_id, is_active: true }).first();
        if (!product) {
            res.status(404).json({ success: false, error: 'Produk tidak ditemukan' });
            return;
        }
        if (product.stock_quantity < quantity) {
            res.status(400).json({ success: false, error: `Stok tidak cukup (tersedia: ${product.stock_quantity} ${product.unit})` });
            return;
        }
        const store = await (0, knex_1.default)('stores').where({ id: product.store_id }).first();
        const total_amount = Math.round(product.price_per_unit * quantity);
        const fees = (0, shared_1.calculateFees)(total_amount);
        const id = (0, uuid_1.v4)();
        const now = new Date().toISOString();
        await (0, knex_1.default)('orders').insert({
            id, buyer_id: req.user.id, seller_id: store.owner_id,
            store_id: product.store_id, product_id,
            quantity, unit_price: product.price_per_unit,
            total_amount,
            platform_fee: fees.platformFee,
            ppn_fee: fees.ppnAmount,
            midtrans_mdr: fees.midtransMdr,
            seller_net: fees.sellerAmount,
            status: 'pending', notes: notes || null,
            created_at: now, updated_at: now,
        });
        res.status(201).json({ success: true, data: await (0, knex_1.default)('orders').where({ id }).first() });
    }
    catch {
        res.status(500).json({ success: false, error: 'Gagal buat pesanan' });
    }
});
/** GET /api/orders/stats — Agregasi statistik penjual (Multi-cabang) */
router.get('/stats', auth_1.requireAuth, async (req, res) => {
    try {
        // 1. Distribusi Cabang (Store Contribution)
        // Mengelompokkan berdasarkan store_id untuk pesanan berstatus selesai/dibayar/dikirim
        const storeStatsRaw = await (0, knex_1.default)('orders')
            .join('stores', 'orders.store_id', 'stores.id')
            .where('orders.seller_id', req.user.id)
            .whereIn('orders.status', ['dibayar', 'diproses', 'dikirim', 'diterima', 'selesai'])
            .select('stores.id as store_id', 'stores.name as store_name')
            .sum('orders.seller_net as total_net')
            .count('orders.id as order_count')
            .groupBy('stores.id', 'stores.name');
        // 2. Trend Harian (7 Hari Terakhir)
        // Menggunakan SQLite date() function
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const dateStr = sevenDaysAgo.toISOString().split('T')[0];
        const dailyTrendsRaw = await (0, knex_1.default)('orders')
            .where('seller_id', req.user.id)
            .whereIn('status', ['dibayar', 'diproses', 'dikirim', 'diterima', 'selesai'])
            .where('created_at', '>=', dateStr)
            .select(knex_1.default.raw('date(created_at) as order_date'))
            .sum('seller_net as total_net')
            .count('id as order_count')
            .groupBy(knex_1.default.raw('date(created_at)'))
            .orderBy('order_date', 'asc');
        res.json({
            success: true,
            data: {
                stores: storeStatsRaw.map((s) => ({
                    store_id: s.store_id,
                    store_name: s.store_name,
                    total_revenue: Number(s.total_net || 0),
                    order_count: Number(s.order_count || 0)
                })),
                trends: dailyTrendsRaw.map((t) => ({
                    date: t.order_date,
                    revenue: Number(t.total_net || 0),
                    orders: Number(t.order_count || 0)
                }))
            }
        });
    }
    catch (err) {
        console.error('Stats error:', err);
        res.status(500).json({ success: false, error: 'Gagal fetch statistik' });
    }
});
/** GET /api/orders — List pesanan user */
router.get('/', auth_1.requireAuth, async (req, res) => {
    try {
        const { role = 'buyer', status } = req.query;
        let query = (0, knex_1.default)('orders')
            .join('products', 'orders.product_id', 'products.id')
            .join('stores', 'orders.store_id', 'stores.id')
            .select('orders.*', 'products.name as product_name', 'products.unit', 'stores.name as store_name');
        if (role === 'seller') {
            query = query.where('orders.seller_id', req.user.id);
        }
        else {
            query = query.where('orders.buyer_id', req.user.id);
        }
        if (status)
            query = query.where('orders.status', status);
        const orders = await query.orderBy('orders.created_at', 'desc');
        res.json({ success: true, data: orders });
    }
    catch {
        res.status(500).json({ success: false, error: 'Gagal fetch pesanan' });
    }
});
/** PATCH /api/orders/:id/status — Update status pesanan */
router.patch('/:id/status', auth_1.requireAuth, async (req, res) => {
    try {
        const { status, shipping_resi, shipping_courier, dispute_reason } = req.body;
        const order = await (0, knex_1.default)('orders').where({ id: req.params.id }).first();
        if (!order) {
            res.status(404).json({ success: false, error: 'Pesanan tidak ditemukan' });
            return;
        }
        const isBuyer = order.buyer_id === req.user.id;
        const isSeller = order.seller_id === req.user.id;
        // Validasi transisi status
        const allowed = {
            seller: ['diproses', 'dikirim', 'dibatalkan'],
            buyer: ['diterima', 'banding', 'dibatalkan'],
        };
        if (isSeller && !allowed.seller.includes(status)) {
            res.status(400).json({ success: false, error: 'Status tidak valid untuk seller' });
            return;
        }
        if (isBuyer && !allowed.buyer.includes(status)) {
            res.status(400).json({ success: false, error: 'Status tidak valid untuk buyer' });
            return;
        }
        if (!isBuyer && !isSeller) {
            res.status(403).json({ success: false, error: 'Bukan bagian dari pesanan ini' });
            return;
        }
        // Hanya bisa dibatalkan jika belum dibayar (pending / menunggu_bayar)
        if (status === 'dibatalkan' && !['pending', 'menunggu_bayar'].includes(order.status)) {
            res.status(400).json({ success: false, error: 'Pesanan tidak bisa dibatalkan karena sudah dibayar/diproses' });
            return;
        }
        const updateData = { status, updated_at: new Date().toISOString() };
        if (shipping_resi)
            updateData.shipping_resi = shipping_resi;
        if (shipping_courier)
            updateData.shipping_courier = shipping_courier;
        if (dispute_reason)
            updateData.dispute_reason = dispute_reason;
        // Release escrow jika diterima
        if (status === 'diterima' || status === 'selesai') {
            updateData.escrow_released_at = new Date().toISOString();
            // TODO: Release wallet ke seller via walletService
        }
        await (0, knex_1.default)('orders').where({ id: req.params.id }).update(updateData);
        res.json({ success: true, data: await (0, knex_1.default)('orders').where({ id: req.params.id }).first() });
    }
    catch {
        res.status(500).json({ success: false, error: 'Gagal update status' });
    }
});
exports.default = router;
//# sourceMappingURL=orders.js.map
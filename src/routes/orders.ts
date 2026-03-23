import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/knex';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { calculateFees, ESCROW_AUTO_RELEASE_DAYS } from '@agrihub/shared';

const router = Router();

/** POST /api/orders — Buat pesanan baru */
router.post('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { product_id, quantity, notes } = req.body;
    if (!product_id || !quantity) {
      res.status(400).json({ success: false, error: 'product_id dan quantity wajib' });
      return;
    }
    const product = await db('products').where({ id: product_id, is_active: true }).first();
    if (!product) { res.status(404).json({ success: false, error: 'Produk tidak ditemukan' }); return; }
    if (product.stock_quantity < quantity) {
      res.status(400).json({ success: false, error: `Stok tidak cukup (tersedia: ${product.stock_quantity} ${product.unit})` });
      return;
    }
    const store = await db('stores').where({ id: product.store_id }).first();
    const total_amount = Math.round(product.price_per_unit * quantity);
    const fees = calculateFees(total_amount);
    const id = uuidv4();
    const now = new Date().toISOString();
    await db('orders').insert({
      id, buyer_id: req.user!.id, seller_id: store.owner_id,
      store_id: product.store_id, product_id,
      quantity, unit_price: product.price_per_unit,
      total_amount, ...fees,
      status: 'pending', notes: notes || null,
      created_at: now, updated_at: now,
    });
    res.status(201).json({ success: true, data: await db('orders').where({ id }).first() });
  } catch { res.status(500).json({ success: false, error: 'Gagal buat pesanan' }); }
});

/** GET /api/orders — List pesanan user */
router.get('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { role = 'buyer', status } = req.query;
    let query = db('orders')
      .join('products', 'orders.product_id', 'products.id')
      .join('stores', 'orders.store_id', 'stores.id')
      .select('orders.*', 'products.name as product_name', 'products.unit', 'stores.name as store_name');

    if (role === 'seller') { query = query.where('orders.seller_id', req.user!.id); }
    else { query = query.where('orders.buyer_id', req.user!.id); }
    if (status) query = query.where('orders.status', status as string);

    const orders = await query.orderBy('orders.created_at', 'desc');
    res.json({ success: true, data: orders });
  } catch { res.status(500).json({ success: false, error: 'Gagal fetch pesanan' }); }
});

/** PATCH /api/orders/:id/status — Update status pesanan */
router.patch('/:id/status', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, shipping_resi, shipping_courier, dispute_reason } = req.body;
    const order = await db('orders').where({ id: req.params.id }).first();
    if (!order) { res.status(404).json({ success: false, error: 'Pesanan tidak ditemukan' }); return; }

    const isBuyer = order.buyer_id === req.user!.id;
    const isSeller = order.seller_id === req.user!.id;

    // Validasi transisi status
    const allowed: Record<string, string[]> = {
      seller: ['diproses', 'dikirim'],
      buyer: ['diterima', 'banding'],
    };
    if (isSeller && !allowed.seller.includes(status)) {
      res.status(400).json({ success: false, error: 'Status tidak valid untuk seller' }); return;
    }
    if (isBuyer && !allowed.buyer.includes(status)) {
      res.status(400).json({ success: false, error: 'Status tidak valid untuk buyer' }); return;
    }
    if (!isBuyer && !isSeller) {
      res.status(403).json({ success: false, error: 'Bukan bagian dari pesanan ini' }); return;
    }

    const updateData: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
    if (shipping_resi) updateData.shipping_resi = shipping_resi;
    if (shipping_courier) updateData.shipping_courier = shipping_courier;
    if (dispute_reason) updateData.dispute_reason = dispute_reason;

    // Release escrow jika diterima
    if (status === 'diterima' || status === 'selesai') {
      updateData.escrow_released_at = new Date().toISOString();
      // TODO: Release wallet ke seller via walletService
    }

    await db('orders').where({ id: req.params.id }).update(updateData);
    res.json({ success: true, data: await db('orders').where({ id: req.params.id }).first() });
  } catch { res.status(500).json({ success: false, error: 'Gagal update status' }); }
});

export default router;

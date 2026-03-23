import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import Midtrans from 'midtrans-client';
import db from '../config/knex';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { calculateFees } from '../shared';

const router = Router();

// ─── Midtrans Snap Client ─────────────────────────────────────────────────
const snap = new Midtrans.Snap({
  isProduction: process.env.NODE_ENV === 'production',
  serverKey: process.env.MIDTRANS_SERVER_KEY || '',
  clientKey: process.env.MIDTRANS_CLIENT_KEY || '',
});

// ─── POST /api/payment/create — Buat transaksi Midtrans Snap ──────────────
router.post('/create', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { order_id } = req.body;
    if (!order_id) { res.status(400).json({ success: false, error: 'order_id wajib' }); return; }

    const order = await db('orders')
      .join('products', 'orders.product_id', 'products.id')
      .join('stores', 'orders.store_id', 'stores.id')
      .join('users as buyer', 'orders.buyer_id', 'buyer.id')
      .where('orders.id', order_id)
      .where('orders.buyer_id', req.user!.id)
      .select('orders.*', 'products.name as product_name', 'buyer.name as buyer_name', 'buyer.phone as buyer_phone')
      .first();

    if (!order) { res.status(404).json({ success: false, error: 'Pesanan tidak ditemukan' }); return; }
    if (order.status !== 'pending') { res.status(400).json({ success: false, error: 'Pesanan sudah dibayar atau dibatalkan' }); return; }

    const transactionDetails = {
      transaction_details: {
        order_id: `AGRIHUB-${order_id.slice(-8).toUpperCase()}`,
        gross_amount: Math.round(order.total_amount + (order.platform_fee || 0) + (order.ppn_amount || 0)),
      },
      customer_details: {
        first_name: order.buyer_name,
        phone: order.buyer_phone,
      },
      item_details: [
        {
          id: order.product_id,
          name: order.product_name.slice(0, 50),
          price: Math.round(order.unit_price),
          quantity: order.quantity,
        },
        ...(order.platform_fee > 0 ? [{
          id: 'platform-fee',
          name: 'Platform AgriHub (2%)',
          price: Math.round(order.platform_fee),
          quantity: 1,
        }] : []),
        ...(order.ppn_amount > 0 ? [{
          id: 'ppn',
          name: 'PPN 11%',
          price: Math.round(order.ppn_amount),
          quantity: 1,
        }] : []),
      ],
      callbacks: {
        finish: `${process.env.CLIENT_URL || 'http://localhost:5173'}/app/pesanan`,
      },
    };

    const transaction = await snap.createTransaction(transactionDetails);

    // Simpan payment token ke order
    await db('orders').where({ id: order_id }).update({
      payment_token: transaction.token,
      payment_url: transaction.redirect_url,
      status: 'menunggu_bayar',
      updated_at: new Date().toISOString(),
    });

    res.json({
      success: true,
      data: {
        token: transaction.token,
        redirect_url: transaction.redirect_url,
        order_id,
        gross_amount: transactionDetails.transaction_details.gross_amount,
      },
    });
  } catch (err) {
    console.error('Midtrans create error:', err);
    res.status(500).json({ success: false, error: 'Gagal membuat transaksi pembayaran' });
  }
});

// ─── POST /api/payment/webhook — Midtrans Notification Webhook ────────────
router.post('/webhook', async (req, res): Promise<void> => {
  try {
    const notification = req.body;
    console.log('Midtrans webhook:', notification);

    // Verifikasi notifikasi dari Midtrans
    const statusResponse = await snap.transaction.notification(notification);
    const orderId = statusResponse.order_id.replace('AGRIHUB-', '').toLowerCase();
    const transactionStatus = statusResponse.transaction_status;
    const fraudStatus = statusResponse.fraud_status;

    // Cari order berdasarkan 8 karakter terakhir ID
    const order = await db('orders').whereRaw('UPPER(SUBSTR(id, -8)) = ?', [orderId.toUpperCase()]).first();

    if (!order) {
      console.warn('Order tidak ditemukan untuk webhook:', orderId);
      res.status(200).json({ status: 'ignored' });
      return;
    }

    let newStatus = order.status;

    if (transactionStatus === 'capture' && fraudStatus === 'accept') {
      newStatus = 'dibayar';
    } else if (transactionStatus === 'settlement') {
      newStatus = 'dibayar';
    } else if (['cancel', 'deny', 'expire'].includes(transactionStatus)) {
      newStatus = 'dibatalkan';
    } else if (transactionStatus === 'pending') {
      newStatus = 'menunggu_bayar';
    }

    await db('orders').where({ id: order.id }).update({
      status: newStatus,
      payment_status: transactionStatus,
      paid_at: newStatus === 'dibayar' ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    });

    // Jika dibayar: tambah ke pending wallet seller (escrow)
    if (newStatus === 'dibayar') {
      await db('wallets')
        .where({ user_id: order.seller_id })
        .increment('pending_balance', order.seller_amount || order.total_amount);

      await db('wallet_transactions').insert({
        id: uuidv4(),
        wallet_id: (await db('wallets').where({ user_id: order.seller_id }).first()).id,
        order_id: order.id,
        type: 'escrow_in',
        amount: order.seller_amount || order.total_amount,
        description: `Escrow pesanan #${order.id.slice(-8)}`,
        status: 'pending',
        created_at: new Date().toISOString(),
      });
    }

    res.status(200).json({ status: 'ok' });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(200).json({ status: 'error', message: (err as Error).message });
  }
});

// ─── GET /api/payment/status/:orderId ─────────────────────────────────────
router.get('/status/:orderId', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const order = await db('orders').where({ id: req.params.orderId }).first();
    if (!order) { res.status(404).json({ success: false, error: 'Pesanan tidak ditemukan' }); return; }
    if (order.buyer_id !== req.user!.id && order.seller_id !== req.user!.id) {
      res.status(403).json({ success: false, error: 'Bukan bagian dari pesanan ini' }); return;
    }
    res.json({
      success: true, data: {
        status: order.status, payment_status: order.payment_status,
        payment_url: order.payment_url, paid_at: order.paid_at,
      },
    });
  } catch { res.status(500).json({ success: false, error: 'Gagal cek status' }); }
});

export default router;

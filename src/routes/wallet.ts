import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/knex';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// ─── GET /api/wallet/me — Saldo dompet user ───────────────────────────────
router.get('/me', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const wallet = await db('wallets').where({ user_id: req.user!.id }).first();
    if (!wallet) { res.status(404).json({ success: false, error: 'Wallet tidak ditemukan' }); return; }
    res.json({ success: true, data: wallet });
  } catch { res.status(500).json({ success: false, error: 'Gagal fetch wallet' }); }
});

// ─── GET /api/wallet/transactions — Riwayat transaksi ─────────────────────
router.get('/transactions', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const wallet = await db('wallets').where({ user_id: req.user!.id }).first();
    if (!wallet) { res.status(404).json({ success: false, error: 'Wallet tidak ditemukan' }); return; }

    const { type, page = 1, limit = 20 } = req.query as Record<string, string>;
    let query = db('wallet_transactions').where({ wallet_id: wallet.id });
    if (type) query = query.where({ type });

    const txs = await query
      .orderBy('created_at', 'desc')
      .limit(Number(limit))
      .offset((Number(page) - 1) * Number(limit));

    res.json({ success: true, data: txs });
  } catch { res.status(500).json({ success: false, error: 'Gagal fetch transaksi' }); }
});

// ─── POST /api/wallet/release-escrow — Release escrow ke seller ───────────
// Dipanggil otomatis setelah buyer konfirmasi 'diterima', atau auto 7 hari
router.post('/release-escrow', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { order_id } = req.body;
    if (!order_id) { res.status(400).json({ success: false, error: 'order_id wajib' }); return; }

    const order = await db('orders').where({ id: order_id }).first();
    if (!order) { res.status(404).json({ success: false, error: 'Pesanan tidak ditemukan' }); return; }
    if (order.buyer_id !== req.user!.id && req.user!.role !== 'admin') {
      res.status(403).json({ success: false, error: 'Tidak berhak release escrow' }); return;
    }
    if (!['diterima', 'selesai'].includes(order.status)) {
      res.status(400).json({ success: false, error: 'Pesanan belum diterima buyer' }); return;
    }
    if (order.escrow_released_at) {
      res.status(400).json({ success: false, error: 'Escrow sudah pernah di-release' }); return;
    }

    const releaseAmount = order.seller_amount || order.total_amount;
    const sellerWallet = await db('wallets').where({ user_id: order.seller_id }).first();
    if (!sellerWallet) { res.status(404).json({ success: false, error: 'Wallet seller tidak ditemukan' }); return; }

    await db.transaction(async trx => {
      // Pindah dari pending ke saldo utama
      await trx('wallets').where({ user_id: order.seller_id })
        .decrement('pending_balance', releaseAmount)
        .increment('balance', releaseAmount)
        .increment('total_earned', releaseAmount);

      // Catat transaksi
      await trx('wallet_transactions').insert({
        id: uuidv4(), wallet_id: sellerWallet.id, order_id,
        type: 'escrow_release',
        amount: releaseAmount,
        description: `Dana pesanan #${order_id.slice(-8)} diterima`,
        status: 'completed',
        created_at: new Date().toISOString(),
      });

      // Update order
      await trx('orders').where({ id: order_id }).update({
        escrow_released_at: new Date().toISOString(),
        status: 'selesai',
        updated_at: new Date().toISOString(),
      });
    });

    res.json({ success: true, data: { released_amount: releaseAmount, message: 'Escrow berhasil di-release ke seller' } });
  } catch { res.status(500).json({ success: false, error: 'Gagal release escrow' }); }
});

// ─── POST /api/wallet/withdraw — Tarik dana ke rekening bank ──────────────
router.post('/withdraw', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { amount, bank_name, account_number, account_name } = req.body;
    if (!amount || !bank_name || !account_number || !account_name) {
      res.status(400).json({ success: false, error: 'amount, bank_name, account_number, account_name wajib' }); return;
    }
    const withdrawAmount = Number(amount);
    if (withdrawAmount < 50000) {
      res.status(400).json({ success: false, error: 'Minimal penarikan Rp 50.000' }); return;
    }

    const wallet = await db('wallets').where({ user_id: req.user!.id }).first();
    if (!wallet) { res.status(404).json({ success: false, error: 'Wallet tidak ditemukan' }); return; }
    if (wallet.balance < withdrawAmount) {
      res.status(400).json({ success: false, error: `Saldo tidak cukup (saldo: Rp${wallet.balance.toLocaleString('id-ID')})` }); return;
    }

    await db.transaction(async trx => {
      await trx('wallets').where({ user_id: req.user!.id })
        .decrement('balance', withdrawAmount)
        .increment('total_withdrawn', withdrawAmount);

      await trx('wallet_transactions').insert({
        id: uuidv4(), wallet_id: wallet.id,
        type: 'withdrawal',
        amount: -withdrawAmount,
        description: `Penarikan ke ${bank_name} ${account_number} a/n ${account_name}`,
        metadata: JSON.stringify({ bank_name, account_number, account_name }),
        status: 'pending',
        created_at: new Date().toISOString(),
      });
    });

    res.json({ success: true, data: { message: 'Permintaan penarikan berhasil. Diproses dalam 1-2 hari kerja.' } });
  } catch { res.status(500).json({ success: false, error: 'Gagal proses penarikan' }); }
});

export default router;

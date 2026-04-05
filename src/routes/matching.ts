import { Router, Response } from 'express';
import db from '../config/knex';
import { requireAuth, AuthRequest } from '../middleware/auth';
import * as matchingService from '../services/matchingService';

const router = Router();

// ─── POST /api/matching/demand — Lapor kebutuhan (Wishlist) ────────────────
router.post('/demand', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { komoditas, jumlah_kg, harga_max_per_kg, address_id } = req.body;
    if (!komoditas || !jumlah_kg || !harga_max_per_kg || !address_id) {
      res.status(400).json({ success: false, error: 'komoditas, jumlah_kg, harga_max_per_kg, address_id wajib' }); return;
    }

    // Pastikan address_id milik user ini
    const address = await db('user_addresses').where({ id: address_id, user_id: req.user!.id }).first();
    if (!address) {
        res.status(403).json({ success: false, error: 'Alamat tidak ditemukan atau bukan milik Anda' }); return;
    }

    const result = await matchingService.createWishlist(req.user!.id, {
      komoditas,
      jumlah_kg: Number(jumlah_kg),
      harga_max_per_kg: Number(harga_max_per_kg),
      address_id
    });

    res.status(201).json({ success: true, data: { id: result.id, matches_found: result.matchesFound } });
  } catch (err) { res.status(500).json({ success: false, error: (err as Error).message }); }
});

// ─── GET /api/matching/feed — List matches yang relevan ──────────────────
router.get('/feed', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const feed = await matchingService.getMatchesForUser(req.user!.id);
    res.json({ success: true, data: feed });
  } catch (err) { res.status(500).json({ success: false, error: 'Gagal fetch feed matching: ' + (err as Error).message }); }
});

// ─── DELETE /api/matching/demand/:id — Hapus Wishlist ───────────────────
router.delete('/demand/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const demand = await db('demand_requests').where({ id: req.params.id, requester_id: req.user!.id }).first();
        if (!demand) { res.status(404).json({ success: false, error: 'Wishlist tidak ditemukan' }); return; }
        
        await db('demand_requests').where({ id: req.params.id }).update({ is_active: false });
        res.json({ success: true, message: 'Wishlist dinonaktifkan' });
    } catch { res.status(500).json({ success: false, error: 'Gagal hapus wishlist' }); }
});

export default router;

import { Router, Response } from 'express';
import db from '../config/knex';
import { requireAuth, AuthRequest } from '../middleware/auth';
import * as matchingService from '../services/matchingService';

const router = Router();

// ─── POST /api/matching/supply — Lapor surplus stok ──────────────────────
router.post('/supply', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { komoditas, jumlah_kg, harga_per_kg, kabupaten, provinsi, tanggal_tersedia } = req.body;
    if (!komoditas || !jumlah_kg || !harga_per_kg || !kabupaten) {
      res.status(400).json({ success: false, error: 'komoditas, jumlah_kg, harga_per_kg, kabupaten wajib' }); return;
    }
    
    const result = await matchingService.reportSupply(req.user!.id, {
      komoditas,
      jumlah_kg: Number(jumlah_kg),
      harga_per_kg: Number(harga_per_kg),
      kabupaten,
      provinsi,
      tanggal_tersedia
    });

    res.status(201).json({ success: true, data: { id: result.id, matches_found: result.matchesFound } });
  } catch (err) { res.status(500).json({ success: false, error: (err as Error).message }); }
});

// ─── POST /api/matching/demand — Lapor kebutuhan ─────────────────────────
router.post('/demand', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { komoditas, jumlah_kg, harga_max_per_kg, kabupaten, deadline } = req.body;
    if (!komoditas || !jumlah_kg || !harga_max_per_kg || !kabupaten) {
      res.status(400).json({ success: false, error: 'komoditas, jumlah_kg, harga_max_per_kg, kabupaten wajib' }); return;
    }

    const result = await matchingService.reportDemand(req.user!.id, {
      komoditas,
      jumlah_kg: Number(jumlah_kg),
      harga_max_per_kg: Number(harga_max_per_kg),
      kabupaten,
      deadline
    });

    res.status(201).json({ success: true, data: { id: result.id, matches_found: result.matchesFound } });
  } catch (err) { res.status(500).json({ success: false, error: (err as Error).message }); }
});

// ─── GET /api/matching/feed — List matches yang relevan ──────────────────
router.get('/feed', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { provinsi } = req.query;
    let query = db('match_history')
      .join('supply_reports', 'match_history.supply_id', 'supply_reports.id')
      .join('demand_requests', 'match_history.demand_id', 'demand_requests.id')
      .join('komoditas', 'supply_reports.komoditas', 'komoditas.nama')
      .where('supply_reports.is_active', true)
      .orderBy('match_history.score', 'desc')
      .select(
        'match_history.*',
        'komoditas.nama as komoditas_nama',
        'supply_reports.kabupaten as supply_kabupaten',
        'supply_reports.provinsi as supply_provinsi',
        'demand_requests.kota_tujuan as demand_kabupaten',
      )
      .limit(20);

    if (provinsi) query = query.where(function() {
      this.where('supply_reports.provinsi', provinsi);
    });

    const feed = await query;
    res.json({ success: true, data: feed });
  } catch (err) { res.status(500).json({ success: false, error: 'Gagal fetch feed matching: ' + (err as Error).message }); }
});

// ─── GET /api/matching/my-supply ─────────────────────────────────────────
router.get('/my-supply', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const reports = await db('supply_reports')
      .where('supply_reports.reporter_id', req.user!.id)
      .orderBy('supply_reports.created_at', 'desc');
    res.json({ success: true, data: reports });
  } catch { res.status(500).json({ success: false, error: 'Gagal fetch supply' }); }
});

export default router;

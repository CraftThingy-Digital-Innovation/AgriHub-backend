import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/knex';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// ─── POST /api/matching/supply — Lapor surplus stok ──────────────────────
router.post('/supply', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { komoditas_id, quantity_kg, price_per_kg, available_from, available_until, kabupaten, provinsi, latitude, longitude } = req.body;
    if (!komoditas_id || !quantity_kg || !price_per_kg || !kabupaten) {
      res.status(400).json({ success: false, error: 'komoditas_id, quantity_kg, price_per_kg, kabupaten wajib' }); return;
    }
    const id = uuidv4(); const now = new Date().toISOString();
    await db('supply_reports').insert({
      id, user_id: req.user!.id, komoditas_id,
      quantity_kg: Number(quantity_kg), price_per_kg: Number(price_per_kg),
      available_from: available_from || now, available_until: available_until || null,
      kabupaten, provinsi: provinsi || '', latitude: latitude || null, longitude: longitude || null,
      is_matched: false, created_at: now, updated_at: now,
    });
    // Auto-run matching
    const matches = await runMatchingFor(id, 'supply');
    res.status(201).json({ success: true, data: { id, matches_found: matches.length } });
  } catch (err) { res.status(500).json({ success: false, error: (err as Error).message }); }
});

// ─── POST /api/matching/demand — Lapor kebutuhan ─────────────────────────
router.post('/demand', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { komoditas_id, quantity_kg, max_price_per_kg, needed_by, kabupaten, provinsi } = req.body;
    if (!komoditas_id || !quantity_kg || !max_price_per_kg || !kabupaten) {
      res.status(400).json({ success: false, error: 'komoditas_id, quantity_kg, max_price_per_kg, kabupaten wajib' }); return;
    }
    const id = uuidv4(); const now = new Date().toISOString();
    await db('demand_requests').insert({
      id, user_id: req.user!.id, komoditas_id,
      quantity_kg: Number(quantity_kg), max_price_per_kg: Number(max_price_per_kg),
      needed_by: needed_by || null, kabupaten, provinsi: provinsi || '',
      is_matched: false, created_at: now, updated_at: now,
    });
    const matches = await runMatchingFor(id, 'demand');
    res.status(201).json({ success: true, data: { id, matches_found: matches.length } });
  } catch (err) { res.status(500).json({ success: false, error: (err as Error).message }); }
});

// ─── Matching Algorithm ───────────────────────────────────────────────────
// Kriteria: komoditas sama, harga supply <= max_price demand, dalam 200km (est)

async function runMatchingFor(reportId: string, type: 'supply' | 'demand') {
  const matches: { supply_id: string; demand_id: string; score: number }[] = [];

  if (type === 'supply') {
    const supply = await db('supply_reports').where({ id: reportId }).first();
    if (!supply) return matches;
    const demands = await db('demand_requests')
      .where({ komoditas_id: supply.komoditas_id, is_matched: false })
      .where('max_price_per_kg', '>=', supply.price_per_kg);

    for (const demand of demands) {
      const score = calculateMatchScore(supply, demand);
      if (score >= 60) {
        const matchId = uuidv4(); const now = new Date().toISOString();
        await db('match_history').insert({
          id: matchId, supply_id: supply.id, demand_id: demand.id,
          komoditas_id: supply.komoditas_id,
          quantity_matched: Math.min(supply.quantity_kg, demand.quantity_kg),
          suggested_price: Math.round((supply.price_per_kg + demand.max_price_per_kg) / 2),
          match_score: score, status: 'suggested',
          created_at: now,
        });
        matches.push({ supply_id: supply.id, demand_id: demand.id, score });
      }
    }
  }
  return matches;
}

function calculateMatchScore(supply: Record<string, unknown>, demand: Record<string, unknown>): number {
  let score = 50; // Base score

  // Harga cocok (lebih murah = lebih bagus)
  const priceRatio = Number(supply.price_per_kg) / Number(demand.max_price_per_kg);
  if (priceRatio <= 0.8) score += 30;
  else if (priceRatio <= 0.9) score += 20;
  else if (priceRatio <= 1.0) score += 10;

  // Provinsi sama = bonus
  if (supply.provinsi === demand.provinsi) score += 15;
  if (supply.kabupaten === demand.kabupaten) score += 5;

  // Kuantitas cocok
  const qRatio = Math.min(Number(supply.quantity_kg), Number(demand.quantity_kg)) / Number(demand.quantity_kg);
  score += Math.floor(qRatio * 10);

  return Math.min(score, 100);
}

// ─── GET /api/matching/feed — List matches yang relevan ──────────────────
router.get('/feed', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { provinsi } = req.query;
    let query = db('match_history')
      .join('supply_reports', 'match_history.supply_id', 'supply_reports.id')
      .join('demand_requests', 'match_history.demand_id', 'demand_requests.id')
      .join('komoditas', 'match_history.komoditas_id', 'komoditas.id')
      .where('match_history.status', 'suggested')
      .orderBy('match_history.match_score', 'desc')
      .select(
        'match_history.*',
        'komoditas.nama as komoditas_nama',
        'supply_reports.kabupaten as supply_kabupaten',
        'supply_reports.provinsi as supply_provinsi',
        'demand_requests.kabupaten as demand_kabupaten',
        'demand_requests.provinsi as demand_provinsi',
      )
      .limit(20);

    if (provinsi) query = query.where(function() {
      this.where('supply_reports.provinsi', provinsi).orWhere('demand_requests.provinsi', provinsi);
    });

    const feed = await query;
    res.json({ success: true, data: feed });
  } catch { res.status(500).json({ success: false, error: 'Gagal fetch feed matching' }); }
});

// ─── GET /api/matching/my-supply ─────────────────────────────────────────
router.get('/my-supply', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const reports = await db('supply_reports')
      .join('komoditas', 'supply_reports.komoditas_id', 'komoditas.id')
      .where('supply_reports.user_id', req.user!.id)
      .select('supply_reports.*', 'komoditas.nama as komoditas_nama')
      .orderBy('supply_reports.created_at', 'desc');
    res.json({ success: true, data: reports });
  } catch { res.status(500).json({ success: false, error: 'Gagal fetch supply' }); }
});

export default router;

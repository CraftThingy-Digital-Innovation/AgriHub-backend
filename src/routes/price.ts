import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/knex';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { chatWithAI } from '../services/aiService';

const router = Router();

// ─── GET /api/price/latest — Harga pangan terkini ────────────────────────
router.get('/latest', async (req, res): Promise<void> => {
  try {
    const { komoditas_id, provinsi, limit = 50 } = req.query;
    let query = db('price_history')
      .join('komoditas', 'price_history.komoditas_id', 'komoditas.id')
      .select('price_history.*', 'komoditas.nama as komoditas_nama', 'komoditas.kategori', 'komoditas.satuan')
      .orderBy('price_history.recorded_date', 'desc')
      .limit(Number(limit));
    if (komoditas_id) query = query.where('price_history.komoditas_id', komoditas_id as string);
    if (provinsi) query = query.where('price_history.provinsi', provinsi as string);
    const prices = await query;
    res.json({ success: true, data: prices });
  } catch { res.status(500).json({ success: false, error: 'Gagal fetch harga' }); }
});

// ─── POST /api/price/report — Input harga manual ─────────────────────────
router.post('/report', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { komoditas_id, price_per_kg, kabupaten, provinsi, source = 'manual' } = req.body;
    if (!komoditas_id || !price_per_kg || !kabupaten || !provinsi) {
      res.status(400).json({ success: false, error: 'komoditas_id, price_per_kg, kabupaten, provinsi wajib' }); return;
    }
    const id = uuidv4(); const now = new Date().toISOString();
    await db('price_history').insert({
      id, komoditas_id, price_per_kg: Number(price_per_kg),
      kabupaten, provinsi, source,
      recorded_date: now.slice(0, 10), reporter_id: req.user!.id,
      created_at: now,
    });
    res.status(201).json({ success: true, data: { id } });
  } catch { res.status(500).json({ success: false, error: 'Gagal lapor harga' }); }
});

// ─── GET /api/price/history/:komoditasId — Historis 30 hari ──────────────
router.get('/history/:komoditasId', async (req, res): Promise<void> => {
  try {
    const { provinsi, days = 30 } = req.query;
    const sinceDate = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    let query = db('price_history')
      .where('komoditas_id', req.params.komoditasId)
      .where('recorded_date', '>=', sinceDate)
      .orderBy('recorded_date', 'asc')
      .select('recorded_date', 'price_per_kg', 'kabupaten', 'provinsi', 'source');
    if (provinsi) query = query.where({ provinsi });
    const history = await query;
    res.json({ success: true, data: history });
  } catch { res.status(500).json({ success: false, error: 'Gagal fetch histori' }); }
});

// ─── GET /api/price/predict/:komoditasId — Prediksi AI 2 minggu ──────────
router.get('/predict/:komoditasId', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    // Cek apakah ada prediksi cache yang masih valid (< 6 jam)
    const cached = await db('price_predictions')
      .where({ komoditas_id: req.params.komoditasId })
      .where('created_at', '>', new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
      .orderBy('created_at', 'desc')
      .first();

    if (cached) {
      res.json({ success: true, data: JSON.parse(cached.predictions_json), cached: true }); return;
    }

    // Ambil 30 hari harga terbaru untuk konteks
    const history = await db('price_history')
      .join('komoditas', 'price_history.komoditas_id', 'komoditas.id')
      .where('price_history.komoditas_id', req.params.komoditasId)
      .orderBy('recorded_date', 'desc')
      .limit(30)
      .select('recorded_date', 'price_per_kg', 'komoditas.nama as nama');

    if (history.length < 3) {
      res.status(400).json({ success: false, error: 'Data harga tidak cukup untuk prediksi (min 3 data)' }); return;
    }

    const komoditas = history[0].nama;
    const dataText = history.reverse().map((h: Record<string, unknown>) => `${h.recorded_date}: Rp${h.price_per_kg}/kg`).join('\n');

    const prompt = `Analisis tren harga ${komoditas} berikut dan prediksi harga untuk 14 hari ke depan dalam format JSON array dengan field "date" (YYYY-MM-DD) dan "predicted_price" (angka dalam Rupiah):\n\n${dataText}\n\nBerikan hanya JSON array, tanpa penjelasan tambahan.`;
    const aiResult = await chatWithAI({
      message: prompt, history: [], userId: req.user!.id, useRag: false,
    });

    let predictions: unknown[] = [];
    try {
      const jsonMatch = aiResult.reply.match(/\[[\s\S]*\]/);
      if (jsonMatch) predictions = JSON.parse(jsonMatch[0]);
    } catch { /* fallback ke simple linear */ }

    // Fallback: linear projection jika AI gagal
    if (predictions.length === 0) {
      const lastPrice = history[history.length - 1].price_per_kg;
      const firstPrice = history[0].price_per_kg;
      const dailyChange = (lastPrice - firstPrice) / history.length;
      for (let i = 1; i <= 14; i++) {
        const date = new Date(Date.now() + i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        predictions.push({ date, predicted_price: Math.round(lastPrice + dailyChange * i) });
      }
    }

    // Simpan prediksi ke DB
    await db('price_predictions').insert({
      id: uuidv4(), komoditas_id: req.params.komoditasId,
      predictions_json: JSON.stringify(predictions),
      model_used: 'puter-ai', created_at: new Date().toISOString(),
    });

    res.json({ success: true, data: predictions });
  } catch { res.status(500).json({ success: false, error: 'Gagal generate prediksi' }); }
});

// ─── POST /api/price/alert — Set alert harga ─────────────────────────────
router.post('/alert', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { komoditas_id, alert_type, threshold_price, provinsi } = req.body;
    if (!komoditas_id || !alert_type || !threshold_price) {
      res.status(400).json({ success: false, error: 'komoditas_id, alert_type, threshold_price wajib' }); return;
    }
    await db('price_alerts').insert({
      id: uuidv4(), user_id: req.user!.id, komoditas_id,
      alert_type, threshold_price: Number(threshold_price),
      provinsi: provinsi || null, is_active: true,
      created_at: new Date().toISOString(),
    });
    res.status(201).json({ success: true, message: 'Alert harga berhasil dibuat' });
  } catch { res.status(500).json({ success: false, error: 'Gagal buat alert' }); }
});

export default router;

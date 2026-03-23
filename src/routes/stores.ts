import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/knex';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

/** GET /api/stores — List toko */
router.get('/', async (req, res): Promise<void> => {
  try {
    const { kabupaten, search, page = 1, limit = 20 } = req.query;
    let query = db('stores').where('is_active', true);
    if (kabupaten) query = query.where({ kabupaten });
    if (search) query = query.where('name', 'like', `%${search}%`);
    const stores = await query.limit(Number(limit)).offset((Number(page) - 1) * Number(limit));
    res.json({ success: true, data: stores });
  } catch { res.status(500).json({ success: false, error: 'Gagal fetch toko' }); }
});

/** GET /api/stores/me — Toko milik sendiri */
router.get('/me', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const store = await db('stores').where({ owner_id: req.user!.id }).first();
    res.json({ success: true, data: store || null });
  } catch { res.status(500).json({ success: false, error: 'Gagal fetch toko' }); }
});

/** POST /api/stores — Daftar toko baru */
router.post('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const existing = await db('stores').where({ owner_id: req.user!.id }).first();
    if (existing) {
      res.status(409).json({ success: false, error: 'Anda sudah memiliki toko' });
      return;
    }
    const { name, kabupaten, provinsi, product_types, description, latitude, longitude } = req.body;
    if (!name || !kabupaten || !provinsi) {
      res.status(400).json({ success: false, error: 'name, kabupaten, provinsi wajib' });
      return;
    }
    // Generate store code unik
    const storeCode = `TM-${Math.floor(1000 + Math.random() * 9000)}`;
    const id = uuidv4();
    const now = new Date().toISOString();
    await db('stores').insert({
      id, owner_id: req.user!.id, store_code: storeCode,
      name, kabupaten, provinsi,
      latitude: latitude || null, longitude: longitude || null,
      product_types: JSON.stringify(product_types || []),
      description: description || null,
      is_active: true, rating: 0, total_orders: 0,
      created_at: now, updated_at: now,
    });
    res.status(201).json({ success: true, data: await db('stores').where({ id }).first() });
  } catch { res.status(500).json({ success: false, error: 'Gagal buat toko' }); }
});

/** PATCH /api/stores/:id */
router.patch('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const store = await db('stores').where({ id: req.params.id, owner_id: req.user!.id }).first();
    if (!store) { res.status(404).json({ success: false, error: 'Toko tidak ditemukan' }); return; }
    await db('stores').where({ id: req.params.id }).update({ ...req.body, updated_at: new Date().toISOString() });
    res.json({ success: true, data: await db('stores').where({ id: req.params.id }).first() });
  } catch { res.status(500).json({ success: false, error: 'Gagal update toko' }); }
});

export default router;

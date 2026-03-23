import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/knex';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { calculateFees } from '../shared';

const router = Router();

/** GET /api/products — List semua produk aktif */
router.get('/', async (req, res): Promise<void> => {
  try {
    const { kategori, search, store_id, page = 1, limit = 20 } = req.query;
    let query = db('products')
      .join('stores', 'products.store_id', 'stores.id')
      .where('products.is_active', true)
      .where('stores.is_active', true)
      .select('products.*', 'stores.name as store_name', 'stores.kabupaten', 'stores.provinsi');

    if (kategori) query = query.where('products.category', kategori as string);
    if (search) query = query.where('products.name', 'like', `%${search}%`);
    if (store_id) query = query.where('products.store_id', store_id as string);

    const offset = (Number(page) - 1) * Number(limit);
    const products = await query.limit(Number(limit)).offset(offset);
    const [{ count }] = await db('products').where('is_active', true).count('id as count');

    res.json({ success: true, data: products, total: Number(count), page: Number(page), limit: Number(limit) });
  } catch { res.status(500).json({ success: false, error: 'Gagal fetch produk' }); }
});

/** GET /api/products/:id */
router.get('/:id', async (req, res): Promise<void> => {
  try {
    const product = await db('products')
      .join('stores', 'products.store_id', 'stores.id')
      .where('products.id', req.params.id)
      .select('products.*', 'stores.name as store_name', 'stores.kabupaten', 'stores.provinsi', 'stores.rating as store_rating')
      .first();
    if (!product) { res.status(404).json({ success: false, error: 'Produk tidak ditemukan' }); return; }
    res.json({ success: true, data: product });
  } catch { res.status(500).json({ success: false, error: 'Gagal fetch produk' }); }
});

/** POST /api/products — Buat produk baru (pemilik toko) */
router.post('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { store_id, name, category, unit, price_per_unit, stock_quantity, min_order, description, weight_gram, sku, origin, images_json } = req.body;
    if (!store_id || !name || !price_per_unit) {
      res.status(400).json({ success: false, error: 'store_id, name, price_per_unit wajib' });
      return;
    }
    // Verifikasi kepemilikan toko
    const store = await db('stores').where({ id: store_id, owner_id: req.user!.id }).first();
    if (!store) { res.status(403).json({ success: false, error: 'Bukan pemilik toko' }); return; }

    const id = uuidv4();
    const now = new Date().toISOString();
    await db('products').insert({ 
      id, store_id, name, category, unit: unit || 'kg', price_per_unit, 
      stock_quantity: stock_quantity || 0, min_order: min_order || 1, 
      description, weight_gram: weight_gram || 1000, sku: sku || null,
      origin: origin || null, images_json: images_json || null,
      is_active: true, created_at: now, updated_at: now 
    });
    const product = await db('products').where({ id }).first();
    res.status(201).json({ success: true, data: product });
  } catch { res.status(500).json({ success: false, error: 'Gagal buat produk' }); }
});

/** PATCH /api/products/:id — Update produk */
router.patch('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const product = await db('products').where({ id: req.params.id }).first();
    if (!product) { res.status(404).json({ success: false, error: 'Produk tidak ditemukan' }); return; }
    const store = await db('stores').where({ id: product.store_id, owner_id: req.user!.id }).first();
    if (!store) { res.status(403).json({ success: false, error: 'Bukan pemilik toko' }); return; }
    await db('products').where({ id: req.params.id }).update({ ...req.body, updated_at: new Date().toISOString() });
    res.json({ success: true, data: await db('products').where({ id: req.params.id }).first() });
  } catch { res.status(500).json({ success: false, error: 'Gagal update produk' }); }
});

/** DELETE /api/products/:id */
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const product = await db('products').where({ id: req.params.id }).first();
    if (!product) { res.status(404).json({ success: false, error: 'Produk tidak ditemukan' }); return; }
    const store = await db('stores').where({ id: product.store_id, owner_id: req.user!.id }).first();
    if (!store) { res.status(403).json({ success: false, error: 'Bukan pemilik toko' }); return; }
    await db('products').where({ id: req.params.id }).update({ is_active: false, updated_at: new Date().toISOString() });
    res.json({ success: true, message: 'Produk dinonaktifkan' });
  } catch { res.status(500).json({ success: false, error: 'Gagal hapus produk' }); }
});

/** GET /api/products/komoditas/list — List komoditas/tanaman dari seed */
router.get('/komoditas/list', async (req, res): Promise<void> => {
  try {
    const { kategori } = req.query;
    let query = db('komoditas');
    if (kategori) query = query.where({ kategori });
    const list = await query.orderBy('nama');
    res.json({ success: true, data: list });
  } catch { res.status(500).json({ success: false, error: 'Gagal fetch komoditas' }); }
});

export default router;

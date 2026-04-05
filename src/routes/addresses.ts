import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/knex';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/users/addresses -> Get list of addresses for the logged in user
router.get('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const addresses = await db('user_addresses')
      .where({ user_id: req.user!.id })
      .orderBy('is_default', 'desc')
      .orderBy('created_at', 'desc');
    res.json({ success: true, data: addresses });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Gagal mengambil alamat' });
  }
});

// POST /api/users/addresses -> Add new address
router.post('/', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { label, recipient_name, recipient_phone, full_address, provinsi, kabupaten, kecamatan, postal_code, latitude, longitude, biteship_area_id, is_default } = req.body;
    
    // If this is set to default, unset other defaults
    if (is_default) {
      await db('user_addresses').where({ user_id: req.user!.id }).update({ is_default: false });
    }

    const id = uuidv4();
    await db('user_addresses').insert({
      id,
      user_id: req.user!.id,
      label: label || 'Alamat',
      recipient_name,
      recipient_phone,
      full_address,
      provinsi,
      kabupaten,
      kecamatan,
      postal_code,
      latitude,
      longitude,
      biteship_area_id,
      is_default: is_default ? true : false,
    });

    const newAddress = await db('user_addresses').where({ id }).first();
    res.status(201).json({ success: true, data: newAddress });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Gagal menyimpan alamat baru' });
  }
});

// DELETE /api/users/addresses/:id -> Delete an address
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const deleted = await db('user_addresses')
          .where({ id: req.params.id, user_id: req.user!.id })
          .del();
        
        if (deleted) res.json({ success: true });
        else res.status(404).json({ success: false, error: 'Alamat tidak ditemukan' });
    } catch {
        res.status(500).json({ success: false, error: 'Gagal menghapus alamat' });
    }
});

export default router;

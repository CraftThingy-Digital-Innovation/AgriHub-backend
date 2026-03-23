import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/knex';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { checkOngkir, createShipment, trackShipment } from '../services/biteshipService';

const router = Router();

// ─── POST /api/shipping/check-ongkir ─────────────────────────────────────
router.post('/check-ongkir', async (req, res): Promise<void> => {
  try {
    const { origin_postal_code, destination_postal_code, weight_gram, couriers } = req.body;
    if (!origin_postal_code || !destination_postal_code || !weight_gram) {
      res.status(400).json({ success: false, error: 'origin_postal_code, destination_postal_code, weight_gram wajib' });
      return;
    }
    const rates = await checkOngkir({ origin_postal_code, destination_postal_code, weight_gram: Number(weight_gram), couriers });
    res.json({ success: true, data: rates });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message || 'Gagal cek ongkir' });
  }
});

// ─── POST /api/shipping/book ──────────────────────────────────────────────
router.post('/book', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { order_id, courier_code, courier_service, items, origin, destination } = req.body;
    if (!order_id || !courier_code || !courier_service) {
      res.status(400).json({ success: false, error: 'order_id, courier_code, courier_service wajib' }); return;
    }

    const order = await db('orders').where({ id: order_id, seller_id: req.user!.id }).first();
    if (!order) { res.status(404).json({ success: false, error: 'Pesanan tidak ditemukan atau bukan milik Anda' }); return; }
    if (!['dibayar', 'diproses'].includes(order.status)) {
      res.status(400).json({ success: false, error: 'Pesanan harus berstatus "dibayar" dulu' }); return;
    }

    const shipment = await createShipment({
      orderId: order_id, origin, destination, courier_code, courier_service,
      items: items || [{ name: 'Produk Pertanian', quantity: order.quantity, value: order.total_amount, weight: 1000 }],
    });

    // Update order dengan resi
    await db('orders').where({ id: order_id }).update({
      status: 'dikirim',
      shipping_resi: shipment.waybill_id,
      shipping_courier: courier_code,
      biteship_order_id: shipment.shipment_id,
      updated_at: new Date().toISOString(),
    });

    // Simpan ke shipment_orders
    await db('shipment_orders').insert({
      id: uuidv4(), order_id,
      courier: courier_code, service: courier_service,
      waybill_id: shipment.waybill_id,
      biteship_order_id: shipment.shipment_id,
      tracking_id: shipment.tracking_id,
      status: 'booked',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });

    res.json({ success: true, data: shipment });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message || 'Gagal booking pengiriman' });
  }
});

// ─── GET /api/shipping/track/:waybillId ──────────────────────────────────
router.get('/track/:waybillId', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { courier } = req.query;
    if (!courier) { res.status(400).json({ success: false, error: 'Query "courier" wajib' }); return; }

    // Cek cache dulu (simpan 30 menit)
    const cached = await db('shipment_tracking_cache')
      .where({ waybill_id: req.params.waybillId })
      .where('fetched_at', '>', new Date(Date.now() - 30 * 60 * 1000).toISOString())
      .first();

    if (cached) {
      res.json({ success: true, data: JSON.parse(cached.response_data), cached: true });
      return;
    }

    const tracking = await trackShipment(req.params.waybillId, String(courier));

    // Update cache
    await db('shipment_tracking_cache').insert({
      id: uuidv4(), waybill_id: req.params.waybillId, courier: String(courier),
      response_data: JSON.stringify(tracking),
      fetched_at: new Date().toISOString(),
    }).onConflict('waybill_id').merge();

    res.json({ success: true, data: tracking });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message || 'Gagal tracking resi' });
  }
});

export default router;

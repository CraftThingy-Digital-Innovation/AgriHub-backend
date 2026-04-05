import axios from 'axios';

const BITESHIP_API = 'https://api.biteship.com/v1';
const getHeaders = () => ({
  Authorization: `Bearer ${process.env.BITESHIP_API_KEY || ''}`,
  'Content-Type': 'application/json',
});

// ─── Cek Ongkir (Rates) ───────────────────────────────────────────────────

export async function checkOngkir(params: {
  origin_postal_code: string;
  destination_postal_code: string;
  weight_gram: number;
  couriers?: string; // 'jne,sicepat,anteraja' etc
}): Promise<{
  courier: string;
  service: string;
  price: number;
  estimated_days: string;
  description: string;
}[]> {
  const { origin_postal_code, destination_postal_code, weight_gram, couriers } = params;

  const response = await axios.post(
    `${BITESHIP_API}/rates/couriers`,
    {
      origin_postal_code,
      destination_postal_code,
      couriers: couriers || 'jne,sicepat,anteraja,tiki,pos',
      items: [{ name: 'Produk Pertanian', description: 'Komoditas pangan', quantity: 1, value: 10000, weight: weight_gram }],
    },
    { headers: getHeaders(), timeout: 15000 }
  );

  const rates = response.data?.pricing || [];
  return rates.map((r: Record<string, unknown>) => ({
    courier: String(r.courier_name),
    service: String(r.courier_service_name),
    price: Number(r.price),
    estimated_days: r.shipment_duration_range ? String(r.shipment_duration_range) : (r.duration ? String(r.duration).replace(' days', '') : '?'),
    description: String(r.courier_service_name),
  })).sort((a: {price: number}, b: {price: number}) => a.price - b.price);
}

// ─── Book Pengiriman ──────────────────────────────────────────────────────

export async function createShipment(params: {
  orderId: string;
  origin: { contact_name: string; contact_phone: string; address: string; postal_code: string; };
  destination: { contact_name: string; contact_phone: string; address: string; postal_code: string; };
  courier_code: string;
  courier_service: string;
  items: { name: string; quantity: number; value: number; weight: number; }[];
}): Promise<{ shipment_id: string; tracking_id: string; waybill_id: string }> {
  const { origin, destination, courier_code, courier_service, items } = params;
  const response = await axios.post(
    `${BITESHIP_API}/orders`,
    {
      shipper_contact_name: origin.contact_name,
      shipper_contact_phone: origin.contact_phone,
      shipper_contact_email: 'noreply@agrihub.id',
      shipper_organization: 'AgriHub Indonesia',
      origin_contact_name: origin.contact_name,
      origin_contact_phone: origin.contact_phone,
      origin_address: origin.address,
      origin_postal_code: origin.postal_code,
      destination_contact_name: destination.contact_name,
      destination_contact_phone: destination.contact_phone,
      destination_address: destination.address,
      destination_postal_code: destination.postal_code,
      courier_company: courier_code,
      courier_type: courier_service,
      delivery_type: 'now',
      order_note: `AgriHub Order #${params.orderId.slice(-8)}`,
      items,
    },
    { headers: getHeaders(), timeout: 20000 }
  );
  return {
    shipment_id: response.data.id,
    tracking_id: response.data.courier?.tracking_id || '',
    waybill_id: response.data.courier?.waybill_id || '',
  };
}

// ─── Track Resi ───────────────────────────────────────────────────────────

export async function trackShipment(waybill_id: string, courier_code: string): Promise<{
  status: string;
  events: { time: string; description: string; location?: string }[];
}> {
  const response = await axios.get(
    `${BITESHIP_API}/trackings/${waybill_id}/couriers/${courier_code}`,
    { headers: getHeaders(), timeout: 10000 }
  );
  const data = response.data;
  return {
    status: data?.status || 'unknown',
    events: (data?.courier?.history || []).map((h: Record<string, unknown>) => ({
      time: String(h.updated_at || ''),
      description: String(h.note || ''),
      location: String(h.service_area_name || ''),
    })),
  };
}

// ─── Search Area ID ───────────────────────────────────────────────────────

export async function searchArea(query: string): Promise<any[]> {
  const response = await axios.get(
    `${BITESHIP_API}/maps/areas?countries=id&input=${encodeURIComponent(query)}&type=single`,
    { headers: getHeaders(), timeout: 10000 }
  );
  return response.data?.areas || [];
}

export async function getAvailableCouriers(): Promise<string[]> {
  return ['jne', 'sicepat', 'anteraja', 'tiki', 'pos', 'jnt', 'wahana', 'ninja'];
}

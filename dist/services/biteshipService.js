"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkOngkir = checkOngkir;
exports.createShipment = createShipment;
exports.trackShipment = trackShipment;
exports.searchArea = searchArea;
exports.getAvailableCouriers = getAvailableCouriers;
const axios_1 = __importDefault(require("axios"));
const BITESHIP_API = 'https://api.biteship.com/v1';
const getHeaders = () => ({
    Authorization: `Bearer ${process.env.BITESHIP_API_KEY || ''}`,
    'Content-Type': 'application/json',
});
// ─── Cek Ongkir (Rates) ───────────────────────────────────────────────────
async function checkOngkir(params) {
    const { origin_postal_code, destination_postal_code, weight_gram, couriers } = params;
    const response = await axios_1.default.post(`${BITESHIP_API}/rates/couriers`, {
        origin_postal_code,
        destination_postal_code,
        couriers: couriers || 'jne,sicepat,anteraja,tiki,pos',
        items: [{ name: 'Produk Pertanian', description: 'Komoditas pangan', quantity: 1, value: 10000, weight: weight_gram }],
    }, { headers: getHeaders(), timeout: 15000 });
    const rates = response.data?.pricing || [];
    return rates.map((r) => ({
        courier: String(r.courier_name),
        service: String(r.courier_service_name),
        price: Number(r.price),
        estimated_days: `${r.min_day || '?'}-${r.max_day || '?'}`,
        description: String(r.courier_service_name),
    })).sort((a, b) => a.price - b.price);
}
// ─── Book Pengiriman ──────────────────────────────────────────────────────
async function createShipment(params) {
    const { origin, destination, courier_code, courier_service, items } = params;
    const response = await axios_1.default.post(`${BITESHIP_API}/orders`, {
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
    }, { headers: getHeaders(), timeout: 20000 });
    return {
        shipment_id: response.data.id,
        tracking_id: response.data.courier?.tracking_id || '',
        waybill_id: response.data.courier?.waybill_id || '',
    };
}
// ─── Track Resi ───────────────────────────────────────────────────────────
async function trackShipment(waybill_id, courier_code) {
    const response = await axios_1.default.get(`${BITESHIP_API}/trackings/${waybill_id}/couriers/${courier_code}`, { headers: getHeaders(), timeout: 10000 });
    const data = response.data;
    return {
        status: data?.status || 'unknown',
        events: (data?.courier?.history || []).map((h) => ({
            time: String(h.updated_at || ''),
            description: String(h.note || ''),
            location: String(h.service_area_name || ''),
        })),
    };
}
// ─── Search Area ID ───────────────────────────────────────────────────────
async function searchArea(query) {
    const response = await axios_1.default.get(`${BITESHIP_API}/maps/areas?countries=id&input=${encodeURIComponent(query)}&type=single`, { headers: getHeaders(), timeout: 10000 });
    return response.data?.areas || [];
}
async function getAvailableCouriers() {
    return ['jne', 'sicepat', 'anteraja', 'tiki', 'pos', 'jnt', 'wahana', 'ninja'];
}
//# sourceMappingURL=biteshipService.js.map
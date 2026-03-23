// ─── Shared Types & Constants for AgriHub Indonesia ───────────────────────
// File ini sebagai canonical source of truth untuk semua types.
// Frontend mengaksesnya via vite path alias @agrihub/shared → ../../backend/src/shared
// Backend mengaksesnya via tsconfig path alias @agrihub/shared → ./shared

// ── Auth ──────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  phone: string;          // WhatsApp number (primary key untuk WA user)
  name: string;
  email?: string;
  role: 'petani' | 'konsumen' | 'distributor' | 'admin';
  avatar_url?: string;
  is_verified: boolean;
  puter_user_id?: string;
  puter_token?: string | null;
  created_at: string;
  updated_at: string;
}

// ── Store / Toko ──────────────────────────────────────────────────────────

export interface Store {
  id: string;
  owner_id: string;
  store_code: string;     // e.g. "TM-2841"
  name: string;
  kabupaten: string;
  provinsi: string;
  latitude?: number;
  longitude?: number;
  product_types: string[];
  description?: string;
  is_active: boolean;
  rating: number;
  total_orders: number;
  created_at: string;
}

// ── Product / Listing ────────────────────────────────────────────────────

export interface Product {
  id: string;
  store_id: string;
  store?: Store;
  name: string;
  category: string;
  unit: string;           // "kg", "ikat", "buah", dll
  price_per_unit: number;
  stock_quantity: number;
  min_order: number;
  description?: string;
  image_url?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// ── Order ────────────────────────────────────────────────────────────────

export type OrderStatus =
  | 'pending'
  | 'menunggu_bayar'
  | 'dibayar'
  | 'diproses'
  | 'dikirim'
  | 'diterima'
  | 'sengketa'
  | 'selesai'
  | 'dibatalkan';

export interface Order {
  id: string;
  buyer_id: string;
  seller_id: string;
  store_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  total_amount: number;
  platform_fee: number;   // 2% dari total
  ppn_amount: number;     // 11% × platform_fee
  seller_amount: number;  // total - fees
  status: OrderStatus;
  payment_token?: string;
  payment_url?: string;
  payment_status?: string;
  paid_at?: string;
  shipping_resi?: string;
  shipping_courier?: string;
  biteship_order_id?: string;
  notes?: string;
  escrow_released_at?: string;
  created_at: string;
  updated_at: string;
}

// ── Wallet ───────────────────────────────────────────────────────────────

export interface Wallet {
  id: string;
  user_id: string;
  balance: number;
  pending_balance: number;  // escrow belum release
  total_earned: number;
  total_withdrawn: number;
  created_at: string;
  updated_at: string;
}

export interface WalletTransaction {
  id: string;
  wallet_id: string;
  order_id?: string;
  type: 'escrow_in' | 'escrow_release' | 'withdrawal' | 'credit' | 'debit';
  amount: number;
  description: string;
  status: 'pending' | 'completed' | 'failed';
  metadata?: string;
  created_at: string;
}

// ── Supply-Demand Matching ────────────────────────────────────────────────

export interface SupplyReport {
  id: string;
  user_id: string;
  komoditas_id: string;
  quantity_kg: number;
  price_per_kg: number;
  kabupaten: string;
  provinsi: string;
  latitude?: number;
  longitude?: number;
  available_from: string;
  available_until?: string;
  is_matched: boolean;
  created_at: string;
}

export interface DemandRequest {
  id: string;
  user_id: string;
  komoditas_id: string;
  quantity_kg: number;
  max_price_per_kg: number;
  kabupaten: string;
  provinsi: string;
  needed_by?: string;
  is_matched: boolean;
  created_at: string;
}

export interface MatchResult {
  id: string;
  supply_id: string;
  demand_id: string;
  komoditas_id: string;
  quantity_matched: number;
  suggested_price: number;
  match_score: number;    // 0-100
  status: 'suggested' | 'accepted' | 'rejected';
  created_at: string;
}

// ── Price Monitoring ─────────────────────────────────────────────────────

export interface PriceHistory {
  id: string;
  komoditas_id: string;
  price_per_kg: number;
  kabupaten: string;
  provinsi: string;
  source: 'manual' | 'BPS' | 'scraper';
  recorded_date: string;
  reporter_id?: string;
}

export interface PriceAlert {
  id: string;
  user_id: string;
  komoditas_id: string;
  alert_type: 'above' | 'below';
  threshold_price: number;
  provinsi?: string;
  is_active: boolean;
  created_at: string;
}

export interface PricePrediction {
  id: string;
  komoditas_id: string;
  predictions_json: string;   // JSON array of { date, predicted_price }
  model_used: string;
  created_at: string;
}

// ── Komoditas ────────────────────────────────────────────────────────────

export interface Komoditas {
  id: string;
  nama: string;
  kategori: string;
  satuan: string;
  deskripsi?: string;
}

// ── Shipment / Logistik ───────────────────────────────────────────────────

export interface ShipmentOrder {
  id: string;
  order_id: string;
  courier: string;          // "jne", "sicepat", dll
  service: string;
  waybill_id?: string;      // nomor resi
  tracking_id?: string;
  biteship_order_id?: string;
  status: 'booked' | 'picked_up' | 'in_transit' | 'delivered';
  created_at: string;
  updated_at: string;
}

// ── RAG / AI ──────────────────────────────────────────────────────────────

export interface RAGDocument {
  id: string;
  user_id: string;
  title: string;
  source_type: 'pdf' | 'xlsx' | 'url' | 'youtube' | 'text';
  source_url?: string;
  content_preview: string;
  chunk_count: number;
  is_global: boolean;
  created_at: string;
}

// ── WhatsApp Group Credit ──────────────────────────────────────────────────

export interface GroupCredit {
  id: string;
  group_jid: string;
  owner_id: string;
  credits_balance: number;
  credits_used: number;
  is_ai_enabled: boolean;
  created_at: string;
  updated_at: string;
}

// ── API Response ───────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

export const PLATFORM_FEE_RATE = 0.02;         // 2%
export const PPN_RATE = 0.11;                   // 11% dari platform fee
export const MIDTRANS_MDR_RATE = 0.007;         // ~0.7%
export const ESCROW_AUTO_RELEASE_DAYS = 3;
export const WITHDRAWAL_MIN = 50000;            // Rp 50.000
export const WITHDRAWAL_FEE = 2500;             // Rp 2.500

export const MATCH_DEFAULT_RADIUS_KM = 200;
export const MATCH_DEFAULT_PRICE_PCT = 20;
export const MATCH_DEFAULT_DATE_DAYS = 7;

export const WA_COMMANDS = {
  DAFTAR_TOKO: 'DAFTAR TOKO',
  JUAL: 'JUAL',
  STOK: 'STOK',
  CARI: 'CARI',
  PESANAN: 'PESANAN',
  KONFIRMASI: 'KONFIRMASI',
  TERIMA: 'TERIMA',
  SALDO: 'SALDO',
  TARIK: 'TARIK',
  BUTUH: 'BUTUH',
  CEK: 'CEK',
  ALERT: 'ALERT',
  ONGKIR: 'ONGKIR',
  KIRIM: 'KIRIM',
  CEK_RESI: 'CEK RESI',
  MENU: 'MENU',
} as const;

/**
 * Hitung fee breakdown untuk suatu transaksi
 */
export function calculateFees(totalAmount: number) {
  const platformFee = Math.round(totalAmount * PLATFORM_FEE_RATE);
  const ppnAmount = Math.round(platformFee * PPN_RATE);
  const midtransMdr = Math.round(totalAmount * MIDTRANS_MDR_RATE);
  const sellerAmount = totalAmount - platformFee - ppnAmount;
  const platformRevenue = platformFee - ppnAmount;
  return { platformFee, ppnAmount, midtransMdr, sellerAmount, platformRevenue };
}

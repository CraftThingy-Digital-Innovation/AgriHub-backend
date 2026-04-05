import { v4 as uuidv4 } from 'uuid';
import db from '../config/knex';
import { sendWAMessage } from './whatsappBot';

export interface DemandData {
  komoditas: string;
  jumlah_kg: number;
  harga_max_per_kg: number;
  address_id: string; // ID dari tabel user_addresses
}

/**
 * Mendaftarkan demand/wishlist baru dari pembeli
 */
export async function createWishlist(userId: string, data: DemandData) {
  const id = uuidv4();
  const now = new Date().toISOString();

  await db('demand_requests').insert({
    id,
    requester_id: userId,
    komoditas: data.komoditas,
    jumlah_kg: data.jumlah_kg,
    harga_max_per_kg: data.harga_max_per_kg,
    address_id: data.address_id,
    is_active: true,
    created_at: now,
    updated_at: now,
  });

  const matchesInfo = await runMatchingForDemand(id);
  return { id, matchesFound: matchesInfo.length };
}

/**
 * Dijalankan ketika Demand baru dibuat
 * Mencari: product.price_per_unit <= demand.harga_max_per_kg && product.stock_quantity >= demand.jumlah_kg
 */
export async function runMatchingForDemand(demandId: string) {
  const matches: any[] = [];
  
  const demand = await db('demand_requests')
    .join('user_addresses', 'demand_requests.address_id', 'user_addresses.id')
    .where('demand_requests.id', demandId)
    .select('demand_requests.*', 'user_addresses.kabupaten as target_kabupaten', 'user_addresses.provinsi as target_provinsi')
    .first();

  if (!demand || !demand.is_active) return matches;

  // Cari tabel produk aktif
  const products = await db('products')
    .join('stores', 'products.store_id', 'stores.id')
    .join('users', 'stores.owner_id', 'users.id')
    .where('products.category', demand.komoditas) // Atau gunakan pattern match yg lbh rumit
    .where('products.is_active', true)
    .where('products.price_per_unit', '<=', demand.harga_max_per_kg)
    .where('products.stock_quantity', '>=', demand.jumlah_kg)
    .select(
      'products.*', 
      'stores.kabupaten as store_kabupaten', 
      'stores.provinsi as store_provinsi',
      'stores.name as store_name',
      'users.phone as seller_phone'
    );

  // Fallback: Jika tak ada yang pas dengan nama kategori persis, pakai perbandingan string nama produk
  let matchedProducts = products;
  if (products.length === 0) {
      matchedProducts = await db('products')
      .join('stores', 'products.store_id', 'stores.id')
      .join('users', 'stores.owner_id', 'users.id')
      .where('products.name', 'like', `%${demand.komoditas}%`)
      .where('products.is_active', true)
      .where('products.price_per_unit', '<=', demand.harga_max_per_kg)
      .where('products.stock_quantity', '>=', demand.jumlah_kg)
      .select(
        'products.*', 
        'stores.kabupaten as store_kabupaten', 
        'stores.provinsi as store_provinsi',
        'stores.name as store_name',
        'users.phone as seller_phone'
      );
  }

  const requester = await db('users').where({ id: demand.requester_id }).first();

  for (const prod of matchedProducts) {
    const score = calculateMatchScore(prod, demand);
    if (score >= 60) {
      const matchId = uuidv4();
      await db('match_history').insert({
        id: matchId,
        supply_id: null, // Legacy column null
        product_id: prod.id,
        demand_id: demand.id,
        score: score,
        distance_km: 0,
        price_diff_pct: ((demand.harga_max_per_kg - prod.price_per_unit) / demand.harga_max_per_kg) * 100,
        is_contacted: false,
        created_at: new Date().toISOString(),
      });
      
      matches.push({ id: matchId, prod });
    }
  }

  // Notifikasi via WA ke pembeli jika punya WA Bot
  if (matches.length > 0 && requester && requester.whatsapp_lid) {
      await sendMatchesDigestToBuyer(requester.whatsapp_lid, demand.komoditas, matches);
  }

  return matches;
}

/**
 * Dijalankan ketika Seller membuat/mengedit Produk baru
 */
export async function runMatchingForProduct(productId: string) {
    const prod = await db('products')
        .join('stores', 'products.store_id', 'stores.id')
        .where('products.id', productId)
        .select('products.*', 'stores.kabupaten as store_kabupaten', 'stores.provinsi as store_provinsi', 'stores.name as store_name')
        .first();

    if (!prod || !prod.is_active) return;

    // Cari demand yang cocok
    const demands = await db('demand_requests')
        .join('user_addresses', 'demand_requests.address_id', 'user_addresses.id')
        .join('users', 'demand_requests.requester_id', 'users.id')
        .where('demand_requests.is_active', true)
        .where(function() {
            this.where('demand_requests.komoditas', prod.category)
                .orWhere('demand_requests.komoditas', 'like', `%${prod.name}%`);
        })
        .where('demand_requests.harga_max_per_kg', '>=', prod.price_per_unit)
        .where('demand_requests.jumlah_kg', '<=', prod.stock_quantity)
        .select(
            'demand_requests.*', 
            'user_addresses.kabupaten as target_kabupaten', 
            'user_addresses.provinsi as target_provinsi',
            'users.whatsapp_lid',
            'users.phone'
        );

    for (const demand of demands) {
        // Cek jika sudah pernah dicocokkan agar tidak double (penting jika update produk memicu lagi)
        const exist = await db('match_history').where({ product_id: prod.id, demand_id: demand.id }).first();
        if (exist) continue;

        const score = calculateMatchScore(prod, demand);
        if (score >= 60) {
            const matchId = uuidv4();
            await db('match_history').insert({
                id: matchId,
                supply_id: null,
                product_id: prod.id,
                demand_id: demand.id,
                score: score,
                distance_km: 0,
                price_diff_pct: ((demand.harga_max_per_kg - prod.price_per_unit) / demand.harga_max_per_kg) * 100,
                is_contacted: false,
                created_at: new Date().toISOString(),
            });

            // Kirim notifikasi seketika ke buyer
            if (demand.whatsapp_lid) {
                const msg = `🎉 *WISHLIST MATCHED!*\n\nKami menemukan stok *${prod.name}* yang sesuai dengan wishlist Anda untuk komoditas *${demand.komoditas}*.\n\n🏪 Toko: ${prod.store_name} (${prod.store_kabupaten})\n💰 Harga: Rp ${Number(prod.price_per_unit).toLocaleString('id-ID')}/kg\n⚖️ Kebutuhan Anda: ${demand.jumlah_kg} kg\n\nKetik *BELI ${matchId}* untuk langsung checkout dengan aman via AgriHub! 🚜`;
                await sendWAMessage(demand.whatsapp_lid, msg);
            }
        }
    }
}

// Fitur digest untuk pembeli
async function sendMatchesDigestToBuyer(jid: string, komoditas: string, matches: any[]) {
    let msg = `🎉 *WISHLIST MATCHED!*\n\nSistem berhasil menemukan ${matches.length} produk *${komoditas}* yang sesuai kriteria anggaran dan jumlah stok.\n\n`;
    
    // Tampilkan max 3 terbaik agar tidak spam
    for (const m of matches.slice(0, 3)) {
        msg += `✅ *${m.prod.name}*\n🏪 ${m.prod.store_name} (${m.prod.store_kabupaten})\n💰 Rp ${Number(m.prod.price_per_unit).toLocaleString('id-ID')}/kg\n👉 Ketik: *BELI ${m.id}*\n\n`;
    }

    if (matches.length > 3) {
        msg += `_...dan ${matches.length - 3} produk lainnya. Cek dashboard AgriHub Anda untuk selengkapnya._\n`;
    }
    
    msg += `💳 Seluruh transaksi dilindungi sistem Escrow AgriHub. Dana Anda aman bersama kami!`;
    await sendWAMessage(jid, msg);
}

function calculateMatchScore(product: any, demand: any): number {
  let score = 50;
  
  const priceDiff = demand.harga_max_per_kg - product.price_per_unit;
  if (priceDiff >= 0) {
    score += Math.min(30, (priceDiff / demand.harga_max_per_kg) * 100);
  }

  if (product.store_kabupaten === demand.target_kabupaten) {
    score += 20;
  } else if (product.store_provinsi === demand.target_provinsi) {
    score += 10;
  }

  return Math.min(score, 100);
}

export async function getMatchesForUser(userId: string) {
  // Hanya return untuk demand yang user ini miliki
  const matches = await db('match_history')
    .join('demand_requests', 'match_history.demand_id', 'demand_requests.id')
    .join('products', 'match_history.product_id', 'products.id')
    .join('stores', 'products.store_id', 'stores.id')
    .where('demand_requests.requester_id', userId)
    .where('products.is_active', true)
    .select(
      'match_history.*',
      'products.name as product_name',
      'products.price_per_unit as product_price',
      'stores.name as store_name',
      'stores.kabupaten as store_kabupaten',
      'demand_requests.komoditas as demand_komoditas',
      'demand_requests.jumlah_kg as demand_qty',
      'demand_requests.harga_max_per_kg as demand_price'
    )
    .orderBy('match_history.score', 'desc');

  return matches;
}

import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  proto,
  WASocket,
} from 'baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcodeTerminal from 'qrcode-terminal';
import path from 'path';
import fs from 'fs';
import db from '../config/knex';
import { chatWithAI } from './aiService';
import { checkGroupCredit, deductGroupCredit } from './aiService';
import { checkOngkir } from './biteshipService';
import { v4 as uuidv4 } from 'uuid';

// ─── Auth state dir ───────────────────────────────────────────────────────
const AUTH_DIR = path.resolve(process.cwd(), 'wa-auth');
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });

let waSocket: WASocket | null = null;
let isConnected = false;
let qrCode = '';

// Pino logger silent — tidak spam terminal
const logger = pino({ level: 'silent' });

// ─── Connect ke WhatsApp ──────────────────────────────────────────────────
export async function connectWhatsApp(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  waSocket = makeWASocket({
    version,
    auth: state,
    logger,
  });

  waSocket.ev.on('creds.update', saveCreds);

  waSocket.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      qrCode = qr;
      console.log('\n📱 Scan QR Code AgriHub WhatsApp Bot:\n');
      qrcodeTerminal.generate(qr, { small: true });
    }
    if (connection === 'close') {
      isConnected = false;
      const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = reason !== DisconnectReason.loggedOut;
      console.log('WA disconnected, reason:', reason, 'reconnecting:', shouldReconnect);
      if (shouldReconnect) setTimeout(connectWhatsApp, 3000);
    } else if (connection === 'open') {
      isConnected = true;
      qrCode = '';
      console.log('✅ AgriHub WhatsApp Bot terhubung!');
    }
  });

  waSocket.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message || msg.key.fromMe) continue;
      await handleMessage(msg);
    }
  });
}

/** 
 * Request Pairing Code
 * Alternatif untuk scan QR bagi kamera rusak
 */
export async function getWAPairingCode(phoneNumber: string): Promise<string> {
  // Pastikan socket tidak sedang terhubung
  if (isConnected) {
    throw new Error('WhatsApp sudah terhubung. Logout dulu jika ingin ganti akun.');
  }

  // Jika ingin pairing baru, sebaiknya hapus session lama agar tidak konflik
  try {
    if (fs.existsSync(AUTH_DIR)) {
      console.log('🧹 Menghapus session lama untuk pairing baru...');
      // Tutup socket jika ada
      if (waSocket) {
        waSocket.ev.removeAllListeners('connection.update');
        waSocket.end(undefined);
        waSocket = null;
      }
      // Hapus isi folder wa-auth
      const files = fs.readdirSync(AUTH_DIR);
      for (const file of files) {
        fs.unlinkSync(path.join(AUTH_DIR, file));
      }
    }
  } catch (err) {
    console.error('⚠️ Gagal membersihkan session lama:', err);
  }

  // Mulai socket baru (pasti fresh karena AUTH_DIR kosong)
  console.log('🔄 Memulai socket baru (fresh) untuk pairing code...');
  await connectWhatsApp();
  
  // Beri jeda agar socket benar-benar siap
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Bersihkan nomor (hanya angka)
  const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
  if (!cleanPhone) throw new Error('Nomor HP tidak valid');

  console.log(`🔑 Meminta Pairing Code untuk: ${cleanPhone}`);
  
  try {
    const socket = waSocket;
    if (!socket) throw new Error('Gagal menginisialisasi socket WhatsApp');
    const code = await socket.requestPairingCode(cleanPhone);
    return code;
  } catch (err) {
    console.error('❌ Error saat meminta pairing code:', err);
    throw new Error('Gagal meminta Pairing Code. Pastikan server stabil dan coba lagi.');
  }
}

export function getWAStatus() {
  return { isConnected, hasQR: !!qrCode, qrCode };
}

export async function sendWAMessage(jid: string, text: string): Promise<void> {
  if (!waSocket || !isConnected) throw new Error('WhatsApp bot tidak terhubung');
  await waSocket.sendMessage(jid, { text });
}

// ─── Commands Parser ──────────────────────────────────────────────────────

async function handleMessage(msg: proto.IWebMessageInfo): Promise<void> {
  if (!msg.key) return;
  const jid = msg.key.remoteJid!;
  const isGroup = jid.endsWith('@g.us');
  const text = (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    ''
  ).trim();

  if (!text) return;

  const upper = text.toUpperCase();
  const sender = msg.key.participant || msg.key.remoteJid || '';

  try {
    // ── Personal Commands ──────────────────────────────────────────────

    // DAFTAR TOKO
    if (upper.startsWith('DAFTAR TOKO')) {
      const parts = text.split('|').map(s => s.trim());
      if (parts.length < 3) {
        await sendWAMessage(jid, '📝 Format: DAFTAR TOKO | Nama Toko | Kabupaten | Provinsi | Jenis Produk\n\nContoh:\nDAFTAR TOKO | Tani Maju | Bengkulu Tengah | Bengkulu | Cabai, Sayuran');
        return;
      }
      const [, name, kabupaten, provinsi, product_types] = parts;
      const phone = sender.split('@')[0].replace(/[^0-9]/g, '');

      const user = await db('users').where('phone', 'like', `%${phone.slice(-9)}%`).first();
      if (!user) {
        await sendWAMessage(jid, `❌ Nomor ${phone} belum terdaftar di AgriHub.\n\nDaftar di: https://agrihub.id/daftar`);
        return;
      }
      const existingStore = await db('stores').where({ owner_id: user.id }).first();
      if (existingStore) {
        await sendWAMessage(jid, `⚠️ Anda sudah punya toko: *${existingStore.name}* (${existingStore.store_code})`);
        return;
      }
      const storeCode = `TM-${Math.floor(1000 + Math.random() * 9000)}`;
      const now = new Date().toISOString();
      await db('stores').insert({
        id: uuidv4(), owner_id: user.id, store_code: storeCode,
        name, kabupaten, provinsi,
        product_types: JSON.stringify(product_types ? product_types.split(',').map((s: string) => s.trim()) : []),
        is_active: true, rating: 0, total_orders: 0,
        created_at: now, updated_at: now,
      });
      await sendWAMessage(jid, `✅ *Toko berhasil terdaftar!*\n\n🏪 Nama: ${name}\n📍 Lokasi: ${kabupaten}, ${provinsi}\n🔑 Kode Toko: *${storeCode}*\n\n_Ketik JUAL untuk mulai listing produk_`);
      return;
    }

    // JUAL [nama_produk] [harga] [stok]
    if (upper.startsWith('JUAL ')) {
      const parts = text.slice(5).trim().split(/\s+/);
      if (parts.length < 3) {
        await sendWAMessage(jid, '📝 Format: JUAL [nama produk] [harga/kg] [stok kg]\n\nContoh: JUAL Cabai Merah 45000 50');
        return;
      }
      const stok = parts[parts.length - 1];
      const harga = parts[parts.length - 2];
      const nama = parts.slice(0, -2).join(' ');
      const phone = sender.split('@')[0].replace(/[^0-9]/g, '');
      const user = await db('users').where('phone', 'like', `%${phone.slice(-9)}%`).first();
      const store = user ? await db('stores').where({ owner_id: user.id }).first() : null;

      if (!store) {
        await sendWAMessage(jid, '❌ Anda belum punya toko. Ketik DAFTAR TOKO dulu!'); return;
      }
      const productId = uuidv4();
      const now = new Date().toISOString();
      await db('products').insert({
        id: productId, store_id: store.id, name: nama, unit: 'kg',
        price_per_unit: Number(harga), stock_quantity: Number(stok),
        min_order: 1, is_active: true, created_at: now, updated_at: now,
      });
      await sendWAMessage(jid, `✅ *Produk berhasil ditambahkan!*\n\n🥬 ${nama}\n💰 Rp${Number(harga).toLocaleString('id-ID')}/kg\n📦 Stok: ${stok} kg\n🏪 Toko: ${store.name}\n\n_Kirim foto produk untuk tampil di marketplace_`);
      return;
    }

    // ONGKIR [asal_kode_pos] [tujuan_kode_pos] [berat_kg]
    if (upper.startsWith('ONGKIR ')) {
      const parts = text.slice(7).trim().split(/\s+/);
      if (parts.length < 3) {
        await sendWAMessage(jid, '📝 Format: ONGKIR [kode pos asal] [kode pos tujuan] [berat kg]\n\nContoh: ONGKIR 38213 12345 5');
        return;
      }
      const [origin, destination, weightKg] = parts;
      await sendWAMessage(jid, `⏳ Mengecek ongkir ${origin} → ${destination}, berat ${weightKg}kg...`);
      const rates = await checkOngkir({ origin_postal_code: origin, destination_postal_code: destination, weight_gram: Number(weightKg) * 1000 });
      if (rates.length === 0) {
        await sendWAMessage(jid, '❌ Tidak ada kurir yang tersedia untuk rute ini.'); return;
      }
      const rateText = rates.slice(0, 5).map((r, i) =>
        `${i + 1}. ${r.courier} ${r.service}\n   💰 Rp${r.price.toLocaleString('id-ID')} | 📅 ${r.estimated_days} hari`
      ).join('\n\n');
      await sendWAMessage(jid, `📦 *Ongkir ${origin} → ${destination} (${weightKg}kg)*\n\n${rateText}\n\n_Data dari Biteship_`);
      return;
    }

    // STOK — cek stok toko sendiri
    if (upper === 'STOK') {
      const phone = sender.split('@')[0].replace(/[^0-9]/g, '');
      const user = await db('users').where('phone', 'like', `%${phone.slice(-9)}%`).first();
      const store = user ? await db('stores').where({ owner_id: user.id }).first() : null;
      if (!store) { await sendWAMessage(jid, '❌ Anda belum punya toko.'); return; }
      const products = await db('products').where({ store_id: store.id, is_active: true });
      if (products.length === 0) { await sendWAMessage(jid, '📭 Toko Anda belum punya produk aktif.'); return; }
      const stokText = products.map((p: Record<string, unknown>, i: number) =>
        `${i + 1}. ${p.name}\n   📦 ${p.stock_quantity} ${p.unit} @ Rp${Number(p.price_per_unit).toLocaleString('id-ID')}`
      ).join('\n');
      await sendWAMessage(jid, `🏪 *Stok ${store.name}*\n\n${stokText}`);
      return;
    }

    // PESANAN — cek pesanan terbaru
    if (upper === 'PESANAN') {
      const phone = sender.split('@')[0].replace(/[^0-9]/g, '');
      const user = await db('users').where('phone', 'like', `%${phone.slice(-9)}%`).first();
      if (!user) { await sendWAMessage(jid, '❌ Nomor belum terdaftar di AgriHub.'); return; }
      const orders = await db('orders')
        .join('products', 'orders.product_id', 'products.id')
        .where('orders.seller_id', user.id)
        .whereNot('orders.status', 'dibatalkan')
        .orderBy('orders.created_at', 'desc')
        .limit(5)
        .select('orders.id', 'orders.status', 'orders.total_amount', 'orders.quantity', 'products.name as product_name');
      if (orders.length === 0) { await sendWAMessage(jid, '📭 Belum ada pesanan masuk.'); return; }
      const orderText = orders.map((o: Record<string, unknown>, i: number) =>
        `${i + 1}. ${o.product_name} (${o.quantity}kg)\n   💰 Rp${Number(o.total_amount).toLocaleString('id-ID')} | Status: ${o.status}`
      ).join('\n');
      await sendWAMessage(jid, `📦 *5 Pesanan Terbaru*\n\n${orderText}`);
      return;
    }

    // MENU / HELP
    if (upper === 'MENU' || upper === 'HELP') {
      await sendWAMessage(jid, `🌾 *Menu AgriHub Bot*\n\n*Seller:*\n• DAFTAR TOKO | nama | kab | prov | produk\n• JUAL [produk] [harga] [stok]\n• STOK — lihat stok toko\n• PESANAN — 5 pesanan terbaru\n\n*Logistik:*\n• ONGKIR [kode pos asal] [tujuan] [berat kg]\n\n*AI Konsultan:*\n• Tanya apa saja tentang pertanian\n  Contoh: "Cara atasi wereng?"\n\n_Info lengkap: https://agrihub.id_`);
      return;
    }

    // ── AI Chat (jika bukan command) ───────────────────────────────────────
    // Grup: cek kredit dulu
    if (isGroup) {
      const credit = await checkGroupCredit(jid);
      if (!credit.allowed) {
        // Hanya reply jika di-mention bot
        return;
      }
      await deductGroupCredit(jid, 0.05);
    }

    // Cari user ID berdasarkan nomor pengirim
    const userPhone = sender.split('@')[0].replace(/[^0-9]/g, '');
    const user = await db('users').where('phone', 'like', `%${userPhone.slice(-9)}%`).first();

    const aiReply = await chatWithAI({
      message: text, history: [], userId: user ? user.id : 'wa-bot',
      useRag: true,
    });

    await sendWAMessage(jid, `🌱 ${aiReply.reply}${aiReply.ragSources.length > 0 ? `\n\n_📚 Sumber: ${aiReply.ragSources.join(', ')}_` : ''}`);
  } catch (err) {
    console.error('WA message handler error:', err);
  }
}

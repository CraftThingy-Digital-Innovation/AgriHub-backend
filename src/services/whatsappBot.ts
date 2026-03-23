import makeWASocket, {
  DisconnectReason,
  AuthenticationState,
  fetchLatestBaileysVersion,
  proto,
  WASocket,
  AuthenticationCreds,
  SignalDataTypeMap,
  initAuthCreds,
  BufferJSON,
} from 'baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcodeTerminal from 'qrcode-terminal';
import db from '../config/knex';
import { chatWithAI } from './aiService';
import { checkGroupCredit, deductGroupCredit } from './aiService';
import { checkOngkir } from './biteshipService';
import { v4 as uuidv4 } from 'uuid';

// ─── Constants ───────────────────────────────────────────────────────────
let waSocket: WASocket | null = null;
let isConnected = false;
let qrCode = '';
const logger = pino({ level: 'silent' });

// ─── Database Auth State Provider ─────────────────────────────────────────

async function ensureAuthTable() {
  const exists = await db.schema.hasTable('whatsapp_auth');
  if (!exists) {
    console.log('🏗️ Membuat tabel whatsapp_auth...');
    await db.schema.createTable('whatsapp_auth', (table) => {
      table.uuid('id').primary();
      table.string('category').index();
      table.string('key_id').index();
      table.text('data');
      table.timestamp('updated_at').defaultTo(db.fn.now());
      table.unique(['category', 'key_id']);
    });
  }
}

async function useDatabaseAuthState(): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void> }> {
  await ensureAuthTable();

  const writeData = async (data: any, category: string, keyId: string) => {
    const jsonStr = JSON.stringify(data, BufferJSON.replacer);
    const existing = await db('whatsapp_auth').where({ category, key_id: keyId }).first();
    if (existing) {
      await db('whatsapp_auth').where({ id: existing.id }).update({ data: jsonStr, updated_at: new Date().toISOString() });
    } else {
      await db('whatsapp_auth').insert({ id: uuidv4(), category, key_id: keyId, data: jsonStr });
    }
  };

  const readData = async (category: string, keyId: string) => {
    const row = await db('whatsapp_auth').where({ category, key_id: keyId }).first();
    if (!row) return null;
    return JSON.parse(row.data, BufferJSON.reviver);
  };

  const removeData = async (category: string, keyId: string) => {
    await db('whatsapp_auth').where({ category, key_id: keyId }).delete();
  };

  let creds: AuthenticationCreds = await readData('creds', 'main') || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: { [key: string]: any } = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(type, id);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          for (const category in data) {
            for (const id in data[category as keyof SignalDataTypeMap]) {
              const value = data[category as keyof SignalDataTypeMap]![id];
              if (value) {
                await writeData(value, category, id);
              } else {
                await removeData(category, id);
              }
            }
          }
        }
      }
    },
    saveCreds: async () => {
      await writeData(creds, 'creds', 'main');
    }
  };
}

// ─── Connect ke WhatsApp ──────────────────────────────────────────────────
export async function connectWhatsApp(): Promise<void> {
  const { state, saveCreds } = await useDatabaseAuthState();
  const { version } = await fetchLatestBaileysVersion();

  waSocket = makeWASocket({
    version,
    auth: state,
    logger,
    printQRInTerminal: false,
  });

  waSocket.ev.on('creds.update', saveCreds);

  waSocket.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      qrCode = qr;
      console.log('\n📱 Scan QR Code AgriHub WhatsApp Bot (Database Persistent Mode):\n');
      qrcodeTerminal.generate(qr, { small: true });
    }
    if (connection === 'close') {
      isConnected = false;
      const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = reason !== DisconnectReason.loggedOut;
      console.log('WA disconnected, reason:', reason, 'reconnecting:', shouldReconnect);
      if (shouldReconnect) {
        setTimeout(connectWhatsApp, 5000);
      } else {
        console.log('🧹 Logging out, clearing database session...');
        db('whatsapp_auth').delete().catch(e => console.error('Gagal hapus session:', e));
      }
    } else if (connection === 'open') {
      isConnected = true;
      qrCode = '';
      console.log('✅ AgriHub WhatsApp Bot terhubung (MOD DEPLOY-PROOF)!');
    }
  });

  waSocket.ev.on('group-participants.update', async (update) => {
    const botId = waSocket?.user?.id?.split(':')[0] || '';
    if (update.action === 'add' && update.participants.some((p: any) => p.id?.startsWith(botId))) {
      console.log(`👋 Bot ditambahkan ke grup: ${update.id}`);
      await sendWAMessage(update.id, '🌾 *Halo semuanya! Saya AsistenTani AgriHub.*\n\nSaya siap membantu di grup ini! Tag saya atau ketik *MENU* untuk melihat perintah yang tersedia. Selamat bertani! 🚜🌿');
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

export async function getWAPairingCode(phoneNumber: string): Promise<string> {
  const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
  if (!cleanPhone) throw new Error('Nomor HP tidak valid');

  await ensureAuthTable();

  if (isConnected && waSocket?.user?.id?.startsWith(cleanPhone)) {
    return 'ALREADY_CONNECTED';
  }

  const currentCredsRow = await db('whatsapp_auth').where({ category: 'creds', key_id: 'main' }).first();
  if (currentCredsRow) {
    const creds = JSON.parse(currentCredsRow.data, BufferJSON.reviver);
    const existingNum = creds.me?.id?.split(':')[0];
    if (existingNum && existingNum !== cleanPhone) {
      console.log('🧹 Membersihkan database karena nomor berbeda...');
      await db('whatsapp_auth').delete();
      if (waSocket) {
        try { waSocket.end(undefined); } catch {}
        waSocket = null;
      }
    }
  }

  if (!waSocket) {
    await connectWhatsApp();
    await new Promise(r => setTimeout(r, 5000));
  }
  
  try {
    const socket = waSocket!;
    return await socket.requestPairingCode(cleanPhone);
  } catch (err) {
    throw new Error('Gagal meminta Pairing Code. Coba lagi nanti.');
  }
}

export function getWAStatus() {
  return { isConnected, hasQR: !!qrCode, qrCode };
}

export async function sendWAMessage(jid: string, text: string): Promise<void> {
  if (!waSocket || !isConnected) return;
  await waSocket.sendMessage(jid, { text });
}

// ─── Message Handler Logic ──────────────────────────────────────────────

async function handleMessage(msg: proto.IWebMessageInfo): Promise<void> {
  if (!msg.key) return;
  const jid = msg.key.remoteJid!;
  const isGroup = jid.endsWith('@g.us');
  
  const text = (
    msg.message?.conversation ||
    msg.message?.extendedTextMessage?.text ||
    msg.message?.imageMessage?.caption ||
    msg.message?.videoMessage?.caption ||
    ''
  ).trim();

  if (!text) return;

  const upper = text.toUpperCase();
  const sender = msg.key.participant || msg.key.remoteJid || '';

  const botId = waSocket?.user?.id?.split(':')[0] || '';
  const botJid = botId + '@s.whatsapp.net';
  const mentionedJids = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  
  const isMentioned = 
    mentionedJids.includes(botJid) || 
    text.includes(`@${botId}`) ||
    (isGroup && text.toLowerCase().includes('asistentani'));

  try {
    // ── DAFTAR TOKO ──────────────────────────────────────────────
    if (upper.startsWith('DAFTAR TOKO')) {
      const parts = text.split('|').map(s => s.trim());
      if (parts.length < 3) {
        await sendWAMessage(jid, '📝 Format: DAFTAR TOKO | Nama Toko | Kabupaten | Provinsi | Produk\n\nContoh:\nDAFTAR TOKO | Tani Maju | Bengkulu Tengah | Bengkulu | Cabai, Sayuran');
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

    // ── JUAL ────────────────────────────────────────────────────
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

    // ── ONGKIR ──────────────────────────────────────────────────
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

    // ── STOK ────────────────────────────────────────────────────
    if (upper === 'STOK') {
      const phone = sender.split('@')[0].replace(/[^0-9]/g, '');
      const user = await db('users').where('phone', 'like', `%${phone.slice(-9)}%`).first();
      const store = user ? await db('stores').where({ owner_id: user.id }).first() : null;
      if (!store) { await sendWAMessage(jid, '❌ Anda belum punya toko.'); return; }
      const products = await db('products').where({ store_id: store.id, is_active: true });
      if (products.length === 0) { await sendWAMessage(jid, '📭 Toko Anda belum punya produk aktif.'); return; }
      const stokText = products.map((p, i) =>
        `${i + 1}. ${p.name}\n   📦 ${p.stock_quantity} ${p.unit} @ Rp${Number(p.price_per_unit).toLocaleString('id-ID')}`
      ).join('\n');
      await sendWAMessage(jid, `🏪 *Stok ${store.name}*\n\n${stokText}`);
      return;
    }

    // ── PESANAN ─────────────────────────────────────────────────
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
      const orderText = orders.map((o, i) =>
        `${i + 1}. ${o.product_name} (${o.quantity}kg)\n   💰 Rp${Number(o.total_amount).toLocaleString('id-ID')} | Status: ${o.status}`
      ).join('\n');
      await sendWAMessage(jid, `📦 *5 Pesanan Terbaru*\n\n${orderText}`);
      return;
    }

    // ── MENU / HELP ─────────────────────────────────────────────
    if (upper === 'MENU' || upper === 'HELP') {
      await sendWAMessage(jid, `🌾 *Menu AgriHub Bot*\n\n*Seller:*\n• DAFTAR TOKO | nama | kab | prov | produk\n• JUAL [produk] [harga] [stok]\n• STOK — lihat stok toko\n• PESANAN — 5 pesanan terbaru\n\n*Logistik:*\n• ONGKIR [kode pos asal] [tujuan] [berat kg]\n\n*AI Konsultan:*\n• Tanya apa saja tentang pertanian\n  Contoh: "Cara atasi wereng?"\n\n_Info lengkap: https://agrihub.id_`);
      return;
    }

    // ── AI Hub Interaction ──
    const isCommand = ['DAFTAR TOKO', 'JUAL ', 'ONGKIR ', 'STOK', 'PESANAN', 'MENU', 'HELP'].some(c => upper.startsWith(c));
    
    if (isGroup && !isMentioned) return;
    
    if (!isCommand) {
       if (isGroup) {
         const credit = await checkGroupCredit(jid);
         if (!credit.allowed) {
            if (isMentioned) await sendWAMessage(jid, `⚠️ *Kredit AI Grup Habis.*\nHubungi admin.`);
            return;
         }
         await deductGroupCredit(jid, 0.05);
       }

       const phone = sender.split('@')[0].replace(/[^0-9]/g, '');
       const user = await db('users').where('phone', 'like', `%${phone.slice(-9)}%`).first();
       const promptText = text.replace(new RegExp(`@${botId}|@${botId.slice(2)}`, 'g'), '').trim();

       const aiReply = await chatWithAI({
         message: promptText || 'Halo!',
         history: [],
         userId: user ? user.id : 'wa-bot',
         useRag: true
       });

       await sendWAMessage(jid, `🌱 ${aiReply.reply}${aiReply.ragSources.length > 0 ? `\n\n_📚 Sumber: ${aiReply.ragSources.join(', ')}_` : ''}`);
    }

  } catch (err) {
    console.error('WA handleMessage error:', err);
  }
}

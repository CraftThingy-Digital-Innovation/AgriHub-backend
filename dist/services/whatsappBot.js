"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.connectWhatsApp = connectWhatsApp;
exports.getWAPairingCode = getWAPairingCode;
exports.getWAStatus = getWAStatus;
exports.sendWAMessage = sendWAMessage;
const baileys_1 = __importStar(require("baileys"));
const pino_1 = __importDefault(require("pino"));
const qrcode_terminal_1 = __importDefault(require("qrcode-terminal"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const knex_1 = __importDefault(require("../config/knex"));
const aiService_1 = require("./aiService");
const aiService_2 = require("./aiService");
const biteshipService_1 = require("./biteshipService");
const uuid_1 = require("uuid");
// ─── Auth state dir ───────────────────────────────────────────────────────
const AUTH_DIR = path_1.default.resolve(process.cwd(), 'wa-auth');
if (!fs_1.default.existsSync(AUTH_DIR))
    fs_1.default.mkdirSync(AUTH_DIR, { recursive: true });
let waSocket = null;
let isConnected = false;
let qrCode = '';
// Pino logger silent — tidak spam terminal
const logger = (0, pino_1.default)({ level: 'silent' });
// ─── Connect ke WhatsApp ──────────────────────────────────────────────────
async function connectWhatsApp() {
    const { state, saveCreds } = await (0, baileys_1.useMultiFileAuthState)(AUTH_DIR);
    const { version } = await (0, baileys_1.fetchLatestBaileysVersion)();
    waSocket = (0, baileys_1.default)({
        version,
        auth: state,
        logger,
    });
    waSocket.ev.on('creds.update', saveCreds);
    waSocket.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            qrCode = qr;
            console.log('\n📱 Scan QR Code AgriHub WhatsApp Bot:\n');
            qrcode_terminal_1.default.generate(qr, { small: true });
        }
        if (connection === 'close') {
            isConnected = false;
            const reason = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = reason !== baileys_1.DisconnectReason.loggedOut;
            console.log('WA disconnected, reason:', reason, 'reconnecting:', shouldReconnect);
            if (shouldReconnect)
                setTimeout(connectWhatsApp, 3000);
        }
        else if (connection === 'open') {
            isConnected = true;
            qrCode = '';
            console.log('✅ AgriHub WhatsApp Bot terhubung!');
        }
    });
    waSocket.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify')
            return;
        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe)
                continue;
            await handleMessage(msg);
        }
    });
}
/**
 * Request Pairing Code
 * Alternatif untuk scan QR bagi kamera rusak
 */
async function getWAPairingCode(phoneNumber) {
    // Pastikan socket tidak sedang terhubung
    if (isConnected) {
        throw new Error('WhatsApp sudah terhubung. Logout dulu jika ingin ganti akun.');
    }
    // Jika ingin pairing baru, sebaiknya hapus session lama agar tidak konflik
    try {
        if (fs_1.default.existsSync(AUTH_DIR)) {
            console.log('🧹 Menghapus session lama untuk pairing baru...');
            // Tutup socket jika ada
            if (waSocket) {
                waSocket.ev.removeAllListeners('connection.update');
                waSocket.end(undefined);
                waSocket = null;
            }
            // Hapus isi folder wa-auth
            const files = fs_1.default.readdirSync(AUTH_DIR);
            for (const file of files) {
                fs_1.default.unlinkSync(path_1.default.join(AUTH_DIR, file));
            }
        }
    }
    catch (err) {
        console.error('⚠️ Gagal membersihkan session lama:', err);
    }
    // Mulai socket baru (pasti fresh karena AUTH_DIR kosong)
    console.log('🔄 Memulai socket baru (fresh) untuk pairing code...');
    await connectWhatsApp();
    // Beri jeda agar socket benar-benar siap
    await new Promise(resolve => setTimeout(resolve, 5000));
    // Bersihkan nomor (hanya angka)
    const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
    if (!cleanPhone)
        throw new Error('Nomor HP tidak valid');
    console.log(`🔑 Meminta Pairing Code untuk: ${cleanPhone}`);
    try {
        const socket = waSocket;
        if (!socket)
            throw new Error('Gagal menginisialisasi socket WhatsApp');
        const code = await socket.requestPairingCode(cleanPhone);
        return code;
    }
    catch (err) {
        console.error('❌ Error saat meminta pairing code:', err);
        throw new Error('Gagal meminta Pairing Code. Pastikan server stabil dan coba lagi.');
    }
}
function getWAStatus() {
    return { isConnected, hasQR: !!qrCode, qrCode };
}
async function sendWAMessage(jid, text) {
    if (!waSocket || !isConnected)
        throw new Error('WhatsApp bot tidak terhubung');
    await waSocket.sendMessage(jid, { text });
}
// ─── Commands Parser ──────────────────────────────────────────────────────
async function handleMessage(msg) {
    if (!msg.key)
        return;
    const jid = msg.key.remoteJid;
    const isGroup = jid.endsWith('@g.us');
    const text = (msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        '').trim();
    if (!text)
        return;
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
            const user = await (0, knex_1.default)('users').where('phone', 'like', `%${phone.slice(-9)}%`).first();
            if (!user) {
                await sendWAMessage(jid, `❌ Nomor ${phone} belum terdaftar di AgriHub.\n\nDaftar di: https://agrihub.id/daftar`);
                return;
            }
            const existingStore = await (0, knex_1.default)('stores').where({ owner_id: user.id }).first();
            if (existingStore) {
                await sendWAMessage(jid, `⚠️ Anda sudah punya toko: *${existingStore.name}* (${existingStore.store_code})`);
                return;
            }
            const storeCode = `TM-${Math.floor(1000 + Math.random() * 9000)}`;
            const now = new Date().toISOString();
            await (0, knex_1.default)('stores').insert({
                id: (0, uuid_1.v4)(), owner_id: user.id, store_code: storeCode,
                name, kabupaten, provinsi,
                product_types: JSON.stringify(product_types ? product_types.split(',').map((s) => s.trim()) : []),
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
            const user = await (0, knex_1.default)('users').where('phone', 'like', `%${phone.slice(-9)}%`).first();
            const store = user ? await (0, knex_1.default)('stores').where({ owner_id: user.id }).first() : null;
            if (!store) {
                await sendWAMessage(jid, '❌ Anda belum punya toko. Ketik DAFTAR TOKO dulu!');
                return;
            }
            const productId = (0, uuid_1.v4)();
            const now = new Date().toISOString();
            await (0, knex_1.default)('products').insert({
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
            const rates = await (0, biteshipService_1.checkOngkir)({ origin_postal_code: origin, destination_postal_code: destination, weight_gram: Number(weightKg) * 1000 });
            if (rates.length === 0) {
                await sendWAMessage(jid, '❌ Tidak ada kurir yang tersedia untuk rute ini.');
                return;
            }
            const rateText = rates.slice(0, 5).map((r, i) => `${i + 1}. ${r.courier} ${r.service}\n   💰 Rp${r.price.toLocaleString('id-ID')} | 📅 ${r.estimated_days} hari`).join('\n\n');
            await sendWAMessage(jid, `📦 *Ongkir ${origin} → ${destination} (${weightKg}kg)*\n\n${rateText}\n\n_Data dari Biteship_`);
            return;
        }
        // STOK — cek stok toko sendiri
        if (upper === 'STOK') {
            const phone = sender.split('@')[0].replace(/[^0-9]/g, '');
            const user = await (0, knex_1.default)('users').where('phone', 'like', `%${phone.slice(-9)}%`).first();
            const store = user ? await (0, knex_1.default)('stores').where({ owner_id: user.id }).first() : null;
            if (!store) {
                await sendWAMessage(jid, '❌ Anda belum punya toko.');
                return;
            }
            const products = await (0, knex_1.default)('products').where({ store_id: store.id, is_active: true });
            if (products.length === 0) {
                await sendWAMessage(jid, '📭 Toko Anda belum punya produk aktif.');
                return;
            }
            const stokText = products.map((p, i) => `${i + 1}. ${p.name}\n   📦 ${p.stock_quantity} ${p.unit} @ Rp${Number(p.price_per_unit).toLocaleString('id-ID')}`).join('\n');
            await sendWAMessage(jid, `🏪 *Stok ${store.name}*\n\n${stokText}`);
            return;
        }
        // PESANAN — cek pesanan terbaru
        if (upper === 'PESANAN') {
            const phone = sender.split('@')[0].replace(/[^0-9]/g, '');
            const user = await (0, knex_1.default)('users').where('phone', 'like', `%${phone.slice(-9)}%`).first();
            if (!user) {
                await sendWAMessage(jid, '❌ Nomor belum terdaftar di AgriHub.');
                return;
            }
            const orders = await (0, knex_1.default)('orders')
                .join('products', 'orders.product_id', 'products.id')
                .where('orders.seller_id', user.id)
                .whereNot('orders.status', 'dibatalkan')
                .orderBy('orders.created_at', 'desc')
                .limit(5)
                .select('orders.id', 'orders.status', 'orders.total_amount', 'orders.quantity', 'products.name as product_name');
            if (orders.length === 0) {
                await sendWAMessage(jid, '📭 Belum ada pesanan masuk.');
                return;
            }
            const orderText = orders.map((o, i) => `${i + 1}. ${o.product_name} (${o.quantity}kg)\n   💰 Rp${Number(o.total_amount).toLocaleString('id-ID')} | Status: ${o.status}`).join('\n');
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
            const credit = await (0, aiService_2.checkGroupCredit)(jid);
            if (!credit.allowed) {
                // Hanya reply jika di-mention bot
                return;
            }
            await (0, aiService_2.deductGroupCredit)(jid, 0.05);
        }
        // Cari user ID berdasarkan nomor pengirim
        const userPhone = sender.split('@')[0].replace(/[^0-9]/g, '');
        const user = await (0, knex_1.default)('users').where('phone', 'like', `%${userPhone.slice(-9)}%`).first();
        const aiReply = await (0, aiService_1.chatWithAI)({
            message: text, history: [], userId: user ? user.id : 'wa-bot',
            useRag: true,
        });
        await sendWAMessage(jid, `🌱 ${aiReply.reply}${aiReply.ragSources.length > 0 ? `\n\n_📚 Sumber: ${aiReply.ragSources.join(', ')}_` : ''}`);
    }
    catch (err) {
        console.error('WA message handler error:', err);
    }
}
//# sourceMappingURL=whatsappBot.js.map
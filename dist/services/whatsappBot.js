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
const knex_1 = __importDefault(require("../config/knex"));
const aiService_1 = require("./aiService");
const aiService_2 = require("./aiService");
const biteshipService_1 = require("./biteshipService");
const uuid_1 = require("uuid");
// ─── Constants ───────────────────────────────────────────────────────────
let waSocket = null;
let isConnected = false;
let qrCode = '';
const logger = (0, pino_1.default)({ level: 'silent' });
// Sesi penanggung jawab grup (Map<groupJid + senderLid, { userId, expires }>)
const pendingAssignments = new Map();
// ─── Database Auth State Provider ─────────────────────────────────────────
async function ensureAuthTable() {
    const exists = await knex_1.default.schema.hasTable('whatsapp_auth');
    if (!exists) {
        console.log('🏗️ Membuat tabel whatsapp_auth...');
        await knex_1.default.schema.createTable('whatsapp_auth', (table) => {
            table.uuid('id').primary();
            table.string('category').index();
            table.string('key_id').index();
            table.text('data');
            table.timestamp('updated_at').defaultTo(knex_1.default.fn.now());
            table.unique(['category', 'key_id']);
        });
    }
}
async function useDatabaseAuthState() {
    await ensureAuthTable();
    const writeData = async (data, category, keyId) => {
        const jsonStr = JSON.stringify(data, baileys_1.BufferJSON.replacer);
        const existing = await (0, knex_1.default)('whatsapp_auth').where({ category, key_id: keyId }).first();
        if (existing) {
            await (0, knex_1.default)('whatsapp_auth').where({ id: existing.id }).update({ data: jsonStr, updated_at: new Date().toISOString() });
        }
        else {
            await (0, knex_1.default)('whatsapp_auth').insert({ id: (0, uuid_1.v4)(), category, key_id: keyId, data: jsonStr });
        }
    };
    const readData = async (category, keyId) => {
        const row = await (0, knex_1.default)('whatsapp_auth').where({ category, key_id: keyId }).first();
        if (!row)
            return null;
        return JSON.parse(row.data, baileys_1.BufferJSON.reviver);
    };
    const removeData = async (category, keyId) => {
        await (0, knex_1.default)('whatsapp_auth').where({ category, key_id: keyId }).delete();
    };
    let creds = await readData('creds', 'main') || (0, baileys_1.initAuthCreds)();
    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data = {};
                    await Promise.all(ids.map(async (id) => {
                        let value = await readData(type, id);
                        if (type === 'app-state-sync-key' && value) {
                            value = baileys_1.proto.Message.AppStateSyncKeyData.fromObject(value);
                        }
                        data[id] = value;
                    }));
                    return data;
                },
                set: async (data) => {
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id];
                            if (value) {
                                await writeData(value, category, id);
                            }
                            else {
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
async function connectWhatsApp() {
    const { state, saveCreds } = await useDatabaseAuthState();
    const { version } = await (0, baileys_1.fetchLatestBaileysVersion)();
    waSocket = (0, baileys_1.default)({
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
            qrcode_terminal_1.default.generate(qr, { small: true });
        }
        if (connection === 'close') {
            isConnected = false;
            const reason = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = reason !== baileys_1.DisconnectReason.loggedOut;
            console.log('WA disconnected, reason:', reason, 'reconnecting:', shouldReconnect);
            if (shouldReconnect) {
                setTimeout(connectWhatsApp, 5000);
            }
            else {
                console.log('🧹 Logging out, clearing database session...');
                (0, knex_1.default)('whatsapp_auth').delete().catch(e => console.error('Gagal hapus session:', e));
            }
        }
        else if (connection === 'open') {
            isConnected = true;
            qrCode = '';
            const identityStr = JSON.stringify(waSocket?.user || {});
            // Hanya log jika identity berubah untuk menghindari spam
            if (waSocket._lastIdentity !== identityStr) {
                console.log('✅ AgriHub WhatsApp Bot terhubung (MOD DEPLOY-PROOF)!');
                console.log('🤖 Identity:', JSON.stringify(waSocket?.user || {}, null, 2));
                waSocket._lastIdentity = identityStr;
            }
            // Cleanup pending assignments berkala (setiap 1 menit)
            setInterval(() => {
                const now = Date.now();
                for (const [key, val] of pendingAssignments.entries()) {
                    if (val.expires < now)
                        pendingAssignments.delete(key);
                }
            }, 60000);
        }
    });
    waSocket.ev.on('group-participants.update', async (update) => {
        const botId = waSocket?.user?.id?.split('@')[0].split(':')[0] || '';
        const botLid = waSocket?.user?.lid?.split('@')[0] || '';
        // Jika bot ditambahkan ke grup
        if (update.action === 'add' && update.participants.some((p) => p.id?.startsWith(botId) || (botLid && p.id?.startsWith(botLid)))) {
            console.log(`👋 Bot ditambahkan ke grup: ${update.id} oleh ${update.author}`);
            // Track siapa yang add (untuk usage tracking/owner grup)
            if (update.author) {
                // Cari user berdasarkan JID (Phone) atau LID
                const user = await (0, knex_1.default)('users')
                    .where({ whatsapp_lid: update.author })
                    .orWhere('phone', 'like', `%${update.author.split('@')[0].replace(/[^0-9]/g, '').slice(-9)}%`)
                    .first();
                const existing = await (0, knex_1.default)('group_credits').where({ group_jid: update.id }).first();
                if (!existing) {
                    await (0, knex_1.default)('group_credits').insert({
                        id: (0, uuid_1.v4)(),
                        group_jid: update.id,
                        owner_id: user ? user.id : null,
                        credits_balance: 5.0, // Bonus awal untuk grup baru
                        is_ai_enabled: true,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    });
                }
                else if (user && !existing.owner_id) {
                    await (0, knex_1.default)('group_credits').where({ id: existing.id }).update({ owner_id: user.id });
                }
            }
            await sendWAMessage(update.id, '🌾 *Halo semuanya! Saya AsistenTani AgriHub.*\n\nSaya siap membantu di grup ini! Tag saya atau ketik *MENU* untuk melihat perintah yang tersedia. Selamat bertani! 🚜🌿');
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
async function getWAPairingCode(phoneNumber) {
    const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
    if (!cleanPhone)
        throw new Error('Nomor HP tidak valid');
    await ensureAuthTable();
    if (isConnected && waSocket?.user?.id?.startsWith(cleanPhone)) {
        return 'ALREADY_CONNECTED';
    }
    const currentCredsRow = await (0, knex_1.default)('whatsapp_auth').where({ category: 'creds', key_id: 'main' }).first();
    if (currentCredsRow) {
        const creds = JSON.parse(currentCredsRow.data, baileys_1.BufferJSON.reviver);
        const existingNum = creds.me?.id?.split(':')[0];
        if (existingNum && existingNum !== cleanPhone) {
            console.log('🧹 Membersihkan database karena nomor berbeda...');
            await (0, knex_1.default)('whatsapp_auth').delete();
            if (waSocket) {
                try {
                    waSocket.end(undefined);
                }
                catch { }
                waSocket = null;
            }
        }
    }
    if (!waSocket) {
        await connectWhatsApp();
        await new Promise(r => setTimeout(r, 5000));
    }
    try {
        const socket = waSocket;
        return await socket.requestPairingCode(cleanPhone);
    }
    catch (err) {
        throw new Error('Gagal meminta Pairing Code. Coba lagi nanti.');
    }
}
function getWAStatus() {
    return { isConnected, hasQR: !!qrCode, qrCode };
}
async function sendWAMessage(jid, text) {
    if (!waSocket || !isConnected)
        return;
    await waSocket.sendMessage(jid, { text });
}
// ─── Message Handler Logic ──────────────────────────────────────────────
async function handleMessage(msg) {
    if (!msg.key)
        return;
    const jid = msg.key.remoteJid;
    const isGroup = jid.endsWith('@g.us');
    const text = (msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        '').trim();
    if (!text)
        return;
    const upper = text.toUpperCase();
    const sender = msg.key.participant || msg.key.remoteJid || '';
    // ── DETEKSI MENTION YANG KUAT (Phone ID & LID) ─────────────────────────
    const botFullId = waSocket?.user?.id || '';
    const botId = botFullId.split('@')[0].split(':')[0] || '';
    const botLidFull = waSocket?.user?.lid || '';
    const botLid = botLidFull.split('@')[0].split(':')[0] || '';
    const botJids = [botFullId, botId + '@s.whatsapp.net', botLidFull, botLid + '@lid'].filter(Boolean);
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo ||
        msg.message?.imageMessage?.contextInfo ||
        msg.message?.videoMessage?.contextInfo ||
        msg.message?.audioMessage?.contextInfo ||
        msg.message?.documentMessage?.contextInfo;
    const mentionedJids = contextInfo?.mentionedJid || [];
    // Regex untuk membersihkan mention dari teks (baik nomor HP atau LID)
    const regexPatterns = [
        `^@${botId}\\s*`,
        `^@${botId.slice(2)}\\s*`,
        `^@${botLid}\\s*`,
        `^@AsistenTani\\s*`,
        `^@Bot\\s*`,
        `^@Agrihub\\s*`
    ].filter(p => !p.includes('^@\\s*')).join('|');
    const cleanText = text.replace(new RegExp(regexPatterns, 'gi'), '').trim();
    const cleanUpper = cleanText.toUpperCase();
    // Status mention: JID cocok, LID cocok, nomor cocok di teks, atau keyword terpancing
    const isMentioned = mentionedJids.some(mj => botJids.includes(mj)) ||
        text.includes(`@${botId}`) ||
        (botLid && text.includes(`@${botLid}`)) ||
        cleanText !== text ||
        (isGroup && text.toLowerCase().includes('asistentani')) ||
        (isGroup && text.toLowerCase().includes('bot'));
    if (isGroup) {
        console.log(`📩 [GROUP] From: ${sender} in ${jid} | Text: "${text}" | Clean: "${cleanText}" | Mention: ${isMentioned}`);
    }
    // ── RESOLUSI IDENTITY (Link Phone & LID) ───────────────────────────────
    let user = null;
    const isLid = sender.endsWith('@lid');
    const participantJid = msg.key.participant || ''; // "628xxx@s.whatsapp.net" or "xxx@lid"
    if (isLid) {
        user = await (0, knex_1.default)('users').where({ whatsapp_lid: sender }).first();
    }
    else {
        const phone = sender.split('@')[0].replace(/[^0-9]/g, '');
        user = await (0, knex_1.default)('users').where('phone', 'like', `%${phone.slice(-9)}%`).first();
        // Jika kita ketemu via phone, tapi msg.key.participant (jika di grup) punya LID, link-kan!
        const participantLid = participantJid.endsWith('@lid') ? participantJid : null;
        if (user && participantLid && user.whatsapp_lid !== participantLid) {
            await (0, knex_1.default)('users').where({ id: user.id }).update({ whatsapp_lid: participantLid });
            console.log(`🔗 Linked LID ${participantLid} to user ${user.phone}`);
        }
    }
    try {
        // ── Command Parser (Panggil dengan cleanUpper agar @Bot MENU tetap terbaca MENU) ──
        const isCommand = ['DAFTAR TOKO', 'JUAL ', 'ONGKIR ', 'STOK', 'PESANAN', 'MENU', 'HELP', 'LINK '].some(c => cleanUpper.startsWith(c));
        if (isCommand) {
            if (cleanUpper.startsWith('LINK ')) {
                const inputPhone = cleanText.slice(5).trim().replace(/[^0-9]/g, '');
                if (inputPhone.length < 9) {
                    await sendWAMessage(jid, '📝 *Format:* LINK [Nomor HP Anda]\nContoh: LINK 085188000139');
                    return;
                }
                const targetUser = await (0, knex_1.default)('users').where('phone', 'like', `%${inputPhone.slice(-9)}%`).first();
                if (!targetUser) {
                    await sendWAMessage(jid, `❌ Nomor *${inputPhone}* tidak ditemukan di database AgriHub. Pastikan Anda sudah mendaftar di web.`);
                    return;
                }
                // Tautkan LID saat ini ke user tersebut
                await (0, knex_1.default)('users').where({ id: targetUser.id }).update({ whatsapp_lid: sender });
                await sendWAMessage(jid, `✅ *Berhasil!* Akun AgriHub (${targetUser.name}) kini tertaut dengan ID WhatsApp ini.\n\nSekarang Anda bisa menggunakan Asisten AI dan mengelola grup!`);
                return;
            }
            if (cleanUpper.startsWith('DAFTAR TOKO')) {
                const parts = cleanText.split('|').map(s => s.trim());
                if (parts.length < 3) {
                    await sendWAMessage(jid, '📝 Format: DAFTAR TOKO | Nama Toko | Kabupaten | Provinsi | Produk');
                    return;
                }
                const [, name, kabupaten, provinsi, product_types] = parts;
                const phone = sender.split('@')[0].replace(/[^0-9]/g, '');
                const user = await (0, knex_1.default)('users').where('phone', 'like', `%${phone.slice(-9)}%`).first();
                if (!user) {
                    await sendWAMessage(jid, `❌ Nomor ${phone} belum terdaftar di AgriHub.\n\nDaftar di: https://agrihub.rumah-genbi.com/daftar`);
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
            if (cleanUpper.startsWith('JUAL ')) {
                const parts = cleanText.slice(5).trim().split(/\s+/);
                if (parts.length < 3) {
                    await sendWAMessage(jid, '📝 Format: JUAL [nama produk] [harga/kg] [stok kg]');
                    return;
                }
                const stok = parts[parts.length - 1];
                const harga = parts[parts.length - 2];
                const nama = parts.slice(0, -2).join(' ');
                const phone = sender.split('@')[0].replace(/[^0-9]/g, '');
                const user = await (0, knex_1.default)('users').where('phone', 'like', `%${phone.slice(-9)}%`).first();
                const store = user ? await (0, knex_1.default)('stores').where({ owner_id: user.id }).first() : null;
                if (!store) {
                    await sendWAMessage(jid, '❌ Toko tidak ditemukan. Daftar dulu!');
                    return;
                }
                await (0, knex_1.default)('products').insert({
                    id: (0, uuid_1.v4)(), store_id: store.id, name: nama, unit: 'kg',
                    price_per_unit: Number(harga), stock_quantity: Number(stok),
                    min_order: 1, is_active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
                });
                await sendWAMessage(jid, `✅ *Produk ditambahkan:* ${nama} | Rp${Number(harga).toLocaleString('id-ID')}/kg`);
                return;
            }
            if (cleanUpper.startsWith('ONGKIR ')) {
                const parts = cleanText.slice(7).trim().split(/\s+/);
                if (parts.length < 3) {
                    await sendWAMessage(jid, '📝 Format: ONGKIR [asal] [tujuan] [berat kg]');
                    return;
                }
                const [origin, destination, weightKg] = parts;
                await sendWAMessage(jid, `⏳ Cek ongkir ${origin} → ${destination}...`);
                const rates = await (0, biteshipService_1.checkOngkir)({ origin_postal_code: origin, destination_postal_code: destination, weight_gram: Number(weightKg) * 1000 });
                const rateText = rates.slice(0, 3).map(r => `• ${r.courier} ${r.service}: Rp${r.price.toLocaleString('id-ID')}`).join('\n');
                await sendWAMessage(jid, `📦 *Ongkir ${origin} → ${destination}*\n\n${rateText || 'Tidak ditemukan.'}`);
                return;
            }
            if (cleanUpper === 'STOK') {
                const phone = sender.split('@')[0].replace(/[^0-9]/g, '');
                const user = await (0, knex_1.default)('users').where('phone', 'like', `%${phone.slice(-9)}%`).first();
                const store = user ? await (0, knex_1.default)('stores').where({ owner_id: user.id }).first() : null;
                if (!store) {
                    await sendWAMessage(jid, '❌ Toko tidak ditemukan.');
                    return;
                }
                const products = await (0, knex_1.default)('products').where({ store_id: store.id, is_active: true });
                const stokText = products.map(p => `• ${p.name}: ${p.stock_quantity}`).join('\n');
                await sendWAMessage(jid, `🏪 *Stok ${store.name}:*\n${stokText || 'Kosong.'}`);
                return;
            }
            if (cleanUpper === 'PESANAN') {
                const phone = sender.split('@')[0].replace(/[^0-9]/g, '');
                const user = await (0, knex_1.default)('users').where('phone', 'like', `%${phone.slice(-9)}%`).first();
                if (!user) {
                    await sendWAMessage(jid, '❌ Akun tidak ditemukan.');
                    return;
                }
                const orders = await (0, knex_1.default)('orders').join('products', 'orders.product_id', 'products.id').where('orders.seller_id', user.id).limit(3).select('products.name', 'orders.status');
                const orderText = orders.map(o => `• ${o.name}: ${o.status}`).join('\n');
                await sendWAMessage(jid, `📦 *Pesanan:* \n${orderText || 'Tidak ada.'}`);
                return;
            }
            if (cleanUpper === 'MENU' || cleanUpper === 'HELP') {
                await sendWAMessage(jid, `🌾 *Menu AgriHub*\n\n• DAFTAR TOKO | nama | kab | prov | produk\n• JUAL [nama] [harga] [stok]\n• STOK\n• PESANAN\n• ONGKIR [asal] [tujuan] [berat]\n• LINK [NomorHP] (Tautkan WA ini ke akun Anda)\n\nAtau tanya saja langsung ke AI!`);
                return;
            }
        }
        // ── AI Hub Interaction ──
        if (isGroup && !isMentioned) {
            // Cek apakah user membalas tawaran jadi penanggung jawab (IYA/YA)
            const pending = pendingAssignments.get(jid + sender);
            if (pending && (upper === 'YA' || upper === 'IYA')) {
                if (pending.expires < Date.now()) {
                    pendingAssignments.delete(jid + sender);
                    return;
                }
                await (0, knex_1.default)('group_credits').where({ group_jid: jid }).update({
                    owner_id: pending.userId,
                    updated_at: new Date().toISOString()
                });
                pendingAssignments.delete(jid + sender);
                const freshUser = await (0, knex_1.default)('users').where({ id: pending.userId }).first();
                let msgText = `✅ *Berhasil!* Anda sekarang adalah penanggung jawab resmi untuk AI di grup ini.`;
                if (freshUser && !freshUser.puter_token) {
                    msgText += `\n\n🔌 *Satu langkah lagi:* Akun Anda belum terhubung ke Puter.com. Silakan klik link sakti ini untuk langsung menghubungkan:\n👉 https://agrihub.rumah-genbi.com/app?action=connect-puter`;
                }
                await sendWAMessage(jid, msgText);
                return;
            }
            return;
        }
        if (!isCommand) {
            // Cek siapa yang bertanggung jawab atas grup ini
            let targetUserId = 'wa-bot';
            if (isGroup) {
                const groupMeta = await (0, knex_1.default)('group_credits').where({ group_jid: jid }).first();
                if (!groupMeta || !groupMeta.owner_id) {
                    if (isMentioned) {
                        if (!user) {
                            const isRealPhone = sender.endsWith('@s.whatsapp.net');
                            const decodedPhone = isRealPhone ? sender.split('@')[0].replace(/[^0-9]/g, '') : '';
                            const phoneParam = decodedPhone ? `&phone=${decodedPhone}` : '';
                            await sendWAMessage(jid, `⚠️ Grup ini belum memiliki penanggung jawab AI.\n\nSepertinya Anda belum terdaftar. Silakan daftar dulu melalui link ini agar bisa mengelola grup:\n👉 https://agrihub.rumah-genbi.com/login?mode=register${phoneParam}&action=link&lid=${sender}`);
                        }
                        else {
                            // Tawarkan jadi penanggung jawab
                            pendingAssignments.set(jid + sender, { userId: user.id, expires: Date.now() + 300000 }); // 5 menit
                            await sendWAMessage(jid, `👋 Halo *${user.name}*!\n\nGrup ini belum memiliki penanggung jawab resmi untuk penggunaan AI.\n\nApakah Anda bersedia menjadi penanggung jawab grup ini? (Seluruh penggunaan AI di grup ini akan menggunakan profil & kredit Anda).\n\nBalas *YA* untuk mengkonfirmasi.`);
                        }
                    }
                    return;
                }
                const owner = await (0, knex_1.default)('users').where({ id: groupMeta.owner_id }).first();
                if (!owner) {
                    if (isMentioned)
                        await sendWAMessage(jid, `❌ Penanggung jawab grup ini tidak ditemukan di database.`);
                    return;
                }
                if (!owner.puter_token) {
                    if (isMentioned)
                        await sendWAMessage(jid, `🔌 Penanggung jawab grup ini (@${owner.phone.split(':')[0]}) belum menghubungkan akun Puter.com.\n\nHarap hubungkan di: https://agrihub.rumah-genbi.com/app?action=connect-puter`);
                    return;
                }
                const credit = await (0, aiService_2.checkGroupCredit)(jid);
                if (!credit.allowed) {
                    if (isMentioned)
                        await sendWAMessage(jid, `⚠️ Kredit AI Grup Habis.`);
                    return;
                }
                await (0, aiService_2.deductGroupCredit)(jid, 0.05);
                targetUserId = owner.id; // Semua aktivitas ditarik ke penanggung jawab
            }
            else {
                // Private Chat: Check user sendiri (user sudah di-resolve di atas)
                if (!user) {
                    const isRealPhone = sender.endsWith('@s.whatsapp.net');
                    const decodedPhone = isRealPhone ? sender.split('@')[0].replace(/[^0-9]/g, '') : '';
                    const phoneParam = decodedPhone ? `&phone=${decodedPhone}` : '';
                    // Cek apakah ada user dengan "nomor bayangan" dari LID ini atau nomor aslinya
                    let exists = null;
                    if (decodedPhone) {
                        exists = await (0, knex_1.default)('users').where('phone', 'like', `%${decodedPhone.slice(-9)}%`).first();
                    }
                    if (exists) {
                        await sendWAMessage(jid, `👋 *Halo ${exists.name}! Sepertinya Anda sudah terdaftar, namun identitas WhatsApp ini belum tertaut.*\n\nSilakan klik link di bawah untuk login dan menautkan akun secara otomatis:\n👉 https://agrihub.rumah-genbi.com/login?mode=login${phoneParam}&action=link&lid=${sender}`);
                    }
                    else {
                        await sendWAMessage(jid, `👋 *Halo! Sepertinya Anda belum terdaftar di AgriHub.*\n\nSilakan daftar di link berikut (ID WhatsApp akan tertaut otomatis):\n👉 https://agrihub.rumah-genbi.com/login?mode=register${phoneParam}&action=link&lid=${sender}`);
                    }
                    return;
                }
                if (!user.puter_token) {
                    await sendWAMessage(jid, `🔌 *Akun Anda belum terhubung ke Puter.com.*\n\nSilakan klik link ini untuk langsung menghubungkan:\n👉 https://agrihub.rumah-genbi.com/app?action=connect-puter`);
                    return;
                }
                targetUserId = user.id;
            }
            // 1. Simpan pesan user ke DB
            await (0, knex_1.default)('chats').insert({
                id: (0, uuid_1.v4)(),
                user_id: user ? user.id : null,
                whatsapp_jid: jid,
                role: 'user',
                content: cleanText || 'Halo!',
                created_at: new Date().toISOString()
            });
            const aiReply = await (0, aiService_1.chatWithAI)({
                message: cleanText || 'Halo!',
                history: [],
                userId: targetUserId,
                whatsappJid: jid,
                useRag: true
            });
            // 2. Simpan balasan AI ke DB
            await (0, knex_1.default)('chats').insert({
                id: (0, uuid_1.v4)(),
                user_id: user ? user.id : 'wa-bot',
                whatsapp_jid: jid,
                role: 'assistant',
                content: aiReply.reply,
                created_at: new Date().toISOString()
            });
            await sendWAMessage(jid, `🌱 ${aiReply.reply}`);
        }
    }
    catch (err) {
        console.error('WA handleMessage error:', err);
    }
}
//# sourceMappingURL=whatsappBot.js.map
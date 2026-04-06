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
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const aiService_1 = require("./aiService");
const biteshipService_1 = require("./biteshipService");
const transactionService = __importStar(require("./transactionService"));
const uuid_1 = require("uuid");
const puter_js_1 = __importDefault(require("@heyputer/puter.js"));
const checkoutService = __importStar(require("./whatsappCheckoutService"));
// ─── Constants ───────────────────────────────────────────────────────────
const SESSION_NAME = process.env.WA_SESSION_NAME || 'main';
let waSocket = null;
let isConnected = false;
let qrCode = '';
const logger = (0, pino_1.default)({ level: 'silent' });
// Sesi penanggung jawab grup (Map<groupJid + senderLid, { userId, expires }>)
const pendingAssignments = new Map();
// ─── Dedup cache: mencegah pesan diproses dua kali saat reconnect/replay ────
const processedMsgIds = new Set();
const MAX_PROCESSED_CACHE = 500;
let isInitializing = false;
let isConnecting = false;
let isInitializedFlag = false;
let lastLockWarning = 0;
let isYielding = false;
let outboxInterval = null;
// ─── Baileys Version Cache ─────────────────────────────────────────────────
// fetchLatestBaileysVersion() membuat outbound HTTP call setiap reconnect.
// Cache ini mencegah hang saat jaringan tidak stabil.
let _cachedBaileysVersion = null;
let _lastVersionFetch = 0;
async function getBaileysVersion() {
    const now = Date.now();
    // Gunakan cache jika masih fresh (< 1 jam)
    if (_cachedBaileysVersion && now - _lastVersionFetch < 3600000) {
        return _cachedBaileysVersion;
    }
    try {
        const result = await Promise.race([
            (0, baileys_1.fetchLatestBaileysVersion)(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('VERSION_TIMEOUT')), 8000)),
        ]);
        _cachedBaileysVersion = result.version;
        _lastVersionFetch = now;
        return result.version;
    }
    catch {
        console.warn('⚠️ [WA] fetchLatestBaileysVersion timeout/gagal, pakai versi cache/fallback.');
        return _cachedBaileysVersion || [2, 3000, 1015901307];
    }
}
// ─── Watchdog ─────────────────────────────────────────────────────────────
// Deteksi silent disconnect (TCP timeout dari sisi WA, tanpa trigger event).
let _lastActivityTime = Date.now();
let _watchdogId = null;
function startWatchdog() {
    if (_watchdogId)
        clearInterval(_watchdogId);
    _lastActivityTime = Date.now();
    _watchdogId = setInterval(() => {
        if (!isConnected) {
            clearInterval(_watchdogId);
            _watchdogId = null;
            return;
        }
        const silent = Date.now() - _lastActivityTime;
        if (silent > 120000) {
            console.warn(`⚠️ [WA] Watchdog: Socket silent ${Math.round(silent / 1000)}s, forcing reconnect...`);
            isConnected = false;
            if (_watchdogId) {
                clearInterval(_watchdogId);
                _watchdogId = null;
            }
            try {
                waSocket?.end(undefined);
            }
            catch { }
            waSocket = null;
            isConnecting = false;
            setTimeout(() => connectWhatsApp(), 2000);
        }
    }, 30000);
}
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
    let creds = await readData('creds', SESSION_NAME) || (0, baileys_1.initAuthCreds)();
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
            await writeData(creds, 'creds', SESSION_NAME);
        }
    };
}
const baileys_2 = require("baileys");
const documentParser_1 = require("./documentParser");
const ragService_1 = require("./ragService");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const os_1 = __importDefault(require("os"));
const crypto_1 = __importDefault(require("crypto"));
// ─── Ensure System Users ────────────────────────────────────────────────
async function ensureSystemUsers() {
    const botId = 'wa-bot';
    const exists = await (0, knex_1.default)('users').where({ id: botId }).first();
    if (!exists) {
        console.log('🤖 Creating system user: wa-bot');
        await (0, knex_1.default)('users').insert({
            id: botId,
            name: 'AsistenTani Bot',
            email: 'bot@agrihub.rumah-genbi.com',
            phone: '0000000000',
            password_hash: (0, uuid_1.v4)(), // Random hash
            role: 'admin',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });
    }
}
async function connectWhatsApp() {
    if (isConnecting) {
        console.log('⏳ Connection already in progress, skipping...');
        return;
    }
    isConnecting = true;
    // Guard: pastikan isConnecting selalu direset jika terjadi exception
    // sebelum socket terbentuk (mencegah flag stuck = true selamanya)
    let socketCreated = false;
    try {
        if (!isInitializedFlag && !isInitializing) {
            isInitializing = true;
            try {
                await ensureSystemUsers();
                isInitializedFlag = true;
            }
            finally {
                isInitializing = false;
            }
        }
        // ─── Global Mutex (DB Lock) ─────────────────────────────
        const lockKey = `whatsapp_bot_${SESSION_NAME}`;
        const nowUnix = Math.floor(Date.now() / 1000);
        // Clean up old locks (> 30s)
        await (0, knex_1.default)('whatsapp_auth').where({ category: 'lock', key_id: lockKey }).where('updated_at', '<', new Date(Date.now() - 30000).toISOString()).delete();
        const existingLock = await (0, knex_1.default)('whatsapp_auth').where({ category: 'lock', key_id: lockKey }).first();
        if (existingLock) {
            const lockData = JSON.parse(existingLock.data);
            if (lockData.pid && String(lockData.pid) !== String(process.pid)) {
                // Check if the lock is "Fresh" (< 30s)
                const isFresh = (Date.now() - new Date(existingLock.updated_at).getTime()) < 30000;
                if (isFresh) {
                    // Hanya log sekali setiap 2 menit agar tidak membanjiri konsol
                    if (!lastLockWarning || (Date.now() - lastLockWarning > 120000)) {
                        console.warn(`🕒 [WA] Active instance found (PID ${lockData.pid}). WA Bot runs on that process. I yield.`);
                        lastLockWarning = Date.now();
                    }
                    isConnected = false;
                    isConnecting = false;
                    isYielding = true;
                    // Cek lagi lebih lama agar tidak spam CPU
                    setTimeout(() => connectWhatsApp(), 60000);
                    return;
                }
                else {
                    console.log(`🧹 [WA] Stale lock found from PID ${lockData.pid}. Taking over...`);
                    await (0, knex_1.default)('whatsapp_auth').where({ category: 'lock', key_id: lockKey }).delete();
                }
            }
        }
        // Upsert Lock with current PID
        const myLockData = JSON.stringify({ pid: process.pid, startTime: nowUnix });
        const lockExists = await (0, knex_1.default)('whatsapp_auth').where({ category: 'lock', key_id: lockKey }).first();
        if (lockExists) {
            await (0, knex_1.default)('whatsapp_auth').where({ id: lockExists.id }).update({ data: myLockData, updated_at: new Date().toISOString() });
        }
        else {
            await (0, knex_1.default)('whatsapp_auth').insert({ id: (0, uuid_1.v4)(), category: 'lock', key_id: lockKey, data: myLockData });
        }
        isYielding = false;
        // Heartbeat interval (maintain lock every 15s)
        const heartbeatId = setInterval(async () => {
            // Jika bot sudah tidak terkoneksi/connecting, stop heartbeat
            if (!isConnecting && !isConnected) {
                clearInterval(heartbeatId);
                return;
            }
            try {
                // VERIFIKASI: Pastikan lock di DB masih milik kita (PID cocok)
                const currentLock = await (0, knex_1.default)('whatsapp_auth').where({ category: 'lock', key_id: lockKey }).first();
                if (currentLock) {
                    const data = JSON.parse(currentLock.data);
                    if (data.pid && String(data.pid) !== String(process.pid)) {
                        console.warn(`⚠️ [WA] Instance takeover detected (New PID: ${data.pid}). yielding control...`);
                        clearInterval(heartbeatId);
                        isConnected = false;
                        isConnecting = false;
                        stopOutboxPoller();
                        try {
                            waSocket?.end(undefined);
                        }
                        catch { }
                        waSocket = null;
                        return;
                    }
                }
                // Update heartbeat timestamp
                await (0, knex_1.default)('whatsapp_auth').where({ category: 'lock', key_id: lockKey }).update({ updated_at: new Date().toISOString() });
            }
            catch (err) {
                console.error('❌ [WA] Heartbeat error:', err.message);
            }
        }, 15000);
        const versionArr = await getBaileysVersion();
        const version = versionArr;
        console.log(`🚀 [PID:${process.pid}] Connecting with Baileys version: ${version.join('.')}...`);
        const { state, saveCreds } = await useDatabaseAuthState();
        waSocket = (0, baileys_1.default)({
            version,
            auth: state,
            logger,
            printQRInTerminal: false,
        });
        socketCreated = true; // Dari sini, connection.update akan handle isConnecting reset
        waSocket.ev.on('creds.update', saveCreds);
        waSocket.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            // Setiap event koneksi = tanda socket aktif
            _lastActivityTime = Date.now();
            if (qr) {
                qrCode = qr;
                console.log('\n📱 Scan QR Code AgriHub WhatsApp Bot (Database Persistent Mode):\n');
                qrcode_terminal_1.default.generate(qr, { small: true });
            }
            if (connection === 'close') {
                isConnected = false;
                isConnecting = false;
                stopOutboxPoller();
                const reason = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = reason !== baileys_1.DisconnectReason.loggedOut;
                console.log(`WA disconnected [PID:${process.pid}], reason:`, reason, 'reconnecting:', shouldReconnect);
                if (shouldReconnect) {
                    // Special Handling for 440 Conflict (Stream Replacement)
                    // standard network drops (ECONNRESET, etc.) get 2-7s jitter.
                    // 440 (Conflict) gets 35-70s jitter to definitely allow the other instance to settle.
                    let delay = 2000 + Math.random() * 5000;
                    if (reason === 440) {
                        console.warn('⚠️  CONFLIK (440) Detected! Waiting ~45s to allow other instances to clear...');
                        delay = 35000 + Math.random() * 35000;
                    }
                    console.log(`⏳ Reconnecting in ${Math.round(delay)}ms...`);
                    setTimeout(() => connectWhatsApp(), delay);
                }
                else {
                    console.log('🧹 Logging out, clearing database session...');
                    (0, knex_1.default)('whatsapp_auth').where({ category: 'creds', key_id: 'main' }).delete().catch(e => console.error('Gagal hapus session:', e));
                }
            }
            else if (connection === 'open') {
                isConnected = true;
                isConnecting = false;
                qrCode = null;
                startWatchdog(); // Mulai watchdog setelah koneksi berhasil
                startOutboxPoller(); // Mulai poller outbox
                console.log('✅ AgriHub WhatsApp Bot terhubung (MOD DEPLOY-PROOF)!');
                console.log('🤖 Identity:', JSON.stringify(waSocket?.user || {}, null, 2));
            }
        });
        waSocket.ev.on('group-participants.update', async (update) => {
            if (!waSocket)
                return;
            const botId = waSocket.user?.id?.split('@')[0].split(':')[0] || '';
            const botLid = waSocket.user?.lid?.split('@')[0] || '';
            // Jika bot ditambahkan ke grup
            if (update.action === 'add' && update.participants.some((p) => p.id?.startsWith(botId) || (botLid && p.id?.startsWith(botLid)))) {
                console.log(`👋 Bot ditambahkan ke grup: ${update.id} oleh ${update.author}`);
                if (update.author) {
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
                            credits_balance: 5.0,
                            is_ai_enabled: true,
                            created_at: new Date().toISOString(),
                            updated_at: new Date().toISOString()
                        });
                    }
                }
                await sendWAMessage(update.id, '🌾 *Halo semuanya! Saya AsistenTani AgriHub.*\n\nSaya siap membantu di grup ini! Tag saya atau ketik *MENU* untuk melihat perintah yang tersedia. Selamat bertani! 🚜🌿');
            }
        });
        waSocket.ev.on('messages.upsert', async ({ messages, type }) => {
            console.log(`📡 [WA] Event: messages.upsert | Type: ${type} | Count: ${messages.length}`);
            if (type !== 'notify')
                return;
            _lastActivityTime = Date.now(); // Update watchdog timer setiap ada pesan masuk
            for (const msg of messages) {
                if (!msg.message || msg.key.fromMe)
                    continue;
                // ── Dedup: skip jika pesan ini sudah pernah diproses ────────────────
                const msgId = msg.key.id || '';
                if (msgId && processedMsgIds.has(msgId)) {
                    console.log(`⏭️ [WA] Skipping duplicate msg: ${msgId}`);
                    continue;
                }
                if (msgId) {
                    processedMsgIds.add(msgId);
                    if (processedMsgIds.size > MAX_PROCESSED_CACHE) {
                        // Hapus entri paling lama untuk jaga memory
                        const first = processedMsgIds.values().next().value;
                        if (first)
                            processedMsgIds.delete(first);
                    }
                }
                console.log(`📩 [WA] Processing Msg:`, msgId);
                // Handle Documents (PDF, etc.) - Deep Search
                const doc = findDocumentInMessage(msg.message);
                if (doc) {
                    handleDocumentUpload(msg, doc).catch(err => console.error('❌ Doc Error:', err));
                }
                else {
                    handleMessage(msg).catch(err => console.error('❌ Msg Error:', err));
                }
            }
        });
    }
    finally {
        // Jika socket tidak sempat dibuat (exception / di-cancel)
        if (!socketCreated) {
            // Tidak perlu console log "Socket tidak sempat dibuat" yang malah jadi spam
            isConnecting = false;
        }
    }
}
function findDocumentInMessage(msg) {
    if (!msg)
        return null;
    if (msg.documentMessage)
        return msg.documentMessage;
    // Check nested structures
    const keys = ['documentWithCaptionMessage', 'ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'templateMessage', 'interactiveMessage', 'quotedMessage'];
    for (const key of keys) {
        if (msg[key]?.message) {
            const found = findDocumentInMessage(msg[key].message);
            if (found)
                return found;
        }
    }
    return null;
}
async function handleDocumentUpload(msg, doc) {
    const jid = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    const fileName = doc.fileName || 'dokumen.pdf';
    const mimeType = doc.mimetype;
    // Hanya proses PDF, TXT, dan MD untuk saat ini
    const isPdf = mimeType?.includes('pdf') || fileName.toLowerCase().endsWith('.pdf');
    const isText = mimeType?.includes('plain') || mimeType?.includes('markdown') || fileName.toLowerCase().endsWith('.txt') || fileName.toLowerCase().endsWith('.md');
    if (!isPdf && !isText) {
        console.log(`🚫 Document type not supported: ${mimeType}`);
        return;
    }
    try {
        // 1. Identifikasi siapa penanggung jawab (owner) grup/chat ini
        let ownerId = 'wa-bot';
        const groupMeta = await (0, knex_1.default)('group_credits').where({ group_jid: jid }).first();
        if (jid.endsWith('@g.us')) {
            if (!groupMeta || !groupMeta.owner_id) {
                await sendWAMessage(jid, '⚠️ Dokumen tidak bisa dipelajari karena grup ini belum memiliki Penanggung Jawab AI. Silakan tentukan dulu siapa penanggung jawabnya.');
                return;
            }
            ownerId = groupMeta.owner_id;
        }
        else {
            // Private chat
            const phone = sender.split('@')[0].replace(/[^0-9]/g, '');
            const user = await (0, knex_1.default)('users').where('phone', 'like', `%${phone.slice(-9)}%`).first();
            if (!user) {
                await sendWAMessage(jid, '⚠️ Silakan daftar AgriHub dulu agar saya bisa menyimpan dokumen Anda ke Knowledge Base.');
                return;
            }
            ownerId = user.id;
        }
        await sendWAMessage(jid, `⏳ Sedang mempelajari dokumen: *${fileName}*...`);
        // 2. Download media
        const buffer = await (0, baileys_2.downloadMediaMessage)(msg, 'buffer', {});
        // 2.1 Check Duplicate (Hash + Size + Name)
        const fileHash = crypto_1.default.createHash('md5').update(buffer).digest('hex');
        const fileSize = buffer.length;
        const isDuplicate = await (0, ragService_1.isDuplicateDocument)(ownerId, fileName, fileHash, fileSize);
        if (isDuplicate) {
            console.log(`♻️ Duplicate document detected: ${fileName} (${fileHash})`);
            await sendWAMessage(jid, `ℹ️ Dokumen *${fileName}* sudah ada di Knowledge Base saya dan tidak perlu dipelajari lagi. Silakan langsung ajukan pertanyaan! 😊`);
            return;
        }
        // 3. Simpan ke temp file agar bisa di-parse
        const tempDir = os_1.default.tmpdir();
        const tempPath = path_1.default.join(tempDir, `wa_${(0, uuid_1.v4)()}_${fileName}`);
        fs_1.default.writeFileSync(tempPath, buffer);
        try {
            // 4. Parse content
            const content = await (0, documentParser_1.parseFile)(tempPath);
            // 5. Store in RAG
            await (0, ragService_1.storeDocument)({
                userId: ownerId,
                title: fileName,
                sourceType: mimeType === 'application/pdf' ? 'pdf' : 'text',
                content: content,
                isGlobal: false,
                fileHash,
                fileSize
            });
            await sendWAMessage(jid, `✅ *Berhasil!* Saya sudah selesai mempelajari dokumen *${fileName}*.\n\nSekarang Anda bisa bertanya apapun tentang isinya, saya akan otomatis mencari jawabannya di sana! 💡🤖`);
        }
        finally {
            // Hapus temp file
            if (fs_1.default.existsSync(tempPath))
                fs_1.default.unlinkSync(tempPath);
        }
    }
    catch (err) {
        console.error('Document Upload Error:', err);
        await sendWAMessage(jid, `❌ Gagal memproses dokumen *${fileName}*: ` + err.message);
    }
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
/**
 * Mengirim pesan WhatsApp dengan proteksi koneksi (Wait & Retry)
 */
async function sendWAMessage(jid, text, options) {
    // ── Normalize JID: jika cuma nomor HP, ubah jadi JID resmi ──────────────────
    let targetJid = jid;
    if (targetJid && !targetJid.includes('@')) {
        let clean = targetJid.replace(/[^0-9]/g, '');
        if (clean.startsWith('0'))
            clean = '62' + clean.slice(1);
        else if (clean.startsWith('8'))
            clean = '62' + clean;
        targetJid = `${clean}@s.whatsapp.net`;
    }
    // Jika sedang connecting, tunggu sebentar (max 15 detik)
    if (!isConnected && isConnecting) {
        let waitCount = 0;
        while (!isConnected && isConnecting && waitCount < 30) {
            await new Promise(r => setTimeout(r, 500));
            waitCount++;
        }
    }
    if (!waSocket || !isConnected) {
        // Memperpanjang batas waktu reconnect dari 15s menjadi 35 detik karena proses reconnect baileys kadang butuh 25dtik
        let waitCount = 0;
        while (!isConnected && isConnecting && waitCount < 70) {
            await new Promise(r => setTimeout(r, 500));
            waitCount++;
        }
    }
    if (!waSocket || !isConnected) {
        if (isYielding) {
            console.log(`📝 [WA] Queueing message to ${targetJid} (Current process is yielding).`);
            try {
                await (0, knex_1.default)('whatsapp_outbox').insert({
                    id: (0, uuid_1.v4)(),
                    jid: targetJid,
                    text: text,
                    options: options ? JSON.stringify(options) : null,
                    status: 'pending',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                });
                return { status: 'queued' };
            }
            catch (e) {
                console.error('❌ [WA] Failed to queue message:', e);
            }
        }
        console.error(`❌ [WA] Failed to send message to ${targetJid}: Bot NOT CONNECTED after wait.`);
        return undefined;
    }
    try {
        return await waSocket.sendMessage(targetJid, { text, ...options });
    }
    catch (err) {
        // If it fails with "Connection Closed", maybe it just dropped. Try once more if isConnected is still true or becomes true.
        const errMsg = err.message;
        if (errMsg.includes('Closed') || errMsg.includes('reset')) {
            console.warn(`⚠️ [WA] Send failed (${errMsg}), retrying once in 2s...`);
            await new Promise(r => setTimeout(r, 2000));
            if (waSocket && isConnected) {
                try {
                    return await waSocket.sendMessage(targetJid, { text, ...options });
                }
                catch { }
            }
        }
        console.error(`❌ [WA] Failed to send message to ${targetJid}:`, err);
        return undefined;
    }
}
// ─── Outbox Poller (For Master) ──────────────────────────────────────────
async function processOutbox() {
    if (!isConnected || !waSocket || isYielding)
        return;
    try {
        const pending = await (0, knex_1.default)('whatsapp_outbox')
            .where({ status: 'pending' })
            .orderBy('created_at', 'asc')
            .limit(5);
        if (pending.length === 0)
            return;
        console.log(`📬 [WA] Processing ${pending.length} messages from outbox...`);
        for (const msg of pending) {
            try {
                const options = msg.options ? JSON.parse(msg.options) : {};
                await waSocket.sendMessage(msg.jid, { text: msg.text, ...options });
                await (0, knex_1.default)('whatsapp_outbox').where({ id: msg.id }).update({
                    status: 'sent',
                    updated_at: new Date().toISOString()
                });
            }
            catch (err) {
                console.error(`❌ [WA] Outbox send failed for ${msg.id}:`, err);
                await (0, knex_1.default)('whatsapp_outbox').where({ id: msg.id }).update({
                    status: 'failed',
                    error: err.message,
                    updated_at: new Date().toISOString()
                });
            }
        }
    }
    catch (err) {
        console.error('❌ [WA] Outbox poller error:', err);
    }
}
function startOutboxPoller() {
    if (outboxInterval)
        clearInterval(outboxInterval);
    outboxInterval = setInterval(processOutbox, 5000);
    console.log('✅ [WA] Outbox poller started.');
}
function stopOutboxPoller() {
    if (outboxInterval) {
        clearInterval(outboxInterval);
        outboxInterval = null;
        console.log('🛑 [WA] Outbox poller stopped.');
    }
}
// ─── Message Handler Logic ──────────────────────────────────────────────
async function handleMessage(msg) {
    if (!msg.key)
        return;
    const jid = msg.key.remoteJid;
    const isGroup = jid.endsWith('@g.us');
    const sender = msg.key.participant || msg.key.remoteJid || '';
    console.log(`📩 [WA] Msg from ${sender} in ${jid}`);
    let text = (msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        '').trim();
    const isImageMessage = !!(msg.message?.imageMessage || msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage);
    const isDocumentMessage = !!(msg.message?.documentMessage || msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.documentMessage);
    const isMediaMessage = isImageMessage || isDocumentMessage;
    if (!text && !isMediaMessage) {
        // Log even if no text (maybe just a media without caption that wasn't caught by the handler)
        console.log(`[WA] Empty text or unhandled media from ${sender}`);
        return;
    }
    if (!text) {
        if (isImageMessage)
            text = "Tolong perhatikan gambar ini dan berikan analisis terkait pertanian.";
        else if (isDocumentMessage)
            text = "Tolong perhatikan dokumen ini dan berikan rangkuman isinya.";
    }
    const upper = text.toUpperCase();
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
        cleanText !== text;
    if (isGroup) {
        // Log sudah di atas, ini untuk detail tambahan
        if (isMentioned)
            console.log(`👉 Mentioned! Text: "${text}" | Clean: "${cleanText}"`);
    }
    // ── RESOLUSI IDENTITY (Link Phone & LID) ───────────────────────────────
    const isLid = sender.endsWith('@lid');
    const isGroupJid = jid.endsWith('@g.us');
    const participantJid = msg.key.participant || '';
    // Coba cari pakai whatsapp_lid yang terikat saat ini
    let user = await (0, knex_1.default)('users').where({ whatsapp_lid: sender }).first();
    // Jika tidak ketemu via LID, coba cari paksa pakai nomor HP
    if (!user) {
        // Pada Private Chat, seringkali remoteJid masih menyimpan nomor HP asli meski participant memakai @lid
        const phoneSource = (isLid && !isGroupJid) ? jid : sender;
        const phoneStr = phoneSource.split('@')[0].replace(/[^0-9]/g, '');
        if (phoneStr.length > 6) {
            user = await (0, knex_1.default)('users').where('phone', 'like', `%${phoneStr.slice(-9)}%`).first();
            // Jika ketemu user di DB via pencocokan string nomor HP, otomatis TAUTKAN!
            if (user && isLid && user.whatsapp_lid !== sender) {
                await (0, knex_1.default)('users').where({ id: user.id }).update({ whatsapp_lid: sender });
                console.log(`🔗 Auto-Linked LID ${sender} to user ${user.phone}`);
            }
            const participantLid = participantJid.endsWith('@lid') ? participantJid : null;
            if (user && participantLid && user.whatsapp_lid !== participantLid) {
                await (0, knex_1.default)('users').where({ id: user.id }).update({ whatsapp_lid: participantLid });
                console.log(`🔗 Linked Participant LID ${participantLid} to user ${user.phone}`);
            }
        }
    }
    // Fallback 100% terakhir: coba dari participantJid jika belum match
    if (!user && participantJid && participantJid !== sender) {
        user = await (0, knex_1.default)('users').where({ whatsapp_lid: participantJid }).first();
    }
    try {
        // ── Command Parser (Panggil dengan cleanUpper agar @Bot MENU tetap terbaca MENU) ──
        const isCommand = ['VERIFIKASI ', 'DAFTAR TOKO', 'JUAL ', 'ONGKIR ', 'STOK', 'PESANAN', 'MENU', 'HELP', 'LINK ', 'LAPOR STOK', 'CARI STOK', 'LIHAT MATCH', 'CEK TOKEN', 'CEK SALDO', 'KREDIT', 'BELI ', 'PILIH KURIR ', 'KIRIM ', 'TERIMA ', 'BATAL '].some(c => cleanUpper.startsWith(c));
        if (isCommand) {
            if (cleanUpper.startsWith('VERIFIKASI ')) {
                const token = cleanUpper.slice(11).trim().toUpperCase();
                if (token.length !== 6) {
                    await sendWAMessage(jid, '❌ Format salah. Contoh: *VERIFIKASI ABCDEF*');
                    return;
                }
                const linkUser = await (0, knex_1.default)('users')
                    .where({ whatsapp_link_token: token })
                    .where('whatsapp_link_expires', '>', new Date().toISOString())
                    .first();
                if (!linkUser) {
                    await sendWAMessage(jid, '❌ Token verifikasi tidak valid atau sudah kadaluarsa. Silakan minta token baru di dashboard AgriHub.');
                    return;
                }
                // Update user: Link WhatsApp ID, Mark Phone Verified, Clear Token
                await (0, knex_1.default)('users').where({ id: linkUser.id }).update({
                    whatsapp_lid: sender,
                    phone_verified: true,
                    whatsapp_link_token: null,
                    whatsapp_link_expires: null,
                    updated_at: new Date().toISOString()
                });
                await sendWAMessage(jid, `✅ *Berhasil!* WhatsApp Anda telah ditautkan ke akun AgriHub atas nama *${linkUser.name}*.\n\nSekarang Anda bisa menerima notifikasi transaksi dan menggunakan fitur AI secara personal! 🌾🤖`);
                return;
            }
            if (cleanUpper.startsWith('LINK')) {
                const inputPhone = cleanText.replace(/LINK/gi, '').trim().replace(/[^0-9]/g, '');
                if (inputPhone.length < 9) {
                    await sendWAMessage(jid, '📝 *Format:* LINK [Nomor HP Anda]\nContoh: LINK 085188000139');
                    return;
                }
                try {
                    const targetUser = await (0, knex_1.default)('users').where('phone', 'like', `%${inputPhone.slice(-9)}%`).first();
                    if (!targetUser) {
                        await sendWAMessage(jid, `❌ Nomor *${inputPhone}* tidak ditemukan di database AgriHub. Pastikan Anda sudah mendaftar di web.`);
                        return;
                    }
                    // Tautkan LID saat ini ke user tersebut
                    await (0, knex_1.default)('users').where({ id: targetUser.id }).update({ whatsapp_lid: sender, phone_verified: true });
                    await sendWAMessage(jid, `✅ *Berhasil!* Akun AgriHub (${targetUser.name}) kini tertaut dengan ID WhatsApp ini.\n\nSekarang Anda bisa menggunakan Asisten AI dan mengelola grup!`);
                }
                catch (err) {
                    console.error('LINK Error:', err);
                    await sendWAMessage(jid, `❌ Gagal menautkan akun: Terjadi kesalahan internal.`);
                }
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
                const user = await (0, knex_1.default)('users').where({ whatsapp_lid: sender }).first() || await (0, knex_1.default)('users').where('phone', 'like', `%${sender.split('@')[0].slice(-9)}%`).first();
                if (!user) {
                    await sendWAMessage(jid, '❌ Akun tidak ditemukan.');
                    return;
                }
                const buying = await (0, knex_1.default)('orders')
                    .join('products', 'orders.product_id', 'products.id')
                    .where('orders.buyer_id', user.id)
                    .select('orders.id', 'products.name as komoditas', 'orders.status', 'orders.total_amount')
                    .orderBy('orders.created_at', 'desc').limit(5);
                const selling = await (0, knex_1.default)('orders')
                    .join('products', 'orders.product_id', 'products.id')
                    .where('orders.seller_id', user.id)
                    .select('orders.id', 'products.name as komoditas', 'orders.status', 'orders.total_amount')
                    .orderBy('orders.created_at', 'desc').limit(5);
                let msg = `📦 *Status Pesanan AgriHub*\n\n`;
                msg += `🛒 *Beli (Keluar):*\n`;
                if (buying.length === 0)
                    msg += `  (Belum ada)\n`;
                buying.forEach(o => {
                    msg += `• #${o.id.slice(-6)} | ${o.komoditas} | *${o.status.toUpperCase()}*\n`;
                });
                msg += `\n💰 *Jual (Masuk):*\n`;
                if (selling.length === 0)
                    msg += `  (Belum ada)\n`;
                selling.forEach(o => {
                    msg += `• #${o.id.slice(-6)} | ${o.komoditas} | *${o.status.toUpperCase()}*\n`;
                });
                msg += `\n_Ketik TERIMA [ID] jika barang sudah sampai!_`;
                await sendWAMessage(jid, msg);
                return;
            }
            if (cleanUpper.startsWith('BELI ')) {
                const matchId = cleanText.slice(5).trim();
                await checkoutService.processBeliCommand(jid, sender, matchId);
                return;
            }
            if (cleanUpper.startsWith('PILIH KURIR ')) {
                const selection = parseInt(cleanText.slice(12).trim(), 10);
                if (isNaN(selection)) {
                    await sendWAMessage(jid, '❌ Format salah. Contoh: PILIH KURIR 1');
                    return;
                }
                await checkoutService.processPilihKurirCommand(jid, sender, selection);
                return;
            }
            if (cleanUpper.startsWith('LAPOR STOK')) {
                await sendWAMessage(jid, 'ℹ️ Sistem Supply kini sudah terpusat. Untuk melaporkan stok, silakan tambahkan produk ke toko Anda melalui menu Dasbor Web atau ketik *JUAL [nama barang] [harga] [stok]* di sini. Sistem akan otomatis mencarikan pembeli yang potensial!');
                return;
            }
            if (cleanUpper.startsWith('CARI STOK')) {
                await sendWAMessage(jid, 'ℹ️ Fitur permintaan barang kini ditingkatkan menjadi **Wishlist** pintar yang terhubung langsung dengan Alamat Pengiriman Anda secara otomatis.\n\nSilakan kunjungi *Menu Wishlist* di Dashboard Web AgriHub (https://agrihub.rumah-genbi.com) untuk menambahkan produk yang Anda butuhkan. Kami akan otomatis memberi tahu Anda di WA ketika ada stok yang cocok dan murah! 🥳');
                return;
            }
            if (cleanUpper.startsWith('KIRIM ')) {
                const parts = cleanText.slice(6).trim().split('|').map(s => s.trim());
                if (parts.length < 3) {
                    await sendWAMessage(jid, '📝 Format: KIRIM [OrderID] | [Kurir] | [Resi]');
                    return;
                }
                const [orderId, courier, resi] = parts;
                try {
                    const fullOrder = await (0, knex_1.default)('orders').where('id', 'like', `%${orderId}`).first();
                    if (!fullOrder)
                        throw new Error('Order tidak ditemukan');
                    await transactionService.updateShippingStatus(fullOrder.id, courier, resi);
                    await sendWAMessage(jid, `✅ *Status Update:* Pesanan #${orderId} telah dikirim via ${courier} with resi *${resi}*.\n\nPembeli telah kami beritahu!`);
                    // Notif Buyer via WhatsApp
                    const buyer = await (0, knex_1.default)('users').where({ id: fullOrder.buyer_id }).first();
                    if (fullOrder.group_jid) {
                        await sendWAMessage(fullOrder.group_jid, `🚚 *PESANAN DIKIRIM*\n\nPesanan #${orderId} dalam perjalanan via ${courier}.\nResi: *${resi}*`);
                    }
                    else if (buyer?.phone) {
                        await sendWAMessage(`${buyer.phone}@s.whatsapp.net`, `🚚 *PESANAN DIKIRIM*\n\nPesanan #${orderId} telah dikirim oleh Penjual via ${courier}.\nResi: *${resi}*`);
                    }
                }
                catch (err) {
                    await sendWAMessage(jid, `❌ Error: ${err.message}`);
                }
                return;
            }
            if (cleanUpper.startsWith('TERIMA ')) {
                const orderShortId = cleanText.slice(7).trim();
                try {
                    const fullOrder = await (0, knex_1.default)('orders').where('id', 'like', `%${orderShortId}`).first();
                    if (!fullOrder)
                        throw new Error('Order tidak ditemukan');
                    if (fullOrder.status === 'completed' || fullOrder.status === 'selesai') {
                        await sendWAMessage(jid, '✅ Pesanan ini sudah selesai sebelumnya!');
                        return;
                    }
                    await transactionService.confirmOrderReceipt(fullOrder.id);
                    await sendWAMessage(jid, `✅ *Selesai!* Terima kasih telah mengkonfirmasi penerimaan pesanan #${orderShortId}. Dana telah kami teruskan ke dompet Penjual.`);
                }
                catch (err) {
                    await sendWAMessage(jid, `❌ Error: ${err.message}`);
                }
                return;
            }
            if (cleanUpper === 'CEK TOKEN' || cleanUpper === 'CEK SALDO' || cleanUpper === 'KREDIT') {
                if (isGroup) {
                    const credits = await (0, aiService_1.checkGroupCredit)(jid);
                    if (!credits.allowed && credits.reason) {
                        await sendWAMessage(jid, `⚠️ *Status AI Grup:*\n${credits.reason}`);
                    }
                    else {
                        await sendWAMessage(jid, `🪙 *Saldo AI Grup:*\n\nSisa Kredit: *${Number(credits.balance).toFixed(2)} tokens*\nStatus: Aktif ✅\n\n_Kredit berkurang 0.05 setiap satu pertanyaan AI._`);
                    }
                }
                else {
                    const phone = sender.split('@')[0].replace(/[^0-9]/g, '');
                    const user = await (0, knex_1.default)('users')
                        .where({ whatsapp_lid: sender })
                        .orWhere('phone', 'like', `%${phone.slice(-9)}%`)
                        .first();
                    if (user?.puter_token) {
                        const balance = await (0, aiService_1.checkPuterBalance)(user.puter_token);
                        await sendWAMessage(jid, `👤 *Status AI Anda:*\n\nAkun Puter: *Tertaut* ✅\nMode: Personal (PC)\n${balance !== null ? `Sisa Kredit: *${Number(balance).toFixed(2)} units*` : 'Kredit: Terhubung'}\n\nAnda menggunakan kuota token dari akun Puter pribadi Anda yang telah dihubungkan di dashboard.`);
                    }
                    else {
                        await sendWAMessage(jid, `👤 *Status AI Anda:*\n\nAkun Puter: *Belum Tertaut* ❌\n\nSilakan login ke AgriHub Web dan hubungkan akun Puter Anda di menu *Pengaturan Chat* agar bisa menggunakan AI di Private Chat.`);
                    }
                }
                return;
            }
            if (cleanUpper === 'MENU' || cleanUpper === 'HELP') {
                const menu = `🌾 *Menu Utama AgriHub* 🌾

*Matchmaking & Grosir:*
• LAPOR STOK | komoditas | jml | harga | kab
• CARI STOK | komoditas | jml | harga | kab
• LIHAT MATCH (Cek hasil matching)

*Transaksi & Logistik:*
• ONGKIR [Asal] | [Tujuan] | [Berat]
• BELI [MatchID] (Lanjut ke pembelian)
• PESANAN (Status beli & jual)
• KIRIM [OrderID] | [Kurir] | [Resi]
• TERIMA [OrderID] (Konfirmasi sampai)

*E-Commerce (Retail):*
• DAFTAR TOKO | nama | kab | prov | produk
• JUAL [nama] [harga] [stok]
• STOK (Cek listing toko)

*Lainnya:*
• CEK TOKEN (Status AI & Kredit)
• LINK [NomorHP] (Tautkan akun)

Atau langsung tanya soal pertanian ke AI! 🚜🌿`;
                await sendWAMessage(jid, menu);
                return;
            }
        }
        // ── AI Hub Interaction ──
        const upper = cleanUpper || '';
        // Group Assignment Logic (If bot is in group but not mentioned)
        if (isGroup && !isMentioned) {
            // Cek apakah user membalas tawaran jadi penanggung jawab (IYA/YA)
            const pending = pendingAssignments.get(jid + sender);
            if (pending && (upper === 'YA' || upper === 'IYA')) {
                if (pending.expires < Date.now()) {
                    pendingAssignments.delete(jid + sender);
                    return;
                }
                // Gunakan UPSERT: Update jika ada, Insert jika belum ada
                const existingGroup = await (0, knex_1.default)('group_credits').where({ group_jid: jid }).first();
                if (existingGroup) {
                    await (0, knex_1.default)('group_credits').where({ id: existingGroup.id }).update({
                        owner_id: pending.userId,
                        updated_at: new Date().toISOString()
                    });
                }
                else {
                    await (0, knex_1.default)('group_credits').insert({
                        id: (0, uuid_1.v4)(),
                        group_jid: jid,
                        owner_id: pending.userId,
                        credits_balance: 5.0, // Bonus awal
                        is_ai_enabled: true,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    });
                }
                pendingAssignments.delete(jid + sender);
                const freshUser = await (0, knex_1.default)('users').where({ id: pending.userId }).first();
                let msgText = `✅ *Berhasil!* Anda sekarang adalah penanggung jawab resmi untuk AI di grup ini.`;
                const isAdmin = freshUser?.role === 'admin';
                if (freshUser && !freshUser.puter_token && !isAdmin) {
                    msgText += `\n\n🔌 *Satu langkah lagi:* Akun Anda belum terhubung ke Puter.com. Silakan klik link sakti ini untuk langsung menghubungkan:\n👉 https://agrihub.rumah-genbi.com/app?action=connect-puter`;
                }
                await sendWAMessage(jid, msgText);
                return;
            }
            return;
        }
        // AI Logic for Private Chat or Mentioned Group
        let targetUserId = 'wa-bot';
        if (isGroup) {
            const groupMeta = await (0, knex_1.default)('group_credits').where({ group_jid: jid }).first();
            if (!groupMeta || !groupMeta.owner_id) {
                if (!groupMeta) {
                    await (0, knex_1.default)('group_credits').insert({
                        id: (0, uuid_1.v4)(),
                        group_jid: jid,
                        owner_id: null,
                        credits_balance: 5.0,
                        is_ai_enabled: true,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    });
                }
                if (isMentioned) {
                    if (!user) {
                        const isRealPhone = sender.endsWith('@s.whatsapp.net');
                        const decodedPhone = isRealPhone ? sender.split('@')[0].replace(/[^0-9]/g, '') : '';
                        const phoneParam = decodedPhone ? `&phone=${decodedPhone}` : '';
                        await sendWAMessage(jid, `⚠️ Grup ini belum memiliki penanggung jawab AI.\n\nSepertinya Anda belum terdaftar. Silakan daftar dulu melalui link ini agar bisa mengelola grup:\n👉 https://agrihub.rumah-genbi.com/login?mode=register${phoneParam}&action=link&lid=${sender}`);
                    }
                    else {
                        pendingAssignments.set(jid + sender, { userId: user.id, expires: Date.now() + 300000 });
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
            const credit = await (0, aiService_1.checkGroupCredit)(jid);
            if (!credit.allowed) {
                if (isMentioned)
                    await sendWAMessage(jid, `⚠️ Kredit AI Grup Habis.`);
                return;
            }
            await (0, aiService_1.deductGroupCredit)(jid, 0.05);
            targetUserId = owner.id;
        }
        else {
            // ── Private Chat: Smart Identity Resolution ─────────────────────────
            // Nomor bot dari waSocket untuk redirect link kembali ke WA setelah setup
            const botPhone = waSocket?.user?.id?.split(':')[0] || '';
            // _botWaUrl reserved for use in frontend magic link after setup: https://wa.me/{botPhone}
            // Nomor HP dari JID/LID (lebih prioritas dari jid daripada sender pada private chat)
            const isPotentialPhone = (s) => {
                const digits = s.replace(/[^0-9]/g, '');
                return digits.length >= 7 && digits.length <= 13;
            };
            const rawDetected = (() => {
                const src = (sender.endsWith('@lid') && !jid.endsWith('@g.us')) ? jid : sender;
                return src.split('@')[0].replace(/[^0-9]/g, '');
            })();
            const detectedPhone = isPotentialPhone(rawDetected) ? rawDetected : null;
            console.log(`🔍 [WA Private] sender=${sender} | jid=${jid} | raw=${rawDetected} | detected=${detectedPhone} | uid=${user?.id || 'null'}`);
            // Helper: buat magic session & kembalikan URL — langsung via DB (tidak via HTTP)
            const createMagicLink = async (purpose, userId) => {
                try {
                    const sessionId = (0, uuid_1.v4)();
                    const botPhone = waSocket?.user?.id?.split(':')[0] || '';
                    await (0, knex_1.default)('wa_magic_sessions').insert({
                        id: sessionId,
                        phone: detectedPhone || null,
                        lid: sender,
                        jid,
                        user_id: userId || null,
                        purpose,
                        status: 'pending',
                        created_at: new Date().toISOString(),
                    });
                    const phoneParam = (detectedPhone && isPotentialPhone(detectedPhone)) ? `&phone=${detectedPhone}` : '';
                    return `https://agrihub.rumah-genbi.com/wa-setup?session=${sessionId}&bot=${botPhone}${phoneParam}`;
                }
                catch (e) {
                    console.error('[WA] Gagal buat magic session via DB:', e);
                    return null;
                }
            };
            if (!user) {
                // Cari via nomor HP untuk detect broken LID
                let foundByPhone = null;
                if (detectedPhone && detectedPhone.length > 5) {
                    foundByPhone = await (0, knex_1.default)('users').where('phone', 'like', `%${detectedPhone.slice(-9)}%`).first();
                }
                if (foundByPhone) {
                    // ── Skenario D: User ada, LID rotated/broken ──
                    const magicUrl = await createMagicLink('relink', foundByPhone.id);
                    await sendWAMessage(jid, `👋 *Halo ${foundByPhone.name}!*\n\n` +
                        `Akun AgriHub Anda sudah terdaftar ✅, namun identitas WhatsApp yang terdeteksi berbeda dari data lama kami.\n\n` +
                        `🔄 Klik tautan berikut untuk *memperbarui & menghubungkan ulang* secara otomatis:\n` +
                        `👉 ${magicUrl}\n\n` +
                        `_Tautan berlaku sampai proses selesai._`);
                }
                else if (detectedPhone) {
                    // ── Skenario C: Sama sekali belum terdaftar (tapi punya nomor HP) ──
                    const magicUrl = await createMagicLink('full-setup');
                    await sendWAMessage(jid, `👋 *Halo! Selamat datang di AgriHub!* 🌾\n\n` +
                        `Anda belum memiliki akun. Klik tautan berikut untuk *daftar & langsung aktif* dalam hitungan detik:\n\n` +
                        `👉 ${magicUrl}\n\n` +
                        `✨ Cukup hubungkan akun *Puter.com* — sistem akan otomatis membuat akun AgriHub dan menautkan WhatsApp ini!\n\n` +
                        `_Tautan berlaku sampai proses selesai._`);
                }
                else {
                    // ── Fallback: LID murni tanpa nomor HP ──
                    await sendWAMessage(jid, `👋 *Halo!* Sepertinya Anda belum terdaftar di AgriHub.\n\n` +
                        `Tautkan akun dengan membalas:\n*LINK [Nomor HP Anda]*\nContoh: *LINK 085123456789*\n\n` +
                        `Belum daftar?\n👉 https://agrihub.rumah-genbi.com/login?mode=register&action=link&lid=${encodeURIComponent(sender)}`);
                }
                return;
            }
            // User ditemukan — auto-update LID jika berubah (silent)
            if (user.whatsapp_lid !== sender && sender.endsWith('@lid')) {
                await (0, knex_1.default)('users').where({ id: user.id }).update({ whatsapp_lid: sender, updated_at: new Date().toISOString() });
                console.log(`🔗 [WA] Auto-updated LID for ${user.id}: ${user.whatsapp_lid} → ${sender}`);
                user.whatsapp_lid = sender;
            }
            // ── Skenario B: User ada tapi belum hubungkan Puter ──
            if (!user.puter_token) {
                const magicUrl = await createMagicLink('connect-puter', user.id);
                await sendWAMessage(jid, `🔌 *Halo ${user.name}!* Akun AgriHub Anda sudah terhubung ✅\n\n` +
                    `Untuk menggunakan fitur *AI AsistenTani*, hubungkan akun *Puter.com* Anda:\n\n` +
                    `👉 ${magicUrl}\n\n` +
                    `_Tautan berlaku sampai proses selesai. Setelah terhubung, langsung chat di sini! 🌱_`);
                return;
            }
            // ── Skenario A: Semua siap, lanjut ke AI ──
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
        if (isMentioned || !isGroup) {
            // Kirim pesan inisial
            let initialMsg = null;
            try {
                // Menampilkan status "sedang mengetik..." di WhatsApp
                await waSocket?.sendPresenceUpdate('composing', jid);
                initialMsg = await sendWAMessage(jid, '⏳ _AsistenTani sedang memproses pertanyaan Anda..._');
            }
            catch (e) { }
            let currentBuffer = '';
            let phaseText = 'Memproses...';
            let waitTime = 0;
            // Timer Polling Anti-Hang & Presence Maintainer
            const pollingTimer = setInterval(async () => {
                if (!isConnected)
                    return; // Jangan kirim update jika diskonek
                if (currentBuffer.length > 0) {
                    // Jika token AI sudah mulai masuk, kita teruskan presence typing
                    await waSocket?.sendPresenceUpdate('composing', jid).catch(() => { });
                    return;
                }
                waitTime += 5;
                // Edit pesan awal HANYA saat fase berat (seperti cari BPS) agar user tahu bot tidak mati
                if (initialMsg?.key && waitTime % 10 === 0) {
                    try {
                        await waSocket?.sendMessage(jid, { text: `⏳ _${phaseText} (${waitTime}s)_`, edit: initialMsg.key });
                    }
                    catch (e) { }
                }
            }, 5000);
            const targetDocumentMsg = msg.message?.documentMessage ? msg : (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.documentMessage ? { key: msg.key, message: msg.message?.extendedTextMessage?.contextInfo?.quotedMessage } : null);
            const targetImageMsg = msg.message?.imageMessage ? msg : (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage ? { key: msg.key, message: msg.message?.extendedTextMessage?.contextInfo?.quotedMessage } : null);
            const targetMsg = targetImageMsg || targetDocumentMsg;
            let imageUrl = undefined;
            if (targetMsg && waSocket) {
                try {
                    // Extract media message node
                    const mediaNode = targetMsg.message?.imageMessage || targetMsg.message?.documentMessage || targetMsg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage || targetMsg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.documentMessage;
                    const buffer = await (0, baileys_2.downloadMediaMessage)(targetMsg, 'buffer', {}, {
                        logger: (0, pino_1.default)({ level: 'silent' }),
                        reuploadRequest: waSocket.updateMediaMessage
                    });
                    if (Buffer.isBuffer(buffer)) {
                        const mimetype = mediaNode?.mimetype || 'application/octet-stream';
                        if (targetImageMsg) {
                            const base64 = buffer.toString('base64');
                            imageUrl = `data:${mimetype};base64,${base64}`;
                        }
                        // [AUTO-INGESTION PIPELINE WA TO PUTER FS & LOCAL RAG]
                        // Berjalan di latar belakang tanpa me-mute response chat saat ini
                        if (user?.id) {
                            const fileName = mediaNode?.fileName || `WA_Media_${Date.now()}.${mimetype.split('/')[1] || 'bin'}`;
                            const fileSize = buffer.length;
                            // Priority: File's native SHA256 from WA, else compute it locally
                            const fileHash = mediaNode?.fileSha256
                                ? Buffer.from(mediaNode.fileSha256).toString('hex')
                                : crypto_1.default.createHash('sha256').update(buffer).digest('hex');
                            (async () => {
                                try {
                                    if (await (0, ragService_1.isDuplicateDocument)(user.id, fileName, fileHash, fileSize))
                                        return;
                                    let docContent = '';
                                    // A) Parser untuk Teks/Dokumen
                                    if (targetDocumentMsg) {
                                        const tmpPath = path_1.default.join(os_1.default.tmpdir(), fileName);
                                        fs_1.default.writeFileSync(tmpPath, buffer);
                                        docContent = await (0, documentParser_1.parseFile)(tmpPath);
                                        fs_1.default.unlinkSync(tmpPath);
                                    }
                                    // B) Parser untuk Gambar (Menggunakan Meta Llama Vision)
                                    else if (targetImageMsg && imageUrl && user.puter_token) {
                                        try {
                                            const { callPuterAI } = await Promise.resolve().then(() => __importStar(require('./aiService')));
                                            const visionResp = await callPuterAI({
                                                messages: [{ role: 'user', content: [{ type: 'text', text: 'Jelaskan sedetail mungkin apa isi gambar ini untuk dokumentasi.' }, { type: 'image_url', image_url: { url: imageUrl } }] }],
                                                model: 'meta-llama/Llama-3.2-11B-Vision-Instruct:free',
                                                apiKey: user.puter_token
                                            });
                                            docContent = `[GAMBAR: ${fileName}]\n${visionResp.reply}`;
                                        }
                                        catch (visionErr) {
                                            console.error('Vision Parsing Error for Ingestion:', visionErr);
                                        }
                                    }
                                    // Menyimpan Biner ke Puter FS Cloud (Sebagai Backup Fisik User)
                                    if (user.puter_token) {
                                        try {
                                            puter_js_1.default.setAuthToken(user.puter_token);
                                            await puter_js_1.default.fs.mkdir('/AgriHub_Docs').catch(() => { });
                                            await puter_js_1.default.fs.mkdir(`/AgriHub_Docs/${user.id}`).catch(() => { });
                                            await puter_js_1.default.fs.write(`/AgriHub_Docs/${user.id}/${fileName}`, buffer);
                                        }
                                        catch (fsErr) {
                                            console.error('Puter FS Uptime Warning:', fsErr);
                                        }
                                    }
                                    // Menyematkan Teks/Vektor ke RAG Sqlite
                                    if (docContent.trim().length >= 10) {
                                        await (0, ragService_1.storeDocument)({
                                            userId: user.id,
                                            title: fileName,
                                            sourceType: targetImageMsg ? 'text' : (fileName.endsWith('.pdf') ? 'pdf' : 'text'),
                                            content: docContent,
                                            fileHash,
                                            fileSize,
                                            originalFilename: fileName
                                        });
                                        console.log(`✅ [RAG] Auto-Ingested WA Media: ${fileName}`);
                                    }
                                }
                                catch (err) {
                                    console.error('RAG Auto-Ingestion Error:', err);
                                }
                            })();
                        }
                    }
                }
                catch (e) {
                    console.error('Failed to download WA media:', e);
                }
            }
            const aiReply = await (0, aiService_1.chatWithAI)({
                message: cleanText || text || 'Halo!',
                history: [],
                userId: targetUserId,
                whatsappJid: jid,
                useRag: true,
                imageUrl,
                onPhaseChange: async (phase) => {
                    phaseText = phase;
                    // Langsung update status fase ke pesan inisial jika koneksi aman
                    if (isConnected && currentBuffer.length === 0 && initialMsg?.key && waSocket) {
                        try {
                            await waSocket.sendMessage(jid, { text: `⏳ _${phaseText}..._`, edit: initialMsg.key });
                        }
                        catch (e) { }
                    }
                },
                onChunk: (chunk) => {
                    // Kita matikan edit streaming WhatsApp per kata karena sangat lambat dan membebani server
                    // Sebagai gantinya, token ditampung di memori, sementara status WA "Sedang Mengetik" aktif terus
                    currentBuffer += chunk;
                }
            });
            if (pollingTimer)
                clearInterval(pollingTimer);
            try {
                await waSocket?.sendPresenceUpdate('paused', jid);
            }
            catch (e) { } // Hentikan typing
            // Process Agentic Tools
            const finalReply = await processAgenticTools(jid, sender, aiReply.reply);
            // Finalisasi Pesan: Prioritas Utama adalah MENGEDIT pesan agar tidak menumpuk.
            // sendWAMessage punya fitur buffer up to ~35 detik jika inet putus.
            let sentMessage = undefined;
            if (initialMsg?.key) {
                try {
                    sentMessage = await sendWAMessage(jid, `🌱 ${finalReply}`, { edit: initialMsg.key });
                }
                catch (e) { }
            }
            // Jika edit tetap gagal (mungkin karena pesan sudah terlalu lama atau server WA menolak), 
            // fallback ke hapus dan kirim baru (hanya jika WA socket terhubung agar tidak error delete).
            if (!sentMessage) {
                try {
                    if (initialMsg?.key && waSocket && isConnected) {
                        await waSocket.sendMessage(jid, { delete: initialMsg.key }).catch(() => { });
                    }
                }
                catch (e) { }
                sentMessage = await sendWAMessage(jid, `🌱 ${finalReply}`);
            }
            // Jika masih gagal (miss > 15s network outage), bot akan pass error.
            if (sentMessage) {
                // 2. Simpan balasan AI ke DB HANYA JIKA TERKIRIM
                await (0, knex_1.default)('chats').insert({
                    id: (0, uuid_1.v4)(),
                    user_id: user ? user.id : 'wa-bot',
                    whatsapp_jid: jid,
                    role: 'assistant',
                    content: finalReply,
                    created_at: new Date().toISOString()
                });
            }
            else {
                console.warn(`[WA BUFER DROP] Sistem mencoba buffer, namun WA terdiskonek terlalu lama. Pesan tidak terkirim ke ${jid}`);
            }
        }
    }
    catch (err) {
        console.error(`❌ [WA] Critical error in handleMessage:`, err);
        // Tambahkan buffer check di handler error juga
        await sendWAMessage(jid, `❌ Maaf, terjadi putus koneksi saat memproses pesan Anda, silakan coba lagi.`);
    }
}
// ── Agentic Tool Processor ───────────────────────────────────────────────
/**
 * Mendeteksi dan mengeksekusi tag [EXEC: COMMAND | PARAMS] dalam respon AI.
 * Mengembalikan pesan yang sudah dibersihkan dari tag teknis.
 */
async function processAgenticTools(jid, sender, aiReply) {
    const execRegex = /\[EXEC:\s*(\w+)\s*\|\s*([^\]]+)\]/g;
    const matches = [...aiReply.matchAll(execRegex)];
    if (matches.length === 0)
        return aiReply;
    let processedReply = aiReply;
    const user = await (0, knex_1.default)('users').where({ whatsapp_lid: sender }).first() || await (0, knex_1.default)('users').where('phone', 'like', `%${sender.split('@')[0].slice(-9)}%`).first();
    // Sandbox Auth Header
    let authHeaders = {};
    if (user) {
        const token = jsonwebtoken_1.default.sign({ id: user.id }, process.env.JWT_SECRET || 'secret', { expiresIn: '5m' });
        authHeaders = { Authorization: `Bearer ${token}` };
    }
    const apiUrl = `http://localhost:${process.env.PORT || 3000}/api`;
    for (const match of matches) {
        const [, command, paramsRaw] = match;
        const params = paramsRaw.split('|').map(p => p.trim());
        console.log(`🤖 [Agent] Executing tool: ${command} with params:`, params);
        try {
            switch (command.toUpperCase()) {
                case 'TAMBAH_PRODUK': {
                    if (!user)
                        throw new Error('Akun tidak tertaut. Pilih menu LINK dahulu.');
                    const [komoditas, kategori, jumlah, harga] = params;
                    // Check if user has store
                    const store = await (0, knex_1.default)('stores').where({ owner_id: user.id }).first();
                    if (!store) {
                        // Return Magic Link (Temporary JWT logic)
                        const setupToken = jsonwebtoken_1.default.sign({ id: user.id, intent: 'setup_store', komoditas }, process.env.JWT_SECRET || 'secret', { expiresIn: '1h' });
                        const magicLink = `https://agrihub.rumah-genbi.com/app/toko?setupToken=${setupToken}`;
                        processedReply = processedReply.replace(match[0], `\n\n⚠️ _Sistem:_ Anda belum memiliki profil Toko/Cabang. Silakan tekan link berikut untuk mengatur lokasi Anda di Peta:\n👉 ${magicLink}\n\nProduk ${komoditas} Anda akan otomatis diunggah setelah toko selesai dibuat.`);
                        break;
                    }
                    await (0, knex_1.default)('products').insert({
                        id: (0, uuid_1.v4)(),
                        store_id: store.id,
                        name: komoditas,
                        category: kategori || 'lainnya',
                        unit: 'kg',
                        price_per_unit: Number(harga.replace(/[^0-9]/g, '')),
                        stock_quantity: Number(jumlah.replace(/[^0-9]/g, '')),
                        min_order: 1,
                        is_active: true,
                    });
                    processedReply = processedReply.replace(match[0], `\n\n✅ _Sistem: Produk ${komoditas} berhasil dipajang di toko ${store.name}! Kini otomatis terindeks sebagai Suplai untuk dicari pembeli._`);
                    break;
                }
                case 'LIHAT_TOKO': {
                    if (!user)
                        throw new Error('Akun belum terdaftar.');
                    const stores = await (0, knex_1.default)('stores').where({ owner_id: user.id });
                    if (stores.length === 0) {
                        const setupToken = jsonwebtoken_1.default.sign({ id: user.id, intent: 'setup_store' }, process.env.JWT_SECRET || 'secret', { expiresIn: '1h' });
                        const magicLink = `https://agrihub.rumah-genbi.com/app/toko?setupToken=${setupToken}`;
                        processedReply = processedReply.replace(match[0], `\n\nℹ️ _Sistem: Anda belum mendaftarkan Toko atau Cabang._\n👉 _Silakan buat toko Anda terlebih dahulu dengan menekan link aman ini:_ ${magicLink}`);
                        break;
                    }
                    let replyText = `\n\n🏪 *Daftar Toko/Cabang Anda Terdaftar:*`;
                    for (const store of stores) {
                        replyText += `\n\n*${store.name}* (${store.kabupaten})`;
                        const products = await (0, knex_1.default)('products').where({ store_id: store.id });
                        if (products.length > 0) {
                            replyText += `\n📦 *Produk Dijual:*`;
                            products.forEach(p => {
                                replyText += `\n- *${p.name}* (Stok: ${p.stock_quantity}kg @ Rp${Number(p.price_per_unit).toLocaleString('id-ID')}/kg)`;
                            });
                        }
                        else {
                            replyText += `\n_(Belum ada produk jualan, ketik: Tambah Jual [Nama] [Kategori] [Jumlah] [Harga])_`;
                        }
                    }
                    processedReply = processedReply.replace(match[0], replyText);
                    break;
                }
                case 'CARI_PRODUK': {
                    const [komoditas, hargaMaxRaw] = params;
                    const limitHarga = hargaMaxRaw ? Number(hargaMaxRaw.replace(/[^0-9]/g, '')) : 9999999;
                    // Simple search query matching product name and active status
                    const results = await (0, knex_1.default)('products')
                        .join('stores', 'products.store_id', 'stores.id')
                        .join('users', 'stores.owner_id', 'users.id')
                        .where('products.is_active', true)
                        .andWhere('products.name', 'like', `%${komoditas}%`)
                        .andWhere('products.price_per_unit', '<=', limitHarga)
                        .select('products.*', 'stores.name as store_name', 'stores.kabupaten', 'users.name as seller_name')
                        .limit(3);
                    if (results.length === 0) {
                        processedReply = processedReply.replace(match[0], `\n\nℹ️ _Sistem: Maaf, tidak ditemukan stok ${komoditas} yang tersedia saat ini._`);
                    }
                    else {
                        const list = results.map(r => `• *${r.name}* (Sisa: ${r.stock_quantity}kg)\n  💰 Rp${Number(r.price_per_unit).toLocaleString('id-ID')}/kg\n  🏪 ${r.store_name} (${r.kabupaten})\n  📦 ID: \`${r.id.split('-')[0]}\``).join('\n\n');
                        processedReply = processedReply.replace(match[0], `\n\n🛒 *Hasil Pencarian Produk AgriHub:*\n\n${list}\n\n👉 _Ingin pesan? Ketik:* [Pesan ID_Produk Jumlah] (Contoh: Pesan ${results[0].id.split('-')[0]} 10)_`);
                    }
                    break;
                }
                case 'CEK_PENGIRIMAN': {
                    // Cek opsi kurir
                    const [productIdRaw, jumlah] = params;
                    // match uuid start
                    const prod = await (0, knex_1.default)('products').where('id', 'like', `${productIdRaw}%`).first();
                    if (!prod) {
                        processedReply = processedReply.replace(match[0], `\n\n❌ _Sistem: Produk ID tidak valid._`);
                        break;
                    }
                    // Opsi kurir disimulasikan / dilompati karena setup Biteship butuh origin/dest valid
                    processedReply = processedReply.replace(match[0], `\n\n🚚 _Opsi Kurir yang Tersedia (Estimasi):_\n1. JNE Reguler\n2. JNT Express\n3. AnterAja\n\n👉 _Lanjutkan ke pembayaran? balas dengan *Checkout ${prod.id.split('-')[0]} ${jumlah} jne*_`);
                    break;
                }
                case 'CHECKOUT_PESANAN': {
                    if (!user)
                        throw new Error('Akun belum terdaftar.');
                    const [productIdRaw, jumlah, kurir] = params;
                    const prod = await (0, knex_1.default)('products').join('stores', 'products.store_id', 'stores.id').where('products.id', 'like', `${productIdRaw}%`).select('products.*', 'stores.owner_id').first();
                    if (!prod) {
                        processedReply = processedReply.replace(match[0], `\n\n❌ _Sistem: Produk tidak ditemukan / stok habis._`);
                        break;
                    }
                    const qty = Number(jumlah);
                    const subtotal = qty * prod.price_per_unit;
                    // Simulated shipping flat rate
                    const shippingFee = 15000;
                    const platformFee = subtotal * 0.02;
                    const ppn = (subtotal + shippingFee) * 0.11;
                    const total = subtotal + shippingFee + platformFee + ppn;
                    const orderId = (0, uuid_1.v4)();
                    await (0, knex_1.default)('orders').insert({
                        id: orderId,
                        buyer_id: user.id,
                        seller_id: prod.owner_id,
                        store_id: prod.store_id,
                        product_id: prod.id,
                        quantity: qty,
                        unit_price: prod.price_per_unit,
                        total_amount: total,
                        platform_fee: platformFee,
                        ppn_fee: ppn,
                        seller_net: subtotal - platformFee,
                        status: 'pending',
                        group_jid: jid.endsWith('@g.us') ? jid : null
                    });
                    // Generate a simulated Midtrans payment link
                    const paymentToken = jsonwebtoken_1.default.sign({ order_id: orderId }, process.env.JWT_SECRET || 'secret', { expiresIn: '1d' });
                    const payLink = `https://agrihub.rumah-genbi.com/pay/${orderId}?token=${paymentToken}`;
                    const invoiceStr = `🧾 *INVOICE PEMBAYARAN*\n\n`
                        + `📦 Produk: ${prod.name} (${qty}kg)\n`
                        + `🚚 Ekspedisi: ${kurir.toUpperCase()}\n`
                        + `💵 Total: *Rp${total.toLocaleString('id-ID')}*\n\n`
                        + `Silakan bayar menggunakan Link Midtrans berikut untuk keamanan transaksi (E-Wallet/VA Code):\n👉 ${payLink}\n\n`
                        + `_Dana Anda akan ditahan oleh sistem AgriHub hingga barang tiba dengan aman._`;
                    processedReply = processedReply.replace(match[0], `\n\n${invoiceStr}`);
                    break;
                }
                case 'CEK_TOKEN': {
                    processedReply = processedReply.replace(match[0], `\n\n💡 _Gunakan perintah *CEK TOKEN* untuk melihat sisa kredit AI Anda._`);
                    break;
                }
                case 'LIHAT_PESANAN': {
                    processedReply = processedReply.replace(match[0], `\n\n💡 _Gunakan perintah *PESANAN* untuk melihat daftar pesanan Anda._`);
                    break;
                }
                default:
                    processedReply = processedReply.replace(match[0], '');
            }
        }
        catch (err) {
            console.error(`❌ [Agent] Tool failure (${command}):`, err.message);
            processedReply = processedReply.replace(match[0], `\n\n❌ _Gagal menjalankan aksi: ${err.message}_`);
        }
    }
    return processedReply;
}
// ── Background Jobs ──────────────────────────────────────────────────────
// Check for auto-confirmation every 12 hours
setInterval(() => {
    transactionService.runAutoConfirmJob().catch(err => console.error('Auto-Confirm Job Error:', err));
}, 12 * 60 * 60 * 1000);
// Initial run
setTimeout(() => transactionService.runAutoConfirmJob().catch(() => { }), 10000);
//# sourceMappingURL=whatsappBot.js.map
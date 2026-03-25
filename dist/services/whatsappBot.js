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
const matchingService = __importStar(require("./matchingService"));
// ─── Constants ───────────────────────────────────────────────────────────
let waSocket = null;
let isConnected = false;
let qrCode = '';
const logger = (0, pino_1.default)({ level: 'silent' });
// Sesi penanggung jawab grup (Map<groupJid + senderLid, { userId, expires }>)
const pendingAssignments = new Map();
let isInitializing = false;
let isConnecting = false;
let isInitializedFlag = false;
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
            email: 'bot@agrihub.id',
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
        const lockKey = 'whatsapp_bot_main';
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
                    console.warn(`🕒 [WA] Active instance found (PID ${lockData.pid}). Waiting 15s for takeover...`);
                    setTimeout(() => connectWhatsApp(), 15000);
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
                console.log(`📩 [WA] Processing Msg:`, msg.key.id);
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
        // Jika socket tidak sempat dibuat (exception sebelum makeWASocket),
        // wajib reset isConnecting agar reconnect berikutnya tidak di-skip.
        if (!socketCreated) {
            console.error('❌ [WA] Socket tidak sempat dibuat, reset isConnecting.');
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
async function sendWAMessage(jid, text) {
    // Jika sedang connecting, tunggu sebentar (max 15 detik)
    if (!isConnected && isConnecting) {
        let waitCount = 0;
        while (!isConnected && isConnecting && waitCount < 30) {
            await new Promise(r => setTimeout(r, 500));
            waitCount++;
        }
    }
    if (!waSocket || !isConnected) {
        console.error(`❌ [WA] Failed to send message to ${jid}: Bot NOT CONNECTED after wait.`);
        return;
    }
    try {
        await waSocket.sendMessage(jid, { text });
    }
    catch (err) {
        // If it fails with "Connection Closed", maybe it just dropped. Try once more if isConnected is still true or becomes true.
        const errMsg = err.message;
        if (errMsg.includes('Closed') || errMsg.includes('reset')) {
            console.warn(`⚠️ [WA] Send failed (${errMsg}), retrying once in 2s...`);
            await new Promise(r => setTimeout(r, 2000));
            if (waSocket && isConnected) {
                try {
                    await waSocket.sendMessage(jid, { text });
                    return;
                }
                catch { }
            }
        }
        console.error(`❌ [WA] Failed to send message to ${jid}:`, err);
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
    const text = (msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        msg.message?.videoMessage?.caption ||
        '').trim();
    if (!text) {
        // Log even if no text (maybe just a media without caption that wasn't caught by the handler)
        console.log(`[WA] Empty text or unhandled media from ${sender}`);
        return;
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
        cleanText !== text ||
        (isGroup && text.toLowerCase().includes('asistentani')) ||
        (isGroup && text.toLowerCase().includes('bot'));
    if (isGroup) {
        // Log sudah di atas, ini untuk detail tambahan
        if (isMentioned)
            console.log(`👉 Mentioned! Text: "${text}" | Clean: "${cleanText}"`);
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
        const isCommand = ['DAFTAR TOKO', 'JUAL ', 'ONGKIR ', 'STOK', 'PESANAN', 'MENU', 'HELP', 'LINK ', 'LAPOR STOK', 'CARI STOK', 'LIHAT MATCH', 'CEK TOKEN', 'CEK SALDO', 'KREDIT'].some(c => cleanUpper.startsWith(c));
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
            if (cleanUpper.startsWith('LAPOR STOK')) {
                const parts = cleanText.split('|').map(s => s.trim());
                if (parts.length < 4) {
                    await sendWAMessage(jid, '📝 *Format:* LAPOR STOK | Komoditas | Jumlah kg | Harga/kg | Kabupaten\n\nContoh: LAPOR STOK | Padi | 500kg | 8000 | Sleman');
                    return;
                }
                const [, komoditas, jumlah, harga, kabupaten] = parts;
                const user = await (0, knex_1.default)('users').where({ whatsapp_lid: sender }).first() || await (0, knex_1.default)('users').where('phone', 'like', `%${sender.split('@')[0].slice(-9)}%`).first();
                if (!user) {
                    await sendWAMessage(jid, '❌ Akun Anda belum terdaftar atau tertaut. Gunakan perintah *LINK [Nomor HP]* dulu.');
                    return;
                }
                const result = await matchingService.reportSupply(user.id, {
                    komoditas,
                    jumlah_kg: Number(jumlah.replace(/[^0-9]/g, '')),
                    harga_per_kg: Number(harga.replace(/[^0-9]/g, '')),
                    kabupaten,
                    provinsi: '' // Optional
                });
                const matchCount = result.matchesFound;
                await sendWAMessage(jid, `✅ *Berhasil!* Stok *${komoditas}* (${jumlah}) Anda telah dilaporkan.\n\n${matchCount > 0 ? `🔥 *BOOM!* Kami menemukan *${matchCount}* calon pembeli yang cocok untuk Anda!` : 'Sistem sedang mencari pembeli yang cocok.'} Ketik *LIHAT MATCH* untuk melihat hasilnya.`);
                // Broadcast notifications to matched parties
                if (matchCount > 0) {
                    const matches = await matchingService.getMatchesForUser(user.id);
                    for (const m of matches) {
                        if (m.supply_id === result.id) {
                            const targetJid = m.matched_lid || `${m.matched_phone}@s.whatsapp.net`;
                            await sendWAMessage(targetJid, `🤝 *Kecocokan Baru!* Stok *${komoditas}* yang Anda cari baru saja dilaporkan oleh seorang petani di *${kabupaten}*.\n\n💰 Harga: Rp${Number(harga.replace(/[^0-9]/g, '')).toLocaleString('id-ID')}/kg\n📦 Jumlah: ${jumlah}\n\nSegera cek di dashboard AgriHub!`);
                        }
                    }
                }
                return;
            }
            if (cleanUpper.startsWith('CARI STOK')) {
                const parts = cleanText.split('|').map(s => s.trim());
                if (parts.length < 4) {
                    await sendWAMessage(jid, '📝 *Format:* CARI STOK | Komoditas | Jumlah kg | Harga Max | Kabupaten\n\nContoh: CARI STOK | Padi | 100kg | 8500 | Sleman');
                    return;
                }
                const [, komoditas, jumlah, harga, kabupaten] = parts;
                const user = await (0, knex_1.default)('users').where({ whatsapp_lid: sender }).first() || await (0, knex_1.default)('users').where('phone', 'like', `%${sender.split('@')[0].slice(-9)}%`).first();
                if (!user) {
                    await sendWAMessage(jid, '❌ Akun Anda belum terdaftar atau tertaut.');
                    return;
                }
                const result = await matchingService.reportDemand(user.id, {
                    komoditas,
                    jumlah_kg: Number(jumlah.replace(/[^0-9]/g, '')),
                    harga_max_per_kg: Number(harga.replace(/[^0-9]/g, '')),
                    kabupaten
                });
                const matchCount = result.matchesFound;
                await sendWAMessage(jid, `🔍 *Permintaan Dicatat:* Mencari *${komoditas}* (${jumlah}) dengan harga max Rp${Number(harga.replace(/[^0-9]/g, '')).toLocaleString('id-ID')}.\n\n${matchCount > 0 ? `🚀 *Kabar Baik!* Ada *${matchCount}* stok tersedia yang cocok dengan permintaan Anda!` : 'Kami akan memberitahu jika ada penjual yang cocok!'}`);
                // Broadcast notifications to matched parties
                if (matchCount > 0) {
                    const matches = await matchingService.getMatchesForUser(user.id);
                    for (const m of matches) {
                        if (m.demand_id === result.id) {
                            const targetJid = m.matched_lid || `${m.matched_phone}@s.whatsapp.net`;
                            await sendWAMessage(targetJid, `🤝 *Peluang Penjualan!* Seorang pembeli mencari *${komoditas}* (${jumlah}) di *${kabupaten}* dengan harga s/d Rp${Number(harga.replace(/[^0-9]/g, '')).toLocaleString('id-ID')}.\n\nStok Anda sangat cocok dengan permintaan ini!`);
                        }
                    }
                }
                return;
            }
            if (cleanUpper === 'LIHAT MATCH') {
                const user = await (0, knex_1.default)('users').where({ whatsapp_lid: sender }).first() || await (0, knex_1.default)('users').where('phone', 'like', `%${sender.split('@')[0].slice(-9)}%`).first();
                if (!user) {
                    await sendWAMessage(jid, '❌ Akun tidak ditemukan.');
                    return;
                }
                const matches = await matchingService.getMatchesForUser(user.id);
                if (matches.length === 0) {
                    await sendWAMessage(jid, 'ℹ️ Belum ada kecocokan (match) baru untuk stok atau permintaan Anda.');
                    return;
                }
                let matchText = '🤝 *Kecocokan (Match) Terbaru:*\n\n';
                for (const m of matches) {
                    matchText += `• *${m.komoditas}* (${m.score}% Cocok)\n`;
                    matchText += `  💰 Harga: Rp${m.supply_price.toLocaleString('id-ID')} vs Rp${m.demand_price.toLocaleString('id-ID')}\n`;
                    matchText += `  📍 Lokasi: ${m.supply_loc} ↔️ ${m.demand_loc}\n\n`;
                }
                await sendWAMessage(jid, matchText);
                return;
            }
            if (cleanUpper === 'CEK TOKEN' || cleanUpper === 'CEK SALDO' || cleanUpper === 'KREDIT') {
                if (isGroup) {
                    const credits = await (0, aiService_2.checkGroupCredit)(jid);
                    if (!credits.allowed && credits.reason) {
                        await sendWAMessage(jid, `⚠️ *Status AI Grup:*\n${credits.reason}`);
                    }
                    else {
                        await sendWAMessage(jid, `🪙 *Saldo AI Grup:*\n\nSisa Kredit: *${Number(credits.balance).toFixed(2)} tokens*\nStatus: Aktif ✅\n\n_Kredit berkurang 0.1 setiap satu pertanyaan AI._`);
                    }
                }
                else {
                    const phone = sender.split('@')[0].replace(/[^0-9]/g, '');
                    const user = await (0, knex_1.default)('users').where('phone', 'like', `%${phone.slice(-9)}%`).first();
                    if (user?.puter_token) {
                        await sendWAMessage(jid, `👤 *Status AI Anda:*\n\nAkun Puter: *Tertaut* ✅\nMode: Personal (PC)\n\nAnda menggunakan kuota token dari akun Puter pribadi Anda yang telah dihubungkan di dashboard.`);
                    }
                    else {
                        await sendWAMessage(jid, `👤 *Status AI Anda:*\n\nAkun Puter: *Belum Tertaut* ❌\n\nSilakan login ke AgriHub Web dan hubungkan akun Puter Anda di menu *Pengaturan Chat* agar bisa menggunakan AI di Private Chat.`);
                    }
                }
                return;
            }
            if (cleanUpper === 'MENU' || cleanUpper === 'HELP') {
                await sendWAMessage(jid, `🌾 *Menu AgriHub*\n\n*E-Commerce:* \n• DAFTAR TOKO | nama | kab | prov | produk\n• JUAL [nama] [harga] [stok]\n• STOK & PESANAN\n\n*Matchmaking (Grosir/Langsung):*\n• LAPOR STOK | komoditas | jml | harga | kab\n• CARI STOK | komoditas | jml | harga | kab\n• LIHAT MATCH\n\n*Lainnya:*\n• ONGKIR [asal] [tuj] [berat]\n• LINK [NomorHP]\n\nAtau tanya saja langsung ke AI!`);
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
                // Gunakan UPSERT: Update jika ada, Insert jika belum ada (antisipasi bot sudah ada di grup sebelum fitur ini)
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
        if (!isCommand) {
            // Cek siapa yang bertanggung jawab atas grup ini
            let targetUserId = 'wa-bot';
            if (isGroup) {
                const groupMeta = await (0, knex_1.default)('group_credits').where({ group_jid: jid }).first();
                if (!groupMeta || !groupMeta.owner_id) {
                    // Jika record belum ada sama sekali, buatkan record kosong (tanpa owner) dulu
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
                if (!owner.puter_token && owner.role !== 'admin') {
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
                if (!user.puter_token && user.role !== 'admin') {
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
            // Kirim ack langsung agar user tahu bot sedang bekerja
            // (AI bisa butuh beberapa detik, tanpa ini tampak seperti bot mati)
            await sendWAMessage(jid, '⏳ _AsistenTani sedang memikirkan jawaban..._');
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
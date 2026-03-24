"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const uuid_1 = require("uuid");
const auth_1 = require("../middleware/auth");
const ragService_1 = require("../services/ragService");
const documentParser_1 = require("../services/documentParser");
const aiService_1 = require("../services/aiService");
const crypto_1 = __importDefault(require("crypto"));
const knex_1 = __importDefault(require("../config/knex"));
const router = (0, express_1.Router)();
// ─── Upload directory setup ────────────────────────────────────────────────
const UPLOAD_DIR = path_1.default.resolve(process.cwd(), 'uploads');
if (!fs_1.default.existsSync(UPLOAD_DIR))
    fs_1.default.mkdirSync(UPLOAD_DIR, { recursive: true });
const storage = multer_1.default.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname);
        cb(null, `${(0, uuid_1.v4)()}${ext}`);
    },
});
const upload = (0, multer_1.default)({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
    fileFilter: (_req, file, cb) => {
        const allowed = ['.pdf', '.txt', '.md', '.xlsx', '.xls', '.csv'];
        const ext = path_1.default.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext))
            cb(null, true);
        else
            cb(new Error(`Format tidak didukung: ${ext}. Gunakan: ${allowed.join(', ')}`));
    },
});
// ─── GET /api/rag/documents — List dokumen user ────────────────────────────
router.get('/documents', auth_1.requireAuth, async (req, res) => {
    try {
        const docs = await (0, ragService_1.getUserDocuments)(req.user.id);
        res.json({ success: true, data: docs });
    }
    catch {
        res.status(500).json({ success: false, error: 'Gagal fetch dokumen' });
    }
});
// ─── POST /api/rag/upload — Upload file ke knowledge base ─────────────────
router.post('/upload', auth_1.requireAuth, upload.single('file'), async (req, res) => {
    if (!req.file) {
        res.status(400).json({ success: false, error: 'File tidak ada' });
        return;
    }
    try {
        const title = req.body.title || req.file.originalname;
        const ext = path_1.default.extname(req.file.originalname).toLowerCase();
        const sourceType = ext === '.pdf' ? 'pdf' : ['.xlsx', '.xls', '.csv'].includes(ext) ? 'xlsx' : 'text';
        // ── Check Duplicate ──
        const fileBuffer = fs_1.default.readFileSync(req.file.path);
        const fileHash = crypto_1.default.createHash('md5').update(fileBuffer).digest('hex');
        const fileSize = fileBuffer.length;
        const isDuplicate = await (0, ragService_1.isDuplicateDocument)(req.user.id, title, fileHash, fileSize);
        if (isDuplicate) {
            fs_1.default.unlinkSync(req.file.path);
            res.json({ success: true, message: 'Dokumen ini sudah ada di Knowledge Base Anda.', data: { is_duplicate: true } });
            return;
        }
        const content = await (0, documentParser_1.parseFile)(req.file.path);
        if (!content || content.trim().length < 50) {
            fs_1.default.unlinkSync(req.file.path);
            res.status(400).json({ success: false, error: 'File terlalu kecil atau kosong' });
            return;
        }
        const docId = await (0, ragService_1.storeDocument)({
            userId: req.user.id,
            title,
            sourceType,
            content,
            isGlobal: req.body.is_global === 'true' && req.user.role === 'admin',
            fileHash,
            fileSize,
        });
        // Cleanup uploaded file setelah diproses
        fs_1.default.unlinkSync(req.file.path);
        res.status(201).json({ success: true, data: { doc_id: docId, title, chunks: content.length } });
    }
    catch (err) {
        if (req.file)
            try {
                fs_1.default.unlinkSync(req.file.path);
            }
            catch { }
        res.status(500).json({ success: false, error: err.message });
    }
});
// ─── POST /api/rag/add-url — Tambah URL ke knowledge base ─────────────────
router.post('/add-url', auth_1.requireAuth, async (req, res) => {
    const { url, title } = req.body;
    if (!url) {
        res.status(400).json({ success: false, error: 'URL wajib diisi' });
        return;
    }
    try {
        const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');
        const content = isYouTube ? await (0, documentParser_1.parseYouTube)(url) : await (0, documentParser_1.parseUrl)(url);
        const docId = await (0, ragService_1.storeDocument)({
            userId: req.user.id,
            title: title || url,
            sourceType: isYouTube ? 'youtube' : 'url',
            sourceUrl: url,
            content,
        });
        res.status(201).json({ success: true, data: { doc_id: docId, title: title || url } });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// ─── POST /api/rag/add-text — Tambah teks manual ──────────────────────────
router.post('/add-text', auth_1.requireAuth, async (req, res) => {
    const { content, title } = req.body;
    if (!content || !title) {
        res.status(400).json({ success: false, error: 'content dan title wajib' });
        return;
    }
    try {
        const docId = await (0, ragService_1.storeDocument)({
            userId: req.user.id,
            title,
            sourceType: 'text',
            content: (0, documentParser_1.parseText)(content),
            isGlobal: req.body.is_global === true && req.user.role === 'admin',
        });
        res.status(201).json({ success: true, data: { doc_id: docId } });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// ─── DELETE /api/rag/documents/:id ────────────────────────────────────────
router.delete('/documents/:id', auth_1.requireAuth, async (req, res) => {
    try {
        const ok = await (0, ragService_1.deleteDocument)(req.params.id, req.user.id);
        if (!ok) {
            res.status(404).json({ success: false, error: 'Dokumen tidak ditemukan' });
            return;
        }
        res.json({ success: true, message: 'Dokumen dihapus' });
    }
    catch {
        res.status(500).json({ success: false, error: 'Gagal hapus dokumen' });
    }
});
// ─── POST /api/rag/chat — Chat dengan AI + RAG ────────────────────────────
router.post('/chat', auth_1.requireAuth, async (req, res) => {
    const { message, history = [], use_rag = true, model } = req.body;
    if (!message?.trim()) {
        res.status(400).json({ success: false, error: 'Pesan tidak boleh kosong' });
        return;
    }
    try {
        const result = await (0, aiService_1.chatWithAI)({
            message,
            history,
            userId: req.user.id,
            useRag: use_rag,
            model,
        });
        res.json({ success: true, data: result });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// ─── POST /api/rag/chat/stream — SSE Streaming ────────────────────────────
router.post('/chat/stream', auth_1.requireAuth, async (req, res) => {
    const { message, history = [], use_rag = true } = req.body;
    if (!message?.trim()) {
        res.status(400).json({ success: false, error: 'Pesan tidak boleh kosong' });
        return;
    }
    // Setup SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    try {
        const result = await (0, aiService_1.chatWithAI)({
            message, history, userId: req.user.id, useRag: use_rag,
        });
        // Simulate streaming by sending word by word
        const words = result.reply.split(' ');
        for (const word of words) {
            res.write(`data: ${JSON.stringify({ token: word + ' ' })}\n\n`);
            await new Promise(r => setTimeout(r, 30));
        }
        if (result.ragSources.length > 0) {
            res.write(`data: ${JSON.stringify({ sources: result.ragSources })}\n\n`);
        }
        res.write('data: [DONE]\n\n');
    }
    catch (err) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    }
    finally {
        res.end();
    }
});
// ─── GET/POST /api/rag/group-credits ──────────────────────────────────────
router.get('/group-credits', auth_1.requireAuth, async (req, res) => {
    try {
        const credits = await (0, knex_1.default)('group_credits').where({ owner_id: req.user.id });
        res.json({ success: true, data: credits });
    }
    catch {
        res.status(500).json({ success: false, error: 'Gagal fetch kredit grup' });
    }
});
router.post('/group-credits', auth_1.requireAuth, async (req, res) => {
    const { group_jid, credits_amount } = req.body;
    if (!group_jid || !credits_amount) {
        res.status(400).json({ success: false, error: 'group_jid dan credits_amount wajib' });
        return;
    }
    try {
        const exists = await (0, knex_1.default)('group_credits').where({ group_jid }).first();
        if (exists) {
            await (0, knex_1.default)('group_credits').where({ group_jid }).increment('credits_balance', Number(credits_amount)).update({ is_ai_enabled: true, updated_at: new Date().toISOString() });
        }
        else {
            await (0, knex_1.default)('group_credits').insert({
                id: (0, uuid_1.v4)(), group_jid, owner_id: req.user.id,
                credits_balance: Number(credits_amount), credits_used: 0,
                is_ai_enabled: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
            });
        }
        res.json({ success: true, message: `Kredit ${credits_amount} ditambahkan ke grup` });
    }
    catch {
        res.status(500).json({ success: false, error: 'Gagal tambah kredit' });
    }
});
exports.default = router;
//# sourceMappingURL=rag.js.map
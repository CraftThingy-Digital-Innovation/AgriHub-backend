import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { storeDocument, getUserDocuments, deleteDocument } from '../services/ragService';
import { parseFile, parseUrl, parseYouTube, parseText } from '../services/documentParser';
import { chatWithAI } from '../services/aiService';
import db from '../config/knex';

const router = Router();

// ─── Upload directory setup ────────────────────────────────────────────────
const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.pdf', '.txt', '.md', '.xlsx', '.xls', '.csv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`Format tidak didukung: ${ext}. Gunakan: ${allowed.join(', ')}`));
  },
});

// ─── GET /api/rag/documents — List dokumen user ────────────────────────────
router.get('/documents', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const docs = await getUserDocuments(req.user!.id);
    res.json({ success: true, data: docs });
  } catch { res.status(500).json({ success: false, error: 'Gagal fetch dokumen' }); }
});

// ─── POST /api/rag/upload — Upload file ke knowledge base ─────────────────
router.post('/upload', requireAuth, upload.single('file'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.file) { res.status(400).json({ success: false, error: 'File tidak ada' }); return; }
  try {
    const title = req.body.title || req.file.originalname;
    const ext = path.extname(req.file.originalname).toLowerCase();
    const sourceType = ext === '.pdf' ? 'pdf' : ['.xlsx', '.xls', '.csv'].includes(ext) ? 'xlsx' : 'text';

    const content = await parseFile(req.file.path);
    if (!content || content.trim().length < 50) {
      fs.unlinkSync(req.file.path);
      res.status(400).json({ success: false, error: 'File terlalu kecil atau kosong' });
      return;
    }

    const docId = await storeDocument({
      userId: req.user!.id,
      title,
      sourceType,
      content,
      isGlobal: req.body.is_global === 'true' && req.user!.role === 'admin',
    });

    // Cleanup uploaded file setelah diproses
    fs.unlinkSync(req.file.path);
    res.status(201).json({ success: true, data: { doc_id: docId, title, chunks: content.length } });
  } catch (err) {
    if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// ─── POST /api/rag/add-url — Tambah URL ke knowledge base ─────────────────
router.post('/add-url', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { url, title } = req.body;
  if (!url) { res.status(400).json({ success: false, error: 'URL wajib diisi' }); return; }
  try {
    const isYouTube = url.includes('youtube.com') || url.includes('youtu.be');
    const content = isYouTube ? await parseYouTube(url) : await parseUrl(url);
    const docId = await storeDocument({
      userId: req.user!.id,
      title: title || url,
      sourceType: isYouTube ? 'youtube' : 'url',
      sourceUrl: url,
      content,
    });
    res.status(201).json({ success: true, data: { doc_id: docId, title: title || url } });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// ─── POST /api/rag/add-text — Tambah teks manual ──────────────────────────
router.post('/add-text', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { content, title } = req.body;
  if (!content || !title) { res.status(400).json({ success: false, error: 'content dan title wajib' }); return; }
  try {
    const docId = await storeDocument({
      userId: req.user!.id,
      title,
      sourceType: 'text',
      content: parseText(content),
      isGlobal: req.body.is_global === true && req.user!.role === 'admin',
    });
    res.status(201).json({ success: true, data: { doc_id: docId } });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// ─── DELETE /api/rag/documents/:id ────────────────────────────────────────
router.delete('/documents/:id', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ok = await deleteDocument(req.params.id, req.user!.id);
    if (!ok) { res.status(404).json({ success: false, error: 'Dokumen tidak ditemukan' }); return; }
    res.json({ success: true, message: 'Dokumen dihapus' });
  } catch { res.status(500).json({ success: false, error: 'Gagal hapus dokumen' }); }
});

// ─── POST /api/rag/chat — Chat dengan AI + RAG ────────────────────────────
router.post('/chat', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { message, history = [], use_rag = true, model } = req.body;
  if (!message?.trim()) { res.status(400).json({ success: false, error: 'Pesan tidak boleh kosong' }); return; }

  try {
    const result = await chatWithAI({
      message,
      history,
      userId: req.user!.id,
      useRag: use_rag,
      model,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// ─── POST /api/rag/chat/stream — SSE Streaming ────────────────────────────
router.post('/chat/stream', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { message, history = [], use_rag = true } = req.body;
  if (!message?.trim()) { res.status(400).json({ success: false, error: 'Pesan tidak boleh kosong' }); return; }

  // Setup SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const result = await chatWithAI({
      message, history, userId: req.user!.id, useRag: use_rag,
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
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: (err as Error).message })}\n\n`);
  } finally {
    res.end();
  }
});

// ─── GET/POST /api/rag/group-credits ──────────────────────────────────────
router.get('/group-credits', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const credits = await db('group_credits').where({ owner_id: req.user!.id });
    res.json({ success: true, data: credits });
  } catch { res.status(500).json({ success: false, error: 'Gagal fetch kredit grup' }); }
});

router.post('/group-credits', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  const { group_jid, credits_amount } = req.body;
  if (!group_jid || !credits_amount) { res.status(400).json({ success: false, error: 'group_jid dan credits_amount wajib' }); return; }
  try {
    const exists = await db('group_credits').where({ group_jid }).first();
    if (exists) {
      await db('group_credits').where({ group_jid }).increment('credits_balance', Number(credits_amount)).update({ is_ai_enabled: true, updated_at: new Date().toISOString() });
    } else {
      await db('group_credits').insert({
        id: uuidv4(), group_jid, owner_id: req.user!.id,
        credits_balance: Number(credits_amount), credits_used: 0,
        is_ai_enabled: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      });
    }
    res.json({ success: true, message: `Kredit ${credits_amount} ditambahkan ke grup` });
  } catch { res.status(500).json({ success: false, error: 'Gagal tambah kredit' }); }
});

export default router;

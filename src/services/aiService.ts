import axios from 'axios';
import { retrieveRelevantChunks } from './ragService';

// ─── Puter.js AI Chat via REST API ────────────────────────────────────────
// Puter.js di server-side menggunakan REST endpoint mereka
// Docs: https://docs.puter.com/ai/

const PUTER_API_BASE = 'https://api.puter.com/v2/chat/completions';

// Model yang direkomendasikan (hemat + kapable)
export const AI_MODELS = {
  default: 'gpt-4o-mini',          // Hemat, cepat, bagus untuk konten pertanian
  advanced: 'claude-3-5-sonnet',   // Untuk analisis kompleks
  embedding: 'text-embedding-3-small',
} as const;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ─── System prompt khusus AgriHub ─────────────────────────────────────────

const SYSTEM_PROMPT = `Kamu adalah AsistenTani, AI konsultan pertanian AgriHub Indonesia yang ramah dan berpengetahuan luas.

Keahlianmu meliputi:
- Budidaya tanaman pangan Indonesia (padi, jagung, cabai, sayuran, dll)
- Pengendalian hama dan penyakit tanaman
- Teknik irigasi dan pemupukan
- Analisis harga pasar dan tren komoditas
- Tips panen dan pascapanen
- Informasi logistik dan distribusi hasil tani
- Panduan menggunakan platform AgriHub

Gaya bicaramu: Gunakan Bahasa Indonesia yang mudah dipahami petani. Jawab dengan singkat, jelas, dan praktis. Jika ada informasi dari dokumen pengetahuan petani, gunakan info tersebut sebagai referensi utama.

Jika pertanyaan di luar konteks pertanian, arahkan kembali ke topik pertanian atau fitur AgriHub.`;

// ─── Main chat function ────────────────────────────────────────────────────

export async function chatWithAI(opts: {
  message: string;
  history: ChatMessage[];
  userId: string;
  whatsappJid?: string;
  useRag?: boolean;
  model?: string;
}): Promise<{ reply: string; ragSources: string[]; tokensUsed?: number }> {
  const { message, history: providedHistory, userId, whatsappJid, useRag = true, model = AI_MODELS.default } = opts;

  let ragContext = '';
  const ragSources: string[] = [];

  // 1. Ambil history dari DB jika whatsappJid ada (untuk bot)
  let dbHistory: ChatMessage[] = [];
  if (whatsappJid) {
    const rows = await db('chats')
      .where({ whatsapp_jid: whatsappJid })
      .orderBy('created_at', 'desc')
      .limit(15);
    dbHistory = rows.reverse().map(r => ({ role: r.role, content: r.content }));
  }

  // Gabungkan history (prioritas history yang dipassing manual jika ada)
  const finalHistory = providedHistory.length > 0 ? providedHistory : dbHistory;

  // 2. Cek apakah perlu summarization (Auto Compression)
  let contextSummary = '';
  if (finalHistory.length >= 12) {
      // Jika history panjang, ambil yang sangat lama untuk disummarize
      const toSummarize = finalHistory.slice(0, -6); 
      contextSummary = await summarizeChat(toSummarize, userId);
  }

  // 3. RAG: Ambil konteks dari dokumen user jika ada
  if (useRag) {
    const chunks = await retrieveRelevantChunks({ query: message, userId, topK: 4 });
    if (chunks.length > 0) {
      ragContext = '\n\n=== INFORMASI DARI DOKUMEN PENGETAHUAN ===\n' +
        chunks.map(c => `[${c.docTitle}]\n${c.content}`).join('\n\n') +
        '\n=== AKHIR DOKUMEN ===\n';
      ragSources.push(...chunks.map(c => c.docTitle));
    }
  }

  const systemMsg = SYSTEM_PROMPT + 
    (contextSummary ? `\n\n=== RINGKASAN PERCAKAPAN SEBELUMNYA ===\n${contextSummary}\n` : '') +
    ragContext;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemMsg },
    ...finalHistory.slice(-6), // Ambil 6 pesan terakhir sebagai context aktif
    { role: 'user', content: message },
  ];

  try {
    // Ambil token puter user dari DB
    const user = await db('users').where({ id: userId }).select('puter_token').first();
    if (!user || !user.puter_token) {
      if (userId === 'wa-bot') {
        return { reply: '❌ Fitur AI dimatikan karena sistem menggunakan Bring Your Own Token. Harap login dan hubungkan akun Puter di web.', ragSources: [] };
      }
      return { reply: '❌ Anda belum menghubungkan akun Puter untuk fitur AI. Silakan hubungkan di Pengaturan Chat.', ragSources: [] };
    }

    const response = await callPuterAI({ messages, model, apiKey: user.puter_token });
    return { reply: response.reply, ragSources, tokensUsed: response.tokensUsed };
  } catch (err) {
    console.error('AI chat error:', err);
    return {
      reply: 'Maaf, terjadi kesalahan saat menghubungi AI Puter. Token Anda mungkin kadaluarsa. Silakan hubungkan ulang akun Puter Anda. ' + (err as Error).message,
      ragSources: [],
    };
  }
}

async function summarizeChat(history: ChatMessage[], userId: string): Promise<string> {
    try {
        const user = await db('users').where({ id: userId }).select('puter_token').first();
        if (!user || !user.puter_token) return '';

        const summaryResponse = await callPuterAI({
            apiKey: user.puter_token,
            model: AI_MODELS.default,
            messages: [
                { role: 'system', content: 'Ringkas percakapan berikut dalam maksimal 3 kalimat padat yang mencakup poin-poin penting agar AI bisa melanjutkan konteksnya.' },
                ...history,
                { role: 'user', content: 'Tolong ringkas percakapan di atas.' }
            ]
        });
        return summaryResponse.reply;
    } catch (err) {
        console.error('Summarization error:', err);
        return '';
    }
}

async function callPuterAI(opts: {
  messages: ChatMessage[];
  model: string;
  apiKey: string;
}): Promise<{ reply: string; tokensUsed?: number }> {
  const { messages, model, apiKey } = opts;

  const response = await axios.post(
    PUTER_API_BASE,
    {
      messages,
      model,
      max_tokens: 1500,
      temperature: 0.7,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 45000,
    }
  );

  const choice = response.data?.choices?.[0];
  if (!choice) {
    console.error('Puter V2 Empty Response:', response.data);
    throw new Error('Empty response dari Puter AI (v2)');
  }

  return {
    reply: choice.message?.content || '',
    tokensUsed: response.data?.usage?.total_tokens,
  };

  return {
    reply: choice.message?.content || '',
    tokensUsed: response.data?.result?.usage?.total_tokens,
  };
}

// ─── Fallback response generator (dev mode / no API key) ─────────────────

function generateFallbackReply(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('harga') || lower.includes('price')) {
    return '💰 Untuk informasi harga terkini, silakan cek halaman Monitor Harga di dashboard AgriHub. Harga cabai merah saat ini berfluktuasi antara Rp 40.000-55.000/kg tergantung wilayah.';
  }
  if (lower.includes('padi') || lower.includes('beras')) {
    return '🌾 Padi adalah komoditas utama Indonesia. Masa tanam ideal: April-Mei (rendeng) atau Oktober-November (gadu). Varietas unggul: Ciherang, IR64, Inpari. Untuk hasil optimal, gunakan pupuk NPK sesuai dosis anjuran Dinas Pertanian setempat.';
  }
  if (lower.includes('cabai') || lower.includes('lombok')) {
    return '🌶️ Cabai memerlukan suhu 16-32°C dan kelembaban 70-80%. Penyakit umum: antraknosa (busuk buah), virus kuning. Pencegahan: rotasi tanaman, pestisida nabati dari daun sirsak atau bawang putih.';
  }
  if (lower.includes('ongkir') || lower.includes('kirim')) {
    return '📦 Untuk cek ongkir pengiriman, gunakan fitur Logistik di AgriHub. Ketik "ONGKIR [asal] [tujuan] [berat]kg" di WhatsApp bot kami!';
  }
  return '🌱 Halo! Saya AsistenTani AgriHub. Saya bisa membantu Anda dengan:\n• Budidaya tanaman (cabai, padi, sayuran, buah)\n• Pengendalian hama & penyakit\n• Harga pasar & perkiraan tren\n• Cara menggunakan fitur AgriHub\n\nSilakan tanyakan sesuatu, ya!';
}

// ─── Group Credit Checker ─────────────────────────────────────────────────

import db from '../config/knex';

export async function checkGroupCredit(groupJid: string): Promise<{
  allowed: boolean;
  balance: number;
  reason?: string;
}> {
  const group = await db('group_credits').where({ group_jid: groupJid }).first();
  if (!group) return { allowed: false, balance: 0, reason: 'Grup belum diaktifkan AI. Pemilik grup harus isi kredit dulu.' };
  if (!group.is_ai_enabled) return { allowed: false, balance: group.credits_balance, reason: 'AI di grup ini nonaktif.' };
  if (group.credits_balance <= 0) return { allowed: false, balance: 0, reason: 'Kredit grup habis. Pemilik grup perlu isi ulang.' };
  return { allowed: true, balance: group.credits_balance };
}

export async function deductGroupCredit(groupJid: string, amount = 0.1): Promise<void> {
  await db('group_credits').where({ group_jid: groupJid }).decrement('credits_balance', amount).increment('credits_used', amount);
}

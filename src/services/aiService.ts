import puter from '@heyputer/puter.js';
import { retrieveRelevantChunks } from './ragService';
import { searchCommodityPrices } from './priceService';
import { parseUrl } from './documentParser';
import db from '../config/knex';

// ─── Puter.js AI Chat via Official SDK ───────────────────────────────────
// Docs: https://docs.puter.com/AI/chat/

// Model via Puter — sesuai agri-hub-plan section 13 AI COST
// Sumber harga: developer.puter.com/ai/models
export const AI_MODELS = {
  // default:  'qwen/qwen3.5-flash-02-23',       // $0.07/M in, $0.26/M out — Default chat & WA bot
  default:  'arcee-ai/trinity-large-preview:free', // GRATIS — fallback jika credits menipis
  advanced: 'qwen/qwen3-235ba22b-2507',        // $0.07/M in, $0.10/M out — RAG kompleks, value terbaik
  simple:   'nvidia/nemotron-3-nano-30b-a3b',  // $0.05/M in, $0.20/M out — Query sederhana, 1M ctx
  deep:     'deepseek/deepseekv3.2',           // $0.26/M in, $0.38/M out — Analisis dokumen kompleks
  fallback: 'arcee-ai/trinity-large-preview:free', // GRATIS — fallback jika credits menipis
  vision:   'meta-llama/Llama-3.2-11B-Vision-Instruct:free', // GRATIS - Vision multimodal
} as const;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | any[];
}

// ─── System prompt khusus AgriHub ─────────────────────────────────────────

const SYSTEM_PROMPT = `Kamu adalah AsistenTani, AI konsultan pertanian AgriHub Indonesia yang ramah dan berpengetahuan luas.
 
  Keahlianmu meliputi:
  - Budidaya tanaman pangan Indonesia (padi, jagung, cabai, sayuran, dll)
  - Pengendalian hama dan penyakit tanaman
  - Teknik irigasi dan pemupukan
  - Analisis harga pasar dan tren komoditas (UTAMAKAN DATA LIVE API)
  - Tips panen dan pascapanen
  - Informasi logistik dan distribusi hasil tani
  - ### AGENTIC ACTIONS (TOOL CALLING)
  Jika user ingin melakukan aksi (lapor, cari, cek ongkir, beli, dll), kamu **WAJIB** menyertakan tag instruksi di akhir jawabanmu dalam format:
  \`[EXEC: COMMAND | PARAMS...]\`

  Daftar Command yang tersedia:
  1. **TAMBAH_PRODUK** | Komoditas | Kategori | Jumlah(kg) | Harga/kg
     (Contoh: [EXEC: TAMBAH_PRODUK | Cabai Rawit | sayuran | 12 | 45000])
     *Sistem akan otomatis menambahkannya ke Toko/Cabang user. Jika user belum punya toko, sistem akan membalas dengan Setup Link.*
  2. **CARI_PRODUK** | Komoditas | Max_Harga(Opsional)
     (Contoh: [EXEC: CARI_PRODUK | Cabai | 50000])
     *Sistem mereturn list produk terdekat dengan lokasi user yang mencocokkan stok.*
  3. **CEK_PENGIRIMAN** | ProductID | Jumlah(kg) | Kordinat_Tujuan(opsional)
     (Contoh: [EXEC: CEK_PENGIRIMAN | prod-abc | 4])
     *Mereturn opsi kurir Biteship dari store penjual ke pembeli.*
  4. **CHECKOUT_PESANAN** | ProductID | Jumlah(kg) | Kode_Kurir
     (Contoh: [EXEC: CHECKOUT_PESANAN | prod-abc | 4 | jne_reg])
     *Otomatis menghitung rincian biaya dan menerbitkan link pembayaran Midtrans yang bisa dipencet oleh User di WA.*
  5. **CEK_TOKEN**
  6. **LIHAT_TOKO**
     (Contoh: [EXEC: LIHAT_TOKO])
     *Mengecek apakah user sudah memiliki profil toko (cabang) beserta detail produk yang dijualnya.*

  ### SUMBER DATA & PRIORITAS (WAJIB DIPATUHI)
  1. **DATA TERBARU DARI PIHPS NASIONAL (Bank Indonesia)**: Ini adalah data harga komoditas yang ditarik secara otomatis oleh sistem kami. Gunakan ini sebagai **SUMBER UTAMA** untuk menjawab statistik dan pertanyaan tentang harga.
  2. **INFORMASI DARI DOKUMEN PENGETAHUAN (RAG)**: Ini adalah data arsip dari dokumen/buku lama. Gunakan HANYA jika data PIHPS tidak ada atau jika user bertanya spesifik tentang isi buku tersebut.

  **ATURAN ANTI-HALUSINASI SANGAT PENTING (EMAS)**:
  - JANGAN PERNAH mengarang (halusinasi) "harga hari ini" jika sistem tidak menyisipkan data harga tanggal hari ini di dalam instruksi konteks.
  - Jika data harga hari ini belum tersedia, jelaskan secara jujur dan transparan kepada user bahwa "Data PIHPS untuk hari ini belum rilis/diperbarui", dan berikan data terakhir yang kamu miliki dari sistem.
  - Jika data API tersedia, KAMU HARUS MENGABAIKAN data harga kadaluarsa dari RAG/buku. Jelaskan secara profesional bahwa data yang kamu berikan adalah data resmi terbaru dari PIHPS Bank Indonesia.

  **PENTING: JANGAN PERNAH MENGATAKAN KAMU TIDAK PUNYA AKSES API.** Kamu adalah front-end dari sistem backend yang MENYERTAKAN data PIHPS secara real-time. Jika data tidak muncul di konteks, itu berarti database PIHPS sedang menunggu update dari Bank Indonesia atau data komoditas tersebut memang kosong/tidak ada.

  Gaya bicaramu: Gunakan Bahasa Indonesia yang ramah, ringkas, mudah dipahami masyarakat, pedangan, dan petani. Konfirmasikan aksi yang akan kamu lakukan sebelum menyertakan tag [EXEC].`;


// ─── Main chat function ────────────────────────────────────────────────────

export async function chatWithAI(opts: {
  message: string;
  history: ChatMessage[];
  userId: string;
  whatsappJid?: string;
  useRag?: boolean;
  model?: string;
  imageUrl?: string;
  onChunk?: (chunk: string) => void;
  onPhaseChange?: (phase: string) => void;
}): Promise<{ reply: string; ragSources: string[]; tokensUsed?: number }> {
  let { message, history: providedHistory, userId, whatsappJid, useRag = true, model = AI_MODELS.default, imageUrl, onChunk, onPhaseChange } = opts;

  let ragContext = '';
  const ragSources: string[] = [];

  // Ambil token puter user dari DB (dibutuhkan untuk stage 1 vision)
  const user = await db('users').where({ id: userId }).select('puter_token', 'role').first();
  let activeToken = user?.puter_token;

  // 0. TWO-STAGE VISION PIPELINE (VISION-AS-A-TOOL)
  if (imageUrl && activeToken) {
     if (onPhaseChange) onPhaseChange('[1/2] Menganalisis gambar...');
     try {
         const visionMsgs: ChatMessage[] = [
             { role: 'user', content: [ { type: 'text', text: 'Jelaskan sedetail mungkin apa isi gambar ini untuk membantu analisis pertanian dan komoditas.' }, { type: 'image_url', image_url: { url: imageUrl } } ] as any }
         ];
         // Gunakan Llama Vision statis tanpa stream
         const visionResp = await callPuterAI({ messages: visionMsgs, model: AI_MODELS.vision, apiKey: activeToken });
         ragContext += `\n\n=== HASIL PENGAMATAN GAMBAR ===\n${visionResp.reply}\n=== AKHIR PENGAMATAN ===\n`;
     } catch (err) {
         console.warn(`⚠️ [AI] Gagal melakukan analisis gambar tahap 1:`, (err as Error).message);
     }
  }

  if (onPhaseChange) onPhaseChange('[2/2] Memikirkan jawaban...');

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

  // 3. RAG: Ambil konteks dari dokumen user atau URL jika ada
  if (useRag) {
    // 3.1 Deteksi & Scrape URL jika ada di pesan
    const urlRegex = /(https?:\/\/[^\s]+)/gi;
    const foundUrls = message.match(urlRegex);
    
    if (foundUrls && foundUrls.length > 0) {
        console.log(`🔗 [AI] Detected ${foundUrls.length} URL(s) to scrape...`);
        for (const url of foundUrls) {
            try {
                const webContent = await parseUrl(url);
                ragContext += `\n\n=== ISI WEBSITE: ${url} ===\n${webContent}\n=== AKHIR WEBSITE ===\n`;
                ragSources.push(url);
            } catch (err) {
                console.warn(`⚠️ [AI] Gagal scrape URL: ${url}`, (err as Error).message);
            }
        }
    }

    // 3.2 Pencarian RAG (Vector Search) - Dikurangi ke 2 chunk untuk hemat token
    let chunks = await retrieveRelevantChunks({ query: message, userId, topK: 2 });
    
    // Fallback: Jika pertanyaan sangat pendek/vague (seperti "apa isinya") dan chunks kosong,
    // ambil dokumen terbaru sebagai konteks umum.
    if (chunks.length === 0 && (message.length < 20 || message.toLowerCase().includes('isi') || message.toLowerCase().includes('jelaskan'))) {
        const recentDocs = await db('rag_documents')
            .where({ user_id: userId })
            .orWhere({ is_global: 1 })
            .orderBy('created_at', 'desc')
            .limit(2);
        
        if (recentDocs.length > 0) {
            ragContext += '\n\n=== DOKUMEN PENGETAHUAN TERBARU ===\n' +
                recentDocs.map(d => `[Judul: ${d.title}]\nPreview: ${d.content_preview || 'Tidak ada preview.'}`).join('\n\n') +
                '\n(Gunakan ini jika user bertanya tentang dokumen yang baru saja dikirim atau isi secara umum)\n';
            ragSources.push(...recentDocs.map(d => d.title));
        }
    } else if (chunks.length > 0) {
      ragContext += '\n\n=== INFORMASI DARI DOKUMEN PENGETAHUAN (ARSIP) ===\n' +
        chunks.map(c => `[SUMBER: ${c.docTitle}${c.originalFilename ? ` | FILE: ${c.originalFilename}` : ''}]\n${c.content}`).join('\n\n') +
        '\n=== AKHIR DOKUMEN ===\n';
      ragSources.push(...chunks.map(c => c.docTitle));
    }
  }

  // 4. PRICE GROUNDING: Ambil data harga real-time (Bapanas/BPS)
  const priceContext = await searchCommodityPrices(message);

  // 5. CREDIT GROUNDING: Ambil sisa kredit grup jika di grup
  let creditContext = '';
  if (whatsappJid && whatsappJid.endsWith('@g.us')) {
      const credits = await checkGroupCredit(whatsappJid);
      if (credits.allowed) {
          creditContext = `\n\n=== INFORMASI KREDIT AI GRUP ===\nSisa kredit AI di grup ini: ${Number(credits.balance).toFixed(2)} tokens.\nSetiap pertanyaan AI memotong 0.05 tokens.\nJika sisa kredit menipis atau habis, beritahu user untuk isi ulang di dashboard.`;
      }
  }


  const systemMsg = SYSTEM_PROMPT + 
    (contextSummary ? `\n\n=== RINGKASAN PERCAKAPAN SEBELUMNYA ===\n${contextSummary}\n` : '') +
    (priceContext ? `\n\n=== DATA TERBARU DARI PIHPS NASIONAL (BANK INDONESIA) ===\n${priceContext}\n` : '') +
    creditContext +
    ragContext;

  // Dalam model Two-Stage, model utama (Trinity) dibiarkan buta (hanya menerima string text), 
  // karena hasil mata (Llama API) sudah masuk di ragContext
  const messages: ChatMessage[] = [
    { role: 'system', content: systemMsg },
    ...finalHistory.slice(-4), // Ambil 4 pesan terakhir (hemat token)
    { role: 'user', content: message },
  ];

  try {
    // Bypass untuk admin: Gunakan SYSTEM_PUTER_TOKEN jika user token tidak ada
    if ((!activeToken || activeToken === '') && user?.role === 'admin') {
      activeToken = process.env.SYSTEM_PUTER_TOKEN;
      if (activeToken) console.log(`🛡️ [AI] Admin bypass used for user ${userId}`);
    }

    if (!activeToken) {
      if (userId === 'wa-bot') {
        return { reply: '❌ Fitur AI dimatikan karena sistem menggunakan Bring Your Own Token. Harap login dan hubungkan akun Puter di web.', ragSources: [] };
      }
      return { reply: '❌ Anda belum menghubungkan akun Puter untuk fitur AI. Silakan hubungkan di Pengaturan Chat.', ragSources: [] };
    }

    const response = await callPuterAI({ messages, model, apiKey: activeToken, onChunk });

    return { reply: response.reply, ragSources, tokensUsed: response.tokensUsed };
  } catch (err) {
    const errMsg = (err as Error).message;
    console.error('AI chat error:', errMsg);
    // Timeout spesifik — jangan expose detail teknis ke user
    if (errMsg === 'AI_TIMEOUT') {
      return {
        reply: '⏱️ Maaf, AI sedang sibuk dan tidak merespons. Silakan coba lagi dalam beberapa detik.',
        ragSources: [],
      };
    }
    return {
      reply: 'Maaf, terjadi kesalahan saat menghubungi AI. Token Anda mungkin kadaluarsa. Silakan hubungkan ulang akun Puter Anda.',
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

export async function callPuterAI(opts: {
  messages: ChatMessage[];
  model: string;
  apiKey: string;
  onChunk?: (chunk: string) => void;
}): Promise<{ reply: string; tokensUsed?: number }> {
  const { messages, model, apiKey, onChunk } = opts;
  
  if (!apiKey) throw new Error('Puter API Key (token) is missing');
  
  // Set token untuk request ini
  puter.setAuthToken(apiKey);

  try {
    if (onChunk) {
        // Mode Streaming
        const responseGenerator = await puter.ai.chat(messages, {
            model,
            max_tokens: 1500,
            temperature: 0.7,
            stream: true
        });

        let fullReply = '';
        for await (const part of responseGenerator) {
            const chunkText = (typeof part === 'string') ? part : (part as any)?.text || (part as any)?.message?.content || '';
            if (chunkText) {
                fullReply += chunkText;
                onChunk(chunkText);
            }
        }
        return { reply: fullReply };
    }

    // Mode Standard
    const aiCallPromise = puter.ai.chat(messages, {
        model,
        max_tokens: 1500,
        temperature: 0.7
    });
    const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('AI_TIMEOUT')), 90000)
    );
    const response = await Promise.race([aiCallPromise, timeoutPromise]);

    // SDK v2: ambil text dari berbagai format response
    const reply = (typeof response === 'string') ? response : (response as any).text || (response as any).message?.content || String(response);

    return {
      reply,
      tokensUsed: (response as any).usage?.total_tokens,
    };
  } catch (err) {
    console.error('Puter SDK Error:', (err as Error).message);
    throw err;
  }
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

export async function checkPuterBalance(apiKey: string): Promise<number | null> {
  try {
    puter.setAuthToken(apiKey);
    const usage = await puter.auth.getMonthlyUsage();
    return usage.allowanceInfo.remaining;
  } catch (err) {
    console.error('Puter Balance Error:', (err as Error).message);
    return null;
  }
}

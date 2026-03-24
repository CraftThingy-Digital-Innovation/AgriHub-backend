"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AI_MODELS = void 0;
exports.chatWithAI = chatWithAI;
exports.checkGroupCredit = checkGroupCredit;
exports.deductGroupCredit = deductGroupCredit;
const puter_js_1 = __importDefault(require("@heyputer/puter.js"));
const ragService_1 = require("./ragService");
// ─── Puter.js AI Chat via Official SDK ───────────────────────────────────
// Docs: https://docs.puter.com/AI/chat/
// Model yang direkomendasikan (hemat + kapable)
exports.AI_MODELS = {
    default: 'gpt-4o-mini', // Hemat, cepat, bagus untuk konten pertanian
    advanced: 'claude-3-5-sonnet', // Untuk analisis kompleks
    embedding: 'text-embedding-3-small',
};
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
 
 Gaya bicaramu: Gunakan Bahasa Indonesia yang mudah dipahami petani. Jawab dengan singkat, jelas, dan praktis. 

 ### AKSES DOKUMEN (KNOWLEDGE BASE)
 Anda MEMILIKI akses ke dokumen pengetahuan (PDF/Excel/Teks) yang diunggah pengguna. Konten dokumen tersebut akan muncul di bawah sebagai teks. 
 - Jika Anda melihat bagian "INFORMASI DARI DOKUMEN PENGETAHUAN", gunakan informasi tersebut sedetail mungkin.
 - JANGAN PERNAH mengatakan "Saya tidak dapat mengakses dokumen ini" jika teksnya ada di konteks. 
 - Jika pengguna bertanya "apa isinya?" atau "jelaskan dokumen ini", ringkaslah teks yang Anda lihat di context.

 Jika informasi dari dokumen sudah mencukupi, jangan lagi mengarahkan ke topik umum. Namun jika benar-benar tidak ada info yang relevan sama sekali, baru arahkan kembali ke topik pertanian umum.`;
// ─── Main chat function ────────────────────────────────────────────────────
async function chatWithAI(opts) {
    const { message, history: providedHistory, userId, whatsappJid, useRag = true, model = exports.AI_MODELS.default } = opts;
    let ragContext = '';
    const ragSources = [];
    // 1. Ambil history dari DB jika whatsappJid ada (untuk bot)
    let dbHistory = [];
    if (whatsappJid) {
        const rows = await (0, knex_1.default)('chats')
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
        let chunks = await (0, ragService_1.retrieveRelevantChunks)({ query: message, userId, topK: 4 });
        // Fallback: Jika pertanyaan sangat pendek/vague (seperti "apa isinya") dan chunks kosong,
        // ambil dokumen terbaru sebagai konteks umum.
        if (chunks.length === 0 && (message.length < 20 || message.toLowerCase().includes('isi') || message.toLowerCase().includes('jelaskan'))) {
            const recentDocs = await (0, knex_1.default)('rag_documents')
                .where({ user_id: userId })
                .orWhere({ is_global: 1 })
                .orderBy('created_at', 'desc')
                .limit(2);
            if (recentDocs.length > 0) {
                ragContext = '\n\n=== DOKUMEN TERBARU ANDA ===\n' +
                    recentDocs.map(d => `[Judul: ${d.title}]\nPreview: ${d.content_preview || 'Tidak ada preview.'}`).join('\n\n') +
                    '\n(Gunakan ini jika user bertanya tentang dokumen yang baru saja dikirim atau isi secara umum)\n';
                ragSources.push(...recentDocs.map(d => d.title));
            }
        }
        else if (chunks.length > 0) {
            ragContext = '\n\n=== INFORMASI DARI DOKUMEN PENGETAHUAN ===\n' +
                chunks.map(c => `[${c.docTitle}]\n${c.content}`).join('\n\n') +
                '\n=== AKHIR DOKUMEN ===\n';
            ragSources.push(...chunks.map(c => c.docTitle));
        }
    }
    const systemMsg = SYSTEM_PROMPT +
        (contextSummary ? `\n\n=== RINGKASAN PERCAKAPAN SEBELUMNYA ===\n${contextSummary}\n` : '') +
        ragContext;
    const messages = [
        { role: 'system', content: systemMsg },
        ...finalHistory.slice(-6), // Ambil 6 pesan terakhir sebagai context aktif
        { role: 'user', content: message },
    ];
    try {
        // Ambil token puter user dari DB
        const user = await (0, knex_1.default)('users').where({ id: userId }).select('puter_token').first();
        if (!user || !user.puter_token) {
            if (userId === 'wa-bot') {
                return { reply: '❌ Fitur AI dimatikan karena sistem menggunakan Bring Your Own Token. Harap login dan hubungkan akun Puter di web.', ragSources: [] };
            }
            return { reply: '❌ Anda belum menghubungkan akun Puter untuk fitur AI. Silakan hubungkan di Pengaturan Chat.', ragSources: [] };
        }
        const response = await callPuterAI({ messages, model, apiKey: user.puter_token });
        return { reply: response.reply, ragSources, tokensUsed: response.tokensUsed };
    }
    catch (err) {
        console.error('AI chat error:', err);
        return {
            reply: 'Maaf, terjadi kesalahan saat menghubungi AI Puter. Token Anda mungkin kadaluarsa. Silakan hubungkan ulang akun Puter Anda. ' + err.message,
            ragSources: [],
        };
    }
}
async function summarizeChat(history, userId) {
    try {
        const user = await (0, knex_1.default)('users').where({ id: userId }).select('puter_token').first();
        if (!user || !user.puter_token)
            return '';
        const summaryResponse = await callPuterAI({
            apiKey: user.puter_token,
            model: exports.AI_MODELS.default,
            messages: [
                { role: 'system', content: 'Ringkas percakapan berikut dalam maksimal 3 kalimat padat yang mencakup poin-poin penting agar AI bisa melanjutkan konteksnya.' },
                ...history,
                { role: 'user', content: 'Tolong ringkas percakapan di atas.' }
            ]
        });
        return summaryResponse.reply;
    }
    catch (err) {
        console.error('Summarization error:', err);
        return '';
    }
}
async function callPuterAI(opts) {
    const { messages, model, apiKey } = opts;
    if (!apiKey)
        throw new Error('Puter API Key (token) is missing');
    // Set token untuk request ini
    puter_js_1.default.setAuthToken(apiKey);
    try {
        const response = await puter_js_1.default.ai.chat(messages, {
            model,
            max_tokens: 1500,
            temperature: 0.7
        });
        // SDK v2 mengembalikan ChatResponse yang bisa langsung di-string-kan atau diakses propertinya
        // Jika response adalah object, kita ambil text-nya
        const reply = (typeof response === 'string') ? response : response.text || response.message?.content || String(response);
        return {
            reply,
            tokensUsed: response.usage?.total_tokens,
        };
    }
    catch (err) {
        console.error('Puter SDK Error:', err);
        throw err;
    }
}
// ─── Fallback response generator (dev mode / no API key) ─────────────────
function generateFallbackReply(message) {
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
const knex_1 = __importDefault(require("../config/knex"));
async function checkGroupCredit(groupJid) {
    const group = await (0, knex_1.default)('group_credits').where({ group_jid: groupJid }).first();
    if (!group)
        return { allowed: false, balance: 0, reason: 'Grup belum diaktifkan AI. Pemilik grup harus isi kredit dulu.' };
    if (!group.is_ai_enabled)
        return { allowed: false, balance: group.credits_balance, reason: 'AI di grup ini nonaktif.' };
    if (group.credits_balance <= 0)
        return { allowed: false, balance: 0, reason: 'Kredit grup habis. Pemilik grup perlu isi ulang.' };
    return { allowed: true, balance: group.credits_balance };
}
async function deductGroupCredit(groupJid, amount = 0.1) {
    await (0, knex_1.default)('group_credits').where({ group_jid: groupJid }).decrement('credits_balance', amount).increment('credits_used', amount);
}
//# sourceMappingURL=aiService.js.map
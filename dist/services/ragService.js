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
exports.chunkText = chunkText;
exports.storeDocument = storeDocument;
exports.retrieveRelevantChunks = retrieveRelevantChunks;
exports.getUserDocuments = getUserDocuments;
exports.deleteDocument = deleteDocument;
exports.isDuplicateDocument = isDuplicateDocument;
const knex_1 = __importDefault(require("../config/knex"));
const uuid_1 = require("uuid");
// ─── Simple cosine similarity for in-DB embedding retrieval ──────────────
function cosineSimilarity(a, b) {
    if (a.length !== b.length)
        return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}
// ─── Naive text embedding (TF-IDF-like word frequency vector) ────────────
// Digunakan ketika tidak ada embedding model external.
// Di prod bisa diganti dgn puter.ai embedding atau openai.
function buildVocab(texts) {
    const vocab = new Set();
    for (const text of texts) {
        for (const word of tokenize(text))
            vocab.add(word);
    }
    return Array.from(vocab);
}
function tokenize(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2);
}
function textToVector(text, vocab) {
    const words = tokenize(text);
    const freq = {};
    for (const w of words)
        freq[w] = (freq[w] || 0) + 1;
    return vocab.map(v => freq[v] || 0);
}
// ─── Chunk text into ~500-char pieces ────────────────────────────────────
function chunkText(text, chunkSize = 800, overlap = 100) {
    const chunks = [];
    let i = 0;
    while (i < text.length) {
        chunks.push(text.slice(i, i + chunkSize));
        i += chunkSize - overlap;
    }
    return chunks.filter(c => c.trim().length > 50);
}
// ─── Store document chunks with embeddings ───────────────────────────────
async function storeDocument(opts) {
    const { userId, title, sourceType, sourceUrl, content, isGlobal, fileHash, fileSize, originalFilename } = opts;
    const chunks = chunkText(content);
    const docId = (0, uuid_1.v4)();
    const now = new Date().toISOString();
    await (0, knex_1.default)('rag_documents').insert({
        id: docId,
        user_id: userId,
        title,
        source_type: sourceType,
        source_url: sourceUrl || null,
        content_preview: content.slice(0, 300),
        chunk_count: chunks.length,
        is_global: isGlobal ? 1 : 0,
        file_hash: fileHash || null,
        file_size: fileSize || null,
        original_filename: originalFilename || null,
        created_at: now,
        updated_at: now,
    });
    // Build vocab from all chunks untuk normalisasi vektor
    const vocab = buildVocab(chunks);
    const chunkRows = chunks.map((chunk, idx) => ({
        id: (0, uuid_1.v4)(),
        document_id: docId,
        chunk_index: idx,
        content: chunk,
        embedding: JSON.stringify(textToVector(chunk, vocab)),
        created_at: now,
    }));
    // Insert in batches of 50
    for (let i = 0; i < chunkRows.length; i += 50) {
        await (0, knex_1.default)('rag_chunks').insert(chunkRows.slice(i, i + 50));
    }
    return docId;
}
// ─── Retrieve top-K relevant chunks for a query ──────────────────────────
async function retrieveRelevantChunks(opts) {
    const { query, userId, topK = 5 } = opts;
    // Get all accessible chunks (user's own + global)
    const chunks = await (0, knex_1.default)('rag_chunks')
        .join('rag_documents', 'rag_chunks.document_id', 'rag_documents.id')
        .where(function () {
        this.where('rag_documents.user_id', userId)
            .orWhere('rag_documents.is_global', 1);
    })
        .select('rag_chunks.content', 'rag_chunks.embedding', 'rag_documents.title as docTitle', 'rag_documents.original_filename as originalFilename');
    if (chunks.length === 0)
        return [];
    // Build shared vocab from all chunk contents + query
    const allTexts = chunks.map((c) => c.content).concat([query]);
    const vocab = buildVocab(allTexts);
    const queryVec = textToVector(query, vocab);
    // Score each chunk
    const scored = chunks.map((chunk) => {
        let chunkVec;
        try {
            chunkVec = JSON.parse(chunk.embedding);
            // Rebuild if vocab size mismatch
            if (chunkVec.length !== vocab.length) {
                chunkVec = textToVector(chunk.content, vocab);
            }
        }
        catch {
            chunkVec = textToVector(chunk.content, vocab);
        }
        return {
            content: chunk.content,
            score: cosineSimilarity(queryVec, chunkVec),
            docTitle: chunk.docTitle,
            originalFilename: chunk.originalFilename,
        };
    });
    return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .filter((c) => c.score > 0.01);
}
// ─── Get documents for a user ─────────────────────────────────────────────
async function getUserDocuments(userId) {
    return (0, knex_1.default)('rag_documents')
        .where(function () {
        this.where({ user_id: userId }).orWhere({ is_global: 1 });
    })
        .orderBy('created_at', 'desc')
        .select('id', 'title', 'original_filename', 'source_type', 'chunk_count', 'is_global', 'content_preview', 'created_at');
}
async function deleteDocument(docId, userId, puterToken) {
    const doc = await (0, knex_1.default)('rag_documents').where({ id: docId, user_id: userId }).first();
    if (!doc)
        return false;
    // Hapus dari Puter FS jika token tersedia dan file original tercatat
    if (puterToken && doc.original_filename) {
        try {
            // Dynamic import to avoid circular dependencies
            const puter = (await Promise.resolve().then(() => __importStar(require('@heyputer/puter.js')))).default;
            puter.setAuthToken(puterToken);
            await puter.fs.delete(`/AgriHub_Docs/${userId}/${doc.original_filename}`).catch(() => { });
        }
        catch (err) { }
    }
    await (0, knex_1.default)('rag_chunks').where({ document_id: docId }).del();
    await (0, knex_1.default)('rag_documents').where({ id: docId }).del();
    return true;
}
async function isDuplicateDocument(userId, title, fileHash, fileSize) {
    const existing = await (0, knex_1.default)('rag_documents')
        .where({
        user_id: userId,
        title,
        file_hash: fileHash,
        file_size: fileSize
    })
        .first();
    return !!existing;
}
//# sourceMappingURL=ragService.js.map
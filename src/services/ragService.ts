import db from '../config/knex';
import { v4 as uuidv4 } from 'uuid';

// ─── Simple cosine similarity for in-DB embedding retrieval ──────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
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

function buildVocab(texts: string[]): string[] {
  const vocab = new Set<string>();
  for (const text of texts) {
    for (const word of tokenize(text)) vocab.add(word);
  }
  return Array.from(vocab);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
}

function textToVector(text: string, vocab: string[]): number[] {
  const words = tokenize(text);
  const freq: Record<string, number> = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  return vocab.map(v => freq[v] || 0);
}

// ─── Chunk text into ~500-char pieces ────────────────────────────────────

export function chunkText(text: string, chunkSize = 800, overlap = 100): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + chunkSize));
    i += chunkSize - overlap;
  }
  return chunks.filter(c => c.trim().length > 50);
}

// ─── Store document chunks with embeddings ───────────────────────────────

export async function storeDocument(opts: {
  userId: string;
  title: string;
  sourceType: 'pdf' | 'docx' | 'xlsx' | 'url' | 'youtube' | 'text' | 'image';
  sourceUrl?: string;
  content: string;
  isGlobal?: boolean;
  fileHash?: string;
  fileSize?: number;
  originalFilename?: string;
}): Promise<string> {
  const { userId, title, sourceType, sourceUrl, content, isGlobal, fileHash, fileSize, originalFilename } = opts;
  const chunks = chunkText(content);

  const docId = uuidv4();
  const now = new Date().toISOString();

  await db('rag_documents').insert({
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
    id: uuidv4(),
    document_id: docId,
    chunk_index: idx,
    content: chunk,
    embedding: JSON.stringify(textToVector(chunk, vocab)),
    created_at: now,
  }));

  // Insert in batches of 50
  for (let i = 0; i < chunkRows.length; i += 50) {
    await db('rag_chunks').insert(chunkRows.slice(i, i + 50));
  }

  return docId;
}

// ─── Retrieve top-K relevant chunks for a query ──────────────────────────

export async function retrieveRelevantChunks(opts: {
  query: string;
  userId: string;
  topK?: number;
}): Promise<{ content: string; score: number; docTitle: string; originalFilename?: string }[]> {
  const { query, userId, topK = 5 } = opts;

  // Get all accessible chunks (user's own + global)
  const chunks = await db('rag_chunks')
    .join('rag_documents', 'rag_chunks.document_id', 'rag_documents.id')
    .where(function () {
      this.where('rag_documents.user_id', userId)
        .orWhere('rag_documents.is_global', 1);
    })
    .select(
      'rag_chunks.content',
      'rag_chunks.embedding',
      'rag_documents.title as docTitle',
      'rag_documents.original_filename as originalFilename'
    );

  if (chunks.length === 0) return [];

  // Build shared vocab from all chunk contents + query
  const allTexts = chunks.map((c: any) => c.content).concat([query]);
  const vocab = buildVocab(allTexts);
  const queryVec = textToVector(query, vocab);

  // Score each chunk
  const scored = chunks.map((chunk: any) => {
    let chunkVec: number[];
    try {
      chunkVec = JSON.parse(chunk.embedding);
      // Rebuild if vocab size mismatch
      if (chunkVec.length !== vocab.length) {
        chunkVec = textToVector(chunk.content, vocab);
      }
    } catch {
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
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, topK)
    .filter((c: any) => c.score > 0.01);
}

// ─── Get documents for a user ─────────────────────────────────────────────

export async function getUserDocuments(userId: string) {
  return db('rag_documents')
    .where(function () {
      this.where({ user_id: userId }).orWhere({ is_global: 1 });
    })
    .orderBy('created_at', 'desc')
    .select('id', 'title', 'original_filename', 'source_type', 'chunk_count', 'is_global', 'content_preview', 'created_at');
}

export async function deleteDocument(docId: string, userId: string, puterToken?: string): Promise<boolean> {
  const doc = await db('rag_documents').where({ id: docId, user_id: userId }).first();
  if (!doc) return false;

  // Hapus dari Puter FS jika token tersedia dan file original tercatat
  if (puterToken && doc.original_filename) {
      try {
          // Dynamic import to avoid circular dependencies
          const puter = (await import('@heyputer/puter.js')).default;
          puter.setAuthToken(puterToken);
          await puter.fs.delete(`/AgriHub_Docs/${userId}/${doc.original_filename}`).catch(() => {});
      } catch (err) {}
  }

  await db('rag_chunks').where({ document_id: docId }).del();
  await db('rag_documents').where({ id: docId }).del();
  return true;
}

export async function isDuplicateDocument(userId: string, title: string, fileHash: string, fileSize: number): Promise<boolean> {
  const existing = await db('rag_documents')
    .where({ 
      user_id: userId, 
      title, 
      file_hash: fileHash, 
      file_size: fileSize 
    })
    .first();
  return !!existing;
}

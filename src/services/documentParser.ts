import fs from 'fs';
import path from 'path';
import axios from 'axios';

// ─── PDF Parser ────────────────────────────────────────────────────────────

export async function parsePdf(filePath: string): Promise<string> {
  try {
    // Dynamic import karena pdf-parse bisa gagal saat build
    const pdfParse = (await import('pdf-parse')).default;
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  } catch (err) {
    console.error('PDF parse error:', err);
    throw new Error('Gagal membaca file PDF');
  }
}

// ─── XLSX / CSV Parser ─────────────────────────────────────────────────────

export async function parseXlsx(filePath: string): Promise<string> {
  try {
    const XLSX = await import('xlsx');
    const workbook = XLSX.readFile(filePath);
    const lines: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      lines.push(`=== Sheet: ${sheetName} ===\n${csv}`);
    }
    return lines.join('\n\n');
  } catch (err) {
    console.error('XLSX parse error:', err);
    throw new Error('Gagal membaca file Excel');
  }
}

// ─── URL / Web Scraper ─────────────────────────────────────────────────────

export async function parseUrl(url: string): Promise<string> {
  try {
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 AgriHub-Bot/1.0' },
      timeout: 15000,
    });
    // Strip HTML tags dengan regex sederhana
    const text = data
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.slice(0, 50000); // Limit 50k char
  } catch (err) {
    console.error('URL scrape error:', err);
    throw new Error(`Gagal mengambil konten dari URL: ${url}`);
  }
}

// ─── YouTube Transcript ────────────────────────────────────────────────────

export async function parseYouTube(videoUrl: string): Promise<string> {
  try {
    // Extract video ID
    const match = videoUrl.match(/(?:v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    if (!match) throw new Error('URL YouTube tidak valid');
    const videoId = match[1];

    // Ambil transcript via timedtext API (unofficial, works for auto-captions)
    const langCodes = ['id', 'en'];
    for (const lang of langCodes) {
      try {
        const { data } = await axios.get(
          `https://www.youtube.com/api/timedtext?lang=${lang}&v=${videoId}&fmt=json3`,
          { timeout: 10000 }
        );
        if (data?.events) {
          const transcript = data.events
            .filter((e: {segs?: {utf8?: string}[]}) => e.segs)
            .map((e: {segs: {utf8?: string}[]}) => e.segs.map((s) => s.utf8 || '').join(''))
            .join(' ');
          if (transcript.trim().length > 50) {
            return `[YouTube Transcript - ${videoId}]\n\n${transcript}`;
          }
        }
      } catch { /* try next lang */ }
    }

    // Fallback: scrape video page for description
    const { data: pageHtml } = await axios.get(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000,
    });
    const descMatch = pageHtml.match(/"description":{"simpleText":"([^"]+)"/);
    if (descMatch) return `[YouTube Video Description]\n\n${descMatch[1]}`;

    throw new Error('Tidak bisa mengambil transcript YouTube');
  } catch (err) {
    throw new Error(`Gagal parse YouTube: ${(err as Error).message}`);
  }
}

// ─── Plain Text ────────────────────────────────────────────────────────────

export function parseText(content: string): string {
  return content.trim();
}

// ─── Auto-detect & parse by file extension ────────────────────────────────

export async function parseFile(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.pdf': return parsePdf(filePath);
    case '.xlsx':
    case '.xls':
    case '.csv': return parseXlsx(filePath);
    case '.txt':
    case '.md': return parseText(fs.readFileSync(filePath, 'utf-8'));
    default: throw new Error(`Format file tidak didukung: ${ext}`);
  }
}

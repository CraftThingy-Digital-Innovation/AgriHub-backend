import axios from 'axios';
import db from '../config/knex';

const BAPANAS_URL = 'https://panelharga.badanpangan.go.id/data-harian.json';
const BPS_BASE_URL = 'https://webapi.bps.go.id/v1/api';

export interface CommodityPrice {
  name: string;
  price: number;
  unit: string;
  date: string;
  source: string;
  location?: string;
}

/**
 * Mendapatkan harga pangan harian dari Badan Pangan Nasional (Bapanas)
 */
export async function getRealTimePrices(commodityName: string): Promise<CommodityPrice[]> {
  try {
    const response = await axios.get(BAPANAS_URL, { timeout: 5000 });
    
    // Antispasi jika maintenance (HTML returned instead of JSON)
    if (typeof response.data === 'string' && response.data.includes('Pemeliharaan')) {
        console.warn('⚠️ Bapanas Price Panel is under maintenance.');
        return [];
    }

    const data = response.data;
    // TBD: Parse Bapanas JSON structure properly based on actual successful response
    // Sementara kita return kosong atau mock jika mencari komoditas spesifik
    console.log('📡 Bapanas Data Fetched:', data);
    
    return []; 
  } catch (error) {
    console.error('❌ Error fetching Bapanas prices:', (error as Error).message);
    return [];
  }
}

/**
 * Mendapatkan statistik khusus (SDGs/SDDS/Indikator) dari BPS
 */
export async function getBPSStrategicIndicators(): Promise<string> {
    const apiKey = process.env.BPS_API_KEY;
    if (!apiKey) return "";

    try {
        const res = await axios.get(`${BPS_BASE_URL}/list/model/indicators/lang/ind/domain/0000/key/${apiKey}`, { timeout: 5000 });
        if (res.data.status !== 'OK' || !res.data.data || !res.data.data[1]) return "";

        const data = res.data.data[1];
        // Ambil 5 indikator strategis terbaru (biasanya NTP, Inflasi, Pertumbuhan Ekonomi)
        let text = "=== INDIKATOR STRATEGIS NASIONAL (BPS) ===\n";
        data.slice(0, 5).forEach((item: any) => {
            text += `• ${item.title}: ${item.value} ${item.unit}\n  (Sumber: ${item.data_source})\n`;
        });
        return text;
    } catch (error) {
        console.error('❌ BPS Indicators Error:', (error as Error).message);
        return "";
    }
}

/**
 * Mendapatkan statistik dari BPS (Badan Pusat Statistik)
 * Membutuhkan BPS_API_KEY di .env
 */
export async function getBPSStatistics(commodity: string): Promise<any> {
    const apiKey = process.env.BPS_API_KEY;
    if (!apiKey) {
        console.warn('⚠️ BPS_API_KEY is not set in environment variables.');
        return null;
    }

    try {
        // Contoh pemanggilan: List subject untuk mencari ID yang relevan
        // Dokumentasi: https://webapi.bps.go.id/developer
        const response = await axios.get(`${BPS_BASE_URL}/list/model/subject/lang/ind/key/${apiKey}`, { timeout: 5000 });
        return response.data;
    } catch (error) {
        console.error('❌ BPS API Error:', (error as Error).message);
        return null;
    }
}

/**
 * Fungsi pembantu untuk AI: Mencari info harga dari tabel pihps_prices (Data Bank Indonesia)
 * Secara dinamis mengekstrak nama komoditas apa saja yang dibicarakan dari DB menggunakan pencocokan Array.some().
 */
export async function searchCommodityPrices(query: string): Promise<string> {
    const lowerQuery = query.toLowerCase();

    try {
        // 1. Ambil tanggal rilis data yang paling akhir
        const latestRow = await db('pihps_prices').max('date as maxDate').first();
        if (!latestRow || !latestRow.maxDate) {
            return `(Sistem: Database PIHPS masih kosong, belum ada data tersinkronisasi.)`;
        }
        const date = latestRow.maxDate as string;

        // 2. Ambil komoditas unik khusus di tanggal tersebut
        const rows = await db('pihps_prices').where('date', date).distinct('commodity_name');
        const allCommodities: string[] = rows.map((r: any) => String(r.commodity_name).toLowerCase().trim());

        // 3. Normalisasi alias (cabe -> cabai, brambang -> bawang, padi/gabah -> beras)
        const queryWithAlias = lowerQuery
            .replace(/\bcabe\b|\blombok\b/g, 'cabai')
            .replace(/\bbrambang\b/g, 'bawang')
            .replace(/\bpadi\b|\bgabah\b/g, 'beras');

        // Buang stop-words agar tidak salah cocok ("harga", "di", "kota", dsb)
        const stopWords = ['harga', 'di', 'dari', 'ke', 'untuk', 'pada', 'update', 'hari', 'ini', 'provinsi', 'kabupaten', 'kota', 'dong', 'cek', 'info', 'informasi', 'terbaru'];
        const queryWords = queryWithAlias
            .replace(/[^a-z0-9 ]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2 && !stopWords.includes(w));

        // 4. Lakukan pencocokan otomatis dengan .some()! 
        // Jika kata dari user ada di dalam nama komoditas atau sebaliknya
        const matchedCommodities = allCommodities.filter(comm => 
            queryWords.some(word => comm.includes(word) || word.includes(comm))
        );

        if (matchedCommodities.length === 0) return ""; 

        // 5. Tarik data berdasarkan komoditas-komoditas yang cocok
        const prices = await db('pihps_prices')
            .where('date', date)
            .whereIn('commodity_name', rows
                .filter((r: any) => matchedCommodities.includes(String(r.commodity_name).toLowerCase().trim()))
                .map((r: any) => r.commodity_name)
            )
            .select('prov_name', 'commodity_name', 'price')
            .avg('price as aggregate_price')
            .groupBy('prov_name', 'commodity_name', 'price')
            .orderBy('prov_name');

        if (prices.length === 0) return "";

        // 6. Cek Spesifikasi Wilayah di string query
        // Cek provinsi apa saja yang ada di database
        const provRows = await db('pihps_prices').distinct('prov_name');
        const allProvinces = provRows.map((r: any) => String(r.prov_name).toLowerCase());
        
        let targetedProvince = "";
        for (const prov of allProvinces) {
            if (lowerQuery.includes(prov)) {
                targetedProvince = prov;
                break;
            }
        }

        let dataToFormat = prices;
        if (targetedProvince) {
            const filtered = prices.filter(p => String(p.prov_name).toLowerCase() === targetedProvince);
            if (filtered.length > 0) dataToFormat = filtered;
        } else {
             // Jika tidak sebut provinsi, hitung AGREGAT RATA-RATA NASIONAL (per komoditas)
             const natAvg: Record<string, { sum: number, count: number }> = {};
             prices.forEach(p => {
                 if (!natAvg[p.commodity_name]) natAvg[p.commodity_name] = { sum: 0, count: 0 };
                 natAvg[p.commodity_name].sum += Number(p.aggregate_price || p.price);
                 natAvg[p.commodity_name].count++;
             });
             
             let text = `=== DATA HARGA NASIONAL PIHPS (BANK INDONESIA) ===\n`;
             for (const [cName, stat] of Object.entries(natAvg)) {
                 const avgPrice = Math.round(stat.sum / stat.count);
                 text += `• [${date}] ${cName}: Rp ${avgPrice.toLocaleString('id-ID')}/Kg (Rata-rata Nasional)\n`;
             }
             text += `\n(AI Instruction: Gunakan data rata-rata nasional di atas yang paling cocok dengan pertanyaan user)`;
             return text;
        }

        // Output format jika ada provinsi spesifik
        let text = `=== DATA HARGA PIHPS DARI BANK INDONESIA (PROVINSI ${targetedProvince.toUpperCase()}) ===\n`;
        for (const p of dataToFormat) {
            text += `• [${date}] ${p.commodity_name}: Rp ${Number(p.aggregate_price || p.price).toLocaleString('id-ID')}/Kg\n`;
        }
        return text;

    } catch (error) {
        console.error('❌ PIHPS DB Search Error:', (error as Error).message);
        return `(Sistem: Gangguan koneksi database saat mencari data harga)`;
    }
}


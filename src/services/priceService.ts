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
 * Fungsi pembantu untuk AI: Mencari info harga dari BPS secara dinamis
 */
export async function searchCommodityPrices(query: string): Promise<string> {
    const apiKey = process.env.BPS_API_KEY;
    if (!apiKey) return "(Sistem: BPS_API_KEY belum dikonfigurasi)";

    const lowerQuery = query.toLowerCase();

    // 1. Jika tanya NTP, arahkan ke indikator strategis
    if (lowerQuery.includes('ntp') || lowerQuery.includes('nilai tukar petani')) {
        return await getBPSStrategicIndicators();
    }

    // 2. Mapping keyword untuk pencarian BPS
    const keywordMap: Record<string, string> = {
        'cabe': 'cabai', 'lombok': 'cabai',
        'brambang': 'bawang merah', 'bawang': 'bawang',
        'beras': 'beras', 'telur': 'telur', 'daging': 'daging',
        'minyak': 'minyak goreng', 'gula': 'gula pasir',
        'padi': 'padi', 'jagung': 'jagung', 'kedelai': 'kedelai'
    };

    let searchKeyword = "";
    for (const [key, val] of Object.entries(keywordMap)) {
        if (lowerQuery.includes(key)) {
            searchKeyword = val;
            break;
        }
    }

    if (!searchKeyword) return "";

    try {
        console.log(`🔍 Searching BPS for: ${searchKeyword}...`);
        const searchRes = await axios.get(`${BPS_BASE_URL}/list/model/var/lang/ind/domain/0000/key/${apiKey}`, {
            params: { keyword: searchKeyword },
            timeout: 5000
        });

        if (searchRes.data.status !== 'OK' || !searchRes.data.data || !searchRes.data.data[1] || searchRes.data.data[1].length === 0) {
            return `(Sistem: BPS tidak memiliki data statistik terbaru untuk "${searchKeyword}")`;
        }

        // Ambil max 3 variabel yang paling relevan
        const vars = searchRes.data.data[1]
            .filter((v: any) => v.title.toLowerCase().includes('harga') || v.title.toLowerCase().includes(searchKeyword))
            .slice(0, 3);

        if (vars.length === 0) return "";

        let groundingText = `=== DATA STATISTIK BPS: ${searchKeyword.toUpperCase()} ===\n`;

        for (const variable of vars) {
            const varId = variable.var_id;
            const varTitle = variable.title;
            const unit = variable.unit || '';

            // Coba ambil data tahun terbaru
            const currentYear = new Date().getFullYear();
            const years = [currentYear, currentYear - 1, currentYear - 2];
            let foundVal = "";
            let dataYear = "";

            for (const th of years) {
                try {
                    const dataRes = await axios.get(`${BPS_BASE_URL}/list/model/data/lang/ind/domain/0000/var/${varId}/key/${apiKey}/th/${th}`, {
                        timeout: 3000
                    });

                    if (dataRes.data.status === 'OK' && dataRes.data.datacontent) {
                        const content = dataRes.data.datacontent;
                        const vervars = dataRes.data.vervar || [];
                        
                        // Cari ID untuk "INDONESIA" (9999)
                        let indonesiaId = "9999"; 
                        const idnEntry = vervars.find((v: any) => v.label.toUpperCase() === 'INDONESIA');
                        if (idnEntry) indonesiaId = idnEntry.val.toString();

                        // Key format: [vervar][var][turvar][th][turth]
                        const targetPrefix = `${indonesiaId}${varId}`;
                        const matchingKey = Object.keys(content).find(k => k.startsWith(targetPrefix));
                        
                        if (matchingKey) {
                            foundVal = content[matchingKey];
                            dataYear = th.toString();
                            break;
                        } else {
                            // Fallback: ambil value pertama
                            const firstKey = Object.keys(content)[0];
                            if (firstKey) {
                                foundVal = content[firstKey];
                                dataYear = th.toString();
                                break;
                            }
                        }
                    }
                } catch { continue; }
            }

            if (foundVal) {
                groundingText += `• ${varTitle}\n  Nilai (Nasional): ${foundVal} ${unit} (Tahun ${dataYear})\n`;
            } else {
                groundingText += `• ${varTitle}\n  Status: Data tabel tersedia, namun belum terbit di API periode terbaru.\n`;
            }
        }

        groundingText += `\n(Gunakan data tahunan di atas sebagai referensi statistik resmi. Jika user bertanya harga hari ini, sampaikan bahwa ini adalah angka resmi terakhir).\n`;
        return groundingText;

    } catch (error) {
        console.error('❌ BPS Search Error:', (error as Error).message);
        return `(Sistem: Gangguan koneksi ke BPS API saat mencari data "${searchKeyword}")`;
    }
}

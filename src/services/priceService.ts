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

    // Mapping keyword untuk pencarian BPS yang lebih akurat
    const keywordMap: Record<string, string> = {
        'cabe': 'cabai',
        'lombok': 'cabai',
        'brambang': 'bawang merah',
        'bawang': 'bawang',
        'beras': 'beras',
        'telur': 'telur',
        'daging': 'daging',
        'minyak': 'minyak goreng',
        'gula': 'gula pasir'
    };

    let searchKeyword = "";
    const lowerQuery = query.toLowerCase();
    
    for (const [key, val] of Object.entries(keywordMap)) {
        if (lowerQuery.includes(key)) {
            searchKeyword = val;
            break;
        }
    }

    if (!searchKeyword) return "";

    try {
        // 1. Cari Variable ID di BPS
        console.log(`🔍 Searching BPS for: ${searchKeyword}...`);
        const searchRes = await axios.get(`${BPS_BASE_URL}/list/model/var/lang/ind/domain/0000/key/${apiKey}`, {
            params: { keyword: searchKeyword },
            timeout: 5000
        });

        if (searchRes.data.status !== 'OK' || !searchRes.data.data || !searchRes.data.data[1] || searchRes.data.data[1].length === 0) {
            return `(Sistem: BPS tidak memiliki variabel statistik khusus untuk "${searchKeyword}")`;
        }

        // Ambil 2 variabel pertama agar AI punya konteks lebih luas
        const vars = searchRes.data.data[1].slice(0, 2);
        let groundingText = `=== DATA STATISTIK BPS: ${searchKeyword.toUpperCase()} ===\n`;

        for (const variable of vars) {
            const varId = variable.var_id;
            const varTitle = variable.title;
            const unit = variable.unit || 'satuan tidak diketahui';

            // 2. Ambil data (coba range tahun)
            const yearsToTry = [new Date().getFullYear(), new Date().getFullYear() - 1, 2022];
            let dataFound = false;

            for (const th of yearsToTry) {
                try {
                    const dataRes = await axios.get(`${BPS_BASE_URL}/list/model/data/lang/ind/domain/0000/var/${varId}/key/${apiKey}/th/${th}`, {
                        timeout: 4000
                    });

                    if (dataRes.data.status === 'OK' && dataRes.data.datacontent) {
                        const content = dataRes.data.datacontent;
                        // Ambil 3 sampel data pertama (biasanya Nasional atau wilayah utama)
                        const samples = Object.values(content).slice(0, 3);
                        const sampleText = samples.length > 0 ? `Sampel nilai: ${samples.join(', ')}` : 'Detail nilai wilayah belum tersedia.';
                        
                        groundingText += `• [ID:${varId}] ${varTitle} (${unit})\n  Tahun: ${th}\n  Status: Tersedia\n  ${sampleText}\n`;
                        dataFound = true;
                        break;
                    }
                } catch { continue; }
            }

            if (!dataFound) {
                groundingText += `• [ID:${varId}] ${varTitle}\n  Status: Metadata tersedia, namun data detail tahun terbaru belum rilis di API.\n`;
            }
        }

        groundingText += `\n(Gunakan data di atas sebagai referensi statistik utama. Jika user bertanya harga "hari ini" dan data di atas adalah data tahun lalu, sampaikan bahwa ini adalah data statistik resmi terakhir dari BPS).\n`;
        return groundingText;

    } catch (error) {
        console.error('❌ BPS Search Error:', (error as Error).message);
        return `(Sistem: Gangguan koneksi ke BPS API saat mencari data "${searchKeyword}")`;
    }
}

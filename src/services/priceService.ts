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
 * Fungsi pembantu untuk AI: Mencari info harga tergabung
 */
export async function searchCommodityPrices(query: string): Promise<string> {
    const commodities = ['cabai', 'beras', 'bawang', 'telur', 'daging', 'minyak', 'gula'];
    const matched = commodities.find(c => query.toLowerCase().includes(c));
    
    if (!matched) return "";

    const prices = await getRealTimePrices(matched);
    if (prices.length > 0) {
        return `Data Harga Bapanas (${matched}): ` + prices.map(p => `${p.name}: Rp${p.price}/${p.unit}`).join(', ');
    }

    return `(Sistem: Gagal mengambil data real-time, sampaikan ke user bahwa sumber data Bapanas sedang maintenance)`;
}

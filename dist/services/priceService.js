"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRealTimePrices = getRealTimePrices;
exports.getBPSStatistics = getBPSStatistics;
exports.searchCommodityPrices = searchCommodityPrices;
const axios_1 = __importDefault(require("axios"));
const BAPANAS_URL = 'https://panelharga.badanpangan.go.id/data-harian.json';
const BPS_BASE_URL = 'https://webapi.bps.go.id/v1/api';
/**
 * Mendapatkan harga pangan harian dari Badan Pangan Nasional (Bapanas)
 */
async function getRealTimePrices(commodityName) {
    try {
        const response = await axios_1.default.get(BAPANAS_URL, { timeout: 5000 });
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
    }
    catch (error) {
        console.error('❌ Error fetching Bapanas prices:', error.message);
        return [];
    }
}
/**
 * Mendapatkan statistik dari BPS (Badan Pusat Statistik)
 * Membutuhkan BPS_API_KEY di .env
 */
async function getBPSStatistics(commodity) {
    const apiKey = process.env.BPS_API_KEY;
    if (!apiKey) {
        console.warn('⚠️ BPS_API_KEY is not set in environment variables.');
        return null;
    }
    try {
        // Contoh pemanggilan: List subject untuk mencari ID yang relevan
        // Dokumentasi: https://webapi.bps.go.id/developer
        const response = await axios_1.default.get(`${BPS_BASE_URL}/list/model/subject/lang/ind/key/${apiKey}`, { timeout: 5000 });
        return response.data;
    }
    catch (error) {
        console.error('❌ BPS API Error:', error.message);
        return null;
    }
}
/**
 * Fungsi pembantu untuk AI: Mencari info harga tergabung
 */
async function searchCommodityPrices(query) {
    const commodities = ['cabai', 'beras', 'bawang', 'telur', 'daging', 'minyak', 'gula'];
    const matched = commodities.find(c => query.toLowerCase().includes(c));
    if (!matched)
        return "";
    const prices = await getRealTimePrices(matched);
    if (prices.length > 0) {
        return `Data Harga Bapanas (${matched}): ` + prices.map(p => `${p.name}: Rp${p.price}/${p.unit}`).join(', ');
    }
    return `(Sistem: Gagal mengambil data real-time, sampaikan ke user bahwa sumber data Bapanas sedang maintenance)`;
}
//# sourceMappingURL=priceService.js.map
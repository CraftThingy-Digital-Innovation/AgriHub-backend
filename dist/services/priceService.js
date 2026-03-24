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
 * Fungsi pembantu untuk AI: Mencari info harga dari BPS secara dinamis
 */
async function searchCommodityPrices(query) {
    const apiKey = process.env.BPS_API_KEY;
    if (!apiKey)
        return "(Sistem: BPS_API_KEY belum dikonfigurasi)";
    // Mapping keyword untuk pencarian BPS yang lebih akurat
    const keywordMap = {
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
    if (!searchKeyword)
        return "";
    try {
        // 1. Cari Variable ID di BPS
        console.log(`🔍 Searching BPS for: ${searchKeyword}...`);
        const searchRes = await axios_1.default.get(`${BPS_BASE_URL}/list/model/var/lang/ind/domain/0000/key/${apiKey}`, {
            params: { keyword: searchKeyword },
            timeout: 5000
        });
        if (searchRes.data.status !== 'OK' || !searchRes.data.data[1] || searchRes.data.data[1].length === 0) {
            return `(Sistem: Tidak ditemukan variabel statistik BPS untuk "${searchKeyword}")`;
        }
        // Ambil variable pertama yang relevan (biasanya yang paling cocok)
        const variable = searchRes.data.data[1][0];
        const varId = variable.var_id;
        const varTitle = variable.title;
        // 2. Ambil data untuk Variabel tersebut (coba tahun ini dan tahun lalu)
        const currentYear = new Date().getFullYear();
        const dataRes = await axios_1.default.get(`${BPS_BASE_URL}/list/model/data/lang/ind/domain/0000/var/${varId}/key/${apiKey}/th/${currentYear}`, {
            timeout: 5000
        });
        let displayData = "";
        if (dataRes.data.status === 'OK' && dataRes.data.data) {
            // Sederhanakan output untuk AI
            displayData = `Data BPS [${varTitle}]: Tersedia untuk tahun ${currentYear}. Nilai bervariasi per wilayah.`;
        }
        else {
            // Coba tahun sebelumnya jika tahun ini kosong
            const prevYear = currentYear - 1;
            const prevDataRes = await axios_1.default.get(`${BPS_BASE_URL}/list/model/data/lang/ind/domain/0000/var/${varId}/key/${apiKey}/th/${prevYear}`, {
                timeout: 5000
            });
            if (prevDataRes.data.status === 'OK') {
                displayData = `Data BPS [${varTitle}]: Menggunakan data tahun ${prevYear} (Data ${currentYear} belum rilis).`;
            }
            else {
                displayData = `Data BPS [${varTitle}]: Data historis tersedia namun gagal mengambil detail saat ini.`;
            }
        }
        return `=== INFO GROUNDING BPS ===\nKomoditas: ${searchKeyword}\nSumber: Badan Pusat Statistik (BPS)\nKonteks: ${displayData}\n(Sampaikan ke user bahwa data ini adalah statistik resmi terbaru dari BPS)`;
    }
    catch (error) {
        console.error('❌ BPS Search Error:', error.message);
        return `(Sistem: Gangguan koneksi ke BPS API saat mencari "${searchKeyword}")`;
    }
}
//# sourceMappingURL=priceService.js.map
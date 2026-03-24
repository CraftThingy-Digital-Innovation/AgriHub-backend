"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRealTimePrices = getRealTimePrices;
exports.getBPSStrategicIndicators = getBPSStrategicIndicators;
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
 * Mendapatkan statistik khusus (SDGs/SDDS/Indikator) dari BPS
 */
async function getBPSStrategicIndicators() {
    const apiKey = process.env.BPS_API_KEY;
    if (!apiKey)
        return "";
    try {
        const res = await axios_1.default.get(`${BPS_BASE_URL}/list/model/indicators/lang/ind/domain/0000/key/${apiKey}`, { timeout: 5000 });
        if (res.data.status !== 'OK' || !res.data.data || !res.data.data[1])
            return "";
        const data = res.data.data[1];
        // Ambil 5 indikator strategis terbaru (biasanya NTP, Inflasi, Pertumbuhan Ekonomi)
        let text = "=== INDIKATOR STRATEGIS NASIONAL (BPS) ===\n";
        data.slice(0, 5).forEach((item) => {
            text += `• ${item.title}: ${item.value} ${item.unit}\n  (Sumber: ${item.data_source})\n`;
        });
        return text;
    }
    catch (error) {
        console.error('❌ BPS Indicators Error:', error.message);
        return "";
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
    const lowerQuery = query.toLowerCase();
    // 1. Jika tanya NTP, arahkan ke indikator strategis
    if (lowerQuery.includes('ntp') || lowerQuery.includes('nilai tukar petani')) {
        return await getBPSStrategicIndicators();
    }
    // 2. Mapping keyword untuk pencarian BPS
    const keywordMap = {
        'cabe': 'cabai', 'lombok': 'cabai',
        'brambang': 'bawang merah', 'bawang': 'bawang',
        'beras': 'beras', 'telur': 'telur', 'daging': 'daging',
        'minyak': 'minyak goreng', 'gula': 'gula pasir',
        'padi': 'padi', 'jagung': 'jagung', 'kedelai': 'kedelai',
        'pupuk': 'pupuk', 'gabah': 'gabah'
    };
    let searchKeyword = "";
    for (const [key, val] of Object.entries(keywordMap)) {
        if (lowerQuery.includes(key)) {
            searchKeyword = val;
            break;
        }
    }
    // Deteksi Wilayah (contoh: Bengkulu)
    let targetDomain = "0000"; // Default Nasional
    const bengkuluKeywords = ['bengkulu', 'provinsi bengkulu'];
    if (bengkuluKeywords.some(bk => lowerQuery.includes(bk))) {
        targetDomain = "1700"; // ID Provinsi Bengkulu di BPS
    }
    if (!searchKeyword)
        return "";
    try {
        console.log(`🔍 Searching BPS for: ${searchKeyword} in domain ${targetDomain}...`);
        const searchRes = await axios_1.default.get(`${BPS_BASE_URL}/list/model/var/lang/ind/domain/${targetDomain}/key/${apiKey}`, {
            params: { keyword: searchKeyword },
            timeout: 5000
        });
        if (searchRes.data.status !== 'OK' || !searchRes.data.data || !searchRes.data.data[1] || searchRes.data.data[1].length === 0) {
            return `(Sistem: BPS tidak memiliki data statistik terbaru untuk "${searchKeyword}" di wilayah yang dipilih)`;
        }
        // Ambil max 3 variabel yang paling relevan
        const vars = searchRes.data.data[1]
            .filter((v) => v.title.toLowerCase().includes('harga') || v.title.toLowerCase().includes(searchKeyword))
            .slice(0, 3);
        if (vars.length === 0)
            return "";
        let groundingText = `=== DATA STATISTIK BPS: ${searchKeyword.toUpperCase()} (${targetDomain === "1700" ? "BENGKULU" : "NASIONAL"}) ===\n`;
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
                    const dataRes = await axios_1.default.get(`${BPS_BASE_URL}/list/model/data/lang/ind/domain/${targetDomain}/var/${varId}/key/${apiKey}/th/${th}`, {
                        timeout: 3000
                    });
                    if (dataRes.data.status === 'OK' && dataRes.data.datacontent) {
                        const content = dataRes.data.datacontent;
                        const vervars = dataRes.data.vervar || [];
                        // Cari ID untuk "INDONESIA" (9999) atau region spesifik
                        let targetId = targetDomain === "0000" ? "9999" : targetDomain;
                        // Fallback jika label tidak cocok
                        const matchEntry = vervars.find((v) => v.label.toUpperCase().includes('INDONESIA') ||
                            v.label.toUpperCase().includes('BENGKULU'));
                        if (matchEntry)
                            targetId = matchEntry.val.toString();
                        const targetPrefix = `${targetId}${varId}`;
                        const matchingKey = Object.keys(content).find(k => k.startsWith(targetPrefix));
                        if (matchingKey) {
                            foundVal = content[matchingKey];
                            dataYear = th.toString();
                            break;
                        }
                        else {
                            // Fallback: ambil value pertama
                            const firstKey = Object.keys(content)[0];
                            if (firstKey) {
                                foundVal = content[firstKey];
                                dataYear = th.toString();
                                break;
                            }
                        }
                    }
                }
                catch {
                    continue;
                }
            }
            if (foundVal) {
                groundingText += `• ${varTitle}\n  Nilai: ${foundVal} ${unit} (Tahun ${dataYear})\n`;
            }
            else {
                groundingText += `• ${varTitle}\n  Status: Data tabel tersedia, namun belum terbit di API periode terbaru.\n`;
            }
        }
        groundingText += `\n(Gunakan data tahunan di atas sebagai referensi statistik resmi. Jika user bertanya harga hari ini, sampaikan bahwa ini adalah angka resmi terakhir dari API BPS).\n`;
        return groundingText;
    }
    catch (error) {
        console.error('❌ BPS Search Error:', error.message);
        return `(Sistem: Gangguan koneksi ke BPS API saat mencari data "${searchKeyword}")`;
    }
}
//# sourceMappingURL=priceService.js.map
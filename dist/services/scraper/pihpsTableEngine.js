"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncRegions = syncRegions;
exports.scrapeMatrixData = scrapeMatrixData;
const axios_1 = __importDefault(require("axios"));
const knex_1 = __importDefault(require("../../config/knex"));
const BASE_URL = 'https://www.bi.go.id/hargapangan/WebSite';
// ─── 1. FETCH & SYNC REGIONS ────────────────────────────────────────────────
async function syncRegions() {
    console.log('[PIHPS] Syncing Regions (Provinces & Regencies)...');
    try {
        const provRes = await axios_1.default.get(`${BASE_URL}/Home/GetProvinceAll`);
        const provinces = provRes.data?.data || [];
        for (const prov of provinces) {
            if (prov.province_id === 0)
                continue; // Skip "Semua Provinsi"
            const regRes = await axios_1.default.get(`${BASE_URL}/Home/GetRegencyAll?ref_prov_id=${prov.province_id}`);
            const regencies = regRes.data?.data || [];
            for (const reg of regencies) {
                if (reg.regency_id === 0)
                    continue; // Skip "Semua Kota"
                await (0, knex_1.default)('pihps_regions').insert({
                    prov_id: parseInt(prov.province_id, 10),
                    prov_name: prov.province_name,
                    reg_id: parseInt(reg.regency_id, 10),
                    reg_name: reg.regency_name,
                }).onConflict(['prov_id', 'reg_id']).merge();
            }
        }
        console.log('[PIHPS] Sync Regions Completed!');
    }
    catch (error) {
        console.error('[PIHPS] Error syncing regions:', error);
    }
}
async function scrapeMatrixData(config) {
    console.log(`[PIHPS] Scrape Matrix Mode Started: ${config.startDate} to ${config.endDate}`);
    const { startDate, endDate, priceType = 1 } = config;
    try {
        const provs = await (0, knex_1.default)('pihps_regions').select('prov_id', 'prov_name').distinct();
        for (const prov of provs) {
            // Ambil seluruh ID regency di provinsi ini dan join dengan koma
            const regs = await (0, knex_1.default)('pihps_regions').where('prov_id', prov.prov_id).select('reg_id');
            const regIds = regs.map(r => r.reg_id).join(',');
            if (!regIds)
                continue;
            // Convert DD-MM-YYYY to YYYY-MM-DD for the URL payload
            const sDay = startDate.split('-')[0], sMo = startDate.split('-')[1], sYr = startDate.split('-')[2];
            const eDay = endDate.split('-')[0], eMo = endDate.split('-')[1], eYr = endDate.split('-')[2];
            const payload = new URLSearchParams();
            payload.append('price_type_id', priceType.toString());
            payload.append('province_id', prov.prov_id.toString());
            payload.append('regency_id', regIds);
            payload.append('start_date', `${sYr}-${sMo}-${sDay}`);
            payload.append('end_date', `${eYr}-${eMo}-${eDay}`);
            payload.append('comcat_id', ''); // Ambil semua komoditas
            payload.append('market_id', ''); // Ambil semua pasar
            payload.append('tipe_laporan', '1');
            console.log(`[PIHPS] Fetching data for Province ${prov.prov_name} (Regencies: ${regIds}) | Dates: ${sYr}-${sMo}-${sDay}`);
            const response = await axios_1.default.get(`${BASE_URL}/TabelHarga/GetGridDataDaerah?${payload.toString()}`);
            const dataGrid = response.data?.data || [];
            await processGridToDatabase(dataGrid, prov.prov_name, priceType);
            // Jeda 2 detik untuk menghindari rate limit / IP Ban
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        console.log(`[PIHPS] Matrix Scraping Completed for ${startDate} to ${endDate}!`);
    }
    catch (error) {
        console.error('[PIHPS] Error in scrapeMatrixData:', error);
    }
}
// ─── 3. DATA PROCESSOR ─────────────────────────────────────────────────────
async function processGridToDatabase(dataGrid, provName, marketType) {
    // Struktur JSON BI PIHPS sangat kompleks. Kolom adalah tanggal misal "12/04/2026", header_name etc.
    // Data array per komoditas: { name: "Beras", 12/04/2026: "13,500", regency: "Kota Banda Aceh" ... }
    // *Format aslinya mungkin JSON array of objects.*
    const rowsToInsert = [];
    for (const row of dataGrid) {
        const commodityName = row.commodity_name || row.name;
        const regencyName = row.regency_name || row.regency || "Unknown";
        if (!commodityName)
            continue;
        // Loop semua key di object row untuk mencari tanggal
        for (const key of Object.keys(row)) {
            // Regex check misal key adalah "12/04/2026" atau "2026-04-12"
            if (/^\d{2}[\/\-]\d{2}[\/\-]\d{4}$/.test(key) || /^\d{4}[\/\-]\d{2}[\/\-]\d{2}$/.test(key)) {
                const dateStr = key.replace(/\//g, '-'); // Normalisasikan
                let isoDate = '';
                if (/^\d{4}/.test(dateStr)) {
                    isoDate = dateStr; // Sudah YYYY-MM-DD
                }
                else {
                    const [dd, mm, yyyy] = dateStr.split('-');
                    isoDate = `${yyyy}-${mm}-${dd}`;
                }
                let rawPrice = row[key];
                if (typeof rawPrice === 'string')
                    rawPrice = rawPrice.replace(/[^\d]/g, ''); // Hapus format titik/koma
                const price = parseInt(rawPrice, 10);
                if (!isNaN(price) && price > 0) {
                    rowsToInsert.push({
                        prov_name: provName,
                        reg_name: regencyName,
                        market_type: marketType,
                        commodity_name: commodityName,
                        date: isoDate,
                        price: price
                    });
                }
            }
        }
    }
    // Batch insert ignores duplicates (On conflict ignore/merge)
    if (rowsToInsert.length > 0) {
        try {
            await (0, knex_1.default)('pihps_prices').insert(rowsToInsert).onConflict(['date', 'commodity_name', 'market_type', 'prov_name', 'reg_name']).ignore();
        }
        catch (err) {
            console.error(`[PIHPS] Error inserting batch data for ${provName}:`, err);
        }
    }
}
//# sourceMappingURL=pihpsTableEngine.js.map
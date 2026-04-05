"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const knex_1 = __importDefault(require("../config/knex"));
const pihpsTableEngine_1 = require("../services/scraper/pihpsTableEngine");
const router = express_1.default.Router();
// [POST] /api/pihps/sync-regions (Admin only)
router.post('/sync-regions', async (req, res) => {
    try {
        (0, pihpsTableEngine_1.syncRegions)();
        res.json({ message: 'Sync regions job started in background' });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to start sync' });
    }
});
// [POST] /api/pihps/backfill (Admin only)
router.post('/backfill', async (req, res) => {
    try {
        const { startDate, endDate, priceType } = req.body;
        if (!startDate || !endDate)
            return res.status(400).json({ error: 'startDate and endDate required (DD-MM-YYYY)' });
        (0, pihpsTableEngine_1.scrapeMatrixData)({ startDate, endDate, priceType: priceType || 1 });
        res.json({ message: `Backfill matrix job started in background for ${startDate} to ${endDate}` });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to start backfill' });
    }
});
// [GET] /api/pihps/commodities — Daftar komoditas unik dari pihps_prices
// Digunakan untuk mengisi dropdown filter di halaman Monitor Harga
router.get('/commodities', async (req, res) => {
    try {
        const rows = await (0, knex_1.default)('pihps_prices')
            .distinct('commodity_name')
            .orderBy('commodity_name');
        const allNames = rows.map((r) => String(r.commodity_name).trim());
        // Deduplikasi: ambil "nama induk" saja.
        // Contoh: "Beras", "Beras Kualitas Bawah I", "Beras Kualitas Medium I" → cukup "Beras"
        // Logika: jika nama A adalah prefix dari nama B (A lebih pendek), maka B adalah sub-varian dari A.
        const baseNames = [...new Set(allNames.map(name => {
                const base = allNames.find(candidate => candidate !== name &&
                    candidate.length < name.length &&
                    name.toLowerCase().startsWith(candidate.toLowerCase()));
                return base || name;
            }))].sort();
        res.json({ status: 'success', data: baseNames });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch commodities' });
    }
});
// [GET] /api/pihps/latest-date
router.get('/latest-date', async (req, res) => {
    try {
        const latestRow = await (0, knex_1.default)('pihps_prices').max('date as maxDate').first();
        res.json({ status: 'success', date: latestRow?.maxDate || new Date().toISOString().slice(0, 10) });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch latest date' });
    }
});
// [GET] /api/pihps/map-data — Data harga per provinsi untuk peta
router.get('/map-data', async (req, res) => {
    try {
        const { date, commodity, marketType } = req.query;
        let query = (0, knex_1.default)('pihps_prices')
            .select('prov_name', 'commodity_name', 'price')
            .avg('price as aggregate_price')
            .groupBy('prov_name', 'commodity_name');
        // Default ke tanggal terbaru jika tidak ada yang disebutkan
        if (date) {
            query = query.where('date', date);
        }
        else {
            const latestRow = await (0, knex_1.default)('pihps_prices').max('date as maxDate').first();
            if (latestRow && latestRow.maxDate) {
                query = query.where('date', latestRow.maxDate);
            }
        }
        // commodity = plain text nama komoditas (mis: "Beras", "Bawang Merah")
        if (commodity) {
            query = query.where('commodity_name', 'like', `%${commodity}%`);
        }
        if (marketType) {
            query = query.where('market_type', marketType);
        }
        const data = await query;
        res.json({ status: 'success', data });
    }
    catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch map data' });
    }
});
exports.default = router;
//# sourceMappingURL=pihps.js.map
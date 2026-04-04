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
        // Start background sync
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
        // Start background scraper
        (0, pihpsTableEngine_1.scrapeMatrixData)({ startDate, endDate, priceType: priceType || 1 });
        res.json({ message: `Backfill matrix job started in background for ${startDate} to ${endDate}` });
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to start backfill' });
    }
});
// [GET] /api/pihps/map-data (Public / Map Chart)
// Returns regional price data aggregated for mapping
router.get('/map-data', async (req, res) => {
    try {
        const { date, commodity, marketType } = req.query;
        // Default to the most recent date available ideally, but for demo:
        let query = (0, knex_1.default)('pihps_prices').select('prov_name', 'commodity_name', 'price').avg('price as aggregate_price').groupBy('prov_name', 'commodity_name');
        if (date)
            query = query.where('date', date);
        if (commodity)
            query = query.where('commodity_name', 'like', `%${commodity}%`);
        if (marketType)
            query = query.where('market_type', marketType);
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
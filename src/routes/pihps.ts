import express from 'express';
import db from '../config/knex';
import { syncRegions, scrapeMatrixData } from '../services/scraper/pihpsTableEngine';

const router = express.Router();

// [POST] /api/pihps/sync-regions (Admin only)
router.post('/sync-regions', async (req, res) => {
  try {
    // Start background sync
    syncRegions();
    res.json({ message: 'Sync regions job started in background' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start sync' });
  }
});

// [POST] /api/pihps/backfill (Admin only)
router.post('/backfill', async (req, res) => {
  try {
    const { startDate, endDate, priceType } = req.body;
    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate required (DD-MM-YYYY)' });

    // Start background scraper
    scrapeMatrixData({ startDate, endDate, priceType: priceType || 1 });
    res.json({ message: `Backfill matrix job started in background for ${startDate} to ${endDate}` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to start backfill' });
  }
});

// [GET] /api/pihps/map-data (Public / Map Chart)
// Returns regional price data aggregated for mapping
router.get('/map-data', async (req, res) => {
  try {
    const { date, commodity, marketType } = req.query;
    // Default to the most recent date available if not specified
    let query = db('pihps_prices').select('prov_name', 'commodity_name', 'price').avg('price as aggregate_price').groupBy('prov_name', 'commodity_name');

    if (date) {
       query = query.where('date', date as string);
    } else {
       const latestRow = await db('pihps_prices').max('date as maxDate').first();
       if (latestRow && latestRow.maxDate) {
           query = query.where('date', latestRow.maxDate);
       }
    }
    if (commodity) {
      let commoditySearch = commodity as string;
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(commoditySearch);
      if (isUUID) {
         const komoditasRow = await db('komoditas').where('id', commoditySearch).first();
         // If found, search PIHPS using the generic word (split the first word, e.g. "Bawang Merah Besar" -> "Bawang Merah" or just search the full name)
         // PIHPS has e.g. 'Beras', 'Bawang Merah', 'Cabai Merah'.
         if (komoditasRow) {
             const baseName = komoditasRow.nama.split(',')[0].replace(/kualitas.*/i, '').trim(); 
             commoditySearch = baseName;
         }
      }
      query = query.where('commodity_name', 'like', `%${commoditySearch}%`);
    }
    if (marketType) query = query.where('market_type', marketType);

    const data = await query;
    res.json({ status: 'success', data });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch map data' });
  }
});

export default router;

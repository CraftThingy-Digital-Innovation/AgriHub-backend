import axios from 'axios';
import db from '../../config/knex';

const BASE_URL = 'https://www.bi.go.id/hargapangan/WebSite';

// ─── 1. FETCH & SYNC REGIONS ────────────────────────────────────────────────
export async function syncRegions() {
  console.log('[PIHPS] Syncing Regions (Provinces & Regencies)...');
  try {
    const provRes = await axios.get(`${BASE_URL}/Home/GetProvinceAll`);
    const provinces = provRes.data?.data || [];

    for (const prov of provinces) {
      const regRes = await axios.get(`${BASE_URL}/Home/GetRegencyAll?ref_prov_id=${prov.id}`);
      const regencies = regRes.data?.data || [];

      for (const reg of regencies) {
        await db('pihps_regions').insert({
          prov_id: parseInt(prov.id, 10),
          prov_name: prov.name,
          reg_id: parseInt(reg.id, 10),
          reg_name: reg.name,
        }).onConflict(['prov_id', 'reg_id']).merge();
      }
    }
    console.log('[PIHPS] Sync Regions Completed!');
  } catch (error) {
    console.error('[PIHPS] Error syncing regions:', error);
  }
}

// ─── 2. BULK MATRIX SCRAPER (PRICES) ────────────────────────────────────────
interface ScrapingConfig {
  startDate: string; // format: DD-MM-YYYY
  endDate: string;   // format: DD-MM-YYYY
  priceType?: number; // 1:Tradisional, 2:Modern, 3:Grosir, 4:Produsen (Default: 1)
}

export async function scrapeMatrixData(config: ScrapingConfig) {
  console.log(`[PIHPS] Scrape Matrix Mode Started: ${config.startDate} to ${config.endDate}`);
  const { startDate, endDate, priceType = 1 } = config;

  try {
    const provs = await db('pihps_regions').select('prov_id', 'prov_name').distinct();

    for (const prov of provs) {
      // Ambil seluruh ID regency di provinsi ini dan join dengan koma
      const regs = await db('pihps_regions').where('prov_id', prov.prov_id).select('reg_id');
      const regIds = regs.map(r => r.reg_id).join(',');

      if (!regIds) continue;

      // Payload sesuai dengan network capture
      const payload = new URLSearchParams();
      payload.append('priceType', priceType.toString());
      payload.append('prov_id', prov.prov_id.toString());
      payload.append('reg_id', regIds);
      payload.append('start_date', startDate);
      payload.append('end_date', endDate);
      payload.append('comcat_id', ''); // Ambil semua komoditas
      payload.append('reportType', '1');

      console.log(`[PIHPS] Fetching data for Province ${prov.prov_name} (Regencies: ${regIds})`);
      
      const response = await axios.post(`${BASE_URL}/TabelHarga/GetGridDataDaerah`, payload.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      const dataGrid = response.data?.data || [];
      await processGridToDatabase(dataGrid, prov.prov_name, priceType);

      // Jeda 2 detik untuk menghindari rate limit / IP Ban
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    console.log(`[PIHPS] Matrix Scraping Completed for ${startDate} to ${endDate}!`);

  } catch (error) {
    console.error('[PIHPS] Error in scrapeMatrixData:', error);
  }
}

// ─── 3. DATA PROCESSOR ─────────────────────────────────────────────────────
async function processGridToDatabase(dataGrid: any[], provName: string, marketType: number) {
  // Struktur JSON BI PIHPS sangat kompleks. Kolom adalah tanggal misal "12/04/2026", header_name etc.
  // Data array per komoditas: { name: "Beras", 12/04/2026: "13,500", regency: "Kota Banda Aceh" ... }
  // *Format aslinya mungkin JSON array of objects.*

  const rowsToInsert = [];

  for (const row of dataGrid) {
    const commodityName = row.commodity_name || row.name;
    const regencyName = row.regency_name || row.regency || "Unknown";
    
    if (!commodityName) continue;

    // Loop semua key di object row untuk mencari tanggal
    for (const key of Object.keys(row)) {
      // Regex check misal key adalah "12/04/2026" atau "12-04-2026"
      if (/^\d{2}[\/\-]\d{2}[\/\-]\d{4}$/.test(key)) {
        const dateStr = key.replace(/\//g, '-'); // Normalisasikan jadi DD-MM-YYYY
        // SQLite date is usually YYYY-MM-DD, parse it:
        const [dd, mm, yyyy] = dateStr.split('-');
        const isoDate = `${yyyy}-${mm}-${dd}`;
        
        let rawPrice = row[key];
        if (typeof rawPrice === 'string') rawPrice = rawPrice.replace(/[^\d]/g, ''); // Hapus format titik/koma
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
        await db('pihps_prices').insert(rowsToInsert).onConflict(['date', 'commodity_name', 'market_type', 'prov_name', 'reg_name']).ignore();
      } catch (err) {
        console.error(`[PIHPS] Error inserting batch data for ${provName}:`, err);
      }
  }
}

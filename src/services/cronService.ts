import cron from 'node-cron';
import db from '../config/knex';
import { syncRegions, scrapeMatrixData } from './scraper/pihpsTableEngine';

// Utility to format date as DD-MM-YYYY
function formatDate(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

export async function initCronJobs() {
  console.log('🕒 Initializing Cron Jobs & Data Synchronization...');

  // 1. Initial Database Seed Check
  try {
    const regionCount = await db('pihps_regions').count('prov_id as count').first();
    const isRegionsEmpty = !regionCount || Number(regionCount.count) === 0;

    if (isRegionsEmpty) {
      console.log('⚠️ PIHPS Regions table is empty. Starting auto-sync...');
      await syncRegions();
    }

    const priceCount = await db('pihps_prices').count('date as count').first();
    const isPricesEmpty = !priceCount || Number(priceCount.count) === 0;

    if (isPricesEmpty) {
      console.log('⚠️ PIHPS Prices table is empty. Starting 5-Years MEGA BACKFILL (Chunked by Year)...');
      // Break down 5 years into 1-year chunks to prevent BI API timeout
      (async () => {
        try {
          const today = new Date();
          for (let i = 4; i >= 0; i--) {
            const startDate = new Date();
            startDate.setFullYear(today.getFullYear() - (i + 1));
            
            const endDate = new Date();
            endDate.setFullYear(today.getFullYear() - i);
            if (i === 0) endDate.setTime(today.getTime()); // Up to today for the last chunk

            const startStr = formatDate(startDate);
            const endStr = formatDate(endDate);
            
            console.log(`[PIHPS] Backfilling chunk: ${startStr} to ${endStr}`);
            await scrapeMatrixData({ startDate: startStr, endDate: endStr, priceType: 1 });
            console.log(`[PIHPS] Completed chunk: ${startStr} to ${endStr}. Resting 10s...`);
            await new Promise(r => setTimeout(r, 10000));
          }
          console.log('🎉 5-Years MEGA BACKFILL Complete!');
        } catch (err) {
          console.error('❌ Error during MEGA BACKFILL:', err);
        }
      })();
    } else {
       console.log('✅ PIHPS Database has existing data. Skipping initial mega-backfill.');
    }
  } catch (err) {
    console.error('❌ Error during Initial Data Check:', err);
  }

  // 2. Schedule Daily Incremental Scraper
  // Runs every day at 06:00 AM (to fetch data reported yesterday/today)
  cron.schedule('0 6 * * *', async () => {
    console.log('⏰ [Cron] Running Daily PIHPS Sync...');
    // Sync regions just in case there are updates
    await syncRegions();

    // Fetch the last 7 days of data to update missing / revised data from BI
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 7);

    try {
      await scrapeMatrixData({
        startDate: formatDate(startDate),
        endDate: formatDate(endDate),
        priceType: 1
      });
      console.log('✅ [Cron] Daily PIHPS Sync Completed!');
    } catch (err) {
      console.error('❌ [Cron] Error during Daily PIHPS Sync:', err);
    }
  });

  console.log('✅ Cron scheduler active.');
}

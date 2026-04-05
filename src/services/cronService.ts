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

    const priceMax = await db('pihps_prices').max('date as maxDate').first();
    const isPricesEmpty = !priceMax || !priceMax.maxDate;

    const today = new Date();
    let backfillStart = new Date();
    backfillStart.setFullYear(today.getFullYear() - 5); // Default 5 years ago
    
    let needsBackfill = false;

    if (isPricesEmpty) {
      console.log('⚠️ PIHPS Prices table is empty. Starting 5-Years MEGA BACKFILL...');
      needsBackfill = true;
    } else {
      const maxDbDate = new Date(String(priceMax.maxDate));
      const diffDays = Math.floor((today.getTime() - maxDbDate.getTime()) / (1000 * 60 * 60 * 24));
      
      if (diffDays > 14) {
        console.log(`⚠️ PIHPS Database gap detected! Last data was ${diffDays} days ago. Resuming backfill...`);
        backfillStart = maxDbDate;
        needsBackfill = true;
      } else {
        console.log('✅ PIHPS Database is up-to-date. Skipping mega-backfill.');
      }
    }

    if (needsBackfill) {
      (async () => {
        try {
          const startYear = backfillStart.getFullYear();
          const endYear = today.getFullYear();

          for (let yr = startYear; yr <= endYear; yr++) {
            let chunkStart = new Date(yr, 0, 1); // Jan 1st
            if (chunkStart < backfillStart) chunkStart = backfillStart;

            let chunkEnd = new Date(yr, 11, 31); // Dec 31st
            if (chunkEnd > today) chunkEnd = today;

            const startStr = formatDate(chunkStart);
            const endStr = formatDate(chunkEnd);
            
            console.log(`[PIHPS] Backfilling chunk: ${startStr} to ${endStr}`);
            await scrapeMatrixData({ startDate: startStr, endDate: endStr, priceType: 1 });
            console.log(`[PIHPS] Completed chunk: ${startStr} to ${endStr}. Resting 10s...`);
            await new Promise(r => setTimeout(r, 10000));
          }
          console.log('🎉 PIHPS Historical Backfill Complete!');
        } catch (err) {
          console.error('❌ Error during MEGA BACKFILL:', err);
        }
      })();
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

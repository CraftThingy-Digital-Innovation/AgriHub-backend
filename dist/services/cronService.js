"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initCronJobs = initCronJobs;
const node_cron_1 = __importDefault(require("node-cron"));
const knex_1 = __importDefault(require("../config/knex"));
const pihpsTableEngine_1 = require("./scraper/pihpsTableEngine");
// Utility to format date as DD-MM-YYYY
function formatDate(date) {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
}
async function initCronJobs() {
    console.log('🕒 Initializing Cron Jobs & Data Synchronization...');
    // ── 1. Initial Database Seed & Backfill Check ─────────────────────────────
    try {
        const regionCount = await (0, knex_1.default)('pihps_regions').count('prov_id as count').first();
        const isRegionsEmpty = !regionCount || Number(regionCount.count) === 0;
        if (isRegionsEmpty) {
            console.log('⚠️ PIHPS Regions table empty. Auto-syncing regions...');
            await (0, pihpsTableEngine_1.syncRegions)();
        }
        const today = new Date();
        const fiveYearsAgo = new Date();
        fiveYearsAgo.setFullYear(today.getFullYear() - 5);
        // Calculate expected date range in days (5 years backfill target)
        const expectedDays = Math.floor((today.getTime() - fiveYearsAgo.getTime()) / (1000 * 60 * 60 * 24));
        // Check actual coverage: how many distinct dates do we have?
        const dateCountRow = await (0, knex_1.default)('pihps_prices').countDistinct('date as count').first();
        const actualDays = Number(dateCountRow?.count || 0);
        // Coverage ratio — if we have less than 80% of expected dates, trigger backfill
        const coverageRatio = actualDays / expectedDays;
        if (actualDays === 0) {
            console.log('⚠️ PIHPS Prices table is EMPTY. Starting 5-Year MEGA BACKFILL...');
        }
        else if (coverageRatio < 0.8) {
            console.log(`⚠️ PIHPS incomplete: ${actualDays} dates of ~${expectedDays} expected (${Math.round(coverageRatio * 100)}% coverage). Resuming backfill...`);
        }
        else {
            // Also check: is the latest data recent enough?
            const priceMax = await (0, knex_1.default)('pihps_prices').max('date as maxDate').first();
            const maxDbDate = new Date(String(priceMax?.maxDate));
            const diffDays = Math.floor((today.getTime() - maxDbDate.getTime()) / (1000 * 60 * 60 * 24));
            if (diffDays > 14) {
                console.log(`⚠️ PIHPS gap detected — last data was ${diffDays} days ago. Resuming incremental backfill from ${String(priceMax?.maxDate)}...`);
            }
            else {
                console.log(`✅ PIHPS Database OK: ${actualDays} distinct dates, coverage ${Math.round(coverageRatio * 100)}%. Skipping backfill.`);
                return; // Early exit — proceed to cron scheduling
            }
        }
        // ── Trigger Backfill ───────────────────────────────────────────────────
        // Determine the start point: either 5 years ago, or from last available date
        let backfillStart = fiveYearsAgo;
        if (actualDays > 0 && coverageRatio >= 0.8) {
            // Partial resume: only fill forward from the last max date
            const priceMax = await (0, knex_1.default)('pihps_prices').max('date as maxDate').first();
            if (priceMax?.maxDate)
                backfillStart = new Date(String(priceMax.maxDate));
        }
        (async () => {
            try {
                const startYear = backfillStart.getFullYear();
                const endYear = today.getFullYear();
                let totalChunks = 0;
                for (let yr = startYear; yr <= endYear; yr++) {
                    // Split each year into quarters to reduce load per request
                    const quarters = [
                        { start: new Date(yr, 0, 1), end: new Date(yr, 2, 31) },
                        { start: new Date(yr, 3, 1), end: new Date(yr, 5, 30) },
                        { start: new Date(yr, 6, 1), end: new Date(yr, 8, 30) },
                        { start: new Date(yr, 9, 1), end: new Date(yr, 11, 31) },
                    ];
                    for (const q of quarters) {
                        let chunkStart = q.start;
                        let chunkEnd = q.end;
                        if (chunkEnd < backfillStart)
                            continue; // Already covered
                        if (chunkStart < backfillStart)
                            chunkStart = backfillStart;
                        if (chunkEnd > today)
                            chunkEnd = today;
                        if (chunkStart > chunkEnd)
                            continue;
                        const startStr = formatDate(chunkStart);
                        const endStr = formatDate(chunkEnd);
                        console.log(`[PIHPS Backfill] Chunk ${++totalChunks}: ${startStr} → ${endStr}`);
                        try {
                            await (0, pihpsTableEngine_1.scrapeMatrixData)({ startDate: startStr, endDate: endStr, priceType: 1 });
                            console.log(`[PIHPS Backfill] ✓ Done chunk ${totalChunks}. Resting 5s...`);
                        }
                        catch (chunkErr) {
                            console.error(`[PIHPS Backfill] ✗ Error chunk ${totalChunks}:`, chunkErr);
                        }
                        await new Promise(r => setTimeout(r, 5000));
                    }
                }
                console.log(`🎉 PIHPS Historical Backfill Complete! (${totalChunks} chunks processed)`);
            }
            catch (err) {
                console.error('❌ PIHPS MEGA BACKFILL failed:', err);
            }
        })();
    }
    catch (err) {
        console.error('❌ Error during Initial Data Check:', err);
    }
    // ── 2. Daily Incremental Scraper — 06:00 AM ────────────────────────────────
    node_cron_1.default.schedule('0 6 * * *', async () => {
        console.log('⏰ [Cron] Running Daily PIHPS Sync...');
        await (0, pihpsTableEngine_1.syncRegions)();
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - 7);
        try {
            await (0, pihpsTableEngine_1.scrapeMatrixData)({
                startDate: formatDate(startDate),
                endDate: formatDate(endDate),
                priceType: 1,
            });
            console.log('✅ [Cron] Daily PIHPS Sync Completed!');
        }
        catch (err) {
            console.error('❌ [Cron] Daily PIHPS Sync Failed:', err);
        }
    });
    console.log('✅ Cron scheduler active.');
}
//# sourceMappingURL=cronService.js.map
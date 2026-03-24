"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMigrations = runMigrations;
require("dotenv/config");
const knex_1 = __importDefault(require("../config/knex"));
// ─── Auto-Migration: runs all pending migrations on startup ───────────────
async function runMigrations() {
    try {
        console.log('🗄️  Running database migrations...');
        // Fix for "corrupt migration directory" when moving from .ts (dev) to .js (dist)
        // AND handling manual renames (20260323_... -> 00x_...)
        try {
            const hasTable = await knex_1.default.schema.hasTable('knex_migrations');
            if (hasTable) {
                const ext = process.env.NODE_ENV === 'production' ? '.js' : '.ts';
                const otherExt = ext === '.js' ? '.ts' : '.js';
                // Sync filenames in DB with current expected extension
                await knex_1.default.raw(`UPDATE knex_migrations SET name = REPLACE(name, '${otherExt}', '${ext}') WHERE name LIKE '%${otherExt}'`);
                // Fix manual renames for BOTH extensions just in case
                const oldPrefix = '20260323_';
                const newPrefixes = {
                    'add_puter_token_to_users': '002_add_puter_token',
                    'enhance_store_product_schema': '003_enhance_store_product_schema'
                };
                for (const [old, newName] of Object.entries(newPrefixes)) {
                    await knex_1.default.raw(`UPDATE knex_migrations SET name = '${newName}${ext}' WHERE name = '${oldPrefix}${old}${ext}' OR name = '${oldPrefix}${old}${otherExt}'`);
                }
                console.log(`🔧 Migration history repaired (Sync to ${ext}).`);
            }
        }
        catch (e) {
            console.warn('⚠️ Repair step failed (possibly already fixed):', e.message);
        }
        const [batchNo, log] = await knex_1.default.migrate.latest();
        if (log.length === 0) {
            console.log('✅ Database is already up to date.');
        }
        else {
            console.log(`✅ Ran batch #${batchNo} — ${log.length} migration(s):`);
            log.forEach((file) => console.log(`   ↳ ${file}`));
        }
    }
    catch (err) {
        console.error('❌ Migration failed:', err);
        throw err;
    }
}
// Jika dijalankan langsung dari CLI (npx tsx src/db/migrate.ts)
if (require.main === module || process.argv[1]?.endsWith('migrate.ts')) {
    runMigrations()
        .then(() => process.exit(0))
        .catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
//# sourceMappingURL=migrate.js.map
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
        try {
            const hasTable = await knex_1.default.schema.hasTable('knex_migrations');
            if (hasTable) {
                await knex_1.default.raw("UPDATE knex_migrations SET name = REPLACE(name, '.ts', '.js') WHERE name LIKE '%.ts'");
            }
        }
        catch (e) {
            // Ignore if table doesn't exist or SQL fails
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
import 'dotenv/config';
import db from '../config/knex';

// ─── Auto-Migration: runs all pending migrations on startup ───────────────

export async function runMigrations(): Promise<void> {
  try {
    console.log('🗄️  Running database migrations...');
    
    // Fix for "corrupt migration directory" when moving from .ts (dev) to .js (dist)
    try {
      const hasTable = await db.schema.hasTable('knex_migrations');
      if (hasTable) {
        await db.raw("UPDATE knex_migrations SET name = REPLACE(name, '.ts', '.js') WHERE name LIKE '%.ts'");
      }
    } catch (e) {
      // Ignore if table doesn't exist or SQL fails
    }

    const [batchNo, log] = await db.migrate.latest();
    if (log.length === 0) {
      console.log('✅ Database is already up to date.');
    } else {
      console.log(`✅ Ran batch #${batchNo} — ${log.length} migration(s):`);
      log.forEach((file: string) => console.log(`   ↳ ${file}`));
    }
  } catch (err) {
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

import db from '../config/knex';

// ─── Auto-Migration: runs all pending migrations on startup ───────────────

export async function runMigrations(): Promise<void> {
  try {
    console.log('🗄️  Running database migrations...');
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

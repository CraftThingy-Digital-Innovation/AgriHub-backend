import 'dotenv/config';
import db from '../config/knex';

export async function runSeeds(): Promise<void> {
  try {
    console.log('🚀 Running database seeds...');
    
    // Knex looking for seed files in the configured directory
    const [log] = await db.seed.run();
    
    if (log.length === 0) {
      console.log('⚠️  No seed files found or executed.');
    } else {
      console.log(`✅ Successfully executed ${log.length} seed file(s):`);
      log.forEach((file: string) => console.log(`   ↳ ${file}`));
    }
  } catch (err) {
    console.error('❌ Seeding failed:', err);
    throw err;
  }
}

// Run if called directly
if (require.main === module || process.argv[1]?.endsWith('seed.ts')) {
  runSeeds()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

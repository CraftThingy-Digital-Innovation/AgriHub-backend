import db from './src/config/knex';
async function fix() {
  try {
    await db('knex_migrations').where('name', 'like', '20260323_%').delete();
    await db.raw("UPDATE knex_migrations SET name = REPLACE(name, '.ts', '.js') WHERE name LIKE '%.ts'");
    console.log('Fixed migrations table');
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}
fix();

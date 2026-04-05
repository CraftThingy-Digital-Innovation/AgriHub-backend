import db from './src/config/knex'; async function test() { try { const x = await db('price_history').join('komoditas',
 'price_history.komoditas', 'komoditas.id').select('price_history.*', 'komoditas.nama as komoditas_nama', 'komoditas.kategori'
).orderBy('price_history.date', 'desc').limit(50); console.log('success!', x.length); } catch(e) { console.error('ERROR:', e); } finally { process.exit(0); } } test();

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // 1. Ubah struktur demand_requests agar nge-link ke user_addresses
  await knex.schema.alterTable('demand_requests', (t) => {
    // Tambah referensi ke tabel alamat
    t.string('address_id').references('id').inTable('user_addresses').onDelete('CASCADE');
    
    // Hapus kolom yang tidak relevan lagi (menggunakan alamat sebagai titik lokasi)
    t.dropColumn('kota_tujuan');
    
    // Threshold & expiry settings bisa menggunakan default
    t.dropColumn('match_radius_km');
    t.dropColumn('match_price_pct');
    t.dropColumn('match_date_days');
    t.dropColumn('deadline');
  });

  // Hapus semua data match_history yang lama (krn merujuk ke supply_reports manual)
  await knex.raw('DELETE FROM match_history');
  
  // Ubah struktur match_history agar support supply dari products (bukan supply_reports)
  // Menghapus foreign key constraint jika ada, tergantung db dialect, tapi karena SQLite/MySQL
  // Lebih aman alter table-nya.
  await knex.schema.alterTable('match_history', (t) => {
    // SQLite seringkali bermasalah dengan drop constraints. 
    // Jadi lebih baik tambah kolom baru.
    t.string('product_id').references('id').inTable('products').onDelete('CASCADE');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('match_history', (t) => {
    t.dropColumn('product_id');
  });

  await knex.schema.alterTable('demand_requests', (t) => {
    t.dropColumn('address_id');
    t.string('kota_tujuan').notNullable().defaultTo('');
    t.integer('match_radius_km').defaultTo(200);
    t.integer('match_price_pct').defaultTo(20);
    t.integer('match_date_days').defaultTo(7);
    t.date('deadline').notNullable().defaultTo(knex.fn.now());
  });
}

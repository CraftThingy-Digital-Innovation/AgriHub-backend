import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── Users ────────────────────────────────────────────────────────────
  await knex.schema.createTable('users', (t) => {
    t.string('id').primary();
    t.string('phone').notNullable().unique();
    t.string('name').notNullable();
    t.string('email').nullable().unique();
    t.string('password_hash').nullable();
    t.enu('role', ['petani', 'konsumen', 'distributor', 'admin']).defaultTo('konsumen');
    t.string('avatar_url').nullable();
    t.boolean('is_verified').defaultTo(false);
    t.string('puter_user_id').nullable();
    t.timestamps(true, true);
  });

  // ── Stores (Toko Petani) ─────────────────────────────────────────────
  await knex.schema.createTable('stores', (t) => {
    t.string('id').primary();
    t.string('owner_id').references('id').inTable('users').onDelete('CASCADE');
    t.string('store_code').notNullable().unique();
    t.string('name').notNullable();
    t.string('kabupaten').notNullable();
    t.string('provinsi').notNullable();
    t.decimal('latitude', 10, 7).nullable();
    t.decimal('longitude', 10, 7).nullable();
    t.text('product_types').defaultTo('[]'); // JSON array
    t.text('description').nullable();
    t.boolean('is_active').defaultTo(true);
    t.decimal('rating', 3, 2).defaultTo(0);
    t.integer('total_orders').defaultTo(0);
    t.timestamps(true, true);
  });

  // ── Products (Listing Produk) ────────────────────────────────────────
  await knex.schema.createTable('products', (t) => {
    t.string('id').primary();
    t.string('store_id').references('id').inTable('stores').onDelete('CASCADE');
    t.string('name').notNullable();
    t.string('category').notNullable();
    t.string('unit').defaultTo('kg');
    t.decimal('price_per_unit', 12, 2).notNullable();
    t.decimal('stock_quantity', 12, 3).defaultTo(0);
    t.decimal('min_order', 12, 3).defaultTo(1);
    t.text('description').nullable();
    t.string('image_url').nullable();
    t.boolean('is_active').defaultTo(true);
    t.timestamps(true, true);
  });

  // ── Orders ───────────────────────────────────────────────────────────
  await knex.schema.createTable('orders', (t) => {
    t.string('id').primary();
    t.string('buyer_id').references('id').inTable('users');
    t.string('seller_id').references('id').inTable('users');
    t.string('store_id').references('id').inTable('stores');
    t.string('product_id').references('id').inTable('products');
    t.decimal('quantity', 12, 3).notNullable();
    t.decimal('unit_price', 12, 2).notNullable();
    t.decimal('total_amount', 12, 2).notNullable();
    t.decimal('platform_fee', 12, 2).notNullable();
    t.decimal('ppn_fee', 12, 2).notNullable();
    t.decimal('midtrans_mdr', 12, 2).defaultTo(0);
    t.decimal('seller_net', 12, 2).notNullable();
    t.enu('status', ['pending','dibayar','diproses','dikirim','diterima','sengketa','selesai','dibatalkan']).defaultTo('pending');
    t.string('midtrans_order_id').nullable();
    t.text('midtrans_token').nullable();
    t.string('payment_method').nullable();
    t.string('shipping_resi').nullable();
    t.string('shipping_courier').nullable();
    t.text('notes').nullable();
    t.timestamp('escrow_released_at').nullable();
    t.text('dispute_reason').nullable();
    t.timestamps(true, true);
  });

  // ── Wallets ──────────────────────────────────────────────────────────
  await knex.schema.createTable('wallets', (t) => {
    t.string('id').primary();
    t.string('user_id').references('id').inTable('users').onDelete('CASCADE').unique();
    t.decimal('balance', 14, 2).defaultTo(0);
    t.decimal('pending_balance', 14, 2).defaultTo(0);
    t.decimal('total_earned', 14, 2).defaultTo(0);
    t.decimal('total_withdrawn', 14, 2).defaultTo(0);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('wallet_transactions', (t) => {
    t.string('id').primary();
    t.string('wallet_id').references('id').inTable('wallets').onDelete('CASCADE');
    t.enu('type', ['credit','debit','escrow_hold','escrow_release','withdrawal']).notNullable();
    t.decimal('amount', 14, 2).notNullable();
    t.string('description').notNullable();
    t.string('reference_id').nullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // ── Supply-Demand Matching ───────────────────────────────────────────
  await knex.schema.createTable('supply_reports', (t) => {
    t.string('id').primary();
    t.string('reporter_id').references('id').inTable('users');
    t.string('komoditas').notNullable();
    t.decimal('jumlah_kg', 12, 2).notNullable();
    t.decimal('harga_per_kg', 12, 2).notNullable();
    t.string('kota').notNullable();
    t.string('kabupaten').notNullable();
    t.string('provinsi').notNullable();
    t.decimal('latitude', 10, 7).nullable();
    t.decimal('longitude', 10, 7).nullable();
    t.date('tanggal_tersedia').notNullable();
    t.boolean('is_active').defaultTo(true);
    t.integer('match_radius_km').defaultTo(200);
    t.integer('match_price_pct').defaultTo(20);
    t.integer('match_date_days').defaultTo(7);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('demand_requests', (t) => {
    t.string('id').primary();
    t.string('requester_id').references('id').inTable('users');
    t.string('komoditas').notNullable();
    t.decimal('jumlah_kg', 12, 2).notNullable();
    t.decimal('harga_max_per_kg', 12, 2).notNullable();
    t.string('kota_tujuan').notNullable();
    t.date('deadline').notNullable();
    t.boolean('is_active').defaultTo(true);
    t.integer('match_radius_km').defaultTo(200);
    t.integer('match_price_pct').defaultTo(20);
    t.integer('match_date_days').defaultTo(7);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('match_history', (t) => {
    t.string('id').primary();
    t.string('supply_id').references('id').inTable('supply_reports').onDelete('CASCADE');
    t.string('demand_id').references('id').inTable('demand_requests').onDelete('CASCADE');
    t.decimal('score', 5, 2).notNullable();
    t.decimal('distance_km', 8, 2).notNullable();
    t.decimal('price_diff_pct', 5, 2).notNullable();
    t.boolean('is_contacted').defaultTo(false);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // ── Price Monitoring ─────────────────────────────────────────────────
  await knex.schema.createTable('price_history', (t) => {
    t.string('id').primary();
    t.string('komoditas').notNullable();
    t.string('wilayah').notNullable();
    t.decimal('harga_per_kg', 12, 2).notNullable();
    t.string('source').defaultTo('manual');
    t.date('date').notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.index(['komoditas', 'wilayah', 'date']);
  });

  await knex.schema.createTable('price_alerts', (t) => {
    t.string('id').primary();
    t.string('user_id').references('id').inTable('users').onDelete('CASCADE');
    t.string('komoditas').notNullable();
    t.string('wilayah').nullable();
    t.enu('condition', ['naik', 'turun']).notNullable();
    t.decimal('threshold_price', 12, 2).notNullable();
    t.boolean('is_active').defaultTo(true);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('price_predictions', (t) => {
    t.string('id').primary();
    t.string('komoditas').notNullable();
    t.string('wilayah').notNullable();
    t.decimal('predicted_price', 12, 2).notNullable();
    t.decimal('confidence', 4, 3).notNullable();
    t.date('prediction_date').notNullable();
    t.timestamp('generated_at').defaultTo(knex.fn.now());
  });

  // ── Shipment ─────────────────────────────────────────────────────────
  await knex.schema.createTable('shipment_orders', (t) => {
    t.string('id').primary();
    t.string('order_id').references('id').inTable('orders').nullable();
    t.string('courier').notNullable();
    t.string('service_type').notNullable();
    t.string('origin_area_id').notNullable();
    t.string('destination_area_id').notNullable();
    t.decimal('weight_kg', 8, 3).notNullable();
    t.decimal('price', 12, 2).notNullable();
    t.string('estimated_days').notNullable();
    t.string('waybill_id').nullable();
    t.string('biteship_order_id').nullable();
    t.enu('status', ['pending','confirmed','picked_up','in_transit','delivered']).defaultTo('pending');
    t.timestamps(true, true);
  });

  await knex.schema.createTable('shipment_tracking_cache', (t) => {
    t.string('waybill_id').primary();
    t.text('tracking_data').notNullable(); // JSON
    t.timestamp('cached_at').defaultTo(knex.fn.now());
  });

  // ── RAG Documents ────────────────────────────────────────────────────
  await knex.schema.createTable('rag_documents', (t) => {
    t.string('id').primary();
    t.string('user_id').references('id').inTable('users').onDelete('CASCADE');
    t.string('title').notNullable();
    t.enu('source_type', ['pdf','docx','xlsx','url','youtube','text']).notNullable();
    t.string('source_url').nullable();
    t.text('content_preview').nullable();
    t.integer('chunk_count').defaultTo(0);
    t.boolean('is_global').defaultTo(false);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('rag_chunks', (t) => {
    t.string('id').primary();
    t.string('document_id').references('id').inTable('rag_documents').onDelete('CASCADE');
    t.integer('chunk_index').notNullable();
    t.text('content').notNullable();
    t.text('embedding').nullable(); // JSON float array
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // ── WhatsApp Group Credits ────────────────────────────────────────────
  await knex.schema.createTable('group_credits', (t) => {
    t.string('id').primary();
    t.string('group_jid').notNullable().unique();
    t.string('owner_id').references('id').inTable('users').onDelete('CASCADE');
    t.decimal('credits_balance', 10, 2).defaultTo(0);
    t.decimal('credits_used', 10, 2).defaultTo(0);
    t.boolean('is_ai_enabled').defaultTo(false);
    t.timestamps(true, true);
  });

  // ── Tanaman / Komoditas Pangan ────────────────────────────────────────
  await knex.schema.createTable('komoditas', (t) => {
    t.string('id').primary();
    t.string('nama').notNullable().unique();
    t.string('nama_latin').nullable();
    t.string('kategori').notNullable(); // 'sayuran', 'buah', 'biji-bijian', dll
    t.text('deskripsi').nullable();
    t.string('unit_default').defaultTo('kg');
    t.string('icon_emoji').nullable();
    t.timestamps(true, true);
  });
}

export async function down(knex: Knex): Promise<void> {
  const tables = [
    'komoditas', 'group_credits', 'rag_chunks', 'rag_documents',
    'shipment_tracking_cache', 'shipment_orders',
    'price_predictions', 'price_alerts', 'price_history',
    'match_history', 'demand_requests', 'supply_reports',
    'wallet_transactions', 'wallets',
    'orders', 'products', 'stores', 'users',
  ];
  for (const table of tables) {
    await knex.schema.dropTableIfExists(table);
  }
}

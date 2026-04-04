"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    await knex.schema.createTable('pihps_regions', (table) => {
        table.increments('id').primary();
        table.integer('prov_id').notNullable();
        table.string('prov_name').notNullable();
        table.integer('reg_id').notNullable();
        table.string('reg_name').notNullable();
        table.unique(['prov_id', 'reg_id']);
    });
    await knex.schema.createTable('pihps_prices', (table) => {
        table.bigIncrements('id').primary();
        table.string('prov_name').notNullable();
        table.string('reg_name').notNullable();
        table.integer('market_type').notNullable(); // 1: Tradisional, 2: Modern, 3: Grosir, 4: Produsen
        table.string('commodity_name').notNullable();
        table.date('date').notNullable();
        table.integer('price').notNullable(); // Harga dalam Rupiah
        // Indexing is critical for 18 million rows capability
        table.index(['date', 'commodity_name', 'prov_name', 'reg_name'], 'idx_pihps_prices_search');
        table.unique(['date', 'commodity_name', 'market_type', 'prov_name', 'reg_name'], 'idx_pihps_prices_unique');
    });
    await knex.schema.createTable('pihps_inflation', (table) => {
        table.bigIncrements('id').primary();
        table.string('periode').notNullable(); // MTM, YOY, DTD
        table.string('region_type').notNullable(); // Nasional atau Provinsi
        table.string('region_name').notNullable(); // Nama Provinsi atau "Nasional"
        table.string('commodity_name').notNullable();
        table.decimal('percentage', 5, 2).notNullable(); // Persentase inflasi
        table.date('date').notNullable();
        table.index(['date', 'commodity_name', 'region_name'], 'idx_pihps_inflation_search');
        table.unique(['date', 'commodity_name', 'periode', 'region_type', 'region_name'], 'idx_pihps_inflation_unique');
    });
}
async function down(knex) {
    await knex.schema.dropTableIfExists('pihps_inflation');
    await knex.schema.dropTableIfExists('pihps_prices');
    await knex.schema.dropTableIfExists('pihps_regions');
}
//# sourceMappingURL=010_create_pihps_tables.js.map
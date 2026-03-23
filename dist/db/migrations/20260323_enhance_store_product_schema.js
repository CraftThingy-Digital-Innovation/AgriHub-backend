"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    // Update Stores table
    await knex.schema.table('stores', (t) => {
        t.text('address').nullable();
        t.string('kecamatan').nullable();
        t.string('postal_code').nullable();
        t.string('area_id').nullable(); // Biteship Area ID
    });
    // Update Products table
    await knex.schema.table('products', (t) => {
        t.integer('weight_gram').defaultTo(1000);
        t.string('sku').nullable();
        t.string('origin').nullable();
        t.text('images_json').nullable(); // JSON array of additional images
    });
}
async function down(knex) {
    await knex.schema.table('stores', (t) => {
        t.dropColumn('address');
        t.dropColumn('kecamatan');
        t.dropColumn('postal_code');
        t.dropColumn('area_id');
    });
    await knex.schema.table('products', (t) => {
        t.dropColumn('weight_gram');
        t.dropColumn('sku');
        t.dropColumn('origin');
        t.dropColumn('images_json');
    });
}
//# sourceMappingURL=20260323_enhance_store_product_schema.js.map
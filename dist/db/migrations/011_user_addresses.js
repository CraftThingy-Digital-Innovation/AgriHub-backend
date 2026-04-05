"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    await knex.schema.createTable('user_addresses', (t) => {
        t.string('id').primary();
        t.string('user_id').references('id').inTable('users').onDelete('CASCADE');
        t.string('label').notNullable(); // e.g. "Rumah", "Kantor"
        t.string('recipient_name').notNullable();
        t.string('recipient_phone').notNullable();
        t.string('full_address').notNullable();
        t.string('provinsi').notNullable();
        t.string('kabupaten').notNullable();
        t.string('kecamatan').notNullable();
        t.string('postal_code').nullable();
        t.decimal('latitude', 10, 7).nullable();
        t.decimal('longitude', 10, 7).nullable();
        t.string('biteship_area_id').nullable();
        t.boolean('is_default').defaultTo(false);
        t.timestamps(true, true);
    });
}
async function down(knex) {
    await knex.schema.dropTableIfExists('user_addresses');
}
//# sourceMappingURL=011_user_addresses.js.map
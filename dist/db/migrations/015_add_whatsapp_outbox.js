"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    const exists = await knex.schema.hasTable('whatsapp_outbox');
    if (!exists) {
        console.log('🏗️ Membuat tabel whatsapp_outbox...');
        await knex.schema.createTable('whatsapp_outbox', (table) => {
            table.uuid('id').primary();
            table.string('jid').notNullable().index();
            table.text('text').notNullable();
            table.json('options').nullable();
            table.string('status').defaultTo('pending').index(); // pending, sent, failed
            table.text('error').nullable();
            table.timestamp('created_at').defaultTo(knex.fn.now());
            table.timestamp('updated_at').defaultTo(knex.fn.now());
        });
    }
}
async function down(knex) {
    await knex.schema.dropTableIfExists('whatsapp_outbox');
}
//# sourceMappingURL=015_add_whatsapp_outbox.js.map
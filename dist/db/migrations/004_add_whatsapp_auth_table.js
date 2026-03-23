"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    await knex.schema.createTable('whatsapp_auth', (table) => {
        table.uuid('id').primary();
        table.string('category').index(); // e.g., 'creds', 'keys'
        table.string('key_id').index(); // e.g., 'main', 'sender-key-123'
        table.text('data'); // JSON blob
        table.timestamp('updated_at').defaultTo(knex.fn.now());
        table.unique(['category', 'key_id']);
    });
}
async function down(knex) {
    await knex.schema.dropTableIfExists('whatsapp_auth');
}
//# sourceMappingURL=004_add_whatsapp_auth_table.js.map
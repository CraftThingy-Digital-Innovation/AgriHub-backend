"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    await knex.schema.createTable('chats', (t) => {
        t.uuid('id').primary();
        t.string('user_id').references('id').inTable('users').onDelete('CASCADE').nullable();
        t.string('whatsapp_jid').nullable().index();
        t.enu('role', ['user', 'assistant', 'system']).notNullable();
        t.text('content').notNullable();
        t.boolean('is_summary').defaultTo(false);
        t.timestamp('created_at').defaultTo(knex.fn.now());
    });
}
async function down(knex) {
    await knex.schema.dropTableIfExists('chats');
}
//# sourceMappingURL=006_create_chats_table.js.map
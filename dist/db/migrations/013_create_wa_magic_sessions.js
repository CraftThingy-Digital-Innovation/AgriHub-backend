"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    await knex.schema.createTable('wa_magic_sessions', (t) => {
        t.text('id').primary(); // UUID = session token
        t.text('phone').nullable(); // Nomor HP yang terdeteksi dari WA
        t.text('lid').nullable(); // LID yang terdeteksi dari WA
        t.text('jid').nullable(); // remoteJid dari WA
        t.text('user_id').nullable(); // FK ke users (null jika belum terdaftar)
        t.text('purpose').notNullable(); // 'connect-puter' | 'relink' | 'full-setup'
        t.text('status').notNullable().defaultTo('pending'); // 'pending' | 'completed'
        t.text('created_at').notNullable();
        t.text('completed_at').nullable();
    });
}
async function down(knex) {
    await knex.schema.dropTableIfExists('wa_magic_sessions');
}
//# sourceMappingURL=013_create_wa_magic_sessions.js.map
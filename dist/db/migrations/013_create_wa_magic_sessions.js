"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    await knex.schema.createTable('wa_magic_sessions', (t) => {
        t.string('id').primary(); // UUID = session token
        t.string('phone').nullable(); // Nomor HP yang terdeteksi dari WA
        t.string('lid').nullable(); // LID yang terdeteksi dari WA
        t.string('jid').nullable(); // remoteJid dari WA
        t.string('user_id').nullable(); // FK ke users (null jika belum terdaftar)
        t.string('purpose').notNullable(); // 'connect-puter' | 'relink' | 'full-setup'
        t.string('status').notNullable().defaultTo('pending'); // 'pending' | 'completed'
        t.timestamp('created_at').defaultTo(knex.fn.now());
        t.timestamp('completed_at').nullable();
    });
}
async function down(knex) {
    await knex.schema.dropTableIfExists('wa_magic_sessions');
}
//# sourceMappingURL=013_create_wa_magic_sessions.js.map
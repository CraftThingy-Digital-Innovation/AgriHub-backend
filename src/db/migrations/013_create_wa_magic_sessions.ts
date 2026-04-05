import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('wa_magic_sessions', (t) => {
    t.string('id').primary();                      // UUID = session token
    t.string('phone').nullable();                  // Nomor HP yang terdeteksi dari WA
    t.string('lid').nullable();                    // LID yang terdeteksi dari WA
    t.string('jid').nullable();                    // remoteJid dari WA
    t.string('user_id').nullable();                // FK ke users (null jika belum terdaftar)
    t.string('purpose').notNullable();             // 'connect-puter' | 'relink' | 'full-setup'
    t.string('status').notNullable().defaultTo('pending'); // 'pending' | 'completed'
    t.timestamp('created_at').defaultTo(knex.fn.now());
    t.timestamp('completed_at').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('wa_magic_sessions');
}

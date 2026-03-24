import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
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

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('chats');
}

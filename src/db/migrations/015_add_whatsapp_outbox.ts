import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
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

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('whatsapp_outbox');
}

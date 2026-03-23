import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('whatsapp_auth', (table) => {
    table.uuid('id').primary();
    table.string('category').index(); // e.g., 'creds', 'keys'
    table.string('key_id').index();   // e.g., 'main', 'sender-key-123'
    table.text('data');               // JSON blob
    table.timestamp('updated_at').defaultTo(knex.fn.now());
    
    table.unique(['category', 'key_id']);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('whatsapp_auth');
}

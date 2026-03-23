import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('users', 'whatsapp_lid');
  if (!hasColumn) {
    return knex.schema.alterTable('users', (table) => {
      // Menyimpan Locked Identity (LID) WhatsApp user
      table.string('whatsapp_lid').nullable().unique();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  return knex.schema.alterTable('users', (table) => {
    table.dropColumn('whatsapp_lid');
  });
}

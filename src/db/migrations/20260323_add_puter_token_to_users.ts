import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('users', 'puter_token');
  if (!hasColumn) {
    return knex.schema.alterTable('users', (table) => {
      // Menyimpan token OAuth Puter.js user
      table.string('puter_token', 2048).nullable();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('users', 'puter_token');
  if (hasColumn) {
    return knex.schema.alterTable('users', (table) => {
      table.dropColumn('puter_token');
    });
  }
}

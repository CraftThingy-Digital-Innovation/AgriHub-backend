import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('rag_documents', (t) => {
    t.string('original_filename').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('rag_documents', (t) => {
    t.dropColumn('original_filename');
  });
}

import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('rag_documents', (t) => {
    t.string('file_hash').nullable().index();
    t.integer('file_size').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('rag_documents', (t) => {
    t.dropColumn('file_hash');
    t.dropColumn('file_size');
  });
}

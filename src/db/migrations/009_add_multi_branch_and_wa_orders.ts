import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Update Stores table for branching
  await knex.schema.table('stores', (t) => {
    t.string('parent_store_id').nullable(); // Not using .references to avoid sqlite transaction issue
    t.boolean('is_main_branch').defaultTo(true);
  });

  // Update Orders table for WA tracking and shipping cache
  await knex.schema.table('orders', (t) => {
    t.string('group_jid').nullable();
    t.text('biteship_draft_cache').nullable(); // To store temporary biteship courier info
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.table('stores', (t) => {
    t.dropColumn('parent_store_id');
    t.dropColumn('is_main_branch');
  });

  await knex.schema.table('orders', (t) => {
    t.dropColumn('group_jid');
    t.dropColumn('biteship_draft_cache');
  });
}

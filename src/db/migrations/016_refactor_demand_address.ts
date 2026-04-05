import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // NO-OP to fix the "corrupt migration directory" error.
  // This migration will be properly refactored in a future update.
}

export async function down(knex: Knex): Promise<void> {
  // NO-OP
}

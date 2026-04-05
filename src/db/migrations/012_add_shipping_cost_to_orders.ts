import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.table('orders', (t) => {
    t.decimal('shipping_fee', 12, 2).defaultTo(0);
    // Note: shipping_resi and shipping_courier already exist from initial schema, 
    // but let's add shipping_service for detail (e.g., 'REG', 'YES')
    t.string('shipping_service').nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.table('orders', (t) => {
    t.dropColumn('shipping_fee');
    t.dropColumn('shipping_service');
  });
}

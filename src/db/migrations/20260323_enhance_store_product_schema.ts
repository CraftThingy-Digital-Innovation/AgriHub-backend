import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Update Stores table
  await knex.schema.table('stores', (t) => {
    t.text('address').nullable();
    t.string('kecamatan').nullable();
    t.string('postal_code').nullable();
  });

  // Update Products table
  await knex.schema.table('products', (t) => {
    t.integer('weight_gram').defaultTo(1000);
    t.string('sku').nullable();
    t.string('origin').nullable();
    t.text('images_json').nullable(); // JSON array of additional images
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.table('stores', (t) => {
    t.dropColumn('address');
    t.dropColumn('kecamatan');
    t.dropColumn('postal_code');
  });

  await knex.schema.table('products', (t) => {
    t.dropColumn('weight_gram');
    t.dropColumn('sku');
    t.dropColumn('origin');
    t.dropColumn('images_json');
  });
}

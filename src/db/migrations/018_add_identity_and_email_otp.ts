import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const tableExists = await knex.schema.hasTable('users');
  if (tableExists) {
    await knex.schema.table('users', (table) => {
      // avatar_url already exists in schema check
      table.string('whatsapp_link_token').nullable().unique().index();
      table.timestamp('whatsapp_link_expires').nullable();
      table.string('email_otp', 6).nullable();
      table.timestamp('email_otp_expires').nullable();
      table.string('puter_email').nullable().index();
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.table('users', (table) => {
    table.dropColumn('whatsapp_link_token');
    table.dropColumn('whatsapp_link_expires');
    table.dropColumn('email_otp');
    table.dropColumn('email_otp_expires');
    table.dropColumn('puter_email');
  });
}

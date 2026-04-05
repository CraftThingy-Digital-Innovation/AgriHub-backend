"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
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
async function down(knex) {
    await knex.schema.table('users', (table) => {
        table.dropColumn('whatsapp_link_token');
        table.dropColumn('whatsapp_link_expires');
        table.dropColumn('email_otp');
        table.dropColumn('email_otp_expires');
        table.dropColumn('puter_email');
    });
}
//# sourceMappingURL=018_add_identity_and_email_otp.js.map
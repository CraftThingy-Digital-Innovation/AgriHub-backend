"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    const hasColumn = await knex.schema.hasColumn('users', 'whatsapp_lid');
    if (!hasColumn) {
        return knex.schema.alterTable('users', (table) => {
            // Menyimpan Locked Identity (LID) WhatsApp user
            table.string('whatsapp_lid').nullable().unique();
        });
    }
}
async function down(knex) {
    return knex.schema.alterTable('users', (table) => {
        table.dropColumn('whatsapp_lid');
    });
}
//# sourceMappingURL=005_add_lid_to_users.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    const hasColumn = await knex.schema.hasColumn('users', 'puter_token');
    if (!hasColumn) {
        return knex.schema.alterTable('users', (table) => {
            // Menyimpan token OAuth Puter.js user
            table.string('puter_token', 2048).nullable();
        });
    }
}
async function down(knex) {
    const hasColumn = await knex.schema.hasColumn('users', 'puter_token');
    if (hasColumn) {
        return knex.schema.alterTable('users', (table) => {
            table.dropColumn('puter_token');
        });
    }
}
//# sourceMappingURL=002_add_puter_token.js.map
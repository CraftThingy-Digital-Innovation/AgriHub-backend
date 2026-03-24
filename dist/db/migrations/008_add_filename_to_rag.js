"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    await knex.schema.alterTable('rag_documents', (t) => {
        t.string('original_filename').nullable();
    });
}
async function down(knex) {
    await knex.schema.alterTable('rag_documents', (t) => {
        t.dropColumn('original_filename');
    });
}
//# sourceMappingURL=008_add_filename_to_rag.js.map
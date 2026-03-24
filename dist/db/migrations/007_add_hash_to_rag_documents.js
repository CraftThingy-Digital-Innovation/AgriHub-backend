"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    await knex.schema.alterTable('rag_documents', (t) => {
        t.string('file_hash').nullable().index();
        t.integer('file_size').nullable();
    });
}
async function down(knex) {
    await knex.schema.alterTable('rag_documents', (t) => {
        t.dropColumn('file_hash');
        t.dropColumn('file_size');
    });
}
//# sourceMappingURL=007_add_hash_to_rag_documents.js.map
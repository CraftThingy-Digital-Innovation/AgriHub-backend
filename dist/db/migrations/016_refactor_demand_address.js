"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    // NO-OP to fix the "corrupt migration directory" error.
    // This migration will be properly refactored in a future update.
}
async function down(knex) {
    // NO-OP
}
//# sourceMappingURL=016_refactor_demand_address.js.map
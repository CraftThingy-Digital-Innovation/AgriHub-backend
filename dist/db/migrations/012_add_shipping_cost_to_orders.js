"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    await knex.schema.table('orders', (t) => {
        t.decimal('shipping_fee', 12, 2).defaultTo(0);
        // Note: shipping_resi and shipping_courier already exist from initial schema, 
        // but let's add shipping_service for detail (e.g., 'REG', 'YES')
        t.string('shipping_service').nullable();
    });
}
async function down(knex) {
    await knex.schema.table('orders', (t) => {
        t.dropColumn('shipping_fee');
        t.dropColumn('shipping_service');
    });
}
//# sourceMappingURL=012_add_shipping_cost_to_orders.js.map
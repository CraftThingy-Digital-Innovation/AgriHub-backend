"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTransactionMidtrans = createTransactionMidtrans;
exports.createOrderFromMatch = createOrderFromMatch;
exports.updateShippingStatus = updateShippingStatus;
exports.confirmOrderReceipt = confirmOrderReceipt;
exports.runAutoConfirmJob = runAutoConfirmJob;
const uuid_1 = require("uuid");
const knex_1 = __importDefault(require("../config/knex"));
const midtrans_client_1 = __importDefault(require("midtrans-client"));
const snap = new midtrans_client_1.default.Snap({
    isProduction: process.env.NODE_ENV === 'production',
    serverKey: process.env.MIDTRANS_SERVER_KEY || '',
    clientKey: process.env.MIDTRANS_CLIENT_KEY || '',
});
async function createTransactionMidtrans(orderId, exactGrossAmount) {
    const transactionDetails = {
        transaction_details: {
            order_id: `AGRIHUB-${orderId.slice(-8).toUpperCase()}`,
            gross_amount: Math.round(exactGrossAmount),
        },
        credit_card: {
            secure: true
        }
    };
    const transaction = await snap.createTransaction(transactionDetails);
    return {
        token: transaction.token,
        redirect_url: transaction.redirect_url
    };
}
async function createOrderFromMatch(input) {
    const { matchId, buyerId, courierCode, courierService, shippingPrice, notes } = input;
    // 1. Get Match & Supply/Demand details
    const match = await (0, knex_1.default)('match_history')
        .join('supply_reports', 'match_history.supply_id', 'supply_reports.id')
        .join('demand_requests', 'match_history.demand_id', 'demand_requests.id')
        .where('match_history.id', matchId)
        .select('match_history.*', 'supply_reports.reporter_id as seller_id', 'supply_reports.komoditas', 'supply_reports.harga_per_kg as unit_price', 'supply_reports.jumlah_kg as current_stock_kg', 'demand_requests.jumlah_kg as requested_qty')
        .first();
    if (!match)
        throw new Error('Match tidak ditemukan');
    const qty = Math.min(match.requested_qty, match.current_stock_kg);
    if (qty <= 0)
        throw new Error('Stok tidak tersedia untuk pesanan ini');
    const productAmount = qty * match.unit_price;
    const platformFee = productAmount * 0.01; // 1% fee example
    const ppnFee = productAmount * 0.11; // 11% PPN
    const totalAmount = productAmount + platformFee + ppnFee + shippingPrice;
    const orderId = (0, uuid_1.v4)();
    const now = new Date().toISOString();
    await knex_1.default.transaction(async (trx) => {
        // 2. Create Order
        await trx('orders').insert({
            id: orderId,
            buyer_id: buyerId,
            seller_id: match.seller_id,
            product_id: match.supply_id, // For matchmaking, supply_id acts as product_id
            quantity: qty,
            unit_price: match.unit_price,
            total_amount: totalAmount,
            platform_fee: platformFee,
            ppn_fee: ppnFee,
            seller_net: productAmount,
            status: 'pending',
            shipping_courier: courierCode,
            notes,
            created_at: now,
            updated_at: now
        });
        // 3. Reduce Stock in supply_reports
        await trx('supply_reports')
            .where({ id: match.supply_id })
            .decrement('jumlah_kg', qty);
        // 4. Inactivate supply/demand if fully depleted (optional logic)
        const updatedSupply = await trx('supply_reports').where({ id: match.supply_id }).first();
        if (updatedSupply.jumlah_kg <= 0) {
            await trx('supply_reports').where({ id: match.supply_id }).update({ is_active: false });
        }
        // Mark match as contacted
        await trx('match_history').where({ id: matchId }).update({ is_contacted: true });
    });
    return { orderId, totalAmount };
}
async function updateShippingStatus(orderId, courier, resi) {
    await (0, knex_1.default)('orders').where({ id: orderId }).update({
        status: 'dikirim',
        shipping_resi: resi,
        shipping_courier: courier,
        updated_at: new Date().toISOString()
    });
}
async function confirmOrderReceipt(orderId) {
    const order = await (0, knex_1.default)('orders').where({ id: orderId }).first();
    if (!order)
        throw new Error('Order tidak ditemukan');
    if (order.status === 'selesai')
        return;
    await knex_1.default.transaction(async (trx) => {
        // 1. Update status
        await trx('orders').where({ id: orderId }).update({
            status: 'selesai',
            updated_at: new Date().toISOString()
        });
        // 2. Release funds to seller wallet
        const sellerWallet = await trx('wallets').where({ user_id: order.seller_id }).first();
        if (sellerWallet) {
            await trx('wallets')
                .where({ id: sellerWallet.id })
                .increment('balance', order.seller_net)
                .increment('total_earned', order.seller_net);
            await trx('wallet_transactions').insert({
                id: (0, uuid_1.v4)(),
                wallet_id: sellerWallet.id,
                type: 'escrow_release',
                amount: order.seller_net,
                description: `Pelepasan dana pesanan #${orderId.slice(-8)}`,
                reference_id: orderId
            });
        }
    });
}
/**
 * Auto-confirm orders that have been in 'dikirim' status for more than 3 days.
 * Should be called by a cron job.
 */
async function runAutoConfirmJob() {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const ordersToConfirm = await (0, knex_1.default)('orders')
        .where({ status: 'dikirim' })
        .andWhere('updated_at', '<', threeDaysAgo);
    for (const order of ordersToConfirm) {
        console.log(`🤖 [Auto-Ender] Confirming Order #${order.id.slice(-8)}`);
        await confirmOrderReceipt(order.id);
    }
}
//# sourceMappingURL=transactionService.js.map
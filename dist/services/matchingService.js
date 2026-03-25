"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportSupply = reportSupply;
exports.reportDemand = reportDemand;
exports.getMatchesForUser = getMatchesForUser;
const uuid_1 = require("uuid");
const knex_1 = __importDefault(require("../config/knex"));
async function reportSupply(userId, data) {
    const id = (0, uuid_1.v4)();
    const now = new Date().toISOString();
    await (0, knex_1.default)('supply_reports').insert({
        id,
        reporter_id: userId,
        komoditas: data.komoditas,
        jumlah_kg: data.jumlah_kg,
        harga_per_kg: data.harga_per_kg,
        kabupaten: data.kabupaten,
        provinsi: data.provinsi || '',
        tanggal_tersedia: data.tanggal_tersedia || now.split('T')[0],
        is_active: true,
        created_at: now,
        updated_at: now,
    });
    const matches = await runMatchingFor(id, 'supply');
    return { id, matchesFound: matches.length };
}
async function reportDemand(userId, data) {
    const id = (0, uuid_1.v4)();
    const now = new Date().toISOString();
    await (0, knex_1.default)('demand_requests').insert({
        id,
        requester_id: userId,
        komoditas: data.komoditas,
        jumlah_kg: data.jumlah_kg,
        harga_max_per_kg: data.harga_max_per_kg,
        kota_tujuan: data.kabupaten, // Mapping kabupaten to kota_tujuan based on schema
        deadline: data.deadline || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        is_active: true,
        created_at: now,
        updated_at: now,
    });
    const matches = await runMatchingFor(id, 'demand');
    return { id, matchesFound: matches.length };
}
async function getMatchesForUser(userId) {
    // Fetch matches where the user is either the supplier or the requester
    const matches = await (0, knex_1.default)('match_history')
        .join('supply_reports', 'match_history.supply_id', 'supply_reports.id')
        .join('demand_requests', 'match_history.demand_id', 'demand_requests.id')
        .where('supply_reports.reporter_id', userId)
        .orWhere('demand_requests.requester_id', userId)
        .select('match_history.*', 'supply_reports.komoditas', 'supply_reports.jumlah_kg as supply_qty', 'supply_reports.harga_per_kg as supply_price', 'supply_reports.kabupaten as supply_loc', 'demand_requests.jumlah_kg as demand_qty', 'demand_requests.harga_max_per_kg as demand_price', 'demand_requests.kota_tujuan as demand_loc')
        .orderBy('match_history.created_at', 'desc')
        .limit(10);
    return matches;
}
async function runMatchingFor(reportId, type) {
    const matches = [];
    if (type === 'supply') {
        const supply = await (0, knex_1.default)('supply_reports').where({ id: reportId }).first();
        if (!supply)
            return matches;
        const demands = await (0, knex_1.default)('demand_requests')
            .join('users', 'demand_requests.requester_id', 'users.id')
            .where({ komoditas: supply.komoditas, 'demand_requests.is_active': true })
            .where('harga_max_per_kg', '>=', supply.harga_per_kg)
            .select('demand_requests.*', 'users.phone', 'users.whatsapp_lid', 'users.name as requester_name');
        for (const demand of demands) {
            const score = calculateMatchScore(supply, demand);
            if (score >= 60) {
                const matchId = (0, uuid_1.v4)();
                await (0, knex_1.default)('match_history').insert({
                    id: matchId,
                    supply_id: supply.id,
                    demand_id: demand.id,
                    score: score,
                    distance_km: 0,
                    price_diff_pct: ((demand.harga_max_per_kg - supply.harga_per_kg) / demand.harga_max_per_kg) * 100,
                    created_at: new Date().toISOString(),
                });
                matches.push({
                    id: matchId,
                    score,
                    matched_user_id: demand.requester_id,
                    matched_user_name: demand.requester_name,
                    matched_phone: demand.phone,
                    matched_lid: demand.whatsapp_lid,
                    demand_id: demand.id,
                    komoditas: supply.komoditas,
                    price: demand.harga_max_per_kg,
                    qty: demand.jumlah_kg,
                    location: demand.kota_tujuan
                });
            }
        }
    }
    else {
        const demand = await (0, knex_1.default)('demand_requests').where({ id: reportId }).first();
        if (!demand)
            return matches;
        const supplies = await (0, knex_1.default)('supply_reports')
            .join('users', 'supply_reports.reporter_id', 'users.id')
            .where({ komoditas: demand.komoditas, 'supply_reports.is_active': true })
            .where('harga_per_kg', '<=', demand.harga_max_per_kg)
            .select('supply_reports.*', 'users.phone', 'users.whatsapp_lid', 'users.name as reporter_name');
        for (const supply of supplies) {
            const score = calculateMatchScore(supply, demand);
            if (score >= 60) {
                const matchId = (0, uuid_1.v4)();
                await (0, knex_1.default)('match_history').insert({
                    id: matchId,
                    supply_id: supply.id,
                    demand_id: demand.id,
                    score: score,
                    distance_km: 0,
                    price_diff_pct: ((demand.harga_max_per_kg - supply.harga_per_kg) / demand.harga_max_per_kg) * 100,
                    created_at: new Date().toISOString(),
                });
                matches.push({
                    id: matchId,
                    score,
                    matched_user_id: supply.reporter_id,
                    matched_user_name: supply.reporter_name,
                    matched_phone: supply.phone,
                    matched_lid: supply.whatsapp_lid,
                    supply_id: supply.id,
                    komoditas: demand.komoditas,
                    price: supply.harga_per_kg,
                    qty: supply.jumlah_kg,
                    location: supply.kabupaten
                });
            }
        }
    }
    return matches;
}
function calculateMatchScore(supply, demand) {
    let score = 50;
    // Price matching
    const priceDiff = demand.harga_max_per_kg - supply.harga_per_kg;
    if (priceDiff >= 0) {
        score += Math.min(30, (priceDiff / demand.harga_max_per_kg) * 100);
    }
    // Location matching (very basic for now)
    if (supply.kabupaten === demand.kota_tujuan) {
        score += 20;
    }
    else if (supply.provinsi === demand.provinsi) {
        score += 10;
    }
    return Math.min(score, 100);
}
//# sourceMappingURL=matchingService.js.map
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const knex_1 = __importDefault(require("../config/knex"));
const auth_1 = require("../middleware/auth");
const matchingService = __importStar(require("../services/matchingService"));
const router = (0, express_1.Router)();
// ─── POST /api/matching/supply — Lapor surplus stok ──────────────────────
router.post('/supply', auth_1.requireAuth, async (req, res) => {
    try {
        const { komoditas, jumlah_kg, harga_per_kg, kabupaten, provinsi, tanggal_tersedia } = req.body;
        if (!komoditas || !jumlah_kg || !harga_per_kg || !kabupaten) {
            res.status(400).json({ success: false, error: 'komoditas, jumlah_kg, harga_per_kg, kabupaten wajib' });
            return;
        }
        const result = await matchingService.reportSupply(req.user.id, {
            komoditas,
            jumlah_kg: Number(jumlah_kg),
            harga_per_kg: Number(harga_per_kg),
            kabupaten,
            provinsi,
            tanggal_tersedia
        });
        res.status(201).json({ success: true, data: { id: result.id, matches_found: result.matchesFound } });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// ─── POST /api/matching/demand — Lapor kebutuhan ─────────────────────────
router.post('/demand', auth_1.requireAuth, async (req, res) => {
    try {
        const { komoditas, jumlah_kg, harga_max_per_kg, kabupaten, deadline } = req.body;
        if (!komoditas || !jumlah_kg || !harga_max_per_kg || !kabupaten) {
            res.status(400).json({ success: false, error: 'komoditas, jumlah_kg, harga_max_per_kg, kabupaten wajib' });
            return;
        }
        const result = await matchingService.reportDemand(req.user.id, {
            komoditas,
            jumlah_kg: Number(jumlah_kg),
            harga_max_per_kg: Number(harga_max_per_kg),
            kabupaten,
            deadline
        });
        res.status(201).json({ success: true, data: { id: result.id, matches_found: result.matchesFound } });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
// ─── GET /api/matching/feed — List matches yang relevan ──────────────────
router.get('/feed', auth_1.requireAuth, async (req, res) => {
    try {
        const { provinsi } = req.query;
        let query = (0, knex_1.default)('match_history')
            .join('supply_reports', 'match_history.supply_id', 'supply_reports.id')
            .join('demand_requests', 'match_history.demand_id', 'demand_requests.id')
            .join('komoditas', 'supply_reports.komoditas', 'komoditas.nama')
            .where('supply_reports.is_active', true)
            .orderBy('match_history.score', 'desc')
            .select('match_history.*', 'komoditas.nama as komoditas_nama', 'supply_reports.kabupaten as supply_kabupaten', 'supply_reports.provinsi as supply_provinsi', 'demand_requests.kota_tujuan as demand_kabupaten')
            .limit(20);
        if (provinsi)
            query = query.where(function () {
                this.where('supply_reports.provinsi', provinsi);
            });
        const feed = await query;
        res.json({ success: true, data: feed });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Gagal fetch feed matching: ' + err.message });
    }
});
// ─── GET /api/matching/my-supply ─────────────────────────────────────────
router.get('/my-supply', auth_1.requireAuth, async (req, res) => {
    try {
        const reports = await (0, knex_1.default)('supply_reports')
            .where('supply_reports.reporter_id', req.user.id)
            .orderBy('supply_reports.created_at', 'desc');
        res.json({ success: true, data: reports });
    }
    catch {
        res.status(500).json({ success: false, error: 'Gagal fetch supply' });
    }
});
exports.default = router;
//# sourceMappingURL=matching.js.map
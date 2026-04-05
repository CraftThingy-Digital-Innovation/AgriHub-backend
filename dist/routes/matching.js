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
// ─── POST /api/matching/demand — Lapor kebutuhan (Wishlist) ────────────────
router.post('/demand', auth_1.requireAuth, async (req, res) => {
    try {
        const { komoditas, jumlah_kg, harga_max_per_kg, address_id } = req.body;
        if (!komoditas || !jumlah_kg || !harga_max_per_kg || !address_id) {
            res.status(400).json({ success: false, error: 'komoditas, jumlah_kg, harga_max_per_kg, address_id wajib' });
            return;
        }
        // Pastikan address_id milik user ini
        const address = await (0, knex_1.default)('user_addresses').where({ id: address_id, user_id: req.user.id }).first();
        if (!address) {
            res.status(403).json({ success: false, error: 'Alamat tidak ditemukan atau bukan milik Anda' });
            return;
        }
        const result = await matchingService.createWishlist(req.user.id, {
            komoditas,
            jumlah_kg: Number(jumlah_kg),
            harga_max_per_kg: Number(harga_max_per_kg),
            address_id
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
        const feed = await matchingService.getMatchesForUser(req.user.id);
        res.json({ success: true, data: feed });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Gagal fetch feed matching: ' + err.message });
    }
});
// ─── DELETE /api/matching/demand/:id — Hapus Wishlist ───────────────────
router.delete('/demand/:id', auth_1.requireAuth, async (req, res) => {
    try {
        const demand = await (0, knex_1.default)('demand_requests').where({ id: req.params.id, requester_id: req.user.id }).first();
        if (!demand) {
            res.status(404).json({ success: false, error: 'Wishlist tidak ditemukan' });
            return;
        }
        await (0, knex_1.default)('demand_requests').where({ id: req.params.id }).update({ is_active: false });
        res.json({ success: true, message: 'Wishlist dinonaktifkan' });
    }
    catch {
        res.status(500).json({ success: false, error: 'Gagal hapus wishlist' });
    }
});
exports.default = router;
//# sourceMappingURL=matching.js.map
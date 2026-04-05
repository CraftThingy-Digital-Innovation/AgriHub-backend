"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const uuid_1 = require("uuid");
const knex_1 = __importDefault(require("../config/knex"));
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
/**
 * POST /api/auth/register
 * Daftar user baru (phone + password atau Puter OAuth)
 */
router.post('/register', async (req, res) => {
    try {
        const { phone, name, email, password, puter_user_id } = req.body;
        if (!phone || !name) {
            res.status(400).json({ success: false, error: 'Phone dan nama wajib diisi' });
            return;
        }
        const exists = await (0, knex_1.default)('users').where({ phone }).first();
        if (exists) {
            res.status(409).json({ success: false, error: 'Nomor HP sudah terdaftar' });
            return;
        }
        const password_hash = password ? await bcryptjs_1.default.hash(password, 10) : null;
        const id = (0, uuid_1.v4)();
        const now = new Date().toISOString();
        await (0, knex_1.default)('users').insert({
            id, phone, name, email: email || null, password_hash,
            role: 'konsumen', is_verified: false,
            puter_user_id: puter_user_id || null,
            created_at: now, updated_at: now,
        });
        // Buat wallet otomatis
        await (0, knex_1.default)('wallets').insert({
            id: (0, uuid_1.v4)(), user_id: id, balance: 0, pending_balance: 0,
            total_earned: 0, total_withdrawn: 0,
            created_at: now, updated_at: now,
        });
        const token = jsonwebtoken_1.default.sign({ id }, process.env.JWT_SECRET || 'secret', { expiresIn: '30d' });
        const user = await (0, knex_1.default)('users').where({ id }).first();
        res.status(201).json({ success: true, data: { user, token } });
    }
    catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: 'Gagal daftar' });
    }
});
/**
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
    try {
        const { phone, password, puter_user_id } = req.body;
        let user;
        if (puter_user_id) {
            // Puter OAuth login
            user = await (0, knex_1.default)('users').where({ puter_user_id }).first();
        }
        else {
            if (!phone || !password) {
                res.status(400).json({ success: false, error: 'Phone dan password wajib diisi' });
                return;
            }
            user = await (0, knex_1.default)('users').where({ phone }).first();
            if (!user?.password_hash) {
                res.status(401).json({ success: false, error: 'Akun tidak ditemukan' });
                return;
            }
            const valid = await bcryptjs_1.default.compare(password, user.password_hash);
            if (!valid) {
                res.status(401).json({ success: false, error: 'Password salah' });
                return;
            }
        }
        if (!user) {
            res.status(404).json({ success: false, error: 'User tidak ditemukan' });
            return;
        }
        const token = jsonwebtoken_1.default.sign({ id: user.id }, process.env.JWT_SECRET || 'secret', { expiresIn: '30d' });
        const { password_hash: _, ...safeUser } = user;
        res.json({ success: true, data: { user: safeUser, token } });
    }
    catch {
        res.status(500).json({ success: false, error: 'Gagal login' });
    }
});
/**
 * GET /api/auth/me
 */
router.get('/me', auth_1.requireAuth, async (req, res) => {
    try {
        const user = await (0, knex_1.default)('users').where({ id: req.user.id }).first();
        const wallet = await (0, knex_1.default)('wallets').where({ user_id: req.user.id }).first();
        const { password_hash: _, ...safeUser } = user;
        res.json({ success: true, data: { user: safeUser, wallet } });
    }
    catch {
        res.status(500).json({ success: false, error: 'Gagal fetch user' });
    }
});
/**
 * PATCH /api/auth/puter-token
 * Simpan token OAuth Puter.js user
 */
router.patch('/puter-token', auth_1.requireAuth, async (req, res) => {
    try {
        const { token } = req.body;
        await (0, knex_1.default)('users').where({ id: req.user.id }).update({
            puter_token: token,
            updated_at: new Date().toISOString(),
        });
        res.json({ success: true, message: 'Puter Token berhasil disimpan' });
    }
    catch {
        res.status(500).json({ success: false, error: 'Gagal simpan token' });
    }
});
/**
 * PATCH /api/auth/link-whatsapp
 * Tautkan WhatsApp LID/JID ke account ini (dipakai dari web setelah login)
 * Mendukung: lid, jid (opsional), phone (opsional untuk update jika beda)
 */
router.patch('/link-whatsapp', auth_1.requireAuth, async (req, res) => {
    try {
        const { lid, jid, phone } = req.body;
        if (!lid) {
            res.status(400).json({ success: false, error: 'LID tidak ditemukan' });
            return;
        }
        const updates = {
            whatsapp_lid: lid,
            updated_at: new Date().toISOString(),
        };
        // Opsional update phone jika berbeda (misalnya nomor baru)
        if (phone)
            updates.phone = phone;
        await (0, knex_1.default)('users').where({ id: req.user.id }).update(updates);
        console.log(`🔗 [Auth] User ${req.user.id} re-linked WA: lid=${lid} | jid=${jid || 'n/a'} | phone=${phone || 'n/a'}`);
        res.json({ success: true, message: 'WhatsApp ID berhasil ditautkan' });
    }
    catch {
        res.status(500).json({ success: false, error: 'Gagal tautkan WhatsApp' });
    }
});
/**
 * GET /api/auth/wa-relink-init
 * Dipanggil oleh WA Bot: generate short-lived JWT untuk relink WA tanpa login manual.
 * User diidentifikasi via phone (dari JID/LID yang terdeteksi WA).
 * Token berlaku 15 menit, berisi { userId, lid, phone, purpose: 'wa-relink' }.
 */
router.get('/wa-relink-init', async (req, res) => {
    try {
        const { phone, lid } = req.query;
        if (!phone) {
            res.status(400).json({ success: false, error: 'Phone wajib disertakan' });
            return;
        }
        const user = await (0, knex_1.default)('users').where('phone', 'like', `%${phone.slice(-9)}%`).first();
        if (!user) {
            res.status(404).json({ success: false, error: 'User tidak ditemukan' });
            return;
        }
        // Generate token khusus re-link (15 menit)
        const relinkToken = jsonwebtoken_1.default.sign({ userId: user.id, lid: lid || null, phone, purpose: 'wa-relink' }, process.env.JWT_SECRET || 'secret', { expiresIn: '15m' });
        res.json({ success: true, token: relinkToken, name: user.name });
    }
    catch {
        res.status(500).json({ success: false, error: 'Gagal generate relink token' });
    }
});
/**
 * POST /api/auth/wa-relink
 * Dipakai dari frontend (tanpa login wajib, tapi pakai relinkToken dari WA).
 * Memvalidasi token re-link dan update whatsapp_lid user di DB.
 */
router.post('/wa-relink', async (req, res) => {
    try {
        const { relinkToken, lid, phone } = req.body;
        if (!relinkToken || !lid) {
            res.status(400).json({ success: false, error: 'relinkToken dan lid diperlukan' });
            return;
        }
        let payload;
        try {
            payload = jsonwebtoken_1.default.verify(relinkToken, process.env.JWT_SECRET || 'secret');
        }
        catch {
            res.status(401).json({ success: false, error: 'Token re-link tidak valid atau sudah kadaluarsa. Silakan minta link baru dari bot.' });
            return;
        }
        if (payload.purpose !== 'wa-relink') {
            res.status(403).json({ success: false, error: 'Token tidak valid untuk re-link WA' });
            return;
        }
        const updates = {
            whatsapp_lid: lid,
            updated_at: new Date().toISOString(),
        };
        if (phone)
            updates.phone = phone;
        await (0, knex_1.default)('users').where({ id: payload.userId }).update(updates);
        console.log(`🔗 [Auth] WA Re-link berhasil untuk user ${payload.userId}: lid=${lid}`);
        // Kembalikan juga JWT login biasa agar user langsung terlogin di web
        const accessToken = jsonwebtoken_1.default.sign({ id: payload.userId }, process.env.JWT_SECRET || 'secret', { expiresIn: '30d' });
        const user = await (0, knex_1.default)('users').where({ id: payload.userId }).first();
        const { password_hash: _, ...safeUser } = user;
        res.json({ success: true, message: 'WhatsApp berhasil ditautkan ulang!', data: { user: safeUser, token: accessToken } });
    }
    catch {
        res.status(500).json({ success: false, error: 'Gagal proses re-link' });
    }
});
/**
 * GET /api/auth/check-phone/:phone
 */
router.get('/check-phone/:phone', async (req, res) => {
    try {
        const { phone } = req.params;
        const user = await (0, knex_1.default)('users').where('phone', 'like', `%${phone.slice(-9)}%`).first();
        res.json({
            success: true,
            exists: !!user,
            name: user?.name // Kirim nama jika ada untuk menyapa
        });
    }
    catch {
        res.status(500).json({ success: false, error: 'Gagal cek nomor' });
    }
});
// ─── WA Magic Link Sessions ───────────────────────────────────────────────
/**
 * POST /api/auth/wa-magic-session
 * [Internal] Dipakai oleh WA Bot untuk membuat session baru.
 * Bisa diakses tanpa auth karena dipanggil dari dalam server.
 */
router.post('/wa-magic-session', async (req, res) => {
    try {
        const { phone, lid, jid, user_id, purpose } = req.body;
        if (!purpose) {
            res.status(400).json({ success: false, error: 'purpose wajib diisi' });
            return;
        }
        const id = (0, uuid_1.v4)();
        const now = new Date().toISOString();
        await (0, knex_1.default)('wa_magic_sessions').insert({ id, phone, lid, jid, user_id: user_id || null, purpose, status: 'pending', created_at: now });
        res.json({ success: true, sessionId: id });
    }
    catch (err) {
        console.error('[wa-magic-session create]', err);
        res.status(500).json({ success: false, error: 'Gagal membuat session' });
    }
});
/**
 * GET /api/auth/wa-magic-session/:sessionId
 * [Publik] Dipakai frontend untuk mendapatkan info session.
 */
router.get('/wa-magic-session/:sessionId', async (req, res) => {
    try {
        const session = await (0, knex_1.default)('wa_magic_sessions').where({ id: req.params.sessionId }).first();
        if (!session) {
            res.status(404).json({ success: false, error: 'Session tidak ditemukan' });
            return;
        }
        if (session.status === 'completed') {
            res.status(410).json({ success: false, error: 'Session sudah selesai dan tidak aktif lagi', completed: true });
            return;
        }
        // Kembalikan info yang dibutuhkan frontend (tanpa data sensitif dari DB user lain)
        let userName = null;
        if (session.user_id) {
            const u = await (0, knex_1.default)('users').where({ id: session.user_id }).select('name').first();
            userName = u?.name || null;
        }
        res.json({ success: true, data: { purpose: session.purpose, phone: session.phone, lid: session.lid, userName } });
    }
    catch {
        res.status(500).json({ success: false, error: 'Gagal mengambil session' });
    }
});
/**
 * POST /api/auth/wa-magic-session/:sessionId/complete
 * [Publik via sessionId as auth] Frontend memanggil ini setelah Puter OAuth sukses.
 * Menyimpan token, update/create user, invalidate session, dan return JWT login.
 */
router.post('/wa-magic-session/:sessionId/complete', async (req, res) => {
    try {
        const session = await (0, knex_1.default)('wa_magic_sessions').where({ id: req.params.sessionId, status: 'pending' }).first();
        if (!session) {
            res.status(404).json({ success: false, error: 'Session tidak valid atau sudah selesai' });
            return;
        }
        const { puter_token, puter_user_id, puter_name } = req.body;
        if (!puter_token) {
            res.status(400).json({ success: false, error: 'puter_token wajib diisi' });
            return;
        }
        const now = new Date().toISOString();
        let userId = session.user_id;
        if (session.purpose === 'full-setup') {
            // User belum terdaftar sama sekali — buat akun baru
            if (!session.phone) {
                res.status(400).json({ success: false, error: 'Nomor HP tidak terdeteksi, tidak bisa buat akun otomatis' });
                return;
            }
            // Cek ulang apakah sudah ada (race condition guard)
            const existing = await (0, knex_1.default)('users').where('phone', 'like', `%${session.phone.slice(-9)}%`).first();
            if (existing) {
                userId = existing.id;
            }
            else {
                userId = (0, uuid_1.v4)();
                const name = puter_name || `User_${session.phone.slice(-4)}`;
                await (0, knex_1.default)('users').insert({
                    id: userId,
                    phone: session.phone,
                    name,
                    role: 'konsumen',
                    is_verified: false,
                    puter_user_id: puter_user_id || null,
                    puter_token,
                    whatsapp_lid: session.lid || null,
                    created_at: now,
                    updated_at: now,
                });
                // Buat wallet otomatis
                await (0, knex_1.default)('wallets').insert({
                    id: (0, uuid_1.v4)(), user_id: userId, balance: 0, pending_balance: 0,
                    total_earned: 0, total_withdrawn: 0, created_at: now, updated_at: now,
                });
                console.log(`🆕 [Auth] Auto-created user via WA magic: ${userId} (${name}, ${session.phone})`);
            }
        }
        // Update user yang sudah ada (connect-puter / relink / atau user baru di atas)
        const updates = { puter_token, updated_at: now };
        if (puter_user_id)
            updates.puter_user_id = puter_user_id;
        if (session.lid)
            updates.whatsapp_lid = session.lid;
        await (0, knex_1.default)('users').where({ id: userId }).update(updates);
        console.log(`🔗 [Auth] Magic session completed. User ${userId} | purpose: ${session.purpose} | lid: ${session.lid}`);
        // Invalidate session
        await (0, knex_1.default)('wa_magic_sessions').where({ id: req.params.sessionId }).update({ status: 'completed', completed_at: now });
        // Kembalikan JWT agar user langsung terlogin di web jika mau
        const accessToken = jsonwebtoken_1.default.sign({ id: userId }, process.env.JWT_SECRET || 'secret', { expiresIn: '30d' });
        const user = await (0, knex_1.default)('users').where({ id: userId }).first();
        const { password_hash: _, ...safeUser } = user;
        res.json({ success: true, message: 'Puter berhasil dihubungkan dan WhatsApp tertaut!', data: { user: safeUser, token: accessToken } });
    }
    catch (err) {
        console.error('[wa-magic-session complete]', err);
        res.status(500).json({ success: false, error: 'Gagal menyelesaikan setup' });
    }
});
exports.default = router;
//# sourceMappingURL=auth.js.map
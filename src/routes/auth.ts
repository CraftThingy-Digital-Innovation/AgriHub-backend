import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import db from '../config/knex';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { sendVerificationEmail } from '../services/emailService';
import { sendWAMessage } from '../services/whatsappBot';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────
const JWT_SECRET = () => process.env.JWT_SECRET || 'secret';
const signToken = (id: string) => jwt.sign({ id }, JWT_SECRET(), { expiresIn: '30d' });
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();
const otpExpiry = () => new Date(Date.now() + 10 * 60 * 1000).toISOString();

function safeUser(user: any) {
  if (!user) return null;
  const { password_hash, email_verify_token, phone_otp, email_verify_expires, phone_otp_expires, ...safe } = user;
  return safe;
}

function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password minimal 8 karakter';
  if (!/[A-Z]/.test(password)) return 'Password harus mengandung huruf kapital (A-Z)';
  if (!/[a-z]/.test(password)) return 'Password harus mengandung huruf kecil (a-z)';
  if (!/\d/.test(password)) return 'Password harus mengandung angka';
  if (!/[!@#$%^&*()\-_=+\[\]{};':"\\|,.<>\/?]/.test(password)) return 'Password harus mengandung karakter spesial (!@#$%...)';
  return null;
}

function normalizeIdentifier(identifier: string): { field: string; value: string } {
  const clean = identifier.trim();
  if (clean.includes('@')) return { field: 'email', value: clean.toLowerCase() };
  if (/^\+?[0-9]{8,15}$/.test(clean.replace(/[\s\-]/g, ''))) return { field: 'phone', value: clean.replace(/[\s\-]/g, '') };
  return { field: 'username', value: clean.toLowerCase() };
}

// ─── POST /api/auth/register ──────────────────────────────────────────────────
router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const { phone, name, username, email, password } = req.body;

    if (!phone || !name || !password) {
      res.status(400).json({ success: false, error: 'Nomor HP, nama, dan password wajib diisi' }); return;
    }
    const pwErr = validatePassword(password);
    if (pwErr) { res.status(400).json({ success: false, error: pwErr }); return; }

    const existsPhone = await db('users').where('phone', 'like', `%${phone.slice(-9)}%`).first();
    if (existsPhone) { res.status(409).json({ success: false, error: 'Nomor HP sudah terdaftar' }); return; }

    if (username) {
      if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
        res.status(400).json({ success: false, error: 'Username hanya huruf, angka, underscore (3-30 karakter)' }); return;
      }
      const existsUser = await db('users').whereRaw('LOWER(username) = ?', [username.toLowerCase()]).first();
      if (existsUser) { res.status(409).json({ success: false, error: 'Username sudah digunakan' }); return; }
    }
    if (email) {
      const existsEmail = await db('users').whereRaw('LOWER(email) = ?', [email.toLowerCase()]).first();
      if (existsEmail) { res.status(409).json({ success: false, error: 'Email sudah terdaftar' }); return; }
    }

    const password_hash = await bcrypt.hash(password, 10);
    const id = uuidv4();
    const now = new Date().toISOString();
    const emailVerifyToken = email ? uuidv4() : null;
    const emailVerifyExpires = email ? new Date(Date.now() + 24 * 3600 * 1000).toISOString() : null;

    await db('users').insert({
      id, phone, name,
      username: username?.toLowerCase() || null,
      email: email?.toLowerCase() || null,
      password_hash,
      role: 'konsumen',
      is_verified: false,
      email_verified: false,
      email_verify_token: emailVerifyToken,
      email_verify_expires: emailVerifyExpires,
      phone_verified: false,
      created_at: now, updated_at: now,
    });

    await db('wallets').insert({
      id: uuidv4(), user_id: id, balance: 0, pending_balance: 0,
      total_earned: 0, total_withdrawn: 0, created_at: now, updated_at: now,
    });

    if (email && emailVerifyToken) {
      sendVerificationEmail(email, emailVerifyToken, name).catch(console.error);
    }

    const token = signToken(id);
    const user = await db('users').where({ id }).first();
    res.status(201).json({ success: true, data: { user: safeUser(user), token } });
  } catch (err) {
    console.error('[register]', err);
    res.status(500).json({ success: false, error: 'Gagal mendaftar' });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { identifier, phone, password, puter_user_id } = req.body;
    const id_ = identifier || phone;

    if (puter_user_id) {
      const user = await db('users').where({ puter_user_id }).first();
      if (!user) { res.status(404).json({ success: false, error: 'Akun Puter tidak ditemukan' }); return; }
      res.json({ success: true, data: { user: safeUser(user), token: signToken(user.id) } });
      return;
    }

    if (!id_ || !password) {
      res.status(400).json({ success: false, error: 'Identifier dan password wajib diisi' }); return;
    }

    const { field, value } = normalizeIdentifier(id_);
    let user: any;
    if (field === 'phone') {
      user = await db('users').where('phone', 'like', `%${value.slice(-9)}%`).first();
    } else if (field === 'email') {
      user = await db('users').whereRaw('LOWER(email) = ?', [value]).first();
    } else {
      user = await db('users').whereRaw('LOWER(username) = ?', [value]).first();
    }

    if (!user?.password_hash) {
      console.log(`[Login] ${field} '${value}' found, but HAS NO PASSWORD_HASH.`);
      res.status(401).json({ success: false, error: 'Akun tidak ditemukan atau belum punya password' }); return;
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) { 
      console.log(`[Login] ${field} '${value}' found. PASSWORD MISMATCH.`);
      res.status(401).json({ success: false, error: 'Password salah' }); return; 
    }

    console.log(`[Login] ${field} '${value}' SUCCESS.`);
    res.json({ success: true, data: { user: safeUser(user), token: signToken(user.id) } });
  } catch (err) {
    console.error('[login]', err);
    res.status(500).json({ success: false, error: 'Gagal login' });
  }
});

// ─── POST /api/auth/login-puter ───────────────────────────────────────────────
router.post('/login-puter', async (req: Request, res: Response): Promise<void> => {
  try {
    const { puter_token, puter_user_id, puter_name, puter_email, puter_username } = req.body;
    if (!puter_token || !puter_user_id) {
      res.status(400).json({ success: false, error: 'puter_token dan puter_user_id wajib' }); return;
    }

    const now = new Date().toISOString();
    let user = await db('users').where({ puter_user_id }).first();
    if (!user && puter_email) {
      user = await db('users').whereRaw('LOWER(email) = ?', [puter_email.toLowerCase()]).first();
    }

    if (user) {
      await db('users').where({ id: user.id }).update({ puter_token, puter_user_id, updated_at: now });
      const fresh = await db('users').where({ id: user.id }).first();
      res.json({ success: true, data: { user: safeUser(fresh), token: signToken(user.id), needs_phone: !user.phone || !user.phone_verified, needs_password: !user.password_hash } });
    } else {
      // Akun baru via Puter — perlu phone + password setelah ini
      const tempUsername = puter_username?.toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 30) || null;
      const id = uuidv4();
      // MySQL schema mengharuskan phone NOT NULL — gunakan placeholder unik hingga user isi sendiri
      const tempPhone = `PUTER_${id.slice(0, 8)}`;
      await db('users').insert({
        id,
        phone: tempPhone,
        name: puter_name || puter_username || 'Pengguna Puter',
        username: tempUsername,
        email: puter_email?.toLowerCase() || null,
        email_verified: !!puter_email,
        puter_user_id,
        puter_token,
        role: 'konsumen',
        is_verified: false,
        phone_verified: false,
        created_at: now, updated_at: now,
      });
      await db('wallets').insert({
        id: uuidv4(), user_id: id, balance: 0, pending_balance: 0,
        total_earned: 0, total_withdrawn: 0, created_at: now, updated_at: now,
      });
      const newUser = await db('users').where({ id }).first();
      res.status(201).json({ success: true, data: { user: safeUser(newUser), token: signToken(id), needs_phone: true, needs_password: true, is_new: true } });
    }
  } catch (err) {
    console.error('[login-puter]', err);
    res.status(500).json({ success: false, error: 'Gagal login dengan Puter' });
  }
});

// ─── POST /api/auth/complete-puter-profile ────────────────────────────────────
// Setelah daftar via Puter, isi phone + password. OTP dikirim via WA.
router.post('/complete-puter-profile', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { phone, password, retype_password } = req.body;
    if (!phone) { res.status(400).json({ success: false, error: 'Nomor HP wajib diisi' }); return; }

    if (password) {
      if (password !== retype_password) { res.status(400).json({ success: false, error: 'Password tidak cocok' }); return; }
      const pwErr = validatePassword(password);
      if (pwErr) { res.status(400).json({ success: false, error: pwErr }); return; }
    }

    const existing = await db('users').where('phone', 'like', `%${phone.slice(-9)}%`).whereNot({ id: req.user!.id }).first();
    if (existing) { res.status(409).json({ success: false, error: 'Nomor HP sudah digunakan akun lain' }); return; }

    const updates: any = { phone, updated_at: new Date().toISOString() };
    if (password && password.trim() !== '') {
      updates.password_hash = await bcrypt.hash(password, 10);
      console.log(`[CompleteProfile] Password hash updated for user ${req.user!.id}`);
    }
    await db('users').where({ id: req.user!.id }).update(updates);

    // Kirim OTP ke WA
    const otp = generateOTP();
    await db('users').where({ id: req.user!.id }).update({ phone_otp: otp, phone_otp_expires: otpExpiry() });
    try {
      await (sendWAMessage as any)(phone, `🌾 *AgriHub* — Kode OTP verifikasi nomor Anda:\n\n*${otp}*\n\n_Berlaku 10 menit. Jangan bagikan ke siapapun._`);
    } catch (e) { console.warn('[OTP] WA send failed:', e); console.log(`[OTP DEV] ${phone} → ${otp}`); }

    const user = await db('users').where({ id: req.user!.id }).first();
    res.json({ success: true, message: 'Profil diperbarui. OTP dikirim ke WhatsApp.', data: { user: safeUser(user) } });
  } catch (err) {
    console.error('[complete-puter-profile]', err);
    res.status(500).json({ success: false, error: 'Gagal memperbarui profil' });
  }
});

// ─── POST /api/auth/send-phone-otp ────────────────────────────────────────────
router.post('/send-phone-otp', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await db('users').where({ id: req.user!.id }).first();
    if (!user?.phone) { res.status(400).json({ success: false, error: 'Nomor HP belum terdaftar' }); return; }
    if (user.phone_verified) { res.json({ success: true, message: 'Nomor sudah terverifikasi' }); return; }

    const otp = generateOTP();
    await db('users').where({ id: user.id }).update({ phone_otp: otp, phone_otp_expires: otpExpiry() });
    try {
      await (sendWAMessage as any)(user.phone, `🌾 *AgriHub* — Kode OTP verifikasi nomor Anda:\n\n*${otp}*\n\n_Berlaku 10 menit. Jangan bagikan ke siapapun._`);
      res.json({ success: true, message: `OTP dikirim ke WhatsApp ${user.phone}` });
    } catch {
      console.log(`[OTP DEV] ${user.phone} → ${otp}`);
      res.json({ success: true, message: 'OTP digenerate (cek log server)', dev_otp: process.env.NODE_ENV !== 'production' ? otp : undefined });
    }
  } catch { res.status(500).json({ success: false, error: 'Gagal kirim OTP' }); }
});

// ─── POST /api/auth/verify-phone-otp ──────────────────────────────────────────
router.post('/verify-phone-otp', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { otp } = req.body;
    const user = await db('users').where({ id: req.user!.id }).first();
    if (!user?.phone_otp) { res.status(400).json({ success: false, error: 'Tidak ada OTP aktif' }); return; }
    if (new Date(user.phone_otp_expires) < new Date()) { res.status(400).json({ success: false, error: 'OTP kadaluarsa' }); return; }
    if (user.phone_otp !== otp?.toString()) { res.status(400).json({ success: false, error: 'OTP salah' }); return; }

    await db('users').where({ id: user.id }).update({ phone_verified: true, phone_otp: null, phone_otp_expires: null, is_verified: true, updated_at: new Date().toISOString() });
    const fresh = await db('users').where({ id: user.id }).first();
    res.json({ success: true, message: 'Nomor HP berhasil diverifikasi!', data: { user: safeUser(fresh) } });
  } catch { res.status(500).json({ success: false, error: 'Gagal verifikasi OTP' }); }
});

// ─── GET /api/auth/verify-email ───────────────────────────────────────────────
router.get('/verify-email', async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.query as { token: string };
    if (!token) { res.redirect('/login?error=token_missing'); return; }
    const user = await db('users').where({ email_verify_token: token }).first();
    if (!user) { res.redirect('/login?error=invalid_token'); return; }
    if (user.email_verified) { res.redirect('/app?email_verified=already'); return; }
    if (new Date(user.email_verify_expires) < new Date()) { res.redirect('/login?error=token_expired'); return; }
    await db('users').where({ id: user.id }).update({ email_verified: true, email_verify_token: null, email_verify_expires: null, updated_at: new Date().toISOString() });
    res.redirect('/app?email_verified=1');
  } catch { res.redirect('/login?error=server_error'); }
});

// ─── POST /api/auth/resend-verify-email ──────────────────────────────────────
router.post('/resend-verify-email', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await db('users').where({ id: req.user!.id }).first();
    if (!user?.email) { res.status(400).json({ success: false, error: 'Tidak ada email terdaftar' }); return; }
    if (user.email_verified) { res.json({ success: true, message: 'Email sudah terverifikasi' }); return; }
    const token = uuidv4();
    const expires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    await db('users').where({ id: user.id }).update({ email_verify_token: token, email_verify_expires: expires });
    await sendVerificationEmail(user.email, token, user.name);
    res.json({ success: true, message: 'Email verifikasi dikirim ulang' });
  } catch { res.status(500).json({ success: false, error: 'Gagal kirim email' }); }
});

// ─── GET /api/auth/check-username/:username ───────────────────────────────────
router.get('/check-username/:username', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username } = req.params;
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) { res.json({ success: true, available: false, reason: 'Format tidak valid' }); return; }
    const exists = await db('users').whereRaw('LOWER(username) = ?', [username.toLowerCase()]).first();
    res.json({ success: true, available: !exists });
  } catch { res.status(500).json({ success: false, error: 'Gagal cek username' }); }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await db('users').where({ id: req.user!.id }).first();
    const wallet = await db('wallets').where({ user_id: req.user!.id }).first();
    res.json({ success: true, data: { user: safeUser(user), wallet } });
  } catch { res.status(500).json({ success: false, error: 'Gagal fetch user' }); }
});

// ─── PATCH /api/auth/puter-token ─────────────────────────────────────────────
router.patch('/puter-token', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { token } = req.body;
    await db('users').where({ id: req.user!.id }).update({ puter_token: token, updated_at: new Date().toISOString() });
    res.json({ success: true, message: 'Puter Token berhasil disimpan' });
  } catch { res.status(500).json({ success: false, error: 'Gagal simpan token' }); }
});

// ─── PATCH /api/auth/link-whatsapp ───────────────────────────────────────────
router.patch('/link-whatsapp', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { lid, phone } = req.body;
    if (!lid) { res.status(400).json({ success: false, error: 'LID tidak ditemukan' }); return; }
    const updates: any = { whatsapp_lid: lid, updated_at: new Date().toISOString() };
    if (phone) updates.phone = phone;
    await db('users').where({ id: req.user!.id }).update(updates);
    res.json({ success: true, message: 'WhatsApp ID berhasil ditautkan' });
  } catch { res.status(500).json({ success: false, error: 'Gagal tautkan WhatsApp' }); }
});

// ─── GET /api/auth/check-phone/:phone ────────────────────────────────────────
router.get('/check-phone/:phone', async (req: Request, res: Response) => {
  try {
    const { phone } = req.params;
    const user = await db('users').where('phone', 'like', `%${phone.slice(-9)}%`).first();
    res.json({ success: true, exists: !!user, name: user?.name });
  } catch { res.status(500).json({ success: false, error: 'Gagal cek nomor' }); }
});

// ─── WA Magic Sessions ────────────────────────────────────────────────────────

router.post('/wa-magic-session', async (req: Request, res: Response): Promise<void> => {
  try {
    const { phone, lid, jid, user_id, purpose } = req.body;
    if (!purpose) { res.status(400).json({ success: false, error: 'purpose wajib' }); return; }
    const id = uuidv4();
    await db('wa_magic_sessions').insert({ id, phone, lid, jid, user_id: user_id || null, purpose, status: 'pending', created_at: new Date().toISOString() });
    res.json({ success: true, sessionId: id });
  } catch { res.status(500).json({ success: false, error: 'Gagal membuat session' }); }
});

router.get('/wa-magic-session/:sessionId', async (req: Request, res: Response): Promise<void> => {
  try {
    const session = await db('wa_magic_sessions').where({ id: req.params.sessionId }).first();
    if (!session) { res.status(404).json({ success: false, error: 'Session tidak ditemukan' }); return; }
    if (session.status === 'completed') { res.status(410).json({ success: false, error: 'Session sudah selesai', completed: true }); return; }
    let userName: string | null = null;
    if (session.user_id) {
      const u = await db('users').where({ id: session.user_id }).select('name').first();
      userName = u?.name || null;
    }
    res.json({ success: true, data: { purpose: session.purpose, phone: session.phone, lid: session.lid, userName } });
  } catch { res.status(500).json({ success: false, error: 'Gagal mengambil session' }); }
});

// POST /api/auth/wa-magic-session/:sessionId/complete
// Setelah Puter OAuth: auto-verify phone (WA bot delivery = proven), return needs_password flag.
// Jika user baru: buat akun + set password via POST /auth/wa-magic-session/set-password
router.post('/wa-magic-session/:sessionId/complete', async (req: Request, res: Response): Promise<void> => {
  try {
    const session = await db('wa_magic_sessions').where({ id: req.params.sessionId, status: 'pending' }).first();
    if (!session) { res.status(404).json({ success: false, error: 'Session tidak valid atau sudah selesai' }); return; }

    const { puter_token, puter_user_id, puter_name, puter_email } = req.body;
    if (!puter_token) { res.status(400).json({ success: false, error: 'puter_token wajib diisi' }); return; }

    const now = new Date().toISOString();
    let userId = session.user_id;
    let isNew = false;

    if (session.purpose === 'full-setup') {
      if (!session.phone) { res.status(400).json({ success: false, error: 'Nomor HP tidak terdeteksi' }); return; }
      const existing = await db('users').where('phone', 'like', `%${session.phone.slice(-9)}%`).first();
      if (existing) {
        userId = existing.id;
      } else {
        isNew = true;
        userId = uuidv4();
        await db('users').insert({
          id: userId,
          phone: session.phone,
          name: puter_name || `User_${session.phone.slice(-4)}`,
          email: puter_email?.toLowerCase() || null,
          email_verified: !!puter_email,
          role: 'konsumen',
          // Phone proven via WA bot delivery → auto-verified, no OTP needed
          is_verified: true,
          phone_verified: true,
          puter_user_id: puter_user_id || null,
          puter_token,
          whatsapp_lid: session.lid || null,
          created_at: now, updated_at: now,
        });
        await db('wallets').insert({ id: uuidv4(), user_id: userId, balance: 0, pending_balance: 0, total_earned: 0, total_withdrawn: 0, created_at: now, updated_at: now });
      }
    }

    // Update all users: puter token, LID, phone_verified=true (bot delivery = phone proven)
    const updates: any = { puter_token, updated_at: now, phone_verified: true, is_verified: true };
    if (puter_user_id) updates.puter_user_id = puter_user_id;
    if (puter_email) { updates.email = puter_email.toLowerCase(); updates.email_verified = true; }
    if (session.lid) updates.whatsapp_lid = session.lid;
    if (session.phone) updates.phone = session.phone;
    await db('users').where({ id: userId }).update(updates);

    // Invalidate session
    await db('wa_magic_sessions').where({ id: req.params.sessionId }).update({ status: 'completed', completed_at: now });

    const user = await db('users').where({ id: userId }).first();
    const needsPassword = !user.password_hash;

    const accessToken = signToken(userId);
    res.json({
      success: true,
      message: 'Puter berhasil dihubungkan!',
      data: { user: safeUser(user), token: accessToken, is_new: isNew, needs_password: needsPassword },
    });
  } catch (err) {
    console.error('[wa-magic-session complete]', err);
    res.status(500).json({ success: false, error: 'Gagal menyelesaikan setup' });
  }
});

// POST /api/auth/wa-magic-session/set-password
// (authenticated) Set password setelah magic link setup
router.post('/wa-magic-session/set-password', requireAuth, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { password, retype_password, email } = req.body;
    if (!password) { res.status(400).json({ success: false, error: 'Password wajib diisi' }); return; }
    if (password !== retype_password) { res.status(400).json({ success: false, error: 'Password tidak cocok' }); return; }
    const pwErr = validatePassword(password);
    if (pwErr) { res.status(400).json({ success: false, error: pwErr }); return; }

    const updates: any = { password_hash: await bcrypt.hash(password, 10), updated_at: new Date().toISOString() };

    let emailVerifyToken: string | null = null;
    if (email) {
      const existsEmail = await db('users').whereRaw('LOWER(email) = ?', [email.toLowerCase()]).whereNot({ id: req.user!.id }).first();
      if (existsEmail) { res.status(409).json({ success: false, error: 'Email sudah digunakan akun lain' }); return; }
      emailVerifyToken = uuidv4();
      updates.email = email.toLowerCase();
      updates.email_verified = false;
      updates.email_verify_token = emailVerifyToken;
      updates.email_verify_expires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    }

    await db('users').where({ id: req.user!.id }).update(updates);

    if (email && emailVerifyToken) {
      const u = await db('users').where({ id: req.user!.id }).first();
      sendVerificationEmail(email, emailVerifyToken, u.name).catch(console.error);
    }

    const user = await db('users').where({ id: req.user!.id }).first();
    res.json({ success: true, message: 'Password berhasil disimpan!', data: { user: safeUser(user) } });
  } catch (err) {
    console.error('[wa-magic set-password]', err);
    res.status(500).json({ success: false, error: 'Gagal menyimpan password' });
  }
});

// ─── wa-relink (legacy, kept for compat) ─────────────────────────────────────
router.get('/wa-relink-init', async (req: Request, res: Response): Promise<void> => {
  try {
    const { phone, lid } = req.query as { phone?: string; lid?: string };
    if (!phone) { res.status(400).json({ success: false, error: 'Phone wajib' }); return; }
    const user = await db('users').where('phone', 'like', `%${phone.slice(-9)}%`).first();
    if (!user) { res.status(404).json({ success: false, error: 'User tidak ditemukan' }); return; }
    const relinkToken = jwt.sign({ userId: user.id, lid: lid || null, phone, purpose: 'wa-relink' }, JWT_SECRET(), { expiresIn: '15m' });
    res.json({ success: true, token: relinkToken, name: user.name });
  } catch { res.status(500).json({ success: false, error: 'Gagal generate token' }); }
});

router.post('/wa-relink', async (req: Request, res: Response): Promise<void> => {
  try {
    const { relinkToken, lid, phone } = req.body;
    if (!relinkToken || !lid) { res.status(400).json({ success: false, error: 'relinkToken dan lid diperlukan' }); return; }
    let payload: any;
    try { payload = jwt.verify(relinkToken, JWT_SECRET()); } catch { res.status(401).json({ success: false, error: 'Token tidak valid' }); return; }
    if (payload.purpose !== 'wa-relink') { res.status(403).json({ success: false, error: 'Token tidak valid' }); return; }
    const updates: any = { whatsapp_lid: lid, updated_at: new Date().toISOString() };
    if (phone) updates.phone = phone;
    await db('users').where({ id: payload.userId }).update(updates);
    const user = await db('users').where({ id: payload.userId }).first();
    res.json({ success: true, message: 'WhatsApp berhasil ditautkan ulang!', data: { user: safeUser(user), token: signToken(payload.userId) } });
  } catch { res.status(500).json({ success: false, error: 'Gagal re-link' }); }
});

// ─── Forgot Password Flow ───────────────────────────────────────────────────

router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { identifier } = req.body;
    if (!identifier) { res.status(400).json({ success: false, error: 'Identifier wajib' }); return; }

    const { field, value } = normalizeIdentifier(identifier);
    let user: any;
    if (field === 'phone') user = await db('users').where('phone', 'like', `%${value.slice(-9)}%`).first();
    else if (field === 'email') user = await db('users').whereRaw('LOWER(email) = ?', [value]).first();
    else user = await db('users').whereRaw('LOWER(username) = ?', [value]).first();

    if (!user) { res.status(404).json({ success: false, error: 'User tidak ditemukan' }); return; }

    // Logic: Default WA, but if both verified, allow choice
    const methods: string[] = ['wa'];
    if (user.email && user.email_verified) methods.push('email');

    res.json({ success: true, methods, phone: user.phone, email: user.email });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.post('/request-reset-otp', async (req: Request, res: Response) => {
  try {
    const { identifier, method } = req.body;
    const { field, value } = normalizeIdentifier(identifier);
    let user: any;
    if (field === 'phone') user = await db('users').where('phone', 'like', `%${value.slice(-9)}%`).first();
    else if (field === 'email') user = await db('users').whereRaw('LOWER(email) = ?', [value]).first();
    else user = await db('users').whereRaw('LOWER(username) = ?', [value]).first();

    if (!user) { res.status(404).json({ success: false, error: 'User tidak ditemukan' }); return; }

    const otp = generateOTP();
    const expires = otpExpiry();
    await db('users').where({ id: user.id }).update({ phone_otp: otp, phone_otp_expires: expires });

    if (method === 'email' && user.email) {
      await sendVerificationEmail(user.email, otp, user.name); // Reusing for simplicity or specialized mail
    } else {
      await (sendWAMessage as any)(user.phone, `🌾 *AgriHub* — Kode RESET PASSWORD Anda:\n\n*${otp}*\n\n_Jangan bagikan kode ini kepada siapapun._`);
    }

    res.json({ success: true, message: 'OTP terkirim' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Gagal mengirim OTP' });
  }
});

router.post('/verify-reset-otp', async (req: Request, res: Response) => {
  try {
    const { identifier, otp } = req.body;
    const { field, value } = normalizeIdentifier(identifier);
    let user: any;
    if (field === 'phone') user = await db('users').where('phone', 'like', `%${value.slice(-9)}%`).first();
    else if (field === 'email') user = await db('users').whereRaw('LOWER(email) = ?', [value]).first();
    else user = await db('users').whereRaw('LOWER(username) = ?', [value]).first();

    if (!user || user.phone_otp !== otp?.toString()) {
      res.status(400).json({ success: false, error: 'OTP salah' }); return;
    }
    if (new Date(user.phone_otp_expires) < new Date()) {
      res.status(400).json({ success: false, error: 'OTP kadaluarsa' }); return;
    }

    res.json({ success: true, message: 'OTP valid' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.post('/reset-password', async (req: Request, res: Response) => {
  try {
    const { identifier, otp, password } = req.body;
    const pwErr = validatePassword(password);
    if (pwErr) { res.status(400).json({ success: false, error: pwErr }); return; }

    const { field, value } = normalizeIdentifier(identifier);
    let user: any;
    if (field === 'phone') user = await db('users').where('phone', 'like', `%${value.slice(-9)}%`).first();
    else if (field === 'email') user = await db('users').whereRaw('LOWER(email) = ?', [value]).first();
    else user = await db('users').whereRaw('LOWER(username) = ?', [value]).first();

    if (!user || user.phone_otp !== otp?.toString()) {
      res.status(400).json({ success: false, error: 'Sesi reset tidak valid' }); return;
    }

    const password_hash = await bcrypt.hash(password, 10);
    await db('users').where({ id: user.id }).update({ 
      password_hash, 
      phone_otp: null, 
      phone_otp_expires: null,
      updated_at: new Date().toISOString() 
    });

    res.json({ success: true, message: 'Password berhasil diubah' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Gagal reset password' });
  }
});

export default router;

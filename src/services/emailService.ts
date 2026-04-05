
import nodemailer from 'nodemailer';
import db from '../config/knex';

// ─── Load settings from DB ──────────────────────────────────────────────────
async function getSetting(key: string): Promise<string> {
  try {
    const row = await db('app_settings').where({ key }).first();
    return row?.value || '';
  } catch {
    return '';
  }
}

async function getSmtpConfig() {
  const [host, port, secure, user, pass, from] = await Promise.all([
    getSetting('smtp_host'),
    getSetting('smtp_port'),
    getSetting('smtp_secure'),
    getSetting('smtp_user'),
    getSetting('smtp_pass'),
    getSetting('smtp_from'),
  ]);
  return { host, port: parseInt(port) || 587, secure: secure === 'true', user, pass, from };
}

// ─── Create transporter (fresh each call so settings changes take effect) ────
async function createTransporter() {
  const cfg = await getSmtpConfig();
  if (!cfg.user || !cfg.pass) return null;

  // Auto-correct: port 465 = SSL (secure: true), port 587/25 = STARTTLS (secure: false)
  // Jika admin salah setting, kita override supaya jangan mismatch
  const port = cfg.port;
  const secure = port === 465 ? true : false;
  const requireTLS = port === 587;

  return nodemailer.createTransport({
    host: cfg.host || 'smtp.gmail.com',
    port,
    secure,           // true hanya untuk 465 (SSL langsung)
    requireTLS,       // true untuk 587 agar paksa upgrade ke STARTTLS
    auth: { user: cfg.user, pass: cfg.pass },
    tls: {
      rejectUnauthorized: false,  // toleran terhadap self-signed cert
      minVersion: 'TLSv1.2',
    },
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  try {
    const transporter = await createTransporter();
    if (!transporter) {
      console.warn('[Email] SMTP not configured — skipping send. Token logged to console.');
      return false;
    }
    const from = (await getSetting('smtp_from')) || (await getSetting('smtp_user'));
    await transporter.sendMail({ from, to, subject, html });
    console.log(`✉️ [Email] Sent to ${to}: ${subject}`);
    return true;
  } catch (err) {
    console.error('[Email] Failed to send:', err);
    return false;
  }
}

export async function sendVerificationEmail(to: string, token: string, name: string): Promise<boolean> {
  const appUrl = (await getSetting('app_url')) || 'https://agrihub.rumah-genbi.com';
  const appName = (await getSetting('app_name')) || 'AgriHub';
  const link = `${appUrl}/verify-email?token=${token}`;

  const html = `
    <div style="font-family:sans-serif;max-width:520px;margin:auto;background:#f0fdf4;border-radius:16px;overflow:hidden;">
      <div style="background:#16a34a;padding:32px;text-align:center;">
        <h1 style="color:#fff;margin:0;font-size:28px;">🌾 ${appName}</h1>
        <p style="color:#bbf7d0;margin:8px 0 0;">Verifikasi Email Anda</p>
      </div>
      <div style="padding:32px;">
        <p style="font-size:16px;color:#166534;">Halo <strong>${name}</strong>,</p>
        <p style="color:#374151;">Klik tombol di bawah untuk memverifikasi email Anda di ${appName}:</p>
        <div style="text-align:center;margin:28px 0;">
          <a href="${link}" style="background:#16a34a;color:#fff;text-decoration:none;padding:14px 32px;border-radius:12px;font-weight:bold;font-size:16px;">
            ✅ Verifikasi Email Sekarang
          </a>
        </div>
        <p style="color:#6b7280;font-size:13px;">Link ini berlaku selama <strong>24 jam</strong>. Jika Anda tidak mendaftar di ${appName}, abaikan email ini.</p>
        <hr style="border:none;border-top:1px solid #d1fae5;margin:24px 0;" />
        <p style="color:#9ca3af;font-size:12px;text-align:center;">© ${new Date().getFullYear()} ${appName}</p>
      </div>
    </div>
  `;
  return sendEmail(to, `Verifikasi Email ${appName} Anda`, html);
}

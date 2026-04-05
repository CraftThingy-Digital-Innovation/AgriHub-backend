"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    // username unik, email verification token, phone OTP verification
    const hasTable = await knex.schema.hasTable('users');
    if (!hasTable)
        return;
    const cols = {
        username: await knex.schema.hasColumn('users', 'username'),
        email_verified: await knex.schema.hasColumn('users', 'email_verified'),
        email_verify_token: await knex.schema.hasColumn('users', 'email_verify_token'),
        email_verify_expires: await knex.schema.hasColumn('users', 'email_verify_expires'),
        phone_verified: await knex.schema.hasColumn('users', 'phone_verified'),
        phone_otp: await knex.schema.hasColumn('users', 'phone_otp'),
        phone_otp_expires: await knex.schema.hasColumn('users', 'phone_otp_expires'),
    };
    await knex.schema.alterTable('users', (t) => {
        if (!cols.username)
            t.string('username').nullable();
        if (!cols.email_verified)
            t.boolean('email_verified').defaultTo(false);
        if (!cols.email_verify_token)
            t.string('email_verify_token').nullable();
        if (!cols.email_verify_expires)
            t.string('email_verify_expires').nullable();
        if (!cols.phone_verified)
            t.boolean('phone_verified').defaultTo(false);
        if (!cols.phone_otp)
            t.string('phone_otp').nullable(); // 6-digit OTP
        if (!cols.phone_otp_expires)
            t.string('phone_otp_expires').nullable();
    });
    // Coba tambah unique index untuk username (safe via raw, skip error jika ada)
    try {
        await knex.raw('CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users(username) WHERE username IS NOT NULL');
    }
    catch { }
}
async function down(knex) {
    // SQLite tidak support DROP COLUMN. Biarkan kolom ada.
}
//# sourceMappingURL=014_add_auth_enhancements.js.map
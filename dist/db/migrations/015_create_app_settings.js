"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    const exists = await knex.schema.hasTable('app_settings');
    if (exists)
        return;
    await knex.schema.createTable('app_settings', (t) => {
        t.string('key').primary();
        t.text('value').nullable();
        t.string('description').nullable();
        t.string('group').nullable(); // 'smtp', 'general', 'payment', etc.
        t.boolean('is_secret').defaultTo(false);
        t.timestamp('updated_at').defaultTo(knex.fn.now());
    });
    // Seed default SMTP settings
    const now = new Date().toISOString();
    const defaults = [
        { key: 'smtp_host', value: 'smtp.gmail.com', description: 'SMTP Host', group: 'smtp', is_secret: false },
        { key: 'smtp_port', value: '587', description: 'SMTP Port', group: 'smtp', is_secret: false },
        { key: 'smtp_secure', value: 'false', description: 'Gunakan SSL/TLS (true/false)', group: 'smtp', is_secret: false },
        { key: 'smtp_user', value: '', description: 'Gmail address / SMTP username', group: 'smtp', is_secret: false },
        { key: 'smtp_pass', value: '', description: 'Gmail App Password (bukan password biasa!)', group: 'smtp', is_secret: true },
        { key: 'smtp_from', value: '', description: 'Nama & email pengirim, contoh: AgriHub <no-reply@agrihub.com>', group: 'smtp', is_secret: false },
        { key: 'app_name', value: 'AgriHub', description: 'Nama aplikasi (muncul di email)', group: 'general', is_secret: false },
        { key: 'app_url', value: 'https://agrihub.rumah-genbi.com', description: 'URL aplikasi produksi', group: 'general', is_secret: false },
    ];
    await knex('app_settings').insert(defaults.map(d => ({ ...d, updated_at: now })));
}
async function down(knex) {
    await knex.schema.dropTableIfExists('app_settings');
}
//# sourceMappingURL=015_create_app_settings.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.up = up;
exports.down = down;
async function up(knex) {
    const exists = await knex('app_settings').where({ key: 'wa_bot_number' }).first();
    if (!exists) {
        await knex('app_settings').insert({
            key: 'wa_bot_number',
            value: '',
            description: 'Nomor WhatsApp bot (format internasional, tanpa +, contoh: 628123456789)',
            group: 'whatsapp',
            is_secret: false,
            updated_at: new Date().toISOString(),
        });
    }
    const existsName = await knex('app_settings').where({ key: 'wa_bot_name' }).first();
    if (!existsName) {
        await knex('app_settings').insert({
            key: 'wa_bot_name',
            value: 'AgriHub Bot',
            description: 'Nama tampilan untuk bot WhatsApp',
            group: 'whatsapp',
            is_secret: false,
            updated_at: new Date().toISOString(),
        });
    }
}
async function down(knex) {
    await knex('app_settings').where({ key: 'wa_bot_number' }).delete();
    await knex('app_settings').where({ key: 'wa_bot_name' }).delete();
}
//# sourceMappingURL=017_add_wa_bot_number_setting.js.map
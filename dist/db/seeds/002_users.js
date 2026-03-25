"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.seed = seed;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const uuid_1 = require("uuid");
const knex_1 = __importDefault(require("../../config/knex"));
async function seed() {
    const phone = '085188000139';
    const name = 'Super Admin AgriHub';
    const password = 'adminagrihub123';
    const passwordHash = await bcryptjs_1.default.hash(password, 10);
    // Check if admin already exists
    const existing = await (0, knex_1.default)('users').where({ phone }).first();
    if (existing) {
        await (0, knex_1.default)('users').where({ phone }).update({
            role: 'admin',
            is_verified: true,
            updated_at: new Date().toISOString(),
        });
        console.log('✅ Admin account updated:', phone);
    }
    else {
        await (0, knex_1.default)('users').insert({
            id: (0, uuid_1.v4)(),
            phone,
            name,
            password_hash: passwordHash,
            role: 'admin',
            is_verified: true,
            is_lid_linked: false, // Default
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        });
        console.log('🚀 Local Superadmin created!');
        console.log('📱 Phone:', phone);
        console.log('🔑 Password:', password);
    }
}
//# sourceMappingURL=002_users.js.map
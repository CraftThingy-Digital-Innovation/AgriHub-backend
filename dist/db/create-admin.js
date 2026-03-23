"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const knex_1 = __importDefault(require("../config/knex"));
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const uuid_1 = require("uuid");
async function createAdmin() {
    const phone = '085188000139';
    const name = 'Super Admin AgriHub';
    const password = 'adminagrihub123';
    const passwordHash = await bcryptjs_1.default.hash(password, 10);
    try {
        const hasTable = await knex_1.default.schema.hasTable('users');
        if (!hasTable) {
            console.log('⚠️  Users table does not exist yet. Please ensure migrations have run successfully first.');
            process.exit(1);
        }
        const existing = await (0, knex_1.default)('users').where({ phone }).first();
        if (existing) {
            await (0, knex_1.default)('users').where({ phone }).update({
                role: 'admin',
                is_verified: true,
                updated_at: new Date(),
            });
            console.log('✅ Admin account updated to superadmin:', phone);
        }
        else {
            const id = (0, uuid_1.v4)();
            await (0, knex_1.default)('users').insert({
                id,
                phone,
                name,
                password_hash: passwordHash,
                role: 'admin',
                is_verified: true,
                created_at: new Date(),
                updated_at: new Date(),
            });
            console.log('🚀 Superadmin created successfully!');
        }
        console.log('📱 Phone:', phone);
        console.log('🔑 Password:', password);
        process.exit(0);
    }
    catch (err) {
        console.error('❌ Failed to create admin:', err);
        process.exit(1);
    }
}
createAdmin();
//# sourceMappingURL=create-admin.js.map
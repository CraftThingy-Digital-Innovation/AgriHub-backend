"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSeeds = runSeeds;
require("dotenv/config");
const knex_1 = __importDefault(require("../config/knex"));
async function runSeeds() {
    try {
        console.log('🚀 Running database seeds...');
        // Knex looking for seed files in the configured directory
        const [log] = await knex_1.default.seed.run();
        if (log.length === 0) {
            console.log('⚠️  No seed files found or executed.');
        }
        else {
            console.log(`✅ Successfully executed ${log.length} seed file(s):`);
            log.forEach((file) => console.log(`   ↳ ${file}`));
        }
    }
    catch (err) {
        console.error('❌ Seeding failed:', err);
        throw err;
    }
}
// Run if called directly
if (require.main === module || process.argv[1]?.endsWith('seed.ts')) {
    runSeeds()
        .then(() => process.exit(0))
        .catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
//# sourceMappingURL=seed.js.map
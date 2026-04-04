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
exports.knexConfig = void 0;
const knex_1 = __importDefault(require("knex"));
const path_1 = __importDefault(require("path"));
const dotenv = __importStar(require("dotenv"));
// Pastikan .env diload khusus saat file ini di-execute standalone
dotenv.config({ path: path_1.default.resolve(process.cwd(), '.env') });
const client = process.env.DATABASE_CLIENT || 'sqlite3';
const config = client === 'sqlite3'
    ? {
        client: 'sqlite3',
        connection: {
            filename: path_1.default.resolve(process.cwd(), process.env.DATABASE_URL || './dev.sqlite'),
        },
        useNullAsDefault: true,
        migrations: {
            directory: path_1.default.resolve(__dirname, '../db/migrations'),
            extension: process.env.NODE_ENV === 'production' ? 'js' : 'ts',
        },
        seeds: {
            directory: path_1.default.resolve(__dirname, '../db/seeds'),
            extension: process.env.NODE_ENV === 'production' ? 'js' : 'ts',
        },
    }
    : {
        client: client === 'pg' ? 'postgresql' : 'mysql2',
        connection: process.env.DATABASE_URL,
        migrations: {
            directory: path_1.default.resolve(__dirname, '../db/migrations'),
            extension: process.env.NODE_ENV === 'production' ? 'js' : 'ts',
        },
        seeds: {
            directory: path_1.default.resolve(__dirname, '../db/seeds'),
            extension: process.env.NODE_ENV === 'production' ? 'js' : 'ts',
        },
    };
exports.knexConfig = config;
const db = (0, knex_1.default)(config);
exports.default = db;
//# sourceMappingURL=knex.js.map
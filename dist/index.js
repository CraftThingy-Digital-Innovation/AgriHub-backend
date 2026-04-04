"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
console.log('🌱 AgriHub: Script loading...');
process.on('uncaughtException', (err) => {
    console.error('🔥 UNCAUGHT EXCEPTION:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('🌊 UNHANDLED REJECTION:', reason);
});
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const path_1 = __importDefault(require("path"));
const migrate_1 = require("./db/migrate");
const errorHandler_1 = require("./middleware/errorHandler");
// Routes
const auth_1 = __importDefault(require("./routes/auth"));
const products_1 = __importDefault(require("./routes/products"));
const stores_1 = __importDefault(require("./routes/stores"));
const orders_1 = __importDefault(require("./routes/orders"));
const rag_1 = __importDefault(require("./routes/rag"));
const payment_1 = __importDefault(require("./routes/payment"));
const wallet_1 = __importDefault(require("./routes/wallet"));
const shipping_1 = __importDefault(require("./routes/shipping"));
const matching_1 = __importDefault(require("./routes/matching"));
const price_1 = __importDefault(require("./routes/price"));
const admin_1 = __importDefault(require("./routes/admin"));
const pihps_1 = __importDefault(require("./routes/pihps"));
const whatsappBot_1 = require("./services/whatsappBot");
const app = (0, express_1.default)();
app.set('trust proxy', 1); // Diperlukan untuk express-rate-limit di balik proxy (Hostinger/Nginx)
const PORT = process.env.PORT || 3000;
// ── Security Middleware ──────────────────────────────────────────────────
app.use((0, helmet_1.default)({
    contentSecurityPolicy: false,
    crossOriginOpenerPolicy: { policy: 'unsafe-none' }, // Diperlukan agar popup Puter.js bisa bicara ke parent
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer-when-downgrade' }
}));
app.use((0, cors_1.default)({
    origin: process.env.CLIENT_URL || 'https://agrihub.rumah-genbi.com',
    credentials: true,
}));
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
// Rate limiting
const limiter = (0, express_rate_limit_1.default)({
    windowMs: 15 * 60 * 1000, // 15 menit
    max: 200,
    message: { success: false, error: 'Terlalu banyak request, coba lagi nanti' },
});
app.use('/api/', limiter);
// ── Health Check ─────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
    res.json({
        success: true,
        status: 'ok',
        version: '1.0.0',
        platform: 'AgriHub Indonesia',
        timestamp: new Date().toISOString(),
    });
});
// ── API Routes ────────────────────────────────────────────────────────────
app.use('/api/auth', auth_1.default);
app.use('/api/products', products_1.default);
app.use('/api/stores', stores_1.default);
app.use('/api/orders', orders_1.default);
app.use('/api/rag', rag_1.default);
app.use('/api/payment', payment_1.default);
app.use('/api/wallet', wallet_1.default);
app.use('/api/shipping', shipping_1.default);
app.use('/api/matching', matching_1.default);
app.use('/api/price', price_1.default);
app.use('/api/admin', admin_1.default);
app.use('/api/pihps', pihps_1.default);
// ── WhatsApp Bot Status ──────────────────────────────────────────────────
app.get('/api/wa/status', (_req, res) => res.json({ success: true, data: (0, whatsappBot_1.getWAStatus)() }));
// ── Serve Vite Build (Production) ─────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
    // Gunakan process.cwd() agar konsisten mencari folder 'public' di root aplikasi
    const distPath = path_1.default.resolve(process.cwd(), 'public');
    const fs = require('fs');
    if (fs.existsSync(distPath)) {
        app.use(express_1.default.static(distPath));
        app.get('*', (_req, res) => {
            res.sendFile(path_1.default.join(distPath, 'index.html'));
        });
        console.log(`🌾  Serving frontend from: ${distPath}`);
    }
    else {
        // Fallback if public folder is missing
        console.log('⚠️  Frontend public folder not found, running in headless API mode.');
        app.get('/', (_req, res) => {
            res.json({
                success: true,
                message: 'AgriHub API is running in headless mode. Use /api/ for endpoints.',
                health: '/health'
            });
        });
    }
}
// ── Error Handlers ────────────────────────────────────────────────────────
app.use(errorHandler_1.notFoundHandler);
app.use(errorHandler_1.errorHandler);
// ── Server Start ──────────────────────────────────────────────────────────
async function bootstrap() {
    try {
        // Auto-migrate sebelum start server
        await (0, migrate_1.runMigrations)();
        // Start WhatsApp bot jika diaktifkan
        if (process.env.ENABLE_WHATSAPP === 'true') {
            (0, whatsappBot_1.connectWhatsApp)().catch(err => console.error('WA Bot error:', err));
        }
        app.listen(PORT, () => {
            console.log('');
            console.log('🌾 ─────────────────────────────────────────');
            console.log(`🌾  AgriHub Indonesia API Server`);
            console.log(`🌾  Running on: http://localhost:${PORT}`);
            console.log(`🌾  Health: http://localhost:${PORT}/health`);
            console.log(`🌾  Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log('🌾 ─────────────────────────────────────────');
            console.log('');
        });
    }
    catch (err) {
        console.error('❌ Failed to start server:', err);
        process.exit(1);
    }
}
console.log('🚀 AgriHub: Bootstrapping...');
bootstrap().catch(err => {
    console.error('💥 CRITICAL BOOTSTRAP ERROR:', err);
    process.exit(1);
});
exports.default = app;
//# sourceMappingURL=index.js.map
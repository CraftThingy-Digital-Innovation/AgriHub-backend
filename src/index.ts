import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';

import { runMigrations } from './db/migrate';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

// Routes
import authRouter from './routes/auth';
import productsRouter from './routes/products';
import storesRouter from './routes/stores';
import ordersRouter from './routes/orders';
import ragRouter from './routes/rag';
import paymentRouter from './routes/payment';
import walletRouter from './routes/wallet';
import shippingRouter from './routes/shipping';
import matchingRouter from './routes/matching';
import priceRouter from './routes/price';
import adminRouter from './routes/admin';
import { connectWhatsApp, getWAStatus } from './services/whatsappBot';

const app = express();
app.set('trust proxy', 1); // Diperlukan untuk express-rate-limit di balik proxy (Hostinger/Nginx)
const PORT = process.env.PORT || 3000;

// ── Security Middleware ──────────────────────────────────────────────────
app.use(helmet({ 
  contentSecurityPolicy: false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
}));
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
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
app.use('/api/auth', authRouter);
app.use('/api/products', productsRouter);
app.use('/api/stores', storesRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/rag', ragRouter);
app.use('/api/payment', paymentRouter);
app.use('/api/wallet', walletRouter);
app.use('/api/shipping', shippingRouter);
app.use('/api/matching', matchingRouter);
app.use('/api/price', priceRouter);
app.use('/api/admin', adminRouter);

// ── WhatsApp Bot Status ──────────────────────────────────────────────────
app.get('/api/wa/status', (_req, res) => res.json({ success: true, data: getWAStatus() }));

// ── Serve Vite Build (Production) ─────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  // Gunakan process.cwd() agar konsisten mencari folder 'public' di root aplikasi
  const distPath = path.resolve(process.cwd(), 'public');
  const fs = require('fs');
  
  if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log(`🌾  Serving frontend from: ${distPath}`);
  } else {
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
app.use(notFoundHandler);
app.use(errorHandler);

// ── Server Start ──────────────────────────────────────────────────────────
async function bootstrap() {
  try {
    // Auto-migrate sebelum start server
    await runMigrations();

    // Start WhatsApp bot jika diaktifkan
    if (process.env.ENABLE_WHATSAPP === 'true') {
      connectWhatsApp().catch(err => console.error('WA Bot error:', err));
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
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
}

bootstrap();

export default app;

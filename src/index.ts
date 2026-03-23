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

const app = express();
const PORT = process.env.PORT || 3001;

// ── Security Middleware ──────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
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

// ── Serve Vite Build (Production) ─────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const distPath = path.resolve(__dirname, '../../frontend/dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// ── Error Handlers ────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ── Server Start ──────────────────────────────────────────────────────────
async function bootstrap() {
  try {
    // Auto-migrate sebelum start server
    await runMigrations();
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

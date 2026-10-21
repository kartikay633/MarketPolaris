// ROADMAP: Section 6 — Backend Architecture (Express Server Entry Point)
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import hpp from 'hpp';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { testConnection } from './config/database.js';
import { RATE_LIMITS } from './config/constants.js';
import { getMarketStatus, isMarketOpen, startCalendarRefresh } from './utils/marketHours.js';
import logger from './utils/logger.js';

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Security Middleware ────────────────────────────────────
app.use(helmet({
  // Allow Vite dev server and frontend origin
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
}));
app.use(hpp());
app.use(compression());

// ─── CORS ───────────────────────────────────────────────────
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Body Parsing ───────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// ─── Request Logging ────────────────────────────────────────
app.use(requestLogger);

// ─── Rate Limiting ──────────────────────────────────────────
app.use('/api/', rateLimit({
  windowMs: RATE_LIMITS.GENERAL.windowMs,
  max: RATE_LIMITS.GENERAL.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests, please try again later',
    code: 'RATE_LIMITED',
  },
}));

// ─── Health Check ───────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  const status = getMarketStatus();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    market: status,
    version: '1.0.0',
  });
});

import userRoutes from './routes/userRoutes.js';
import marketRoutes from './routes/marketRoutes.js';
import stockRoutes from './routes/stockRoutes.js';
import searchRoutes from './routes/searchRoutes.js';
import newsRoutes from './routes/newsRoutes.js';
import aiRoutes from './routes/aiRoutes.js';
import watchlistRoutes from './routes/watchlistRoutes.js';
import tradeRoutes from './routes/tradeRoutes.js';
import portfolioRoutes from './routes/portfolioRoutes.js';
import alertRoutes from './routes/alertRoutes.js';
import researchRoutes from './routes/researchRoutes.js';

// ─── API Routes ─────────────────────────────────────────────
app.use('/api/user', userRoutes);
app.use('/api/market', marketRoutes);
app.use('/api/stocks', stockRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/watchlist', watchlistRoutes);
app.use('/api/trade', tradeRoutes);
app.use('/api/portfolio', portfolioRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/research', researchRoutes);

// ─── 404 for unknown API routes ─────────────────────────────
app.use('/api', (req, res) => {
  res.status(404).json({
    error: `API endpoint not found: ${req.method} ${req.originalUrl}`,
    code: 'NOT_FOUND',
  });
});

// ─── Global Error Handler ───────────────────────────────────
app.use(errorHandler);

// ─── Start Server ───────────────────────────────────────────
async function start() {
  // Test database connection (non-fatal if DB isn't ready yet)
  try {
    const dbOk = await testConnection();
    if (!dbOk) {
      logger.warn('Database connection failed — server starting without DB');
    }
  } catch (err) {
    logger.warn({ err }, 'Database not available — server starting without DB');
  }

  // The official NSE holiday and special-session calendar refreshes every 12 hours.
  startCalendarRefresh({ logger });

  // Price alerts are checked every minute while the market is open, with or without a browser open.
  const { alertService } = await import('./services/alertService.js');
  setInterval(() => {
    if (isMarketOpen()) alertService.checkAll().catch((err) => logger.warn({ err: err.message }, 'Background alert check failed'));
  }, 60000).unref();

  // The NSE equity directory (search, quotes and charts for every listed stock) refreshes in the background.
  const { upstoxProvider } = await import('./providers/UpstoxProvider.js');
  upstoxProvider.directory.ensureFresh();

  // HOST (e.g. 127.0.0.1) limits who can reach the API; unset, it listens on every interface as before.
  const host = process.env.HOST || undefined;
  app.listen(PORT, host, () => {
    logger.info(`Market Polaris API server running on ${host || 'all interfaces'}, port ${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`Market status: ${getMarketStatus().status}`);
  });
}

start().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});

export default app;

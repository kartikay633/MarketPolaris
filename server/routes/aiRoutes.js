// ROADMAP: Section 6, 10 & 15 — AI Routes
import { Router } from 'express';
import { aiController } from '../controllers/aiController.js';
import { optionalAuth } from '../middleware/auth.js';

const router = Router();

// GET /api/ai/market-summary — AI Daily Market Intelligence Digest
router.get('/market-summary', optionalAuth, (req, res, next) => aiController.getMarketSummary(req, res, next));

// GET /api/ai/stock-insight/:symbol — AI Stock Insight for specific ticker
router.get('/stock-insight/:symbol', optionalAuth, (req, res, next) => aiController.getStockInsight(req, res, next));

// POST /api/ai/chat — Conversational Polaris AI Assistant
router.post('/chat', optionalAuth, (req, res, next) => aiController.chat(req, res, next));

// POST /api/ai/agentic-analysis — Autonomous Multi-Agent Quantitative Pipeline with 5-Year Trend ML
router.post('/agentic-analysis', optionalAuth, (req, res, next) => aiController.runAgenticAnalysis(req, res, next));

// GET /api/ai/conversations — Conversation history
router.get('/conversations', optionalAuth, (req, res, next) => aiController.getConversations(req, res, next));

export default router;

// ROADMAP: Section 6 & 15 — Market Routes
import { Router } from 'express';
import { marketController } from '../controllers/marketController.js';
import { optionalAuth } from '../middleware/auth.js';

const router = Router();

// GET /api/market/overview — Comprehensive overview: major indices, breadth, sectors
router.get('/overview', optionalAuth, (req, res, next) => marketController.getOverview(req, res, next));

// GET /api/market/indices — Major Indian market indices
router.get('/indices', optionalAuth, (req, res, next) => marketController.getIndices(req, res, next));

// GET /api/market/gainers — Top daily gainers
router.get('/gainers', optionalAuth, (req, res, next) => marketController.getGainers(req, res, next));

// GET /api/market/losers — Top daily losers
router.get('/losers', optionalAuth, (req, res, next) => marketController.getLosers(req, res, next));

// GET /api/market/active — Traded-value leaders
router.get('/active', optionalAuth, (req, res, next) => marketController.getActive(req, res, next));

// GET /api/market/stocks — Every covered stock from the same snapshot (screener, heatmap)
router.get('/stocks', optionalAuth, (req, res, next) => marketController.getStocks(req, res, next));

// GET /api/market/search — Quick symbol search
router.get('/search', optionalAuth, (req, res, next) => marketController.search(req, res, next));

export default router;

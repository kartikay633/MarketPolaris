// ROADMAP: Section 6, 11 & Phase 6 — Trade Controller
import { tradeService } from '../services/tradeService.js';

export class TradeController {
  async executeOrder(req, res, next) {
    try {
      const userId = req.userId || 'demo-trader';
      const { symbol, type, quantity } = req.body;
      const result = await tradeService.executeOrder(userId, { symbol, type, quantity });
      res.status(201).json(result);
    } catch (err) {
      res.status(400).json({ error: err.message, code: 'TRADE_ERROR' });
    }
  }

  async getPortfolio(req, res, next) {
    try {
      const userId = req.userId || 'demo-trader';
      const portfolio = await tradeService.getPortfolio(userId);
      res.json(portfolio);
    } catch (err) {
      next(err);
    }
  }

  async getOrders(req, res, next) {
    try {
      const userId = req.userId || 'demo-trader';
      const limit = parseInt(req.query.limit, 10) || 50;
      const orders = await tradeService.getOrders(userId, limit);
      res.json({ orders });
    } catch (err) {
      next(err);
    }
  }

  async resetPortfolio(req, res, next) {
    try {
      const userId = req.userId || 'demo-trader';
      const result = await tradeService.resetPortfolio(userId);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async addFunds(req, res, next) {
    try {
      const userId = req.userId || 'demo-trader';
      const { amount } = req.body;
      const result = await tradeService.addFunds(userId, amount);
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: err.message, code: 'TRADE_ERROR' });
    }
  }
}

export const tradeController = new TradeController();
export default tradeController;

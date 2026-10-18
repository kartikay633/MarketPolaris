// ROADMAP: Section 6 & 15 — Market Controller
import { marketDataService } from '../services/marketDataService.js';

export class MarketController {
  async getOverview(req, res, next) {
    try {
      const data = await marketDataService.getOverview();
      res.json(data);
    } catch (err) {
      next(err);
    }
  }

  async getIndices(req, res, next) {
    try {
      const indices = await marketDataService.getIndices();
      res.json({ indices });
    } catch (err) {
      next(err);
    }
  }

  async getGainers(req, res, next) {
    try {
      const limit = parseInt(req.query.limit, 10) || 20;
      const gainers = await marketDataService.getGainers(limit);
      res.json({ gainers });
    } catch (err) {
      next(err);
    }
  }

  async getLosers(req, res, next) {
    try {
      const limit = parseInt(req.query.limit, 10) || 20;
      const losers = await marketDataService.getLosers(limit);
      res.json({ losers });
    } catch (err) {
      next(err);
    }
  }

  async getActive(req, res, next) {
    try {
      const limit = parseInt(req.query.limit, 10) || 20;
      const active = await marketDataService.getActive(limit);
      res.json({ active });
    } catch (err) {
      next(err);
    }
  }

  async getStocks(req, res, next) {
    try {
      res.json(await marketDataService.getStocks());
    } catch (err) {
      next(err);
    }
  }

  async getQuote(req, res, next) {
    try {
      const { symbol } = req.params;
      const quote = await marketDataService.getQuote(symbol);
      res.json(quote);
    } catch (err) {
      next(err);
    }
  }

  async getHistory(req, res, next) {
    try {
      const { symbol } = req.params;
      const { interval, from, to } = req.query;
      const candles = await marketDataService.getHistoricalCandles(symbol, interval, from, to);
      res.json({ symbol, interval: interval || 'day', candles });
    } catch (err) {
      next(err);
    }
  }

  async search(req, res, next) {
    try {
      const { q } = req.query;
      const results = await marketDataService.search(q);
      res.json({ results });
    } catch (err) {
      next(err);
    }
  }
}

export const marketController = new MarketController();
export default marketController;

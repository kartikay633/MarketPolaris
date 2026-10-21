// News Controller: the company news wire, its trader panels and per-stock news.
import { newsService } from '../services/newsService.js';
import { EVENT_TYPES } from '../news/classify.js';

const SYMBOL = /^(?:(?:NSE|BSE):)?[A-Z0-9&_-]{1,24}$/;

export class NewsController {
  async getMarketNews(req, res, next) {
    try {
      const category = EVENT_TYPES[req.query.category] ? req.query.category : 'all';
      const limit = Math.min(200, parseInt(req.query.limit, 10) || 30);
      const days = Math.min(7, Math.max(1, parseInt(req.query.days, 10) || 2));
      const symbol = SYMBOL.test(String(req.query.symbol || '').toUpperCase()) ? String(req.query.symbol).toUpperCase() : undefined;
      const kind = ['filing', 'story'].includes(req.query.kind) ? req.query.kind : undefined;
      const materiality = ['high', 'medium', 'low'].includes(req.query.materiality) ? req.query.materiality : 'medium';
      const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : undefined;
      const articles = await newsService.getMarketNews({ category, limit, days, symbol, kind, materiality, q });
      res.json({ category, count: articles.length, articles });
    } catch (err) {
      next(err);
    }
  }

  async getPulse(req, res, next) {
    try {
      res.json(await newsService.getPulse());
    } catch (err) {
      next(err);
    }
  }

  async getStockNews(req, res, next) {
    try {
      const { symbol } = req.params;
      const limit = Math.min(30, parseInt(req.query.limit, 10) || 6);
      const articles = await newsService.getStockNews(symbol, { limit });
      res.json({ symbol, count: articles.length, articles });
    } catch (err) {
      next(err);
    }
  }
}

export const newsController = new NewsController();
export default newsController;

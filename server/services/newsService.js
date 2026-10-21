// ROADMAP: Section 6 & 9 — News Service with In-Memory Caching
import NodeCache from 'node-cache';
import { marketauxProvider } from '../providers/MarketauxProvider.js';
import logger from '../utils/logger.js';

// Cache: 10 min for market news, 30 min for stock news (TTLs are set per entry below)
const cache = new NodeCache({
  stdTTL: 300,
  checkperiod: 60,
});

const MARKET_FETCH = 25; // the most Marketaux returns per request
const STOCK_FETCH = 10;

export class NewsService {
  constructor(provider = marketauxProvider) {
    this.provider = provider;
    this.lastGood = new Map(); // cache key -> last non-empty list, served while the feed fails
  }

  // One upstream request per list (not per page size), so the free Marketaux quota of about 100
  // requests a day lasts. A failed or empty reply keeps serving the last good list and retries in 60 s.
  async _list(key, load, ttl) {
    const cached = cache.get(key);
    if (cached) return cached;
    const fresh = await load();
    if (fresh.length) {
      this.lastGood.set(key, fresh);
      cache.set(key, fresh, ttl);
      return fresh;
    }
    const kept = this.lastGood.get(key) || [];
    cache.set(key, kept, 60);
    return kept;
  }

  async getMarketNews(options = {}) {
    const category = options.category || 'all';
    const limit = options.limit || 30;
    const articles = await this._list(`news:market:${category}`, () => this.provider.getMarketNews({ category, limit: MARKET_FETCH }), 600);
    return articles.slice(0, limit);
  }

  async getStockNews(symbol, options = {}) {
    const limit = options.limit || 6;
    const cleanSym = (symbol || '').toUpperCase();
    const articles = await this._list(`news:stock:${cleanSym}`, () => this.provider.getStockNews(cleanSym, { limit: STOCK_FETCH }), 1800);
    return articles.slice(0, limit);
  }
}

export const newsService = new NewsService();
export default newsService;

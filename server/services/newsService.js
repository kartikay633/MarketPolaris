// ROADMAP: Section 6 & 9 — News Service with In-Memory Caching
import NodeCache from 'node-cache';
import { marketauxProvider } from '../providers/MarketauxProvider.js';
import logger from '../utils/logger.js';

// Cache: 5 min TTL for general news, 10 min TTL for stock-specific news
const cache = new NodeCache({
  stdTTL: 300,
  checkperiod: 60,
});

export class NewsService {
  constructor(provider = marketauxProvider) {
    this.provider = provider;
  }

  async getMarketNews(options = {}) {
    const category = options.category || 'all';
    const limit = options.limit || 30;
    const cacheKey = `news:market:${category}:${limit}`;

    const cached = cache.get(cacheKey);
    if (cached) return cached;

    // The feed serves only real articles, so a short list is normal; an empty one (feed down)
    // is kept briefly so the next request retries soon without hammering the API.
    const articles = await this.provider.getMarketNews({ category, limit });
    cache.set(cacheKey, articles, articles.length ? 120 : 30); // 2 minutes cache
    return articles;
  }

  async getStockNews(symbol, options = {}) {
    const limit = options.limit || 6;
    const cleanSym = (symbol || '').toUpperCase();
    const cacheKey = `news:stock:${cleanSym}:${limit}`;

    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const articles = await this.provider.getStockNews(cleanSym, { limit });
    cache.set(cacheKey, articles, 600); // 10 minutes cache
    return articles;
  }
}

export const newsService = new NewsService();
export default newsService;

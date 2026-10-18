// ROADMAP: Section 6 & 8 — Market Data Service with In-Memory Caching
import NodeCache from 'node-cache';
import { upstoxProvider } from '../providers/UpstoxProvider.js';
import { isMarketOpen } from '../utils/marketHours.js';
import logger from '../utils/logger.js';

// Market data cache: standard 15s TTL during market hours, 60s when market closed
const cache = new NodeCache({
  stdTTL: 15,
  checkperiod: 30,
});

export class MarketDataService {
  constructor(provider = upstoxProvider) {
    this.provider = provider;
  }

  _getTTL(liveTtl = 15, closedTtl = 60) {
    return isMarketOpen() ? liveTtl : closedTtl;
  }

  async getOverview() {
    const cacheKey = 'market:overview';
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const data = await this.provider.getMarketOverview();
    cache.set(cacheKey, data, this._getTTL(15, 120));
    return data;
  }

  async getIndices() {
    const cacheKey = 'market:indices';
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const data = await this.provider.getIndices();
    cache.set(cacheKey, data, this._getTTL(15, 120));
    return data;
  }

  async getGainers(limit = 20) {
    const cacheKey = `market:gainers:${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const data = await this.provider.getGainers(limit);
    cache.set(cacheKey, data, this._getTTL(30, 300));
    return data;
  }

  async getLosers(limit = 20) {
    const cacheKey = `market:losers:${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const data = await this.provider.getLosers(limit);
    cache.set(cacheKey, data, this._getTTL(30, 300));
    return data;
  }

  async getActive(limit = 20) {
    const cacheKey = `market:active:${limit}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const data = await this.provider.getActive(limit);
    cache.set(cacheKey, data, this._getTTL(30, 300));
    return data;
  }

  async getStocks() {
    const cacheKey = 'market:stocks';
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const data = await this.provider.getStocks();
    cache.set(cacheKey, data, this._getTTL(30, 300));
    return data;
  }

  async getQuote(symbol) {
    const cacheKey = `stock:quote:${symbol.toUpperCase()}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const data = await this.provider.getQuote(symbol);
    cache.set(cacheKey, data, this._getTTL(10, 180));
    return data;
  }

  async getHistoricalCandles(symbol, interval, fromDate, toDate) {
    const cacheKey = `stock:candles:${symbol.toUpperCase()}:${interval}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const data = await this.provider.getHistoricalCandles(symbol, interval, fromDate, toDate);
    cache.set(cacheKey, data, 300); // 5 minutes cache
    return data;
  }

  async search(query) {
    return this.provider.searchInstruments(query);
  }
}

export const marketDataService = new MarketDataService();
export default marketDataService;

// ROADMAP: Section 9 — Marketaux News Provider Implementation
import axios from 'axios';
import { NewsProvider } from './NewsProvider.js';
import logger from '../utils/logger.js';

// Serves only articles the Marketaux feed returned, each with its own source link. When the
// feed is unconfigured, down or short, the list is simply shorter (possibly empty) and the UI
// shows its neutral empty state; there are no built-in sample articles.
const MIN_MATCH = 20;

export class MarketauxProvider extends NewsProvider {
  constructor() {
    super();
    this.apiKey = process.env.NEWS_API_KEY;
    this.baseUrl = process.env.NEWS_API_BASE_URL || 'https://api.marketaux.com/v1';
    this.isLive = Boolean(this.apiKey && this.apiKey !== 'your-news-api-key');

    if (this.isLive) {
      logger.info('Marketaux News Provider active — connected to live Indian financial news');
    } else {
      logger.info('Marketaux API key not configured — market news is empty until it is');
    }
  }

  async getMarketNews(options = {}) {
    const limit = options.limit || 30;
    const category = options.category || 'all';
    if (!this.isLive) return [];

    try {
      const params = {
        api_token: this.apiKey,
        countries: 'in',
        language: 'en',
        limit: Math.min(limit, 25),
      };

      if (category && category !== 'all') {
        params.search = category;
      }

      const res = await axios.get(`${this.baseUrl}/news/all`, {
        params,
        timeout: 12000,
      });
      return this._normalizeAll(res.data?.data, category).slice(0, limit);
    } catch (err) {
      logger.warn({ err: err.message }, 'Live Marketaux market news request failed; serving no articles');
      return [];
    }
  }

  async getStockNews(symbol, options = {}) {
    const limit = options.limit || 6;
    const cleanSym = (symbol || '').replace('NSE:', '').replace('BSE:', '').toUpperCase();
    if (!this.isLive || !cleanSym) return [];

    try {
      const res = await axios.get(`${this.baseUrl}/news/all`, {
        params: {
          api_token: this.apiKey,
          language: 'en',
          // The exact NSE/BSE listing, not a text search: "RELIANCE" as text also matches
          // Reliance Power and Reliance Infra, which are different companies.
          symbols: `${cleanSym}.NS,${cleanSym}.BO`,
          filter_entities: 'true',
          limit: Math.min(limit, 10),
        },
        timeout: 12000,
      });
      return this._normalizeAll(res.data?.data, 'stocks', [symbol]).slice(0, limit);
    } catch (err) {
      logger.warn({ err: err.message }, `Live Marketaux stock news failed for ${symbol}; serving no articles`);
      return [];
    }
  }

  // Keeps only articles with a title, a publish time and an http(s) source link, de-duplicated by link.
  _normalizeAll(items, category, fallbackSymbols = []) {
    const seen = new Set();
    return (Array.isArray(items) ? items : [])
      .filter((item) => item?.title && item.published_at && /^https?:\/\//i.test(item.url || ''))
      .filter((item) => !seen.has(item.url) && seen.add(item.url))
      .map((item) => this._normalizeArticle(item, category, fallbackSymbols));
  }

  _normalizeArticle(item, category = 'market', fallbackSymbols = []) {
    // Only Indian listings the article is clearly about: foreign tickers (e.g. HDB.BA) and
    // weak matches (Marketaux match_score below MIN_MATCH) produced misleading tags.
    const entities = (item.entities || [])
      .filter((e) => /\.(NS|BO)$/.test(e.symbol || '') && (e.match_score ?? 0) >= MIN_MATCH)
      .sort((a, b) => (b.match_score ?? 0) - (a.match_score ?? 0));
    let sentiment = 'neutral';
    const score = entities[0]?.sentiment_score;
    if (typeof score === 'number') {
      sentiment = score > 0.1 ? 'positive' : score < -0.1 ? 'negative' : 'neutral';
    }

    const symbols = [...new Set(entities.map((e) => `NSE:${e.symbol.replace(/\.(NS|BO)$/, '')}`))];

    return {
      id: item.uuid || item.url,
      title: item.title,
      summary: item.description || item.snippet || item.title,
      source: item.source || new URL(item.url).hostname.replace(/^www\./, ''),
      sourceUrl: item.url,
      imageUrl: item.image_url || null,
      publishedAt: item.published_at,
      category: category === 'all' ? 'markets' : category,
      relatedSymbols: symbols.length > 0 ? symbols : fallbackSymbols,
      sentiment,
    };
  }
}

export const marketauxProvider = new MarketauxProvider();
export default marketauxProvider;

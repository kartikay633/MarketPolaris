// News for the app, from the company news wire (server/news): NSE filings for every listed company
// and company stories from Indian business publishers. Marketaux is no longer used.
import { newsWire } from '../news/index.js';
import { EVENT_TYPES } from '../news/classify.js';
import { liveFilings } from '../research/stockFacts.js';
import { nseClient } from '../providers/nseClient.js';
import logger from '../utils/logger.js';

// A wire item in the article shape the pages and the AI already read.
export function toArticle(x) {
  return {
    id: x.id,
    title: x.title,
    summary: x.kind === 'filing' ? `${x.companies[0]?.name || x.symbols[0]}: ${x.summary}` : x.summary,
    source: x.source,
    sourceUrl: x.sourceUrl,
    publishedAt: x.publishedAt,
    category: EVENT_TYPES[x.eventType] || 'Other',
    eventType: x.eventType,
    kind: x.kind,
    materiality: x.materiality,
    companies: x.companies,
    relatedSymbols: x.symbols.map((s) => `NSE:${s}`),
  };
}

export class NewsService {
  constructor(wire = newsWire) {
    this.wire = wire;
  }

  // category: 'all' or an event type; the other filters pass straight to the wire.
  async getMarketNews({ category = 'all', limit = 30, symbol, kind, q, days = 2, materiality = 'medium' } = {}) {
    const items = await this.wire.query({ type: category && category !== 'all' ? category : undefined, symbol, kind, q, days, limit, materiality });
    return items.map(toArticle);
  }

  // A company's wire items over the last two weeks; NSE's live filing list fills in when the wire is thin.
  async getStockNews(symbol, { limit = 6 } = {}) {
    const clean = String(symbol || '').toUpperCase().replace(/^(NSE|BSE):/, '');
    const items = (await this.wire.query({ symbol: clean, days: 14, limit, materiality: 'low' })).map(toArticle);
    if (items.length >= limit) return items;
    try {
      const filings = await liveFilings(clean, { nse: nseClient, days: 14, limit });
      for (const f of filings) {
        if (items.some((a) => a.sourceUrl && a.sourceUrl === f.url)) continue;
        items.push({ id: `nse-live-${clean}-${f.time}`, title: f.text || f.category, summary: f.category, source: 'NSE filing', sourceUrl: f.url,
          publishedAt: new Date(f.time).toISOString(), category: f.category, eventType: 'other', kind: 'filing', materiality: 'medium',
          companies: [{ symbol: clean, name: clean }], relatedSymbols: [`NSE:${clean}`] });
      }
    } catch (err) {
      logger.debug({ err: err.message, symbol: clean }, 'Live NSE filings unavailable for stock news');
    }
    return items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, limit);
  }

  async getPulse() {
    return this.wire.pulse();
  }
}

export const newsService = new NewsService();
export default newsService;

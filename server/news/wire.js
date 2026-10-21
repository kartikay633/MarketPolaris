// Company news wire: NSE corporate filings for every listed company, plus company stories from
// Indian business publishers' public RSS feeds (headline, summary line and link only). Items are
// tagged with the NSE companies they concern and an event type, filtered to company news (market
// commentary and routine filings are dropped), and stored per IST day so the day's flow builds up.
// Trader panels come from the same verifiable sources: NSE bulk/block deals and credit-rating actions.
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { CompanyTagger } from './tagger.js';
import { EVENT_TYPES, storyEventType, filingEventType, filingMateriality, isMarketCommentary } from './classify.js';

export const PUBLISHER_FEEDS = [
  { source: 'Economic Times', url: 'https://economictimes.indiatimes.com/markets/stocks/news/rssfeeds/2146842.cms' },
  { source: 'Economic Times', url: 'https://economictimes.indiatimes.com/industry/rssfeeds/13352306.cms' },
  { source: 'Business Standard', url: 'https://www.business-standard.com/rss/companies-101.rss' },
  { source: 'Business Standard', url: 'https://www.business-standard.com/rss/markets-106.rss' },
  { source: 'Mint', url: 'https://www.livemint.com/rss/companies' },
  { source: 'Mint', url: 'https://www.livemint.com/rss/markets' },
  { source: 'BusinessLine', url: 'https://www.thehindubusinessline.com/companies/feeder/default.rss' },
];
const IST_MS = 19800000;
const KEEP_DAYS = 30;
const MEMORY_DAYS = 7;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MarketPolaris/1.0 (+news wire; headlines and links only)';

export const istDay = (t) => new Date(new Date(t).getTime() + IST_MS).toISOString().slice(0, 10);
const ddmmyyyy = (d) => { const x = new Date(d.getTime() + IST_MS); return `${String(x.getUTCDate()).padStart(2, '0')}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${x.getUTCFullYear()}`; };
const id = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);
const strip = (s) => String(s || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/\s+/g, ' ').trim();

// '21-Oct-2026 19:15:55' (IST) → ISO time.
export function nseTime(text) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(text || '').trim());
  if (!m) return null;
  const t = Date.parse(`${m[2]} ${m[1]} ${m[3]} ${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'} GMT+0530`);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// One NSE corporate announcement → a wire item, or null for routine notices.
export function filingItem(r) {
  if (!r?.symbol || !r.seq_id) return null;
  const text = strip(r.attchmntText);
  const materiality = filingMateriality(r.desc, text);
  if (!materiality) return null;
  const publishedAt = nseTime(r.exchdisstime) || nseTime(r.an_dt);
  if (!publishedAt) return null;
  const detail = text.replace(/^.*?has (?:informed|intimated|submitted)(?: to)? the Exchange,?\s*(?:about|regarding|that|of|with respect to)?\s*(?:the\s+)?/i, '');
  const title = detail ? detail.charAt(0).toUpperCase() + detail.slice(1) : strip(r.desc);
  return {
    id: `nse-${r.seq_id}`, kind: 'filing', title: title.slice(0, 300), summary: strip(r.desc), category: strip(r.desc),
    source: 'NSE filing', sourceUrl: /^https?:\/\//.test(r.attchmntFile || '') ? r.attchmntFile : null, publishedAt,
    symbols: [r.symbol], companies: [{ symbol: r.symbol, name: strip(r.sm_name) || r.symbol }],
    eventType: filingEventType(r.desc, text), materiality,
  };
}

// RSS XML → raw items ({ title, link, description, publishedAt }).
export function parseFeed(xml) {
  return (String(xml || '').match(/<item[\s>][\s\S]*?<\/item>/g) || []).map((block) => {
    const tag = (name) => strip((block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)) || [])[1]);
    const t = Date.parse(tag('pubDate'));
    return { title: tag('title'), link: tag('link'), description: tag('description'), publishedAt: Number.isFinite(t) ? new Date(t).toISOString() : null };
  }).filter((x) => x.title && /^https?:\/\//.test(x.link) && x.publishedAt);
}

// A publisher story → a wire item, or null when it names no listed company or is market commentary.
export function storyItem(raw, source, tagger, names = {}) {
  if (isMarketCommentary(raw.title)) return null;
  let symbols = tagger.tag(raw.title);
  // The summary only names the company when the match is strong (a full name, brand or ticker).
  if (!symbols.length) symbols = tagger.tag(raw.description, 1, 3);
  if (!symbols.length) return null;
  const type = storyEventType(raw.title, raw.description);
  return {
    id: `story-${id(raw.link)}`, kind: 'story', title: raw.title.slice(0, 300), summary: raw.description.slice(0, 320), category: EVENT_TYPES[type],
    source, sourceUrl: raw.link, publishedAt: raw.publishedAt,
    symbols, companies: symbols.map((s) => ({ symbol: s, name: names[s] || s })),
    // Company events rank high; analyst views and plain price moves rank lower.
    eventType: type, materiality: ['results', 'legal', 'deals', 'ratings', 'capital', 'orders', 'management'].includes(type) ? 'high' : type === 'price' ? 'low' : 'medium',
  };
}

const RANK = { high: 3, medium: 2, low: 1 };

export class NewsWire {
  constructor({ dataDir, nse, equities = () => ({}), notable = () => [], fetcher = globalThis.fetch, logger = null, now = () => new Date() }) {
    this.notable = notable;
    this.dir = path.join(dataDir, 'news-wire');
    this.nse = nse;
    this.equities = equities;
    this.fetcher = fetcher;
    this.logger = logger;
    this.now = now;
    this.items = new Map();
    this.deals = null;
    this.ratings = [];
    this.loaded = null;
    this.tagger = null;
    this.lastRefresh = null;
  }

  _tagger() {
    const eq = this.equities() || {};
    if (!this.tagger || this.tagger.size !== Object.keys(eq).length) { this.tagger = new CompanyTagger(eq, { notable: this.notable() }); this.tagger.size = Object.keys(eq).length; }
    return this.tagger;
  }

  async load() {
    this.loaded ||= (async () => {
      const today = this.now();
      for (let i = 0; i < MEMORY_DAYS; i += 1) {
        const day = istDay(today.getTime() - i * 86400000);
        try {
          const doc = JSON.parse(await fs.readFile(path.join(this.dir, `${day}.json`), 'utf8'));
          for (const item of doc.items || []) this.items.set(item.id, item);
          if (i === 0 && doc.deals) this.deals = doc.deals;
          if (i === 0 && doc.ratings) this.ratings = doc.ratings;
        } catch { /* no file for that day */ }
      }
    })();
    return this.loaded;
  }

  async _save(day) {
    const items = [...this.items.values()].filter((x) => istDay(x.publishedAt) === day).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    const doc = { day, savedAt: this.now().toISOString(), items, ...(day === istDay(this.now()) && { deals: this.deals, ratings: this.ratings }) };
    await fs.mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, `${day}.json`);
    await fs.writeFile(`${file}.tmp`, JSON.stringify(doc));
    for (let attempt = 0; ; attempt += 1) {
      try { await fs.rename(`${file}.tmp`, file); break; } catch (err) { if (attempt >= 6) throw err; await new Promise((r) => setTimeout(r, 150 * 2 ** attempt)); }
    }
  }

  async _filings(days = 1) {
    const to = this.now();
    const from = new Date(to.getTime() - (days - 1) * 86400000);
    const rows = await this.nse.getJson(`/api/corporate-announcements?index=equities&from_date=${ddmmyyyy(from)}&to_date=${ddmmyyyy(to)}`,
      'https://www.nseindia.com/companies-listing/corporate-filings-announcements');
    return (Array.isArray(rows) ? rows : []).map(filingItem).filter(Boolean);
  }

  async _stories() {
    const tagger = this._tagger();
    const eq = this.equities() || {};
    const names = Object.fromEntries(Object.entries(eq).map(([s, e]) => [s, e.name]));
    const out = [];
    await Promise.all(PUBLISHER_FEEDS.map(async ({ source, url }) => {
      try {
        const res = await this.fetcher(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml' }, signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        for (const raw of parseFeed(await res.text())) { const item = storyItem(raw, source, tagger, names); if (item) out.push(item); }
      } catch (err) {
        this.logger?.warn({ err: err.message, url }, 'News feed unavailable');
      }
    }));
    // The same story often runs on two feeds of one publisher, or under a near-identical headline.
    const seen = new Set();
    return out.filter((x) => { const key = x.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').slice(0, 70); if (seen.has(key)) return false; seen.add(key); return true; });
  }

  async _dealsSnapshot() {
    const j = await this.nse.getJson('/api/snapshot-capital-market-largedeal', 'https://www.nseindia.com/market-data/large-deals');
    const map = (rows, kind) => (rows || []).map((r) => {
      const qty = Number(String(r.qty).replace(/,/g, '')), price = Number(String(r.watp).replace(/,/g, ''));
      return { kind, symbol: r.symbol, name: strip(r.name), client: strip(r.clientName), side: r.buySell, quantity: qty, price, valueCr: Number.isFinite(qty * price) ? Math.round(qty * price / 1e5) / 100 : null, date: r.date };
    }).filter((d) => d.symbol && d.valueCr !== null);
    return { asOf: j.as_on_date || null, block: map(j.BLOCK_DEALS_DATA, 'block'), bulk: map(j.BULK_DEALS_DATA, 'bulk') };
  }

  async _ratingActions() {
    const rows = await this.nse.getJson('/api/corporate-credit-rating?index=equities', 'https://www.nseindia.com/companies-listing/debt-centralised-database/credit-rating');
    const cutoff = this.now().getTime() - 30 * 86400000;
    const tagger = this._tagger();
    return (Array.isArray(rows) ? rows : []).map((r) => {
      const t = Date.parse(String(r.DateofCR || '').replace(/^(\d{2})-(\d{2})-(\d{4})$/, '$3-$2-$1'));
      const action = /upgrad/i.test(r.RatingAction) ? 'upgrade' : /downgrad/i.test(r.RatingAction) ? 'downgrade' : null;
      const symbol = r.Symbol && r.Symbol !== 'NOTLISTED' ? r.Symbol : tagger.tag(r.CompanyName, 1)[0] || null;
      return { date: Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null, time: t, action, symbol, company: strip(r.CompanyName), agency: strip(r.NameOfCRAgency),
        rating: strip(r.CreditRating), previous: strip(r.CreditRatingEarlier) || null, outlook: strip(r.Outlook) || null };
    }).filter((r) => r.action && r.time >= cutoff).sort((a, b) => b.time - a.time)
      // One line per company and action (an agency usually rates several instruments at once).
      .filter((r, i, all) => all.findIndex((x) => x.company === r.company && x.action === r.action) === i).map(({ time, ...r }) => r);
  }

  // One pass over every source; a failed source keeps its previous data.
  async refresh({ filingDays = 1 } = {}) {
    await this.load();
    const touched = new Set();
    const merge = (items) => { for (const x of items) { if (!this.items.has(x.id)) touched.add(istDay(x.publishedAt)); this.items.set(x.id, x); } };
    const settle = (p) => p.then((value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason }));
    const storiesP = settle(this._stories());
    const filings = await settle(this._filings(filingDays));
    const deals = await settle(this._dealsSnapshot());
    const ratings = await settle(this._ratingActions());
    const stories = await storiesP;
    if (filings.status === 'fulfilled') merge(filings.value); else this.logger?.warn({ err: filings.reason?.message }, 'NSE filings unavailable');
    if (stories.status === 'fulfilled') merge(stories.value);
    if (deals.status === 'fulfilled') this.deals = deals.value; else this.logger?.warn({ err: deals.reason?.message }, 'NSE large deals unavailable');
    if (ratings.status === 'fulfilled') this.ratings = ratings.value; else this.logger?.warn({ err: ratings.reason?.message }, 'NSE credit ratings unavailable');
    touched.add(istDay(this.now()));
    // Keep KEEP_DAYS on disk, MEMORY_DAYS in memory.
    const oldest = istDay(this.now().getTime() - MEMORY_DAYS * 86400000);
    for (const [k, x] of this.items) if (istDay(x.publishedAt) < oldest) this.items.delete(k);
    for (const day of touched) await this._save(day);
    await this._prune();
    this.lastRefresh = this.now().toISOString();
    return { items: this.items.size, filings: filings.value?.length ?? null, stories: stories.value?.length ?? null };
  }

  async _prune() {
    const cutoff = istDay(this.now().getTime() - KEEP_DAYS * 86400000);
    try { for (const f of await fs.readdir(this.dir)) if (/^\d{4}-\d{2}-\d{2}\.json$/.test(f) && f.slice(0, 10) < cutoff) await fs.unlink(path.join(this.dir, f)); } catch { /* folder not yet created */ }
  }

  // Refreshes every 5 minutes from 08:00 to 22:00 IST and every 20 minutes otherwise.
  start() {
    const tick = async () => {
      try { await this.refresh({ filingDays: this.lastRefresh ? 1 : 2 }); }
      catch (err) { this.logger?.warn({ err: err.message }, 'News wire refresh failed'); }
      const hour = new Date(this.now().getTime() + IST_MS).getUTCHours();
      this.timer = setTimeout(tick, (hour >= 8 && hour < 22 ? 5 : 20) * 60000);
      this.timer.unref?.();
    };
    tick();
  }

  // Newest first. type: an EVENT_TYPES key; kind: 'filing' | 'story'; materiality: minimum level.
  async query({ type, symbol, kind, q, days = 2, limit = 60, materiality = 'medium' } = {}) {
    await this.load();
    const since = istDay(this.now().getTime() - (Math.max(1, days) - 1) * 86400000);
    const sym = symbol ? String(symbol).toUpperCase().replace(/^(NSE|BSE):/, '') : null;
    const text = q ? String(q).toLowerCase() : null;
    return [...this.items.values()]
      .filter((x) => istDay(x.publishedAt) >= since)
      .filter((x) => (!type || x.eventType === type) && (!kind || x.kind === kind) && (!sym || x.symbols.includes(sym)))
      .filter((x) => RANK[x.materiality] >= (RANK[materiality] || 1))
      .filter((x) => !text || `${x.title} ${x.summary} ${x.companies.map((c) => `${c.symbol} ${c.name}`).join(' ')}`.toLowerCase().includes(text))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, limit);
  }

  // Panels for the News page, all counts of verifiable events.
  async pulse() {
    await this.load();
    const today = istDay(this.now());
    const todays = [...this.items.values()].filter((x) => istDay(x.publishedAt) === today && RANK[x.materiality] >= 2);
    const byType = Object.fromEntries(Object.keys(EVENT_TYPES).map((k) => [k, 0]));
    const companies = new Map();
    for (const x of todays) {
      byType[x.eventType] = (byType[x.eventType] || 0) + 1;
      for (const c of x.companies) {
        const e = companies.get(c.symbol) || { symbol: c.symbol, name: c.name, items: 0, filings: 0, stories: 0, types: new Set() };
        e.items += 1; e[x.kind === 'filing' ? 'filings' : 'stories'] += 1; e.types.add(x.eventType);
        companies.set(c.symbol, e);
      }
    }
    const deals = this.deals || { asOf: null, block: [], bulk: [] };
    const bigBulk = deals.bulk.filter((d) => d.valueCr >= 5).sort((a, b) => b.valueCr - a.valueCr);
    return {
      day: today,
      refreshedAt: this.lastRefresh,
      activity: { filings: todays.filter((x) => x.kind === 'filing').length, stories: todays.filter((x) => x.kind === 'story').length, byType, labels: EVENT_TYPES },
      results: todays.filter((x) => x.eventType === 'results' && x.kind === 'filing').map((x) => x.companies[0]).filter((c, i, a) => a.findIndex((y) => y.symbol === c.symbol) === i).slice(0, 40),
      mostInNews: [...companies.values()].sort((a, b) => b.items - a.items || b.filings - a.filings).slice(0, 10).map((c) => ({ ...c, types: [...c.types] })),
      deals: { asOf: deals.asOf, block: [...deals.block].sort((a, b) => b.valueCr - a.valueCr).slice(0, 12), bulk: bigBulk.slice(0, 12),
        blockValueCr: Math.round(deals.block.reduce((s, d) => s + d.valueCr, 0)), bulkCount: deals.bulk.length },
      ratings: { upgrades: this.ratings.filter((r) => r.action === 'upgrade').slice(0, 12), downgrades: this.ratings.filter((r) => r.action === 'downgrade').slice(0, 12),
        windowDays: 30, filingsToday: todays.filter((x) => x.kind === 'filing' && x.eventType === 'ratings').length },
    };
  }
}

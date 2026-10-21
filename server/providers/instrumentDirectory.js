// Every NSE main-board equity (series EQ, and BE for trade-for-trade stocks) from Upstox's public
// NSE instrument list, so any listed stock can be searched, quoted and charted. The list is saved
// to <data dir>/nse-equities.json and refreshed in the background once it is a week old.
// AI forecasts still cover only the research universe; `covered` marks those stocks.
import axios from 'axios';
import { readFileSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import logger from '../utils/logger.js';

export const NSE_INSTRUMENTS_URL = 'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz';
const SERIES = new Set(['EQ', 'BE']);
const MAX_AGE_MS = 7 * 86400000;

// Upstox instrument rows → { SYMBOL: { name, key, isin, series } } for main-board equities.
export function equitiesFrom(instruments) {
  const out = {};
  for (const x of instruments || []) {
    if (x?.segment !== 'NSE_EQ' || !SERIES.has(x.instrument_type) || !x.trading_symbol || !/^NSE_EQ\|/.test(x.instrument_key || '')) continue;
    // The official name (as NSE lists it); Upstox's short name can lag a rename, so it is only searched.
    out[String(x.trading_symbol).toUpperCase()] = {
      name: String(x.name || x.trading_symbol).trim(),
      alias: x.short_name ? String(x.short_name).trim() : null,
      key: x.instrument_key,
      isin: x.isin || null,
      series: x.instrument_type,
    };
  }
  return out;
}

// Search score: exact symbol, symbol prefix, a name word starting with the query, then substrings.
function score(symbol, name, q) {
  const n = name.toLowerCase();
  const compact = q.replace(/\s+/g, '');
  if (symbol === q || symbol === compact) return 100;
  let s = 0;
  if (symbol.startsWith(q) || symbol.startsWith(compact)) s = 80;
  else if (n.startsWith(q.toLowerCase())) s = 70;
  else if (n.split(/[\s&.-]+/).some((w) => w.startsWith(q.toLowerCase()))) s = 60;
  else if (symbol.includes(q)) s = 45;
  else if (n.includes(q.toLowerCase())) s = 35;
  return s;
}

export class InstrumentDirectory {
  constructor(dataDir, { fetcher = axios.get } = {}) {
    this.file = path.join(dataDir, 'nse-equities.json');
    this.fetcher = fetcher;
    this.equities = {};
    this.fetchedAt = null;
    this.refreshing = null;
    try {
      const doc = JSON.parse(readFileSync(this.file, 'utf8'));
      this.equities = doc.equities || {};
      this.fetchedAt = doc.fetchedAt || null;
    } catch { /* not saved yet: refreshed on first use */ }
  }

  get size() { return Object.keys(this.equities).length; }

  // Refreshes in the background when the saved list is missing or a week old; never blocks a request.
  ensureFresh() {
    const age = this.fetchedAt ? Date.now() - Date.parse(this.fetchedAt) : Infinity;
    if (age < MAX_AGE_MS || this.refreshing) return this.refreshing;
    this.refreshing = this.refresh().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  async refresh() {
    try {
      const res = await this.fetcher(NSE_INSTRUMENTS_URL, { responseType: 'arraybuffer', timeout: 30000 });
      const equities = equitiesFrom(JSON.parse(gunzipSync(Buffer.from(res.data)).toString('utf8')));
      if (Object.keys(equities).length < 1000) throw new Error(`only ${Object.keys(equities).length} equities in the list`);
      this.equities = equities;
      this.fetchedAt = new Date().toISOString();
      await writeFile(`${this.file}.tmp`, JSON.stringify({ source: NSE_INSTRUMENTS_URL, fetchedAt: this.fetchedAt, equities }));
      await rename(`${this.file}.tmp`, this.file);
      logger.info({ equities: this.size }, 'NSE equity directory refreshed');
    } catch (err) {
      logger.warn({ err: err.message }, 'NSE equity directory refresh failed; keeping the saved list');
    }
  }

  get(symbol) {
    this.ensureFresh();
    return this.equities[String(symbol || '').toUpperCase().replace(/^(NSE|BSE):/, '')] || null;
  }

  // Best matches for a typed query; stocks the AI covers rank first among equal matches.
  search(query, { covered = new Set(), limit = 10 } = {}) {
    this.ensureFresh();
    const q = String(query || '').trim().toUpperCase().replace(/^(NSE|BSE):/, '');
    if (!q) return [];
    const hits = [];
    for (const [symbol, e] of Object.entries(this.equities)) {
      const s = Math.max(score(symbol, e.name, q), e.alias ? score(symbol, e.alias, q) - 5 : 0);
      if (s) hits.push({ symbol, e, s: s + (covered.has(symbol) ? 5 : 0) + (e.series === 'EQ' ? 1 : 0) });
    }
    return hits.sort((a, b) => b.s - a.s || a.symbol.localeCompare(b.symbol)).slice(0, limit)
      .map(({ symbol, e }) => ({ symbol: `NSE:${symbol}`, name: e.name, exchange: 'NSE', series: e.series, covered: covered.has(symbol) }));
  }
}

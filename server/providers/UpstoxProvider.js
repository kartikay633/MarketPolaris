// ROADMAP: Section 8 — Upstox Provider Implementation
import axios from 'axios';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import NodeCache from 'node-cache';
import { MarketDataProvider } from './MarketDataProvider.js';
import { nseClient } from './nseClient.js';
import {
  SOURCE_EOD, SOURCE_UNAVAILABLE, SECTOR_LABELS, loadUniverse, readCandleSummary, readCandleSummaries, quoteKeys, snapshotFromQuotes,
  snapshotFromCandles, movers, breadthOf, sectorsOf, analyzeOptionChain, readNames, saveNames,
} from './marketSnapshot.js';
import { getMarketStatus, isMarketOpen } from '../utils/marketHours.js';
import logger from '../utils/logger.js';

export { SOURCE_EOD, SOURCE_UNAVAILABLE };
const NSE_INSTRUMENTS_URL = 'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz';

// Symbol mapping between Market Pulse internal format and Upstox instrument keys
const RAW_MAPPINGS = {
  NIFTY_50: 'NSE_INDEX|Nifty 50',
  BANK_NIFTY: 'NSE_INDEX|Nifty Bank',
  SENSEX: 'BSE_INDEX|SENSEX',
  INDIA_VIX: 'NSE_INDEX|India VIX',
  RELIANCE: 'NSE_EQ|INE002A01018',
  TCS: 'NSE_EQ|INE467B01029',
  HDFCBANK: 'NSE_EQ|INE040A01034',
  INFY: 'NSE_EQ|INE009A01021',
  ICICIBANK: 'NSE_EQ|INE090A01021',
  TATAMOTORS: 'NSE_EQ|INE155A01022',
  BHARTIARTL: 'NSE_EQ|INE397D01024',
  ITC: 'NSE_EQ|INE154A01025',
  LT: 'NSE_EQ|INE018A01030',
  TATASTEEL: 'NSE_EQ|INE081A01020',
  SUNPHARMA: 'NSE_EQ|INE044A01036',
  SBIN: 'NSE_EQ|INE062A01020',
  AXISBANK: 'NSE_EQ|INE238A01034',
  KOTAKBANK: 'NSE_EQ|INE237A01028',
  WIPRO: 'NSE_EQ|INE075A01022',
  HCLTECH: 'NSE_EQ|INE860A01027',
  BAJFINANCE: 'NSE_EQ|INE296A01024',
  BAJAJFINSV: 'NSE_EQ|INE918I01026',
  MARUTI: 'NSE_EQ|INE585B01010',
  ASIANPAINT: 'NSE_EQ|INE021A01026',
  TITAN: 'NSE_EQ|INE280A01028',
  ULTRACEMCO: 'NSE_EQ|INE481G01011',
  NTPC: 'NSE_EQ|INE733E01010',
  POWERGRID: 'NSE_EQ|INE752E01010',
  ONGC: 'NSE_EQ|INE213A01029',
  COALINDIA: 'NSE_EQ|INE522F01014',
  JSWSTEEL: 'NSE_EQ|INE019A01038',
  HINDALCO: 'NSE_EQ|INE038A01020',
  ADANIENT: 'NSE_EQ|INE423A01024',
  ADANIPORTS: 'NSE_EQ|INE742F01042',
  NESTLEIND: 'NSE_EQ|INE239A01024',
  DRREDDY: 'NSE_EQ|INE089A01023',
  CIPLA: 'NSE_EQ|INE059A01026',
  TECHM: 'NSE_EQ|INE669C01036',
};

// Every index, quote and overview payload carries `source`, set by the code path
// that produced it: 'live' for an Upstox response, 'end-of-day' for saved candles or an
// exchange end-of-day report, 'fallback' for built-in values (single quotes and the
// standalone indices endpoint only; the overview, movers and screener never serve them).
export const SOURCE_LIVE = 'live';
export const SOURCE_FALLBACK = 'fallback';

const markFallback = (rows) => rows.map((row) => ({ ...row, source: SOURCE_FALLBACK }));
const positive = (v) => (Number(v) > 0 ? Number(v) : null);

// Saved candle files are named by the research collection; the dashboard knows NIFTY BANK as BANK_NIFTY.
const SAVED_CANDLE_FILES = { BANK_NIFTY: 'NIFTY_BANK' };

// [timestamp, open, high, low, close, volume, oi] → chart candle (epoch seconds).
const toCandle = (c) => ({
  time: Math.floor(new Date(c[0]).getTime() / 1000),
  open: Number(c[1]),
  high: Number(c[2]),
  low: Number(c[3]),
  close: Number(c[4]),
  volume: Number(c[5] || 0),
});

// Rolls chronological daily candles up into Monday-start weeks (IST dates).
function toWeeks(daily) {
  const weeks = [];
  for (const c of daily) {
    const day = new Date((c.time + 19800) * 1000);
    const monday = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
    const last = weeks[weeks.length - 1];
    if (last && last.week === monday) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume += c.volume;
    } else {
      weeks.push({ week: monday, ...c });
    }
  }
  return weeks.map(({ week, ...c }) => c);
}

// Build lookup map supporting 'RELIANCE', 'NSE:RELIANCE', 'BSE:RELIANCE'
const SYMBOL_TO_INSTRUMENT_KEY = {};
for (const [key, val] of Object.entries(RAW_MAPPINGS)) {
  SYMBOL_TO_INSTRUMENT_KEY[key] = val;
  SYMBOL_TO_INSTRUMENT_KEY[`NSE:${key}`] = val;
  SYMBOL_TO_INSTRUMENT_KEY[`BSE:${key}`] = val;
}
// Every stock the research pipeline covers: instrument keys resolved by the nightly
// collection from Upstox's official NSE instrument list (data/pulse/collection.json).
try {
  const manifest = JSON.parse(readFileSync(path.resolve(process.env.PULSE_DATA_DIR || 'data/pulse', 'collection.json'), 'utf8'));
  for (const { symbol, instrumentKey } of manifest.instruments || []) {
    if (!/^NSE_EQ\|/.test(instrumentKey || '') || SYMBOL_TO_INSTRUMENT_KEY[symbol]) continue;
    SYMBOL_TO_INSTRUMENT_KEY[symbol] = instrumentKey;
    SYMBOL_TO_INSTRUMENT_KEY[`NSE:${symbol}`] = instrumentKey;
  }
} catch { /* no research collection yet: only the built-in symbols resolve */ }

export class UpstoxProvider extends MarketDataProvider {
  constructor() {
    super();
    this.token = process.env.UPSTOX_ANALYTICS_TOKEN;
    this.baseUrl = process.env.UPSTOX_API_BASE_URL || 'https://api.upstox.com/v2';
    this.isLive = Boolean(this.token && this.token !== 'your-analytics-token');
    this.dataDir = path.resolve(process.env.PULSE_DATA_DIR || 'data/pulse');
    this.nse = nseClient;
    this.cache = new NodeCache({ checkperiod: 60, useClones: false });
    this.inflight = new Map();

    if (this.isLive) {
      logger.info('Upstox credentials active — connected to live NSE/BSE Upstox feeds');
    } else {
      logger.info('Upstox credentials not configured — running in high-fidelity mock provider mode');
    }
  }

  // Each block carries its own source: 'live' (Upstox feed), 'end-of-day' (saved candles or an
  // exchange end-of-day report) or 'unavailable' (block is null; the UI shows a neutral state).
  async getMarketOverview() {
    const marketState = getMarketStatus();
    const [snap, derivatives, institutionalFlows, turnover] = await Promise.all([
      this.getSnapshot(),
      this._cached('derivatives', () => this._getDerivatives()),
      this._cached('flows', () => this.nse.getFiiDii(), { open: 15 * 60, closed: 60 * 60 }),
      this._cached('turnover', () => this.nse.getTurnover(), { open: 5 * 60, closed: 30 * 60 }),
    ]);

    const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
    const eodOrLive = (asOf) => (marketState.status === 'OPEN' && asOf === today ? SOURCE_LIVE : SOURCE_EOD);
    const indices = snap?.indices || [];
    const sectors = snap?.sectorIndices?.length ? sectorsOf(snap.sectorIndices) : null;
    const breadth = snap?.stocks?.length ? breadthOf(snap.stocks) : null;

    const block = (data, source, asOf) => ({ source: data ? source : SOURCE_UNAVAILABLE, asOf: data ? asOf : null });
    const meta = {
      indices: block(indices.length ? indices : null, snap?.source, snap?.asOf),
      breadth: block(breadth, snap?.source, snap?.asOf),
      sectors: block(sectors, snap?.source, snap?.asOf),
      turnover: block(turnover, turnover && eodOrLive(turnover.asOf), turnover?.asOf),
      institutionalFlows: block(institutionalFlows, SOURCE_EOD, institutionalFlows?.asOf),
      derivatives: block(derivatives, SOURCE_LIVE, derivatives && (snap?.source === SOURCE_LIVE ? snap.asOf : new Date().toISOString())),
    };
    const sources = Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, v.source]));
    const asOf = Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, v.asOf]));
    const shown = Object.values(sources).filter((s) => s !== SOURCE_UNAVAILABLE);

    return {
      status: marketState.status,
      statusMessage: marketState.reason,
      timestamp: new Date().toISOString(),
      source: shown.length && shown.every((s) => s === SOURCE_LIVE) ? SOURCE_LIVE : SOURCE_EOD,
      sources,
      asOf,
      session: snap?.session || null,
      indices,
      breadth,
      sectors,
      turnover,
      institutionalFlows,
      derivatives,
    };
  }

  // One snapshot of the covered universe shared by the overview, movers and screener:
  // a single batched Upstox quote call when the feed is live, else the latest saved candles.
  async getSnapshot() {
    return this._cached('snapshot', async () => {
      const universe = this._universe();
      if (!universe.stocks.length) return null;
      const summaries = await readCandleSummaries(this.dataDir, [
        ...universe.stocks.map((i) => i.symbol),
        ...universe.sectorIndices.map((i) => i.symbol),
        ...universe.headline.map((h) => h.collected || h.symbol),
      ]);
      const names = this._names(universe);

      if (this.isLive) {
        try {
          const res = await axios.get(`${this.baseUrl}/market-quote/quotes`, {
            params: { instrument_key: quoteKeys(universe).join(',') },
            headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
            timeout: 10000,
          });
          const live = snapshotFromQuotes(universe, res.data?.data, summaries, names);
          if (live) return live;
          logger.warn('Upstox batched quote covered too little of the universe; using saved end-of-day candles');
        } catch (err) {
          logger.warn({ err: err.message }, 'Upstox batched quote failed; using saved end-of-day candles');
        }
      }
      return snapshotFromCandles(universe, summaries, names);
    }, { open: 15, closed: 120 });
  }

  // NIFTY option chain for the nearest expiry that has not passed. Live feed only: the saved
  // F&O history holds stock options, not index options, so there is no end-of-day substitute.
  async _getDerivatives() {
    if (!this.isLive) return null;
    const underlying = 'NSE_INDEX|Nifty 50';
    const headers = { Authorization: `Bearer ${this.token}`, Accept: 'application/json' };
    try {
      const expiries = await this._cached('nifty-expiries', async () => {
        const res = await axios.get(`${this.baseUrl}/option/contract`, { params: { instrument_key: underlying }, headers, timeout: 8000 });
        const list = [...new Set((res.data?.data || []).map((c) => c.expiry).filter(Boolean))].sort();
        return list.length ? list : null;
      }, { open: 6 * 3600, closed: 6 * 3600 });
      const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
      const expiry = expiries?.find((d) => d >= today);
      if (!expiry) return null;
      const res = await axios.get(`${this.baseUrl}/option/chain`, { params: { instrument_key: underlying, expiry_date: expiry }, headers, timeout: 8000 });
      return analyzeOptionChain(res.data?.data);
    } catch (err) {
      logger.warn({ err: err.message }, 'Upstox NIFTY option chain unavailable');
      return null;
    }
  }

  _universe() {
    if (!this.universe) this.universe = loadUniverse(this.dataDir);
    return this.universe;
  }

  // Company names come from Upstox's public NSE instrument list, saved once next to the
  // collection. Until that file exists rows show the trading symbol as the name.
  _names(universe) {
    if (this.names) return this.names;
    const saved = readNames(this.dataDir);
    if (saved) {
      this.names = saved;
      return saved;
    }
    if (this.isLive && !this.namesRequested) {
      this.namesRequested = true;
      axios.get(NSE_INSTRUMENTS_URL, { responseType: 'arraybuffer', timeout: 30000 })
        .then((res) => saveNames(this.dataDir, JSON.parse(gunzipSync(Buffer.from(res.data)).toString('utf8')), universe))
        .then((names) => { if (names) { this.names = names; this.cache.del('snapshot'); } })
        .catch((err) => logger.warn({ err: err.message }, 'NSE instrument names unavailable; showing symbols'));
    }
    return {};
  }

  // Shares one in-flight request per key and keeps the result for a market-hours-aware TTL.
  // A failed or empty result is kept briefly so a down source is not hammered.
  async _cached(key, load, ttl = { open: 60, closed: 600 }) {
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    if (this.inflight.has(key)) return this.inflight.get(key);
    const p = (async () => {
      try {
        const value = (await load()) ?? null;
        this.cache.set(key, value, value === null ? 60 : isMarketOpen() ? ttl.open : ttl.closed);
        return value;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p;
  }

  async getIndices() {
    if (this.isLive) {
      try {
        const res = await axios.get(`${this.baseUrl}/market-quote/quotes`, {
          params: {
            instrument_key: 'NSE_INDEX|Nifty 50,BSE_INDEX|SENSEX,NSE_INDEX|Nifty Bank,NSE_INDEX|India VIX',
          },
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: 'application/json',
          },
          timeout: 7000,
        });
        if (res.data?.data) {
          return this._normalizeIndices(res.data.data);
        }
      } catch (err) {
        logger.warn({ err: err.message }, 'Live Upstox indices request failed, using high-fidelity fallback');
      }
    }

    return this._getFallbackIndices();
  }

  _normalizeIndices(data) {
    const list = [];
    for (const [key, quote] of Object.entries(data)) {
      const isNifty = key.includes('Nifty 50');
      const isBank = key.includes('Nifty Bank');
      const isSensex = key.includes('SENSEX');
      const isVix = key.includes('India VIX');

      const symbol = isNifty ? 'NIFTY_50' : isSensex ? 'SENSEX' : isBank ? 'BANK_NIFTY' : isVix ? 'INDIA_VIX' : key;
      const name = isNifty ? 'NIFTY 50' : isSensex ? 'BSE SENSEX' : isBank ? 'NIFTY BANK' : isVix ? 'INDIA VIX' : key;
      const value = quote.last_price || quote.ltp || quote.close || 0;
      const prevClose = quote.ohlc?.close || quote.previous_close || value;
      const change = quote.net_change ?? (value - prevClose);
      const changePercent = prevClose ? Number(((change / prevClose) * 100).toFixed(2)) : 0;

      list.push({
        symbol,
        name,
        value,
        change: Number(change.toFixed(2)),
        changePercent,
        open: quote.ohlc?.open || 0,
        high: quote.ohlc?.high || 0,
        low: quote.ohlc?.low || 0,
        previousClose: prevClose,
        source: SOURCE_LIVE,
      });
    }

    // Ensure order: NIFTY 50, SENSEX, BANK NIFTY, INDIA VIX
    const order = ['NIFTY_50', 'SENSEX', 'BANK_NIFTY', 'INDIA_VIX'];
    list.sort((a, b) => order.indexOf(a.symbol) - order.indexOf(b.symbol));

    return list.length > 0 ? list : this._getFallbackIndices();
  }

  _getFallbackIndices() {
    return markFallback([
      {
        symbol: 'NIFTY_50',
        name: 'NIFTY 50',
        value: 25418.55,
        change: 138.25,
        changePercent: 0.55,
        open: 25320.10,
        high: 25445.80,
        low: 25290.40,
        previousClose: 25280.30,
      },
      {
        symbol: 'SENSEX',
        name: 'BSE SENSEX',
        value: 83184.80,
        change: 412.10,
        changePercent: 0.50,
        open: 82950.00,
        high: 83260.40,
        low: 82880.20,
        previousClose: 82772.70,
      },
      {
        symbol: 'BANK_NIFTY',
        name: 'NIFTY BANK',
        value: 52140.90,
        change: 320.65,
        changePercent: 0.62,
        open: 51920.00,
        high: 52210.00,
        low: 51850.50,
        previousClose: 51820.25,
      },
      {
        symbol: 'INDIA_VIX',
        name: 'INDIA VIX',
        value: 12.85,
        change: -0.42,
        changePercent: -3.16,
        open: 13.20,
        high: 13.45,
        low: 12.60,
        previousClose: 13.27,
      },
    ]);
  }

  // Movers are ranked over the covered universe from the shared snapshot. With no snapshot
  // (no feed and no saved candles) the lists are empty rather than built-in.
  async getGainers(limit = 20) {
    const snap = await this.getSnapshot();
    return snap ? movers(snap.stocks, 'gainers', limit) : [];
  }

  async getLosers(limit = 20) {
    const snap = await this.getSnapshot();
    return snap ? movers(snap.stocks, 'losers', limit) : [];
  }

  // Most active by traded value (volume × average traded price).
  async getActive(limit = 20) {
    const snap = await this.getSnapshot();
    return snap ? movers(snap.stocks, 'active', limit) : [];
  }

  // Every covered stock, for the screener and heatmap.
  async getStocks() {
    const snap = await this.getSnapshot();
    return snap
      ? { source: snap.source, asOf: snap.asOf, session: snap.session, stocks: snap.stocks }
      : { source: SOURCE_UNAVAILABLE, asOf: null, session: null, stocks: [] };
  }

  async getQuote(symbol) {
    const upper = symbol.toUpperCase();
    const instKey = SYMBOL_TO_INSTRUMENT_KEY[upper];

    if (this.isLive && instKey) {
      try {
        const res = await axios.get(`${this.baseUrl}/market-quote/quotes`, {
          params: { instrument_key: instKey },
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: 'application/json',
          },
          timeout: 7000,
        });

        if (res.data?.data) {
          const quotes = Object.values(res.data.data);
          if (quotes.length > 0) {
            const q = quotes[0];
            const ltp = q.last_price || q.close || 0;
            const netChange = Number(q.net_change);
            const prevClose = Number.isFinite(netChange) ? ltp - netChange : (positive(q.ohlc?.close) ?? ltp);
            const change = ltp - prevClose;
            const changePercent = prevClose ? Number(((change / prevClose) * 100).toFixed(2)) : 0;
            const marketState = getMarketStatus();
            // The quote has no 52-week range, average volume or classification. The range and
            // sector come from the saved daily candles and the research universe; a field with
            // no source is null, never a circuit limit or a placeholder.
            const cleanSym = upper.replace(/^(NSE|BSE):/, '');
            const saved = await readCandleSummary(this.dataDir, cleanSym);
            const high = positive(q.ohlc?.high);
            const low = positive(q.ohlc?.low);
            const sectorCode = this._universe().stocks.find((i) => i.symbol === cleanSym)?.sector || saved?.sector || null;

            return {
              symbol: upper,
              name: q.symbol || cleanSym,
              exchange: upper.startsWith('BSE') ? 'BSE' : 'NSE',
              instrumentKey: instKey,
              ltp,
              change: Number(change.toFixed(2)),
              changePercent,
              open: positive(q.ohlc?.open),
              high,
              low,
              close: Number(prevClose.toFixed(2)),
              previousClose: Number(prevClose.toFixed(2)),
              volume: typeof q.volume === 'number' ? q.volume : null,
              averageVolume: null,
              // The saved range ends at the last collected session; extend it with today's range.
              fiftyTwoWeekHigh: saved ? Math.max(saved.fiftyTwoWeekHigh, high ?? ltp) : null,
              fiftyTwoWeekLow: saved ? Math.min(saved.fiftyTwoWeekLow, low ?? ltp) : null,
              sector: sectorCode ? SECTOR_LABELS[sectorCode] || sectorCode : null,
              industry: null,
              marketStatus: marketState.status,
              lastUpdated: new Date().toISOString(),
              source: SOURCE_LIVE,
            };
          }
        }
      } catch (err) {
        logger.warn({ err: err.message }, `Live Upstox quote failed for ${symbol}, falling back to mock`);
      }
    }

    const cleanSym = upper.replace('NSE:', '').replace('BSE:', '');
    const quoteMap = {
      RELIANCE: {
        symbol: 'NSE:RELIANCE',
        name: 'Reliance Industries Limited',
        exchange: 'NSE',
        instrumentKey: 'NSE_EQ|INE002A01018',
        ltp: 2980.50,
        change: 65.10,
        changePercent: 2.23,
        open: 2930.00,
        high: 2995.00,
        low: 2922.00,
        close: 2915.40,
        previousClose: 2915.40,
        volume: 14200000,
        averageVolume: 9800000,
        fiftyTwoWeekHigh: 3217.90,
        fiftyTwoWeekLow: 2220.30,
        sector: 'Energy',
        industry: 'Oil & Gas Refining',
      },
      TCS: {
        symbol: 'NSE:TCS',
        name: 'Tata Consultancy Services',
        exchange: 'NSE',
        instrumentKey: 'NSE_EQ|INE467B01029',
        ltp: 4290.00,
        change: 62.00,
        changePercent: 1.47,
        open: 4240.00,
        high: 4310.00,
        low: 4235.00,
        close: 4228.00,
        previousClose: 4228.00,
        volume: 6800000,
        averageVolume: 5100000,
        fiftyTwoWeekHigh: 4585.00,
        fiftyTwoWeekLow: 3313.00,
        sector: 'Information Technology',
        industry: 'Software Consulting',
      },
      HDFCBANK: {
        symbol: 'NSE:HDFCBANK',
        name: 'HDFC Bank Limited',
        exchange: 'NSE',
        instrumentKey: 'NSE_EQ|INE040A01034',
        ltp: 1675.00,
        change: 28.50,
        changePercent: 1.73,
        open: 1650.00,
        high: 1682.00,
        low: 1648.00,
        close: 1646.50,
        previousClose: 1646.50,
        volume: 29400000,
        averageVolume: 22100000,
        fiftyTwoWeekHigh: 1794.00,
        fiftyTwoWeekLow: 1363.55,
        sector: 'Banking',
        industry: 'Private Bank',
      },
      INFY: {
        symbol: 'NSE:INFY',
        name: 'Infosys Limited',
        exchange: 'NSE',
        instrumentKey: 'NSE_EQ|INE009A01021',
        ltp: 1942.20,
        change: 52.80,
        changePercent: 2.80,
        open: 1900.00,
        high: 1955.00,
        low: 1895.00,
        close: 1889.40,
        previousClose: 1889.40,
        volume: 18200000,
        averageVolume: 12400000,
        fiftyTwoWeekHigh: 1990.00,
        fiftyTwoWeekLow: 1358.35,
        sector: 'Information Technology',
        industry: 'Software Services',
      },
    };

    const quote = quoteMap[cleanSym] || {
      symbol: `NSE:${cleanSym}`,
      name: `${cleanSym} Limited`,
      exchange: 'NSE',
      instrumentKey: `NSE_EQ|${cleanSym}`,
      ltp: 1250.00,
      change: 15.50,
      changePercent: 1.25,
      open: 1238.00,
      high: 1262.00,
      low: 1235.00,
      close: 1234.50,
      previousClose: 1234.50,
      volume: 8500000,
      averageVolume: 6200000,
      fiftyTwoWeekHigh: 1450.00,
      fiftyTwoWeekLow: 980.00,
      sector: 'Diversified',
      industry: 'Conglomerate',
    };

    const marketState = getMarketStatus();
    return {
      ...quote,
      marketStatus: marketState.status,
      lastUpdated: new Date().toISOString(),
      source: SOURCE_FALLBACK,
    };
  }

  async getHistoricalCandles(symbol, interval = 'day', fromDate, toDate) {
    const instKey = SYMBOL_TO_INSTRUMENT_KEY[symbol.toUpperCase()] || SYMBOL_TO_INSTRUMENT_KEY[`NSE:${symbol.toUpperCase()}`];

    // Determine interval configuration
    let upstoxInterval = 'day';
    let daysBack = 90;

    const normInterval = (interval || '').toUpperCase();
    if (normInterval === '1D' || interval === '1minute') {
      upstoxInterval = '1minute';
      daysBack = 2;
    } else if (normInterval === '1W' || interval === '30minute') {
      upstoxInterval = '30minute';
      daysBack = 7;
    } else if (normInterval === '1M') {
      upstoxInterval = 'day';
      daysBack = 30;
    } else if (normInterval === '3M') {
      upstoxInterval = 'day';
      daysBack = 90;
    } else if (normInterval === '1Y') {
      upstoxInterval = 'day';
      daysBack = 365;
    } else if (normInterval === '5Y' || interval === 'week') {
      upstoxInterval = 'week';
      daysBack = 1825;
    }

    const today = new Date().toISOString().split('T')[0];
    const past = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const to = toDate || today;
    const from = fromDate || past;

    // Live Upstox candle fetch
    if (this.isLive && instKey) {
      try {
        const res = await axios.get(
          `${this.baseUrl}/historical-candle/${encodeURIComponent(instKey)}/${upstoxInterval}/${to}/${from}`,
          {
            headers: {
              Authorization: `Bearer ${this.token}`,
              Accept: 'application/json',
            },
            timeout: 8000,
          }
        );

        if (res.data?.data?.candles && Array.isArray(res.data.data.candles) && res.data.data.candles.length > 0) {
          // Upstox candle array: [timestamp, open, high, low, close, volume, oi]
          // Upstox returns candles from newest to oldest; reverse to chronological for Lightweight Charts
          const sorted = [...res.data.data.candles].reverse();
          return sorted.map((c) => ({ ...toCandle(c), source: SOURCE_LIVE }));
        }
      } catch (err) {
        logger.warn({ err: err.message }, `Live Upstox candle fetch failed for ${symbol} (${upstoxInterval})`);
      }
    }

    // No feed: daily and weekly views read the saved daily candles; intraday views have no
    // saved substitute, so they return [] and the UI shows its day-range rail instead.
    if (upstoxInterval !== 'day' && upstoxInterval !== 'week') return [];
    return this._savedCandles(symbol, { from, to, weekly: upstoxInterval === 'week' });
  }

  // Saved daily candles (data/pulse/candles/<SYMBOL>.json) within [from, to], marked
  // 'end-of-day', optionally rolled up to weeks. A symbol with no saved file returns [].
  async _savedCandles(symbol, { from, to, weekly }) {
    const bare = symbol.toUpperCase().replace(/^(NSE|BSE):/, '');
    const file = SAVED_CANDLE_FILES[bare] || bare;
    if (!/^[A-Z0-9&_-]+$/.test(file)) return [];
    let rows;
    try {
      rows = JSON.parse(await readFile(path.join(this.dataDir, 'candles', `${file}.json`), 'utf8')).candles;
    } catch {
      return [];
    }
    const daily = (Array.isArray(rows) ? rows : [])
      .filter((c) => Array.isArray(c) && Number(c[4]) > 0)
      .filter((c) => { const d = String(c[0]).slice(0, 10); return d >= from && d <= to; })
      .map(toCandle);
    return (weekly ? toWeeks(daily) : daily).map((c) => ({ ...c, source: SOURCE_EOD }));
  }

  async searchInstruments(query) {
    const q = (query || '').toLowerCase().trim();
    const universe = [
      { symbol: 'NSE:RELIANCE', name: 'Reliance Industries Ltd', exchange: 'NSE', sector: 'Energy' },
      { symbol: 'NSE:TCS', name: 'Tata Consultancy Services', exchange: 'NSE', sector: 'Information Technology' },
      { symbol: 'NSE:HDFCBANK', name: 'HDFC Bank Limited', exchange: 'NSE', sector: 'Banking' },
      { symbol: 'NSE:INFY', name: 'Infosys Limited', exchange: 'NSE', sector: 'Information Technology' },
      { symbol: 'NSE:ICICIBANK', name: 'ICICI Bank Ltd', exchange: 'NSE', sector: 'Banking' },
      { symbol: 'NSE:BHARTIARTL', name: 'Bharti Airtel Ltd', exchange: 'NSE', sector: 'Telecommunications' },
      { symbol: 'NSE:TATAMOTORS', name: 'Tata Motors Ltd', exchange: 'NSE', sector: 'Automobile' },
      { symbol: 'NSE:ITC', name: 'ITC Limited', exchange: 'NSE', sector: 'FMCG' },
      { symbol: 'NSE:LT', name: 'Larsen & Toubro Ltd', exchange: 'NSE', sector: 'Infrastructure & Capital Goods' },
      { symbol: 'NSE:TATASTEEL', name: 'Tata Steel Ltd', exchange: 'NSE', sector: 'Metals & Mining' },
      { symbol: 'NSE:SUNPHARMA', name: 'Sun Pharmaceutical Ltd', exchange: 'NSE', sector: 'Pharmaceuticals' },
      { symbol: 'NSE:SBIN', name: 'State Bank of India', exchange: 'NSE', sector: 'Public Sector Banking' },
      { symbol: 'NSE:AXISBANK', name: 'Axis Bank Limited', exchange: 'NSE', sector: 'Banking' },
      { symbol: 'NSE:KOTAKBANK', name: 'Kotak Mahindra Bank', exchange: 'NSE', sector: 'Banking' },
      { symbol: 'NSE:WIPRO', name: 'Wipro Limited', exchange: 'NSE', sector: 'Information Technology' },
      { symbol: 'NSE:HCLTECH', name: 'HCL Technologies Ltd', exchange: 'NSE', sector: 'Information Technology' },
      { symbol: 'NSE:BAJFINANCE', name: 'Bajaj Finance Limited', exchange: 'NSE', sector: 'Financial Services' },
      { symbol: 'NSE:BAJAJFINSV', name: 'Bajaj Finserv Ltd', exchange: 'NSE', sector: 'Financial Services' },
      { symbol: 'NSE:MARUTI', name: 'Maruti Suzuki India Ltd', exchange: 'NSE', sector: 'Automobile' },
      { symbol: 'NSE:ASIANPAINT', name: 'Asian Paints Ltd', exchange: 'NSE', sector: 'Paints & Consumer' },
      { symbol: 'NSE:TITAN', name: 'Titan Company Limited', exchange: 'NSE', sector: 'Consumer Goods & Luxury' },
      { symbol: 'NSE:ULTRACEMCO', name: 'UltraTech Cement Ltd', exchange: 'NSE', sector: 'Cement & Building Materials' },
      { symbol: 'NSE:NTPC', name: 'NTPC Limited', exchange: 'NSE', sector: 'Power Generation' },
      { symbol: 'NSE:POWERGRID', name: 'Power Grid Corporation', exchange: 'NSE', sector: 'Utilities & Transmission' },
      { symbol: 'NSE:ONGC', name: 'Oil & Natural Gas Corp', exchange: 'NSE', sector: 'Energy & Exploration' },
      { symbol: 'NSE:COALINDIA', name: 'Coal India Limited', exchange: 'NSE', sector: 'Energy & Mining' },
      { symbol: 'NSE:JSWSTEEL', name: 'JSW Steel Ltd', exchange: 'NSE', sector: 'Metals & Mining' },
      { symbol: 'NSE:HINDALCO', name: 'Hindalco Industries Ltd', exchange: 'NSE', sector: 'Metals & Aluminium' },
      { symbol: 'NSE:ADANIENT', name: 'Adani Enterprises Ltd', exchange: 'NSE', sector: 'Diversified Conglomerate' },
      { symbol: 'NSE:ADANIPORTS', name: 'Adani Ports & SEZ Ltd', exchange: 'NSE', sector: 'Ports & Logistics' },
      { symbol: 'NSE:NESTLEIND', name: 'Nestle India Limited', exchange: 'NSE', sector: 'FMCG & Food' },
      { symbol: 'NSE:DRREDDY', name: "Dr. Reddy's Laboratories", exchange: 'NSE', sector: 'Pharmaceuticals' },
      { symbol: 'NSE:CIPLA', name: 'Cipla Limited', exchange: 'NSE', sector: 'Pharmaceuticals' },
      { symbol: 'NSE:TECHM', name: 'Tech Mahindra Limited', exchange: 'NSE', sector: 'Information Technology' },
    ];

    if (!q) {
      return universe.slice(0, 8);
    }

    return universe.filter(
      (item) =>
        item.symbol.toLowerCase().includes(q) ||
        item.name.toLowerCase().includes(q) ||
        item.sector.toLowerCase().includes(q)
    );
  }
}

export const upstoxProvider = new UpstoxProvider();
export default upstoxProvider;

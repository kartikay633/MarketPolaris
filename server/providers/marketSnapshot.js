// Market snapshot for the covered research universe (data/pulse/collection.json): every stock
// and NSE sector index the nightly collection tracks, priced either from one batched Upstox
// quote call ('live') or from the latest saved daily candles ('end-of-day'). Movers, breadth,
// sector performance and the screener are all computed from this one snapshot, so nothing
// shown on those widgets is a built-in sample value.
import { readFile, stat, writeFile, rename } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const SOURCE_EOD = 'end-of-day';
export const SOURCE_UNAVAILABLE = 'unavailable';

export const SECTOR_LABELS = {
  BANK: 'Banking', FINANCE: 'Financial services', IT: 'IT', ENERGY: 'Energy & power', AUTO: 'Automobiles',
  FMCG: 'FMCG', HEALTH: 'Healthcare', METAL: 'Metals & mining', INDUSTRIAL: 'Industrials', REALTY: 'Realty',
  CONSUMER: 'Consumer', CHEMICAL: 'Chemicals', MEDIA: 'Media',
};

const SECTOR_INDEX_NAMES = {
  NIFTY_BANK: 'Nifty Bank', NIFTY_FIN_SERVICE: 'Nifty Financial Services', NIFTY_IT: 'Nifty IT', NIFTY_ENERGY: 'Nifty Energy',
  NIFTY_FMCG: 'Nifty FMCG', NIFTY_HEALTHCARE: 'Nifty Healthcare', NIFTY_METAL: 'Nifty Metal',
  NIFTY_INFRA: 'Nifty Infrastructure', NIFTY_REALTY: 'Nifty Realty', NIFTY_MEDIA: 'Nifty Media',
};

// Headline indices in display order. The dashboard and ticker know NIFTY BANK as BANK_NIFTY.
// SENSEX is a BSE index the research collection does not store, so it is shown only live.
const HEADLINE = [
  { symbol: 'NIFTY_50', name: 'NIFTY 50', instrumentKey: 'NSE_INDEX|Nifty 50' },
  { symbol: 'SENSEX', name: 'BSE SENSEX', instrumentKey: 'BSE_INDEX|SENSEX' },
  { symbol: 'BANK_NIFTY', name: 'NIFTY BANK', collected: 'NIFTY_BANK', instrumentKey: 'NSE_INDEX|Nifty Bank' },
  { symbol: 'INDIA_VIX', name: 'INDIA VIX', instrumentKey: 'NSE_INDEX|India VIX' },
];

const DAY_MS = 86400000;
const IST_MS = 19800000;
const round = (n, d = 2) => (Number.isFinite(n) ? Number(n.toFixed(d)) : null);
const istDay = (ms) => new Date(ms + IST_MS).toISOString().slice(0, 10);

export function loadUniverse(dataDir) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path.join(dataDir, 'collection.json'), 'utf8'));
  } catch {
    return { stocks: [], sectorIndices: [], headline: HEADLINE };
  }
  const rows = (manifest.instruments || []).filter((i) => i.status === undefined || i.status === 'ready');
  return {
    stocks: rows.filter((i) => !i.benchmark && /^NSE_EQ\|/.test(i.instrumentKey || ''))
      .map(({ symbol, instrumentKey, sector }) => ({ symbol, instrumentKey, sector: sector || null })),
    sectorIndices: rows.filter((i) => i.benchmark && i.sector)
      .map(({ symbol, instrumentKey, sector }) => ({ symbol, instrumentKey, sector, name: SECTOR_INDEX_NAMES[symbol] || instrumentKey.split('|')[1] })),
    headline: HEADLINE,
  };
}

// ── Saved daily candles ─────────────────────────────────────────────────────

// Latest session of one saved candle file plus its trailing 52-week range.
// Candle rows are [timestamp, open, high, low, close, volume, oi], oldest first.
export function summarizeCandles(candles) {
  const rows = (candles || []).filter((c) => Array.isArray(c) && Number.isFinite(Number(c[4])) && Number(c[4]) > 0);
  if (rows.length < 2) return null;
  const last = rows[rows.length - 1];
  const prev = rows[rows.length - 2];
  const date = String(last[0]).slice(0, 10);
  const yearAgo = new Date(Date.parse(`${date}T00:00:00Z`) - 365 * DAY_MS).toISOString().slice(0, 10);
  const year = rows.filter((c) => String(c[0]).slice(0, 10) > yearAgo);
  return {
    date,
    open: Number(last[1]),
    high: Number(last[2]),
    low: Number(last[3]),
    close: Number(last[4]),
    volume: Number(last[5]) || 0,
    previousClose: Number(prev[4]),
    fiftyTwoWeekHigh: Math.max(...year.map((c) => Number(c[2]))),
    fiftyTwoWeekLow: Math.min(...year.map((c) => Number(c[3]))),
  };
}

const summaryCache = new Map(); // file → { mtimeMs, summary }

export async function readCandleSummary(dataDir, symbol) {
  const file = path.join(dataDir, 'candles', `${symbol}.json`);
  try {
    const { mtimeMs } = await stat(file);
    const hit = summaryCache.get(file);
    if (hit && hit.mtimeMs === mtimeMs) return hit.summary;
    const summary = summarizeCandles(JSON.parse(await readFile(file, 'utf8')).candles);
    summaryCache.set(file, { mtimeMs, summary });
    return summary;
  } catch {
    return null;
  }
}

export async function readCandleSummaries(dataDir, symbols) {
  const out = {};
  await Promise.all(symbols.map(async (s) => { out[s] = await readCandleSummary(dataDir, s); }));
  return out;
}

// ── Row builders ────────────────────────────────────────────────────────────

function stockRow(inst, px, extra) {
  const change = px.ltp - px.previousClose;
  return {
    symbol: `NSE:${inst.symbol}`,
    name: extra.names?.[inst.symbol] || inst.symbol,
    ltp: round(px.ltp),
    change: round(change),
    changePercent: px.previousClose ? round((change / px.previousClose) * 100) : 0,
    open: round(px.open),
    high: round(px.high),
    low: round(px.low),
    previousClose: round(px.previousClose),
    volume: px.volume,
    tradedValue: Math.round(px.tradedValue),
    tradedValueEstimated: Boolean(px.tradedValueEstimated),
    fiftyTwoWeekHigh: round(px.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: round(px.fiftyTwoWeekLow),
    sector: SECTOR_LABELS[inst.sector] || inst.sector || 'Other',
    sectorCode: inst.sector,
    source: extra.source,
    asOf: extra.asOf,
  };
}

function indexRow(symbol, name, px, extra) {
  const change = px.ltp - px.previousClose;
  return {
    symbol,
    name,
    value: round(px.ltp),
    change: round(change),
    changePercent: px.previousClose ? round((change / px.previousClose) * 100) : 0,
    open: round(px.open),
    high: round(px.high),
    low: round(px.low),
    previousClose: round(px.previousClose),
    source: extra.source,
    asOf: extra.asOf,
  };
}

// End-of-day snapshot from saved candles. Only instruments whose latest candle is the most
// recent saved session are used, so a stale file never mixes an older day into the totals.
export function snapshotFromCandles(universe, summaries, names = {}) {
  const dates = universe.stocks.map((i) => summaries[i.symbol]?.date).filter(Boolean).sort();
  const session = dates[dates.length - 1];
  if (!session) return null;
  const extra = { source: SOURCE_EOD, asOf: session, names };
  const current = (s) => s && s.date === session;
  const px = (s) => ({
    ltp: s.close, previousClose: s.previousClose, open: s.open, high: s.high, low: s.low, volume: s.volume,
    // Daily candles carry no VWAP; traded value is estimated at the session's typical price.
    tradedValue: s.volume * ((s.high + s.low + s.close) / 3), tradedValueEstimated: true,
    fiftyTwoWeekHigh: s.fiftyTwoWeekHigh, fiftyTwoWeekLow: s.fiftyTwoWeekLow,
  });
  const stocks = universe.stocks.filter((i) => current(summaries[i.symbol])).map((i) => stockRow(i, px(summaries[i.symbol]), extra));
  const sectorIndices = universe.sectorIndices.filter((i) => current(summaries[i.symbol]))
    .map((i) => ({ ...indexRow(i.symbol, i.name, px(summaries[i.symbol]), extra), sector: i.sector }));
  const indices = universe.headline.filter((h) => current(summaries[h.collected || h.symbol]))
    .map((h) => indexRow(h.symbol, h.name, px(summaries[h.collected || h.symbol]), extra));
  return { source: SOURCE_EOD, asOf: session, session, stocks, sectorIndices, indices };
}

// The instrument keys one batched Upstox market-quote call asks for.
export function quoteKeys(universe) {
  return [...new Set([
    ...universe.headline.map((h) => h.instrumentKey),
    ...universe.sectorIndices.map((i) => i.instrumentKey),
    ...universe.stocks.map((i) => i.instrumentKey),
  ])];
}

function quotePx(q, summary) {
  const ltp = Number(q?.last_price);
  const netChange = Number(q?.net_change);
  if (!(ltp > 0) || !Number.isFinite(netChange)) return null;
  const high = Number(q.ohlc?.high) || ltp;
  const low = Number(q.ohlc?.low) || ltp;
  const volume = Number(q.volume) || 0;
  const avg = Number(q.average_price);
  return {
    ltp, previousClose: ltp - netChange, open: Number(q.ohlc?.open) || ltp, high, low, volume,
    tradedValue: volume * (avg > 0 ? avg : ltp), tradedValueEstimated: !(avg > 0),
    // The saved 52-week range ends at the last collected session; extend it with today's range.
    fiftyTwoWeekHigh: summary ? Math.max(summary.fiftyTwoWeekHigh, high) : null,
    fiftyTwoWeekLow: summary ? Math.min(summary.fiftyTwoWeekLow, low) : null,
  };
}

// Live snapshot from an Upstox market-quote response (keyed 'NSE_EQ:SYMBOL', each entry carrying
// its instrument_token). Returns null when the response covers too little of the universe to be
// representative; the caller then falls back to end-of-day candles rather than mixing the two.
export function snapshotFromQuotes(universe, data, summaries = {}, names = {}, minCoverage = 0.8) {
  const byKey = {};
  for (const q of Object.values(data || {})) if (q?.instrument_token) byKey[q.instrument_token] = q;
  const stamps = Object.values(byKey).map((q) => Number(q.last_trade_time)).filter((t) => t > 0);
  const asOfMs = stamps.length ? Math.max(...stamps) : Date.now();
  const extra = { source: 'live', asOf: new Date(asOfMs).toISOString(), names };

  const stocks = universe.stocks.flatMap((i) => {
    const px = quotePx(byKey[i.instrumentKey], summaries[i.symbol]);
    return px ? [stockRow(i, px, extra)] : [];
  });
  if (!universe.stocks.length || stocks.length < universe.stocks.length * minCoverage) return null;
  const sectorIndices = universe.sectorIndices.flatMap((i) => {
    const px = quotePx(byKey[i.instrumentKey]);
    return px ? [{ ...indexRow(i.symbol, i.name, px, extra), sector: i.sector }] : [];
  });
  const indices = universe.headline.flatMap((h) => {
    const px = quotePx(byKey[h.instrumentKey]);
    return px ? [indexRow(h.symbol, h.name, px, extra)] : [];
  });
  return { source: 'live', asOf: extra.asOf, session: istDay(asOfMs), stocks, sectorIndices, indices };
}

// ── Derived views ───────────────────────────────────────────────────────────

export function movers(stocks, kind, limit = 20) {
  const n = Math.max(0, Math.min(Number(limit) || 20, 200));
  if (kind === 'gainers') return stocks.filter((s) => s.changePercent > 0).sort((a, b) => b.changePercent - a.changePercent).slice(0, n);
  if (kind === 'losers') return stocks.filter((s) => s.changePercent < 0).sort((a, b) => a.changePercent - b.changePercent).slice(0, n);
  if (kind === 'active') return [...stocks].sort((a, b) => b.tradedValue - a.tradedValue).slice(0, n);
  return [];
}

export function breadthOf(stocks) {
  const advancing = stocks.filter((s) => s.change > 0).length;
  const declining = stocks.filter((s) => s.change < 0).length;
  return { advancing, declining, unchanged: stocks.length - advancing - declining, total: stocks.length, universe: 'tracked NSE stocks' };
}

export function sectorsOf(sectorIndices) {
  return sectorIndices.map((i) => ({ name: i.name, symbol: i.symbol, changePercent: i.changePercent, positive: i.changePercent >= 0, value: i.value }));
}

// NIFTY option-chain read-outs from an Upstox /option/chain response for one expiry:
// open-interest put/call ratio, max-pain strike, the largest call and put OI strikes, and the
// at-the-money implied volatility (mean of the ATM call and put IV that Upstox reports).
export function analyzeOptionChain(chain) {
  const rows = (chain || []).filter((r) => Number.isFinite(Number(r?.strike_price)));
  if (rows.length < 3) return null;
  const strikes = rows.map((r) => ({
    strike: Number(r.strike_price),
    callOi: Number(r.call_options?.market_data?.oi) || 0,
    putOi: Number(r.put_options?.market_data?.oi) || 0,
    callIv: Number(r.call_options?.option_greeks?.iv) || 0,
    putIv: Number(r.put_options?.option_greeks?.iv) || 0,
  })).sort((a, b) => a.strike - b.strike);
  const callOi = strikes.reduce((s, r) => s + r.callOi, 0);
  const putOi = strikes.reduce((s, r) => s + r.putOi, 0);
  const spot = Number(rows.find((r) => Number(r.underlying_spot_price) > 0)?.underlying_spot_price);
  if (!(callOi > 0) || !(putOi > 0) || !(spot > 0)) return null;

  let maxPain = null;
  let least = Infinity;
  for (const { strike: k } of strikes) {
    const pain = strikes.reduce((s, r) => s + r.callOi * Math.max(0, k - r.strike) + r.putOi * Math.max(0, r.strike - k), 0);
    if (pain < least) { least = pain; maxPain = k; }
  }
  const top = (key) => strikes.reduce((best, r) => (r[key] > best[key] ? r : best), strikes[0]);
  const callWall = top('callOi');
  const putWall = top('putOi');
  const atm = strikes.reduce((best, r) => (Math.abs(r.strike - spot) < Math.abs(best.strike - spot) ? r : best), strikes[0]);
  const ivs = [atm.callIv, atm.putIv].filter((v) => v > 0);

  return {
    underlying: 'NIFTY 50',
    expiry: rows[0].expiry || null,
    spot: round(spot),
    pcr: round(putOi / callOi),
    maxPain,
    callWall: callWall.strike,
    callWallOi: callWall.callOi,
    putWall: putWall.strike,
    putWallOi: putWall.putOi,
    atmStrike: atm.strike,
    atmIv: ivs.length ? round(ivs.reduce((a, b) => a + b, 0) / ivs.length, 1) : null,
  };
}

// ── Company names ───────────────────────────────────────────────────────────

// Company names for the covered symbols, saved from Upstox's public NSE instrument list.
export function readNames(dataDir) {
  try {
    return JSON.parse(readFileSync(path.join(dataDir, 'instrument-names.json'), 'utf8')).names || {};
  } catch {
    return null;
  }
}

export async function saveNames(dataDir, instruments, universe) {
  const keys = new Map(universe.stocks.map((i) => [i.instrumentKey, i.symbol]));
  const names = {};
  for (const x of instruments || []) {
    const symbol = keys.get(x?.instrument_key);
    if (symbol && x.name) names[symbol] = String(x.name).trim();
  }
  if (!Object.keys(names).length) return null;
  const file = path.join(dataDir, 'instrument-names.json');
  await writeFile(`${file}.tmp`, JSON.stringify({ source: 'upstox NSE instrument list', fetchedAt: new Date().toISOString(), names }, null, 1));
  await rename(`${file}.tmp`, file);
  return names;
}

// ROADMAP: Section 6 & 10 — AI Service (Google Gemini 1.5 Flash + Data-Grounded Synthesis)
import axios from 'axios';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import NodeCache from 'node-cache';
import { marketDataService } from './marketDataService.js';
import { newsService } from './newsService.js';
import { readNames } from '../providers/marketSnapshot.js';
import { isMarketOpen, getMarketStatus } from '../utils/marketHours.js';
import logger from '../utils/logger.js';

// AI response cache: 10 min for market summaries, 15 min for stock insights
const aiCache = new NodeCache({
  stdTTL: 600,
  checkperiod: 60,
});

// In-memory conversation storage
const conversations = new Map();

// ── Market brief ────────────────────────────────────────────────────────────
// The dashboard brief is built only from what /api/market/overview, gainers and losers
// return. An overview block whose source is 'unavailable' is left out, and so is every
// sentence, driver or level that would need it; nothing is filled in from built-in values.

const fmt = (n, digits = 2) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const signedPct = (n) => `${n >= 0 ? '+' : '-'}${fmt(Math.abs(n))}%`;
const crore = (n) => `₹${fmt(Math.abs(n))} Cr`;
const bare = (symbol) => String(symbol || '').replace(/^(NSE|BSE):/, '');
const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : null);

// '2026-10-16' → '16 Oct'; an ISO timestamp → '16 Oct, 16:00 IST'.
export function whenLabel(asOf) {
  if (!asOf) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(asOf);
  const t = Date.parse(dateOnly ? `${asOf}T00:00:00+05:30` : asOf);
  if (!Number.isFinite(t)) return null;
  const day = new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  if (dateOnly) return day;
  const time = new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
  return `${day}, ${time} IST`;
}

// Structured market context from the overview and movers. Each overview block is kept only
// when the overview marks it as served (sources[block] !== 'unavailable') and it is non-null.
export function marketContextFrom({ overview, gainers = [], losers = [], status = {}, isOpen = false }) {
  const sources = overview?.sources || {};
  const asOf = overview?.asOf || {};
  const has = (block) => Boolean(overview?.[block]) && Boolean(sources[block]) && sources[block] !== 'unavailable';
  const mover = (s) => ({ symbol: bare(s.symbol), name: s.name, ltp: num(s.ltp), changePercent: num(s.changePercent) });

  return {
    timestamp: new Date().toISOString(),
    marketStatus: status.status || overview?.status || null,
    marketReason: status.reason || overview?.statusMessage || null,
    isAfterMarket: !isOpen,
    session: overview?.session || null,
    sources: Object.fromEntries(Object.entries(sources).filter(([block]) => has(block))),
    asOf: Object.fromEntries(Object.entries(asOf).filter(([block]) => has(block))),
    indices: has('indices')
      ? overview.indices.filter((i) => num(i.value) !== null).map((i) => ({
        symbol: i.symbol, name: i.name, value: num(i.value), change: num(i.change), changePercent: num(i.changePercent),
        high: num(i.high), low: num(i.low), previousClose: num(i.previousClose),
      }))
      : [],
    breadth: has('breadth') ? overview.breadth : null,
    sectors: has('sectors')
      ? overview.sectors.filter((s) => num(s.changePercent) !== null)
        .map((s) => ({ name: s.name, changePercent: num(s.changePercent) }))
        .sort((a, b) => b.changePercent - a.changePercent)
      : [],
    turnover: has('turnover') ? overview.turnover : null,
    institutionalFlows: has('institutionalFlows') ? overview.institutionalFlows : null,
    derivatives: has('derivatives') ? overview.derivatives : null,
    topGainers: (Array.isArray(gainers) ? gainers : []).filter((s) => num(s.changePercent) !== null).map(mover),
    topLosers: (Array.isArray(losers) ? losers : []).filter((s) => num(s.changePercent) !== null).map(mover),
  };
}

function stanceOf(nifty, breadth) {
  if (!nifty) return null;
  const tilt = breadth?.total ? (breadth.advancing - breadth.declining) / breadth.total : 0;
  if (nifty.changePercent >= 0.5 && tilt >= 0) return 'Bullish Momentum';
  if (nifty.changePercent <= -0.5 && tilt <= 0) return 'Cautious';
  return 'Consolidation';
}

const flowPhrase = (who, net) => `${who} net ${net >= 0 ? 'buyers' : 'sellers'} of ${crore(net)}`;

// Deterministic brief: headline, summary, drivers, the dated data points behind them and
// the levels that can be computed from them. Missing data drops the item, never a guess.
export function buildMarketBrief(ctx = {}) {
  const indices = ctx.indices || [];
  const nifty = indices.find((i) => i.symbol === 'NIFTY_50');
  const vix = indices.find((i) => i.symbol === 'INDIA_VIX');
  const others = indices.filter((i) => i !== nifty && i !== vix);
  const { breadth, turnover, institutionalFlows: flows, derivatives: deriv } = ctx;
  const sectors = ctx.sectors || [];
  const asOf = ctx.asOf || {};
  const isAfterMarket = ctx.isAfterMarket ?? true;
  const sessionDay = whenLabel(ctx.session) || whenLabel(asOf.indices)?.split(',')[0] || null;

  let headline;
  if (nifty) {
    headline = isAfterMarket
      ? `NIFTY 50 closed${sessionDay ? ` the ${sessionDay} session` : ''} at ${fmt(nifty.value)}, ${signedPct(nifty.changePercent)}`
      : `NIFTY 50 at ${fmt(nifty.value)}, ${signedPct(nifty.changePercent)} so far today`;
    if (breadth?.total) headline += `; ${breadth.advancing} of ${breadth.total} tracked stocks advanced`;
  } else {
    headline = 'Market brief will update once exchange data is available';
  }

  const summary = [];
  if (others.length || vix) {
    const moves = others.map((i) => `${i.name} ${signedPct(i.changePercent)}`);
    const parts = [];
    if (moves.length) parts.push(`${nifty ? 'Among other headline indices, ' : ''}${moves.join(' and ')}`);
    if (vix) parts.push(`India VIX ${isAfterMarket ? 'ended at' : 'at'} ${fmt(vix.value)}`);
    summary.push(`${parts.join('; ')}.`);
  }
  if (breadth?.total) {
    summary.push(`Across ${breadth.total} tracked NSE stocks, ${breadth.advancing} advanced and ${breadth.declining} declined.`);
  }
  if (flows && num(flows.fiiNet) !== null && num(flows.diiNet) !== null) {
    const day = whenLabel(flows.asOf || asOf.institutionalFlows);
    summary.push(`NSE provisional data${day ? ` for ${day}` : ''} shows ${flowPhrase('FIIs', flows.fiiNet)} and ${flowPhrase('DIIs', flows.diiNet)}.`);
  }
  if (!summary.length) summary.push('Exchange data for this brief is not available right now.');

  const keyDrivers = [];
  const moverList = (rows) => rows.slice(0, 3).map((s) => `${s.symbol} ${signedPct(s.changePercent)}`).join(', ');
  if (ctx.topGainers?.length) keyDrivers.push(`Top gainers: ${moverList(ctx.topGainers)}`);
  if (ctx.topLosers?.length) keyDrivers.push(`Top losers: ${moverList(ctx.topLosers)}`);
  if (sectors.length >= 2) {
    const [best, worst] = [sectors[0], sectors[sectors.length - 1]];
    keyDrivers.push(`Strongest sector index ${best.name} ${signedPct(best.changePercent)}; weakest ${worst.name} ${signedPct(worst.changePercent)}`);
  }
  if (turnover && num(turnover.nseCashCr) !== null) {
    const day = whenLabel(turnover.asOf || asOf.turnover);
    keyDrivers.push(`NSE cash market turnover ${crore(turnover.nseCashCr)}${day ? ` (${day})` : ''}`);
  }
  if (deriv && num(deriv.pcr) !== null) {
    const expiry = whenLabel(deriv.expiry);
    const bits = [`PCR ${fmt(deriv.pcr)}`];
    if (num(deriv.maxPain) !== null) bits.push(`max pain ${fmt(deriv.maxPain, 0)}`);
    keyDrivers.push(`NIFTY options${expiry ? ` (${expiry} expiry)` : ''}: ${bits.join(', ')}`);
  }

  const sessionFeed = [];
  const feed = (block, tag, title, detail) => sessionFeed.push({ time: whenLabel(asOf[block]) || '', tag, title, detail, source: ctx.sources?.[block] || null });
  if (indices.length) {
    feed('indices', 'INDICES', isAfterMarket ? 'Headline index close' : 'Headline indices',
      indices.map((i) => `${i.name} ${fmt(i.value)} (${signedPct(i.changePercent)})`).join(' · '));
  }
  if (breadth?.total) {
    feed('breadth', 'BREADTH', 'Market breadth',
      `${breadth.advancing} advancing, ${breadth.declining} declining, ${breadth.unchanged} unchanged across ${breadth.total} tracked NSE stocks.`);
  }
  if (turnover && num(turnover.nseCashCr) !== null) {
    const extra = num(turnover.nseFoPremiumCr) !== null ? `; equity F&O premium turnover ${crore(turnover.nseFoPremiumCr)}` : '';
    feed('turnover', 'TURNOVER', 'NSE turnover', `Cash market ${crore(turnover.nseCashCr)}${extra}.`);
  }
  if (flows && num(flows.fiiNet) !== null && num(flows.diiNet) !== null) {
    const leg = (who, buy, sell, net) => (num(buy) !== null && num(sell) !== null
      ? `${who} bought ${crore(buy)} and sold ${crore(sell)} (net ${net >= 0 ? '+' : '-'}${crore(net)})`
      : `${who} net ${net >= 0 ? '+' : '-'}${crore(net)}`);
    feed('institutionalFlows', 'FII / DII', 'Institutional flows (NSE provisional)',
      `${leg('FIIs', flows.fiiBuy, flows.fiiSell, flows.fiiNet)}; ${leg('DIIs', flows.diiBuy, flows.diiSell, flows.diiNet)}.`);
  }
  if (deriv && num(deriv.pcr) !== null) {
    const bits = [`PCR ${fmt(deriv.pcr)}`];
    if (num(deriv.maxPain) !== null) bits.push(`max pain ${fmt(deriv.maxPain, 0)}`);
    if (num(deriv.callWall) !== null) bits.push(`highest call OI at ${fmt(deriv.callWall, 0)}`);
    if (num(deriv.putWall) !== null) bits.push(`highest put OI at ${fmt(deriv.putWall, 0)}`);
    if (num(deriv.atmIv) !== null) bits.push(`ATM IV ${fmt(deriv.atmIv, 1)}%`);
    const expiry = whenLabel(deriv.expiry);
    feed('derivatives', 'OPTIONS', `NIFTY option chain${expiry ? ` · ${expiry} expiry` : ''}`, `${bits.join(', ')}.`);
  }

  // Classic floor pivots need a completed session's high, low and close.
  let pivots = null;
  if (isAfterMarket && nifty && nifty.high > 0 && nifty.low > 0 && nifty.high >= nifty.low) {
    const { high: h, low: l, value: c } = nifty;
    const p = (h + l + c) / 3;
    pivots = {
      basis: sessionDay ? `${sessionDay} NIFTY 50 high, low and close` : 'NIFTY 50 session high, low and close',
      pivot: fmt(p),
      support: `${fmt(2 * p - h)} / ${fmt(p - (h - l))}`,
      resistance: `${fmt(2 * p - l)} / ${fmt(p + (h - l))}`,
    };
  }
  const levels = {
    pivots,
    options: deriv && num(deriv.pcr) !== null ? {
      expiry: whenLabel(deriv.expiry),
      pcr: fmt(deriv.pcr),
      maxPain: num(deriv.maxPain) !== null ? fmt(deriv.maxPain, 0) : null,
      callWall: num(deriv.callWall) !== null ? fmt(deriv.callWall, 0) : null,
      putWall: num(deriv.putWall) !== null ? fmt(deriv.putWall, 0) : null,
    } : null,
    vix: vix ? fmt(vix.value) : null,
  };

  return {
    isAfterMarket,
    headline,
    summary: summary.join(' '),
    keyDrivers,
    sectorOutlook: sectors.length >= 2
      ? `${sectors[0].name} led (${signedPct(sectors[0].changePercent)}) while ${sectors[sectors.length - 1].name} lagged (${signedPct(sectors[sectors.length - 1].changePercent)}).`
      : null,
    marketStance: stanceOf(nifty, breadth),
    sessionFeed,
    levels,
    sources: ctx.sources || {},
    asOf,
    timestamp: new Date().toISOString(),
  };
}

// True when every number in `text` also appears in the context (allowing rounding), so a
// model-written brief cannot introduce figures the data does not contain.
export function numbersGrounded(text, context) {
  const numbersIn = (s) => (String(s).match(/\d[\d,]*(?:\.\d+)?/g) || []).map((n) => Number(n.replace(/,/g, '')));
  const known = new Set();
  for (const n of numbersIn(JSON.stringify(context))) {
    for (const d of [0, 1, 2]) known.add(Number(n.toFixed(d)));
  }
  return numbersIn(text).every((n) => known.has(n));
}

// ── Saved daily history ─────────────────────────────────────────────────────
// Stock insights and the historical study read only the saved daily candles in
// data/pulse/candles/<SYMBOL>.json. Every figure they show is computed from those rows
// and dated by the last saved session; a symbol with no saved file shows no figures.

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365.25 * DAY_MS;
const SAVED_FILE_ALIASES = { NIFTY: 'NIFTY_50', NIFTY50: 'NIFTY_50', BANK_NIFTY: 'NIFTY_BANK', BANKNIFTY: 'NIFTY_BANK' };
// Index symbols the chat may be handed; questions about them get the market brief.
const INDEX_SYMBOL = /^((NSE|BSE):)?(NIFTY|SENSEX|BANKEX|BANKNIFTY|BANK_NIFTY|INDIA_VIX)/i;
const REAL_QUOTE_SOURCES = new Set(['live', 'end-of-day']);
const NEWS_MAX_AGE_MS = 7 * DAY_MS;
const round2 = (n) => Math.round(n * 100) / 100;
const rupees = (n) => `₹${fmt(n)}`;
// '2026-10-16' → '16 Oct 2026': multi-year statistics need the year.
const dayOf = (date) => {
  const t = Date.parse(`${date}T00:00:00+05:30`);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : date;
};
const pctFrom = (value, base) => ((value - base) / base) * 100;
const yearsBefore = (date, years) => new Date(Date.parse(`${date}T00:00:00Z`) - years * YEAR_MS).toISOString().slice(0, 10);

export async function readSavedCandles(dataDir, symbol) {
  const name = bare(symbol).toUpperCase();
  const file = SAVED_FILE_ALIASES[name] || name;
  if (!/^[A-Z0-9&_-]+$/.test(file)) return null;
  try {
    const doc = JSON.parse(await readFile(path.join(dataDir, 'candles', `${file}.json`), 'utf8'));
    const rows = (Array.isArray(doc.candles) ? doc.candles : [])
      .filter((c) => Array.isArray(c) && [2, 3, 4].every((i) => Number(c[i]) > 0))
      .map((c) => ({ date: String(c[0]).slice(0, 10), open: Number(c[1]), high: Number(c[2]), low: Number(c[3]), close: Number(c[4]), volume: Number(c[5]) || 0 }))
      .sort((a, b) => a.date.localeCompare(b.date));
    return rows.length >= 2 ? { file, sector: doc.sector || null, benchmark: Boolean(doc.benchmark), rows } : null;
  } catch {
    return null;
  }
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const stdev = (xs) => { const m = mean(xs); return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1)); };
const sma = (rows, n) => (rows.length >= n ? mean(rows.slice(-n).map((r) => r.close)) : null);
const dailyReturns = (rows) => rows.slice(1).map((r, i) => ({ date: r.date, ret: r.close / rows[i].close - 1 }));

// Statistics of saved daily candles over the trailing `years` (or all saved history when it
// is shorter). A statistic is null when the rows cannot support it; nothing is filled in.
export function candleStudy(rows, { benchmark = null, years = 5 } = {}) {
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const last = rows[rows.length - 1];
  const cutoff = yearsBefore(last.date, years);
  const span = rows.filter((r) => r.date >= cutoff);
  const first = span[0];
  const coveredYears = (Date.parse(last.date) - Date.parse(first.date)) / YEAR_MS;
  const returns = dailyReturns(span);

  const yearRows = rows.filter((r) => r.date > yearsBefore(last.date, 1));
  const hi = yearRows.reduce((a, r) => (r.high > a.high ? r : a), yearRows[0]);
  const lo = yearRows.reduce((a, r) => (r.low < a.low ? r : a), yearRows[0]);

  let peak = span[0];
  let drawdown = { pct: 0, peakDate: span[0].date, troughDate: span[0].date };
  for (const r of span) {
    if (r.close > peak.close) peak = r;
    const dd = pctFrom(r.close, peak.close);
    if (dd < drawdown.pct) drawdown = { pct: dd, peakDate: peak.date, troughDate: r.date };
  }

  // Historical 1-day 95% VaR: the 5th-percentile daily return of the past year.
  const yearReturns = dailyReturns(yearRows).map((r) => r.ret).sort((a, b) => a - b);
  const var95 = yearReturns.length >= 100 ? yearReturns[Math.floor(yearReturns.length * 0.05)] * 100 : null;

  // Beta and correlation against the benchmark's returns on the same sessions.
  let beta = null;
  let correlation = null;
  if (benchmark?.length) {
    const closeOn = new Map(benchmark.map((r) => [r.date, r.close]));
    const paired = span.filter((r) => closeOn.has(r.date));
    const pairs = paired.slice(1).map((r, i) => [r.close / paired[i].close - 1, closeOn.get(r.date) / closeOn.get(paired[i].date) - 1]);
    if (pairs.length >= 60) {
      const xs = pairs.map((p) => p[1]);
      const ys = pairs.map((p) => p[0]);
      const mx = mean(xs);
      const my = mean(ys);
      const cov = pairs.reduce((s, [y, x]) => s + (x - mx) * (y - my), 0) / (pairs.length - 1);
      beta = cov / stdev(xs) ** 2;
      correlation = cov / (stdev(xs) * stdev(ys));
    }
  }

  // Price band (of 20 across the 52-week range) where the most shares traded in the past year.
  let volumeBand = null;
  if (yearRows.every((r) => r.volume > 0) && hi.high > lo.low) {
    const bands = 20;
    const width = (hi.high - lo.low) / bands;
    const traded = new Array(bands).fill(0);
    for (const r of yearRows) {
      const typical = (r.high + r.low + r.close) / 3;
      traded[Math.min(bands - 1, Math.floor((typical - lo.low) / width))] += r.volume;
    }
    const top = traded.indexOf(Math.max(...traded));
    volumeBand = { low: round2(lo.low + top * width), high: round2(lo.low + (top + 1) * width) };
  }

  const sma50 = sma(rows, 50);
  const sma200 = sma(rows, 200);
  return {
    asOf: last.date,
    from: first.date,
    sessions: span.length,
    years: round2(coveredYears),
    firstClose: first.close,
    lastClose: last.close,
    previousClose: rows[rows.length - 2].close,
    cagrPct: coveredYears >= 1 ? round2(((last.close / first.close) ** (1 / coveredYears) - 1) * 100) : null,
    totalReturnPct: round2(pctFrom(last.close, first.close)),
    annualVolatilityPct: returns.length >= 20 ? round2(stdev(returns.map((r) => r.ret)) * Math.sqrt(252) * 100) : null,
    maxDrawdown: { pct: round2(drawdown.pct), peakDate: drawdown.peakDate, troughDate: drawdown.troughDate },
    sma50: sma50 === null ? null : round2(sma50),
    sma200: sma200 === null ? null : round2(sma200),
    vsSma50Pct: sma50 === null ? null : round2(pctFrom(last.close, sma50)),
    vsSma200Pct: sma200 === null ? null : round2(pctFrom(last.close, sma200)),
    fiftyTwoWeek: { high: hi.high, highDate: hi.date, low: lo.low, lowDate: lo.date },
    var95Pct: var95 === null ? null : round2(var95),
    betaVsNifty: beta === null ? null : round2(beta),
    correlationVsNifty: correlation === null ? null : round2(correlation),
    volumeBand,
  };
}

const aboveBelow = (pct) => `${fmt(Math.abs(pct))}% ${pct >= 0 ? 'above' : 'below'}`;

// Stock insight from a real quote, the saved daily history and dated news headlines.
// No real quote (missing, or the provider's built-in 'fallback') → a neutral insight with no figures.
export function stockInsightFrom({ symbol, quote = null, history = null, news = [] }) {
  const sym = bare(symbol).toUpperCase();
  const base = { symbol: sym, timestamp: new Date().toISOString() };
  if (!quote || !REAL_QUOTE_SOURCES.has(quote.source) || !(num(quote.ltp) > 0)) {
    return {
      ...base,
      available: false,
      sentiment: 'neutral',
      summary: `Market data for ${sym} is unavailable right now, so Pulse AI has no insight to show. Please check again shortly.`,
      keyFactors: [],
      technicalNote: null,
      catalyst: null,
      sources: { quote: 'unavailable' },
    };
  }

  const ltp = Number(quote.ltp);
  const change = num(quote.changePercent);
  const verb = quote.source === 'live' ? 'last traded at' : 'closed at';
  let summary = `${sym} ${verb} ${rupees(ltp)}${change !== null ? ` (${signedPct(change)} on the day)` : ''}.`;
  if (num(quote.low) > 0 && num(quote.high) >= num(quote.low)) summary += ` Day range ${rupees(quote.low)} – ${rupees(quote.high)}.`;

  const keyFactors = [];
  let technicalNote = null;
  if (history) {
    const day = dayOf(history.asOf);
    const { high, low } = history.fiftyTwoWeek;
    keyFactors.push(`52-week range ${rupees(low)} – ${rupees(high)} (daily closes to ${day})`);
    keyFactors.push(`${aboveBelow(pctFrom(ltp, high))} the 52-week high of ${rupees(high)}`);
    if (history.annualVolatilityPct !== null) keyFactors.push(`Annualised volatility ${fmt(history.annualVolatilityPct)}% over the past year`);
    const averages = [];
    if (history.sma50 !== null) averages.push(`${aboveBelow(history.vsSma50Pct)} its 50-day average of ${rupees(history.sma50)}`);
    if (history.sma200 !== null) averages.push(`${aboveBelow(history.vsSma200Pct)} its 200-day average of ${rupees(history.sma200)}`);
    if (averages.length) technicalNote = `The ${day} close of ${rupees(history.lastClose)} was ${averages.join(' and ')}.`;
  }

  // Tone of the price action only: the day's move agreeing with the 50-day trend.
  let sentiment = 'neutral';
  if (change !== null && history?.vsSma50Pct != null) {
    if (change > 0 && history.vsSma50Pct > 0) sentiment = 'bullish';
    if (change < 0 && history.vsSma50Pct < 0) sentiment = 'bearish';
  }

  // Only a linked headline from the past week counts as current news.
  const headline = news.find((n) => n?.title && n?.url && Date.now() - Date.parse(n.publishedAt) <= NEWS_MAX_AGE_MS);
  return {
    ...base,
    available: true,
    sentiment,
    summary,
    keyFactors,
    technicalNote,
    catalyst: headline ? headline.title : null,
    sources: {
      quote: quote.source,
      history: history ? { source: 'end-of-day', asOf: history.asOf } : 'unavailable',
      news: headline ? { title: headline.title, url: headline.url, publishedAt: headline.publishedAt || null } : null,
    },
  };
}

// Historical study (the "quant lab") of one symbol's saved daily candles. It describes the
// past only: no forecasts, price targets, position sizes or buy/sell directives.
export function historicalStudyFrom({ symbol, name = null, saved, benchmark = null, years = 5 }) {
  const sym = bare(symbol).toUpperCase();
  if (!saved) {
    return {
      success: false,
      available: false,
      symbol: sym,
      message: `Saved daily price history for ${sym} is not available, so no historical study can be shown.`,
      timestamp: new Date().toISOString(),
    };
  }
  const isIndex = saved.benchmark || INDEX_SYMBOL.test(saved.file);
  const s = candleStudy(saved.rows, { benchmark: isIndex ? null : benchmark, years });
  const px = isIndex ? (n) => fmt(n) : rupees;
  const day = dayOf(s.asOf);
  const period = `${dayOf(s.from)} to ${day}`;

  const trend = [`Over ${fmt(s.sessions, 0)} sessions (${period}) the close moved from ${px(s.firstClose)} to ${px(s.lastClose)}, ${signedPct(s.totalReturnPct)}${s.cagrPct !== null ? `, or ${signedPct(s.cagrPct)} a year compounded` : ''}.`];
  if (s.sma200 !== null) trend.push(`The ${day} close was ${aboveBelow(s.vsSma200Pct)} the 200-day average of ${px(s.sma200)}${s.sma50 !== null ? ` and ${aboveBelow(s.vsSma50Pct)} the 50-day average of ${px(s.sma50)}` : ''}.`);

  const risk = [];
  if (s.annualVolatilityPct !== null) risk.push(`Annualised volatility of daily returns was ${fmt(s.annualVolatilityPct)}%.`);
  if (s.maxDrawdown.pct < 0) risk.push(`The deepest fall from a previous high was ${fmt(Math.abs(s.maxDrawdown.pct))}%, from ${dayOf(s.maxDrawdown.peakDate)} to ${dayOf(s.maxDrawdown.troughDate)}.`);
  if (s.var95Pct !== null) risk.push(`In the past year, 5% of sessions closed ${fmt(Math.abs(s.var95Pct))}% or more below the previous close.`);

  const market = [`52-week range ${px(s.fiftyTwoWeek.low)} (${dayOf(s.fiftyTwoWeek.lowDate)}) to ${px(s.fiftyTwoWeek.high)} (${dayOf(s.fiftyTwoWeek.highDate)}).`];
  if (s.betaVsNifty !== null) market.push(`Against NIFTY 50 over the same sessions, beta was ${fmt(s.betaVsNifty)} and correlation ${fmt(s.correlationVsNifty)}.`);
  if (s.volumeBand) market.push(`The most shares traded in the past year between ${px(s.volumeBand.low)} and ${px(s.volumeBand.high)}.`);

  return {
    success: true,
    available: true,
    symbol: sym,
    name,
    sector: saved.sector,
    source: 'end-of-day',
    asOf: s.asOf,
    basis: { from: s.from, to: s.asOf, sessions: s.sessions, years: s.years, requestedYears: years },
    metrics: s,
    reasoningTrace: [
      { step: 1, agent: 'Trend & history', observation: trend.join(' ') },
      { step: 2, agent: 'Risk', observation: risk.join(' ') || 'Not enough saved sessions to measure risk.' },
      { step: 3, agent: 'Range & market sensitivity', observation: market.join(' ') },
    ],
    note: `Computed from saved NSE daily candles up to ${day}. Historical statistics describe past prices; they are not a forecast or a recommendation.`,
    timestamp: new Date().toISOString(),
  };
}

export class AIService {
  constructor({ market = marketDataService, news = newsService, cache = aiCache, dataDir = path.resolve(process.env.PULSE_DATA_DIR || 'data/pulse') } = {}) {
    this.market = market;
    this.news = news;
    this.cache = cache;
    this.dataDir = dataDir;
    this.apiKey = process.env.GEMINI_API_KEY;
    this.model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
  }

  async assembleMarketContext() {
    try {
      const [overview, gainers, losers] = await Promise.all([
        this.market.getOverview().catch(() => null),
        this.market.getGainers(8).catch(() => []),
        this.market.getLosers(8).catch(() => []),
      ]);
      return marketContextFrom({ overview, gainers, losers, status: getMarketStatus(), isOpen: isMarketOpen() });
    } catch (err) {
      logger.warn({ err: err.message }, 'Failed to assemble complete market context');
      return marketContextFrom({ isOpen: isMarketOpen() });
    }
  }

  // The quote is kept only when it is 'live' or 'end-of-day', and only its price fields: the
  // provider fills volume, 52-week range and sector with placeholders when Upstox omits them,
  // so the 52-week range comes from the saved daily candles instead.
  async assembleStockContext(symbol) {
    const upper = String(symbol || '').toUpperCase();
    const [quote, saved, news] = await Promise.all([
      this.market.getQuote(upper).catch(() => null),
      readSavedCandles(this.dataDir, upper),
      Promise.resolve(this.news.getStockNews(upper, { limit: 4 })).catch(() => []),
    ]);
    const real = quote && REAL_QUOTE_SOURCES.has(quote.source) && num(quote.ltp) > 0;
    return {
      symbol: upper,
      quote: real ? {
        source: quote.source,
        ltp: num(quote.ltp),
        change: num(quote.change),
        changePercent: num(quote.changePercent),
        open: num(quote.open) > 0 ? num(quote.open) : null,
        high: num(quote.high) > 0 ? num(quote.high) : null,
        low: num(quote.low) > 0 ? num(quote.low) : null,
        previousClose: num(quote.previousClose) > 0 ? num(quote.previousClose) : null,
        lastUpdated: quote.lastUpdated || null,
      } : null,
      history: real && saved ? candleStudy(saved.rows, { years: 1 }) : null,
      news: (Array.isArray(news) ? news : [])
        .filter((n) => n?.title && /^https?:\/\//.test(n.sourceUrl || n.url || ''))
        .map((n) => ({ title: n.title, url: n.sourceUrl || n.url, publishedAt: n.publishedAt || null })),
    };
  }

  async generateMarketSummary() {
    const cacheKey = 'ai:market:summary';
    const cached = this.cache.get(cacheKey);
    if (cached && Array.isArray(cached.sessionFeed)) {
      return cached;
    }

    const context = await this.assembleMarketContext();
    const brief = buildMarketBrief(context);
    // Nothing to brief on yet: keep the neutral brief only briefly so real data shows soon.
    const ttl = context.indices?.length ? 600 : 60;

    // Gemini may reword the brief, but only from the same data: a reply that cites any
    // figure the context does not contain is discarded in favour of the deterministic brief.
    if (context.indices?.length && this.apiKey && this.apiKey !== 'your-gemini-api-key') {
      try {
        const prompt = `You are Pulse AI, the market brief writer for Market Pulse (Indian equities, NSE/BSE).
Write a concise market brief using ONLY the data below. Every number you write must appear in the data.
Do not mention corporate events, orders, approvals, policy decisions, macro figures, forecasts,
support/resistance levels or anything else the data does not contain. If a field is missing, leave it out.
${context.isAfterMarket ? 'The market is closed; describe how the last session concluded.' : 'The market is open; describe the session so far.'}
Data:
${JSON.stringify(context, null, 2)}

Respond in JSON with exactly these keys:
{
  "headline": "one sentence",
  "summary": "2-3 sentences on index moves, breadth and institutional flows",
  "keyDrivers": ["3-5 short data points"],
  "sectorOutlook": "1 sentence on leading vs lagging sector indices",
  "marketStance": "Bullish Momentum" | "Consolidation" | "Cautious"
}`;

        const res = await axios.post(
          `${this.baseUrl}/${this.model}:generateContent?key=${this.apiKey}`,
          {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json' },
          },
          { timeout: 7000 }
        );

        const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          const parsed = JSON.parse(text);
          const written = {
            headline: typeof parsed.headline === 'string' ? parsed.headline : null,
            summary: typeof parsed.summary === 'string' ? parsed.summary : null,
            keyDrivers: Array.isArray(parsed.keyDrivers) ? parsed.keyDrivers.filter((d) => typeof d === 'string') : null,
            sectorOutlook: typeof parsed.sectorOutlook === 'string' ? parsed.sectorOutlook : null,
          };
          if (written.headline && written.summary && numbersGrounded(JSON.stringify(written), context)) {
            const result = {
              ...brief,
              ...Object.fromEntries(Object.entries(written).filter(([, v]) => v !== null)),
              marketStance: ['Bullish Momentum', 'Consolidation', 'Cautious'].includes(parsed.marketStance) ? parsed.marketStance : brief.marketStance,
            };
            this.cache.set(cacheKey, result, ttl);
            return result;
          }
          logger.warn('Gemini market brief cited figures outside the market data; using the data-built brief');
        }
      } catch (err) {
        logger.warn({ err: err.message }, 'Gemini market summary failed, using the data-built brief');
      }
    }

    this.cache.set(cacheKey, brief, ttl);
    return brief;
  }

  async generateStockInsight(symbol) {
    const cleanSym = (symbol || '').toUpperCase();
    const cacheKey = `ai:stock:${cleanSym}`;
    const cached = this.cache.get(cacheKey);
    if (cached && 'available' in cached) return cached;

    const context = await this.assembleStockContext(cleanSym);
    const insight = stockInsightFrom(context);
    if (!insight.available) {
      this.cache.set(cacheKey, insight, 60);
      return insight;
    }

    // Gemini may reword the insight, but only from the same data: a reply citing any figure
    // the context does not contain is discarded. The catalyst stays a real, linked headline.
    if (this.apiKey && this.apiKey !== 'your-gemini-api-key') {
      try {
        const prompt = `You are Pulse AI, an equity research writer for Indian equities.
Describe ${cleanSym} using ONLY the data below. Every number you write must appear in the data.
Do not mention support or resistance levels, forecasts, corporate events, sector themes or
anything else the data does not contain. Never recommend buying or selling.
Data:
${JSON.stringify(context, null, 2)}

Respond in JSON with exactly these keys:
{
  "summary": "2 sentences on the price move and its position in the 52-week range",
  "keyFactors": ["2-4 short data points"],
  "technicalNote": "1 sentence on the close against its 50-day and 200-day averages"
}`;

        const res = await axios.post(
          `${this.baseUrl}/${this.model}:generateContent?key=${this.apiKey}`,
          {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json' },
          },
          { timeout: 7000 }
        );

        const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          const parsed = JSON.parse(text);
          const written = {
            summary: typeof parsed.summary === 'string' ? parsed.summary : null,
            keyFactors: Array.isArray(parsed.keyFactors) ? parsed.keyFactors.filter((f) => typeof f === 'string') : null,
            technicalNote: typeof parsed.technicalNote === 'string' ? parsed.technicalNote : null,
          };
          if (written.summary && numbersGrounded(JSON.stringify(written), context)) {
            const result = { ...insight, ...Object.fromEntries(Object.entries(written).filter(([, v]) => v !== null)) };
            this.cache.set(cacheKey, result, 900);
            return result;
          }
          logger.warn(`Gemini stock insight for ${cleanSym} cited figures outside the data; using the data-built insight`);
        }
      } catch (err) {
        logger.warn({ err: err.message }, `Gemini stock insight failed for ${cleanSym}, using the data-built insight`);
      }
    }

    this.cache.set(cacheKey, insight, 900);
    return insight;
  }

  async chatResponse({ message, conversationId, symbol }) {
    const convId = conversationId || `conv-${Date.now()}`;
    const userMsg = (message || '').trim();

    // Index questions are answered from the market brief, never from a single-symbol quote.
    const requested = symbol && !INDEX_SYMBOL.test(bare(symbol)) ? symbol : null;
    const targetSymbol = requested || this._detectSymbol(userMsg);
    const askedIndex = !targetSymbol && Boolean(symbol);
    let stockContext = null;
    if (targetSymbol) {
      stockContext = await this.assembleStockContext(targetSymbol);
    }
    const marketContext = await this.assembleMarketContext();

    // Attempt Gemini call
    if (this.apiKey && this.apiKey !== 'your-gemini-api-key') {
      try {
        const prompt = `You are Pulse AI, the intelligent market co-pilot of Market Pulse for the Indian stock market.
User query: "${userMsg}"
Market Context: ${JSON.stringify(marketContext)}
Stock Context: ${JSON.stringify(stockContext)}

Answer the user directly, concisely, and insightfully.
${marketContext.isAfterMarket ? 'Note: The Indian market is currently CLOSED. If the user asks about what happened last day or after market hours, describe the last session from the market context only.' : ''}
Ground all statements in the actual numbers provided. Never recommend buying or selling stocks; use educational and analytical framing. Format with clean markdown.`;

        const res = await axios.post(
          `${this.baseUrl}/${this.model}:generateContent?key=${this.apiKey}`,
          {
            contents: [{ parts: [{ text: prompt }] }],
          },
          { timeout: 8000 }
        );

        const reply = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (reply && !numbersGrounded(reply, { userMsg, marketContext, stockContext })) {
          logger.warn('Gemini chat reply cited figures outside the data; using the data-built reply');
        } else if (reply) {
          this._saveMessage(convId, userMsg, reply);
          return {
            conversationId: convId,
            reply,
            symbol: targetSymbol,
            timestamp: new Date().toISOString(),
          };
        }
      } catch (err) {
        logger.warn({ err: err.message }, 'Gemini chat call failed, providing grounded response');
      }
    }

    // High-fidelity dynamic intelligent response
    const reply = this._generateSmartReply(userMsg, targetSymbol, stockContext, marketContext, { askedIndex });
    this._saveMessage(convId, userMsg, reply);

    return {
      conversationId: convId,
      reply,
      symbol: targetSymbol,
      timestamp: new Date().toISOString(),
    };
  }

  // Stock tickers named in the question, matched as whole words. Index names (NIFTY, SENSEX)
  // are not symbols here: those questions go to the market brief.
  _detectSymbol(query) {
    const q = String(query || '').toUpperCase();
    const candidates = ['RELIANCE', 'TCS', 'INFY', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'ITC', 'LT', 'TITAN', 'BAJFINANCE', 'SUNPHARMA'];
    for (const sym of candidates) {
      if (new RegExp(`(^|[^A-Z0-9&])${sym}([^A-Z0-9&]|$)`).test(q)) return `NSE:${sym}`;
    }
    return null;
  }

  _generateSmartReply(userQuery, symbol, stockContext, marketContext, { askedIndex = false } = {}) {
    const qLower = userQuery.toLowerCase();

    if (symbol && stockContext) {
      const insight = stockInsightFrom(stockContext);
      if (!insight.available) {
        return `### ${insight.symbol}

${insight.summary}`;
      }
      const lines = [`### ${insight.symbol}`, '', insight.summary];
      if (insight.keyFactors.length) lines.push('', '#### Key Data Points', ...insight.keyFactors.map((f) => `- ${f}`));
      if (insight.technicalNote) lines.push('', insight.technicalNote);
      if (insight.sources.news) lines.push('', `**Latest headline** (${dayOf(insight.sources.news.publishedAt.slice(0, 10))}): [${insight.sources.news.title}](${insight.sources.news.url})`);
      lines.push('', '*Pulse AI provides data-grounded insights for analytical and educational purposes only, not financial or investment advice.*');
      return lines.join('\n');
    }

    // Last session / market questions: the same data-built brief the dashboard shows.
    const askedWrap = ['yesterday', 'last day', 'after market', 'post market', 'closed', 'what happened'].some((k) => qLower.includes(k));
    const askedMarket = askedIndex || ['nifty', 'market', 'sensex', 'today', 'index', 'indices'].some((k) => qLower.includes(k));
    if (askedWrap || askedMarket) {
      const brief = buildMarketBrief(marketContext);
      if (!marketContext.indices?.length) {
        return `### Market Brief

Exchange data for the brief is not available right now. Please check again shortly.`;
      }
      const lines = [`### ${brief.isAfterMarket ? 'Last Session Wrap' : 'Market Overview'}`, '', `**${brief.headline}.**`, '', brief.summary];
      if (brief.keyDrivers.length) lines.push('', '#### Key Data Points', ...brief.keyDrivers.map((d) => `- ${d}`));
      if (brief.sessionFeed.length) lines.push('', '#### Source Data', ...brief.sessionFeed.map((f) => `- **${f.title}**${f.time ? ` (${f.time})` : ''}: ${f.detail}`));
      if (brief.levels.pivots) {
        const p = brief.levels.pivots;
        lines.push('', `#### Classic Pivots (${p.basis})`, `- Pivot ${p.pivot} · Support ${p.support} · Resistance ${p.resistance}`);
      }
      lines.push('', '*Pulse AI provides data-grounded insights for analytical and educational purposes only, not financial or investment advice.*');
      return lines.join('\n');
    }

    return `### Pulse AI Assistant

I am your co-pilot for the Indian stock market. I read NSE & BSE quotes, market breadth, institutional flows and the NIFTY option chain.

You can ask me:
- *"What happened last day after the market time was over?"*
- *"How is NIFTY 50 performing?"*
- *"Analyze Reliance Industries or Tata Motors"*
- *"Show me the post-market closing wrap"*

How can I assist your market analysis right now?`;
  }

  _saveMessage(convId, userMsg, reply) {
    if (!conversations.has(convId)) {
      conversations.set(convId, []);
    }
    const history = conversations.get(convId);
    history.push({ role: 'user', content: userMsg, timestamp: new Date().toISOString() });
    history.push({ role: 'assistant', content: reply, timestamp: new Date().toISOString() });
    if (history.length > 50) history.splice(0, 10);
  }

  getConversations(convId) {
    if (convId && conversations.has(convId)) {
      return conversations.get(convId);
    }
    return Array.from(conversations.entries()).map(([id, msgs]) => ({
      id,
      lastMessage: msgs[msgs.length - 1]?.content || '',
      updatedAt: msgs[msgs.length - 1]?.timestamp || new Date().toISOString(),
    }));
  }

  // Historical study of a symbol's saved daily candles (the dashboard's "quant lab" link).
  // Every figure is computed from data/pulse/candles/<SYMBOL>.json and NIFTY_50.json; a
  // symbol without a saved file returns available: false and no figures. `strategy` is
  // accepted for API compatibility and ignored: the study gives no buy/sell directives.
  async runAgenticAnalysis({ symbol, timeframe = '5Y' } = {}) {
    const sym = String(symbol || '').trim().toUpperCase();
    const years = Math.min(10, Math.max(1, Number(/^(\d+)Y$/i.exec(String(timeframe || ''))?.[1]) || 5));
    const [saved, benchmark] = sym
      ? await Promise.all([readSavedCandles(this.dataDir, sym), readSavedCandles(this.dataDir, 'NIFTY_50')])
      : [null, null];
    const name = saved ? (readNames(this.dataDir) || {})[saved.file] || null : null;
    return historicalStudyFrom({ symbol: saved?.file || sym || 'symbol', name, saved, benchmark: benchmark?.rows || null, years });
  }
}

export const aiService = new AIService();
export default aiService;

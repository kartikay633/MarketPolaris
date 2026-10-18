// Movers, breadth, sectors, turnover, flows and derivatives are computed from real data only:
// a batched Upstox quote, saved end-of-day candles, the NIFTY option chain or NSE reports.
// No payload from these endpoints may carry a built-in ('fallback') value.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import axios from 'axios';
import express from 'express';
import { UpstoxProvider, upstoxProvider, SOURCE_LIVE, SOURCE_FALLBACK, SOURCE_EOD, SOURCE_UNAVAILABLE } from '../server/providers/UpstoxProvider.js';
import { analyzeOptionChain, summarizeCandles } from '../server/providers/marketSnapshot.js';
import { parseFiiDii, parseTurnover, nseDate } from '../server/providers/nseClient.js';

const STOCKS = [
  { symbol: 'AAA', instrumentKey: 'NSE_EQ|INE000A00001', sector: 'BANK' },
  { symbol: 'BBB', instrumentKey: 'NSE_EQ|INE000B00001', sector: 'IT' },
  { symbol: 'CCC', instrumentKey: 'NSE_EQ|INE000C00001', sector: 'IT' },
  { symbol: 'DDD', instrumentKey: 'NSE_EQ|INE000D00001', sector: 'METAL' },
];
const BENCH = [
  { symbol: 'NIFTY_50', instrumentKey: 'NSE_INDEX|Nifty 50', sector: null },
  { symbol: 'NIFTY_BANK', instrumentKey: 'NSE_INDEX|Nifty Bank', sector: 'BANK' },
  { symbol: 'NIFTY_IT', instrumentKey: 'NSE_INDEX|Nifty IT', sector: 'IT' },
  { symbol: 'INDIA_VIX', instrumentKey: 'NSE_INDEX|India VIX', sector: null },
];
// Last two saved sessions per instrument: [prevClose, close, volume]. DDD's file is a day stale.
const EOD = { AAA: [100, 104, 1000], BBB: [200, 190, 5000], CCC: [50, 50, 300], DDD: [80, 88, 10], NIFTY_50: [23000, 23100, 0], NIFTY_BANK: [55000, 54450, 0], NIFTY_IT: [40000, 40400, 0], INDIA_VIX: [14, 14.7, 0] };

function candleRows(symbol) {
  const [prev, close, volume] = EOD[symbol];
  const last = symbol === 'DDD' ? '2026-10-15' : '2026-10-16';
  const rows = [];
  for (let i = 300; i >= 2; i -= 1) {
    const d = new Date(Date.parse(`${last}T00:00:00Z`) - i * 86400000).toISOString().slice(0, 10);
    rows.push([`${d}T09:15:00+05:30`, prev, prev * 1.01, prev * 0.99, prev, volume]);
  }
  const prevDay = new Date(Date.parse(`${last}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  rows.push([`${prevDay}T09:15:00+05:30`, prev, prev, prev, prev, volume]);
  rows.push([`${last}T09:15:00+05:30`, prev, Math.max(prev, close) * 1.2, Math.min(prev, close), close, volume]);
  return rows;
}

function fixtureDir(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mp-snapshot-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, 'candles'));
  const instruments = [
    ...STOCKS.map((s) => ({ ...s, benchmark: false, status: 'ready' })),
    ...BENCH.map((b) => ({ ...b, benchmark: true, status: 'ready' })),
  ];
  writeFileSync(path.join(dir, 'collection.json'), JSON.stringify({ instruments }));
  for (const i of instruments) writeFileSync(path.join(dir, 'candles', `${i.symbol}.json`), JSON.stringify({ symbol: i.symbol, candles: candleRows(i.symbol) }));
  writeFileSync(path.join(dir, 'instrument-names.json'), JSON.stringify({ names: { AAA: 'AAA BANK LTD', BBB: 'BBB SOFTWARE LTD' } }));
  return dir;
}

const TRADE_MS = Date.parse('2026-10-16T09:59:58.000Z');
function quote(instrumentKey, last, net, { volume = 0, avg = null } = {}) {
  return { instrument_token: instrumentKey, last_price: last, net_change: net, volume, average_price: avg, last_trade_time: String(TRADE_MS), ohlc: { open: last - net, high: last + 1, low: last - net - 1, close: last } };
}
function liveQuotes() {
  const q = [
    quote('NSE_EQ|INE000A00001', 110, 10, { volume: 100, avg: 108 }), // +10%  value 10,800
    quote('NSE_EQ|INE000B00001', 180, -20, { volume: 500, avg: 185 }), // -10%  value 92,500
    quote('NSE_EQ|INE000C00001', 51, 1, { volume: 50, avg: 50 }), //      +2%   value 2,500
    quote('NSE_EQ|INE000D00001', 80, 0, { volume: 10, avg: 80 }), //       0%   value 800
    quote('NSE_INDEX|Nifty 50', 23200, 100), quote('BSE_INDEX|SENSEX', 75000, 300),
    quote('NSE_INDEX|Nifty Bank', 55100, -50), quote('NSE_INDEX|India VIX', 13.5, -0.5), quote('NSE_INDEX|Nifty IT', 41000, 410),
  ];
  return Object.fromEntries(q.map((x) => [x.instrument_token.replace('|', ':'), x]));
}

function chain() {
  const row = (strike, callOi, putOi, callIv, putIv) => ({
    expiry: '2026-10-19', strike_price: strike, underlying_spot_price: 23140,
    call_options: { market_data: { oi: callOi }, option_greeks: { iv: callIv } },
    put_options: { market_data: { oi: putOi }, option_greeks: { iv: putIv } },
  });
  return [row(23000, 100, 900, 0, 14), row(23100, 300, 500, 12, 13), row(23200, 800, 200, 11, 0), row(23300, 400, 50, 10.5, 0)];
}

const NSE_FLOWS = [
  { category: 'DII', date: '16-Oct-2026', buyValue: '17201.8', sellValue: '20863.08', netValue: '-3661.28' },
  { category: 'FII/FPI', date: '16-Oct-2026', buyValue: '19951.59', sellValue: '18785.67', netValue: '1165.92' },
];
const NSE_TURNOVER = { data: {
  equities: [
    { segment: 'CM', instrument: 'Equity', value: 1222883541373.63, noOfTrades: 41585421, mktTimeStamp: '2026-10-16 16:00:00' },
    { segment: 'CM', instrument: 'SME', value: 2691206998.25, noOfTrades: 13783, mktTimeStamp: '2026-10-16 15:57:28' },
    { segment: 'total', instrument: 'Total', value: null, noOfTrades: 41599204 },
  ],
  equityDerivatives: [
    { segment: 'FO', instrument: 'Index Options', notionalTurnover: 2.474e14, premiumTurnover: 6.8e11 },
    { segment: 'FO', instrument: 'Stock Futures', notionalTurnover: 8.0e11, premiumTurnover: 0 },
  ],
} };

// Routes every Upstox call made through axios; records the quote calls for inspection.
function stubUpstox(t, { quotes = 'live', options = true } = {}) {
  const calls = [];
  const original = axios.get;
  axios.get = async (url, cfg = {}) => {
    calls.push({ url, params: cfg.params });
    if (url.endsWith('/market-quote/quotes')) {
      if (quotes === 'throw') throw new Error('ETIMEDOUT');
      if (quotes === 'indices-only') return { data: { data: Object.fromEntries(Object.entries(liveQuotes()).filter(([k]) => k.includes('INDEX'))) } };
      return { data: { data: liveQuotes() } };
    }
    if (url.endsWith('/option/contract')) {
      if (!options) throw new Error('403');
      return { data: { data: [{ expiry: '2026-10-12' }, { expiry: '2099-10-19' }, { expiry: '2099-10-27' }] } };
    }
    if (url.endsWith('/option/chain')) return { data: { data: chain() } };
    throw new Error(`unexpected network call ${url}`);
  };
  t.after(() => { axios.get = original; });
  return calls;
}

function provider(dataDir, { live, nse = 'up' }) {
  const p = new UpstoxProvider();
  p.dataDir = dataDir;
  p.isLive = live;
  p.token = live ? 'test-token' : undefined;
  p.nse = nse === 'up'
    ? { getFiiDii: async () => parseFiiDii(NSE_FLOWS), getTurnover: async () => parseTurnover(NSE_TURNOVER) }
    : { getFiiDii: async () => null, getTurnover: async () => null };
  return p;
}

// Every 'source' anywhere in a payload, so a fallback value cannot hide in a nested block.
function sourcesIn(value, found = []) {
  if (Array.isArray(value)) value.forEach((v) => sourcesIn(v, found));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'source' && typeof v === 'string') found.push(v);
      else sourcesIn(v, found);
    }
  }
  return found;
}

function assertNoFallback(payload, label) {
  const found = sourcesIn(payload);
  assert.ok(!found.includes(SOURCE_FALLBACK), `${label} carries a fallback-tagged value`);
  if (payload?.sources) for (const [block, s] of Object.entries(payload.sources)) assert.notEqual(s, SOURCE_FALLBACK, `${label}.${block}`);
}

async function everything(p) {
  return {
    overview: await p.getMarketOverview(),
    gainers: await p.getGainers(10),
    losers: await p.getLosers(10),
    active: await p.getActive(10),
    stocks: await p.getStocks(),
  };
}

test('live feed: one batched quote call prices the universe and every block is real', async (t) => {
  const calls = stubUpstox(t);
  const p = provider(fixtureDir(t), { live: true });
  const all = await everything(p);
  for (const [k, v] of Object.entries(all)) assertNoFallback(v, k);

  const quoteCalls = calls.filter((c) => c.url.endsWith('/market-quote/quotes'));
  assert.equal(quoteCalls.length, 1, 'overview, movers and screener share one batched quote call');
  const keys = quoteCalls[0].params.instrument_key.split(',');
  for (const s of [...STOCKS, ...BENCH]) assert.ok(keys.includes(s.instrumentKey), s.symbol);

  const { overview, gainers, losers, active, stocks } = all;
  assert.deepEqual(gainers.map((r) => r.symbol), ['NSE:AAA', 'NSE:CCC']);
  assert.equal(gainers[0].changePercent, 10);
  assert.equal(gainers[0].name, 'AAA BANK LTD');
  assert.deepEqual(losers.map((r) => r.symbol), ['NSE:BBB']);
  assert.deepEqual(active.map((r) => r.symbol), ['NSE:BBB', 'NSE:AAA', 'NSE:CCC', 'NSE:DDD'], 'ranked by volume × average price');
  assert.equal(active[0].tradedValue, 92500);
  for (const r of [...gainers, ...losers, ...active, ...stocks.stocks]) {
    assert.equal(r.source, SOURCE_LIVE);
    assert.equal(r.asOf, new Date(TRADE_MS).toISOString());
  }
  // 52-week range comes from saved candles, extended by the session's own range.
  assert.ok(gainers[0].fiftyTwoWeekHigh >= 111);

  assert.deepEqual(overview.breadth, { advancing: 2, declining: 1, unchanged: 1, total: 4, universe: 'tracked NSE stocks' });
  assert.deepEqual(overview.sectors.map((s) => [s.name, s.changePercent]), [['Nifty Bank', -0.09], ['Nifty IT', 1.01]]);
  assert.deepEqual(overview.indices.map((i) => i.symbol), ['NIFTY_50', 'SENSEX', 'BANK_NIFTY', 'INDIA_VIX']);
  assert.equal(overview.derivatives.expiry, '2026-10-19');
  assert.equal(overview.institutionalFlows.fiiNet, 1165.92);
  assert.equal(overview.turnover.asOf, '2026-10-16');
  assert.deepEqual(
    overview.sources,
    { indices: 'live', breadth: 'live', sectors: 'live', turnover: SOURCE_EOD, institutionalFlows: SOURCE_EOD, derivatives: 'live' },
  );
  assert.equal(overview.asOf.institutionalFlows, '2026-10-16');
});

test('feed down: movers, breadth, sectors and indices come from saved candles, marked end-of-day with the date', async (t) => {
  for (const mode of ['throw', 'indices-only']) {
    await t.test(mode, async (tt) => {
      stubUpstox(tt, { quotes: mode, options: false });
      const p = provider(fixtureDir(tt), { live: true, nse: 'down' });
      const all = await everything(p);
      for (const [k, v] of Object.entries(all)) assertNoFallback(v, k);

      const { overview, gainers, losers, active, stocks } = all;
      // DDD's last candle is a day older than the rest, so it is left out rather than mixed in.
      assert.deepEqual(stocks.stocks.map((r) => r.symbol).sort(), ['NSE:AAA', 'NSE:BBB', 'NSE:CCC']);
      assert.equal(stocks.source, SOURCE_EOD);
      assert.equal(stocks.asOf, '2026-10-16');
      assert.deepEqual(gainers.map((r) => [r.symbol, r.changePercent]), [['NSE:AAA', 4]]);
      assert.deepEqual(losers.map((r) => [r.symbol, r.changePercent]), [['NSE:BBB', -5]]);
      assert.equal(active[0].symbol, 'NSE:BBB');
      assert.ok(active.every((r) => r.tradedValueEstimated), 'candle traded value is flagged as an estimate');
      for (const r of [...gainers, ...losers, ...active]) {
        assert.equal(r.source, SOURCE_EOD);
        assert.equal(r.asOf, '2026-10-16');
      }

      assert.deepEqual(overview.breadth, { advancing: 1, declining: 1, unchanged: 1, total: 3, universe: 'tracked NSE stocks' });
      assert.deepEqual(overview.sectors.map((s) => [s.name, s.changePercent]), [['Nifty Bank', -1], ['Nifty IT', 1]]);
      assert.deepEqual(overview.indices.map((i) => [i.symbol, i.value, i.source]), [
        ['NIFTY_50', 23100, SOURCE_EOD], ['BANK_NIFTY', 54450, SOURCE_EOD], ['INDIA_VIX', 14.7, SOURCE_EOD],
      ], 'SENSEX is not collected, so it is left out instead of invented');
      for (const block of ['indices', 'breadth', 'sectors']) {
        assert.equal(overview.sources[block], SOURCE_EOD, block);
        assert.equal(overview.asOf[block], '2026-10-16', block);
      }
      for (const block of ['turnover', 'institutionalFlows', 'derivatives']) {
        assert.equal(overview[block], null, block);
        assert.equal(overview.sources[block], SOURCE_UNAVAILABLE, block);
      }
    });
  }
});

test('no token and no saved data: lists are empty and blocks unavailable, never sample values', async (t) => {
  stubUpstox(t);
  const dir = mkdtempSync(path.join(tmpdir(), 'mp-empty-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const p = provider(dir, { live: false, nse: 'down' });
  const all = await everything(p);
  for (const [k, v] of Object.entries(all)) assertNoFallback(v, k);
  assert.deepEqual([all.gainers, all.losers, all.active, all.stocks.stocks], [[], [], [], []]);
  assert.equal(all.stocks.source, SOURCE_UNAVAILABLE);
  assert.deepEqual(all.overview.indices, []);
  for (const block of ['breadth', 'sectors', 'turnover', 'institutionalFlows', 'derivatives']) {
    assert.equal(all.overview[block], null, block);
    assert.equal(all.overview.sources[block], SOURCE_UNAVAILABLE, block);
  }
});

test('market endpoints serve no fallback-tagged values', async (t) => {
  stubUpstox(t, { quotes: 'throw', options: false });
  const dir = fixtureDir(t);
  const saved = { dataDir: upstoxProvider.dataDir, isLive: upstoxProvider.isLive, token: upstoxProvider.token, nse: upstoxProvider.nse, universe: upstoxProvider.universe, names: upstoxProvider.names };
  Object.assign(upstoxProvider, { dataDir: dir, isLive: true, token: 'test-token', nse: provider(dir, { live: true }).nse, universe: undefined, names: undefined });
  upstoxProvider.cache.flushAll();
  t.after(() => { Object.assign(upstoxProvider, saved); upstoxProvider.cache.flushAll(); });

  // The routes' optional-auth middleware builds a Supabase client at import; requests here send
  // no Authorization header, so the placeholder key is never used.
  process.env.SUPABASE_SECRET_KEY ||= 'test-placeholder';
  process.env.VITE_SUPABASE_URL ||= 'http://127.0.0.1:9';
  const { default: marketRoutes } = await import('../server/routes/marketRoutes.js');
  const app = express();
  app.use('/api/market', marketRoutes);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;

  for (const route of ['overview', 'gainers?limit=5', 'losers?limit=5', 'active?limit=5', 'stocks']) {
    const res = await fetch(`${origin}/api/market/${route}`);
    assert.equal(res.status, 200, route);
    const body = await res.json();
    assertNoFallback(body, route);
    assert.ok(sourcesIn(body).length > 0, `${route} says where its data came from`);
  }
  const overview = await (await fetch(`${origin}/api/market/overview`)).json();
  assert.equal(overview.sources.breadth, SOURCE_EOD);
  assert.equal(overview.sources.institutionalFlows, SOURCE_EOD);
  assert.equal(overview.institutionalFlows.diiNet, -3661.28);
  assert.equal(overview.derivatives, null);
});

test('option chain read-outs: OI put/call ratio, max pain, OI walls and ATM IV', () => {
  const d = analyzeOptionChain(chain());
  assert.equal(d.pcr, 1.03); // 1650 put OI / 1600 call OI
  assert.equal(d.callWall, 23200);
  assert.equal(d.callWallOi, 800);
  assert.equal(d.putWall, 23000);
  assert.equal(d.atmStrike, 23100);
  assert.equal(d.atmIv, 12.5);
  // Payout to holders if NIFTY settles at K: Σ callOI·max(0,K−s) + Σ putOI·max(0,s−K).
  // 23000 → 500·100 + 200·200 + 50·300 = 105,000; 23100 → 100·100 + 200·100 + 50·200 = 40,000;
  // 23200 → 100·200 + 300·100 + 50·100 = 55,000; 23300 → … larger. Minimum at 23100.
  assert.equal(d.maxPain, 23100);
  assert.equal(analyzeOptionChain([]), null);
  assert.equal(analyzeOptionChain(chain().map((r) => ({ ...r, call_options: {} }))), null, 'no call OI, no ratio');
});

test('NSE report parsing keeps exchange figures and rejects malformed payloads', () => {
  assert.equal(nseDate('16-Oct-2026'), '2026-10-16');
  const flows = parseFiiDii(NSE_FLOWS);
  assert.deepEqual([flows.fiiBuy, flows.fiiSell, flows.fiiNet, flows.diiNet, flows.asOf], [19951.59, 18785.67, 1165.92, -3661.28, '2026-10-16']);
  assert.equal(parseFiiDii([{ category: 'FII/FPI', date: '16-Oct-2026', buyValue: 'n/a' }]), null);
  assert.equal(parseFiiDii({ error: 'blocked' }), null);

  const turnover = parseTurnover(NSE_TURNOVER);
  assert.equal(turnover.nseCashCr, 122557.47);
  assert.equal(turnover.nseFoNotionalCr, 24820000);
  assert.equal(turnover.nseFoPremiumCr, 68000);
  assert.equal(turnover.cashTrades, 41599204);
  assert.equal(turnover.asOf, '2026-10-16');
  assert.equal(parseTurnover({ data: { equities: [] } }), null);
  assert.equal(parseTurnover('<html>Access denied</html>'), null);
});

test('candle summary reads the latest session and its trailing 52-week range', () => {
  const s = summarizeCandles(candleRows('AAA'));
  assert.equal(s.date, '2026-10-16');
  assert.equal(s.close, 104);
  assert.equal(s.previousClose, 100);
  assert.equal(s.fiftyTwoWeekHigh, 104 * 1.2);
  assert.equal(summarizeCandles([]), null);
});

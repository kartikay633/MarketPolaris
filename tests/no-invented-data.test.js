import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import axios from 'axios';
import NodeCache from 'node-cache';
import { AIService, buildMarketBrief, marketContextFrom, numbersGrounded } from '../server/services/aiService.js';
import { MarketauxProvider } from '../server/providers/MarketauxProvider.js';
import { UpstoxProvider } from '../server/providers/UpstoxProvider.js';

// Figures and events the dashboard used to show without any source behind them.
const INVENTED = [
  '25,418', '25418', '83,184', '52,140', '1842', '1,842', '2110', '2,110', '3,953', '23,300', '23300',
  '25,280', '25,450', '51,850', '12.85', '14,500', '704.8', 'L&T', 'Sun Pharma', 'FDA', 'RBI', 'Titan',
  'GST', 'repo rate', 'Gift Nifty',
];
const assertNoInvented = (value) => {
  const text = JSON.stringify(value);
  for (const s of INVENTED) assert.ok(!text.includes(s), `found invented "${s}"`);
};

function stub(t, obj, key, impl) {
  const original = obj[key];
  obj[key] = impl;
  t.after(() => { obj[key] = original; });
}

const unavailableOverview = {
  status: 'CLOSED',
  statusMessage: 'Weekend',
  source: 'end-of-day',
  sources: { indices: 'unavailable', breadth: 'unavailable', sectors: 'unavailable', turnover: 'unavailable', institutionalFlows: 'unavailable', derivatives: 'unavailable' },
  asOf: { indices: null, breadth: null, sectors: null, turnover: null, institutionalFlows: null, derivatives: null },
  session: null,
  indices: [],
  breadth: null,
  sectors: null,
  turnover: null,
  institutionalFlows: null,
  derivatives: null,
};

const realOverview = {
  status: 'CLOSED',
  statusMessage: 'Weekend',
  source: 'end-of-day',
  sources: { indices: 'end-of-day', breadth: 'end-of-day', sectors: 'end-of-day', turnover: 'end-of-day', institutionalFlows: 'end-of-day', derivatives: 'live' },
  asOf: { indices: '2026-10-16T10:30:00.000Z', breadth: '2026-10-16T10:30:00.000Z', sectors: '2026-10-16T10:30:00.000Z', turnover: '2026-10-16', institutionalFlows: '2026-10-16', derivatives: '2026-10-16T10:30:00.000Z' },
  session: '2026-10-16',
  indices: [
    { symbol: 'NIFTY_50', name: 'NIFTY 50', value: 23146.15, change: 148.8, changePercent: 0.65, open: 23065.1, high: 23149.85, low: 22913.8, previousClose: 22997.35 },
    { symbol: 'BANK_NIFTY', name: 'NIFTY BANK', value: 55844, change: 33.5, changePercent: 0.06, open: 55927.15, high: 55989.55, low: 55526.3, previousClose: 55810.5 },
    { symbol: 'INDIA_VIX', name: 'INDIA VIX', value: 14.06, change: 0.03, changePercent: 0.21, open: 14.03, high: 14.52, low: 12.79, previousClose: 14.03 },
  ],
  breadth: { advancing: 86, declining: 89, unchanged: 0, total: 175, universe: 'tracked NSE stocks' },
  sectors: [
    { name: 'Nifty IT', symbol: 'NIFTY_IT', changePercent: 3.92, positive: true, value: 37000.5 },
    { name: 'Nifty FMCG', symbol: 'NIFTY_FMCG', changePercent: -0.39, positive: false, value: 54000.2 },
  ],
  turnover: { nseCashCr: 122601.09, nseEquityCr: 122288.35, nseFoNotionalCr: 25452299.1, nseFoPremiumCr: 76292.31, cashTrades: 41603397, asOf: '2026-10-16', publisher: 'NSE' },
  institutionalFlows: { fiiBuy: 19951.59, fiiSell: 18785.67, fiiNet: 1165.92, diiBuy: 17201.8, diiSell: 20863.08, diiNet: -3661.28, date: '16-Oct-2026', asOf: '2026-10-16', publisher: 'NSE provisional' },
  derivatives: { underlying: 'NIFTY 50', expiry: '2026-10-19', spot: 23146.15, pcr: 1.33, maxPain: 23050, callWall: 24000, callWallOi: 13975715, putWall: 22000, putWallOi: 18391620, atmStrike: 23150, atmIv: 11 },
};
const gainers = [{ symbol: 'NSE:TECHM', name: 'TECH MAHINDRA LIMITED', ltp: 1790, changePercent: 8.48 }];
const losers = [{ symbol: 'NSE:IPCALAB', name: 'IPCA LABORATORIES LIMITED', ltp: 1300.5, changePercent: -4.21 }];

// The fixtures describe the completed 16 Oct session, so tests fix the market as closed
// rather than reading the wall clock.
const closedHours = { isMarketOpen: () => false, getMarketStatus: () => ({ status: 'CLOSED', reason: 'Weekend' }) };
const marketStub = (overview, g = [], l = []) => ({
  getOverview: async () => overview,
  getGainers: async () => g,
  getLosers: async () => l,
});

// ── Pulse AI brief ──────────────────────────────────────────────────────────

test('with every overview block unavailable the brief states no figures at all', async () => {
  const ai = new AIService({ hours: closedHours, market: marketStub(unavailableOverview), cache: new NodeCache() });
  ai.apiKey = '';
  const brief = await ai.generateMarketSummary();

  assertNoInvented(brief);
  assert.deepEqual(brief.keyDrivers, []);
  assert.deepEqual(brief.sessionFeed, []);
  assert.equal(brief.levels.pivots, null);
  assert.equal(brief.levels.options, null);
  assert.equal(brief.levels.vix, null);
  assert.equal(brief.marketStance, null);
  assert.ok(!/\d/.test(brief.headline + brief.summary), `${brief.headline} / ${brief.summary}`);
});

test('the overview failing entirely also yields a figure-free brief', async () => {
  const market = { getOverview: async () => { throw new Error('down'); }, getGainers: async () => [], getLosers: async () => [] };
  const ai = new AIService({ hours: closedHours, market, cache: new NodeCache() });
  ai.apiKey = '';
  const brief = await ai.generateMarketSummary();
  assertNoInvented(brief);
  assert.ok(!/\d/.test(brief.headline + brief.summary + brief.keyDrivers.join('')));
});

test('every figure in the brief comes from the overview and movers', async () => {
  const ai = new AIService({ hours: closedHours, market: marketStub(realOverview, gainers, losers), cache: new NodeCache() });
  ai.apiKey = '';
  const brief = await ai.generateMarketSummary();
  assertNoInvented(brief);

  const source = { realOverview, gainers, losers };
  const { headline, summary, keyDrivers, sectorOutlook, sessionFeed } = brief;
  assert.ok(numbersGrounded(JSON.stringify({ headline, summary, keyDrivers, sectorOutlook, sessionFeed }), source));
  assert.match(headline, /23,146\.15/);
  assert.match(summary, /FIIs net buyers of ₹1,165\.92 Cr and DIIs net sellers of ₹3,661\.28 Cr/);
  assert.ok(keyDrivers.some((d) => d.includes('TECHM +8.48%')));
  assert.deepEqual(sessionFeed.map((f) => f.tag), ['INDICES', 'BREADTH', 'TURNOVER', 'FII / DII', 'OPTIONS']);

  // Pivots are the classic formula over the session's real high, low and close.
  const { high: h, low: l, value: c } = realOverview.indices[0];
  const p = (h + l + c) / 3;
  const fmt = (n) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  assert.equal(brief.levels.pivots.pivot, fmt(p));
  assert.equal(brief.levels.pivots.support, `${fmt(2 * p - h)} / ${fmt(p - (h - l))}`);
  assert.equal(brief.levels.pivots.resistance, `${fmt(2 * p - l)} / ${fmt(p + (h - l))}`);
  assert.equal(brief.levels.options.maxPain, '23,050');
});

test('a block marked unavailable is left out even if data is present', () => {
  const overview = { ...realOverview, sources: { ...realOverview.sources, institutionalFlows: 'unavailable', derivatives: 'unavailable' } };
  const brief = buildMarketBrief(marketContextFrom({ overview, isOpen: false }));
  const text = JSON.stringify(brief);
  assert.ok(!text.includes('1,165.92') && !text.includes('FII'));
  assert.ok(!text.includes('PCR') && !text.includes('23,050'));
  assert.equal(brief.levels.options, null);
});

test('no pivots are computed while the session is still open', () => {
  const brief = buildMarketBrief(marketContextFrom({ overview: realOverview, isOpen: true }));
  assert.equal(brief.levels.pivots, null);
});

test('a Gemini brief citing figures outside the data is discarded', async t => {
  stub(t, axios, 'post', async () => ({
    data: { candidates: [{ content: { parts: [{ text: JSON.stringify({
      headline: 'Nifty settles at record 25,418 as L&T bags ₹14,500 Cr order',
      summary: 'Strong session.', keyDrivers: [], sectorOutlook: '', marketStance: 'Bullish Momentum',
    }) }] } }] },
  }));
  const ai = new AIService({ hours: closedHours, market: marketStub(realOverview, gainers, losers), cache: new NodeCache() });
  ai.apiKey = 'test-key';
  const brief = await ai.generateMarketSummary();
  assertNoInvented(brief);
  assert.match(brief.headline, /^NIFTY 50 closed the 16 Oct session at 23,146\.15/);
});

test('a Gemini brief that sticks to the data is used', async t => {
  stub(t, axios, 'post', async () => ({
    data: { candidates: [{ content: { parts: [{ text: JSON.stringify({
      headline: 'NIFTY 50 ends at 23,146.15, up 0.65%',
      summary: 'FIIs bought a net ₹1,165.92 Cr while DIIs sold a net ₹3,661.28 Cr.',
      keyDrivers: ['Nifty IT led with +3.92%'], sectorOutlook: 'IT led, FMCG lagged.', marketStance: 'Consolidation',
    }) }] } }] },
  }));
  const ai = new AIService({ hours: closedHours, market: marketStub(realOverview, gainers, losers), cache: new NodeCache() });
  ai.apiKey = 'test-key';
  const brief = await ai.generateMarketSummary();
  assert.equal(brief.headline, 'NIFTY 50 ends at 23,146.15, up 0.65%');
  assert.equal(brief.sessionFeed.length, 5);
});

test('the chat market wrap uses the same real brief', async () => {
  const ai = new AIService({ hours: closedHours, market: marketStub(realOverview, gainers, losers), cache: new NodeCache() });
  const reply = ai._generateSmartReply('what happened after market hours?', null, null, await ai.assembleMarketContext());
  assertNoInvented(reply);
  assert.match(reply, /23,146\.15/);
});

// ── Market wire (Marketaux) ─────────────────────────────────────────────────

function newsProvider(live) {
  const p = new MarketauxProvider();
  p.isLive = live;
  p.apiKey = live ? 'test-key' : undefined;
  return p;
}

test('without a news key no articles are served', async t => {
  stub(t, axios, 'get', async () => { throw new Error('network must not be called without a key'); });
  const p = newsProvider(false);
  assert.deepEqual(await p.getMarketNews({ limit: 6 }), []);
  assert.deepEqual(await p.getStockNews('NSE:RELIANCE', { limit: 4 }), []);
});

test('a failed news feed serves no articles', async t => {
  stub(t, axios, 'get', async () => { throw new Error('down'); });
  const p = newsProvider(true);
  assert.deepEqual(await p.getMarketNews({ limit: 6 }), []);
  assert.deepEqual(await p.getStockNews('RELIANCE'), []);
});

test('a short live feed is not padded and unlinked items are dropped', async t => {
  stub(t, axios, 'get', async () => ({ data: { data: [
    { uuid: 'a', title: 'Real headline', url: 'https://example.com/a', source: 'example.com', published_at: '2026-10-16T10:00:00Z' },
    { uuid: 'b', title: 'No link', url: '', published_at: '2026-10-16T10:00:00Z' },
    { uuid: 'c', title: 'No time', url: 'https://example.com/c' },
  ] } }));
  const p = newsProvider(true);
  const articles = await p.getMarketNews({ limit: 30 });
  assert.deepEqual(articles.map((a) => a.title), ['Real headline']);
  assert.equal(articles[0].sourceUrl, 'https://example.com/a');
  assert.equal(articles[0].imageUrl, null);
  assertNoInvented(articles);
  assert.deepEqual((await p.getStockNews('RELIANCE', { limit: 6 })).map((a) => a.title), ['Real headline']);
});

// ── Historical candles ──────────────────────────────────────────────────────

async function candleSandbox(t) {
  const dir = await mkdtemp(join(tmpdir(), 'pulse-candles-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'candles'));
  const day = (d, close) => [`${d}T00:00:00+05:30`, close - 10, close + 5, close - 20, close, 1000, 0];
  const candles = [
    day('2026-10-05', 22800), day('2026-10-06', 22850), day('2026-10-07', 22900), day('2026-10-08', 22950), day('2026-10-09', 23000),
    day('2026-10-12', 23010), day('2026-10-13', 23050), day('2026-10-14', 23080), day('2026-10-15', 22997.35), day('2026-10-16', 23146.15),
  ];
  await writeFile(join(dir, 'candles', 'NIFTY_50.json'), JSON.stringify({ symbol: 'NIFTY_50', candles }));
  await writeFile(join(dir, 'candles', 'NIFTY_BANK.json'), JSON.stringify({ symbol: 'NIFTY_BANK', candles }));
  return { dir, candles };
}

function candleProvider(live, dataDir) {
  const p = new UpstoxProvider();
  p.isLive = live;
  p.token = live ? 'test-token' : undefined;
  p.dataDir = dataDir;
  return p;
}

test('without the feed, daily candles come from the saved file and say end-of-day', async t => {
  const { dir, candles } = await candleSandbox(t);
  stub(t, axios, 'get', async () => { throw new Error('network must not be called without a token'); });
  const p = candleProvider(false, dir);

  const daily = await p.getHistoricalCandles('NIFTY_50', '3M', '2026-10-01', '2026-10-31');
  assert.deepEqual(daily.map((c) => c.close), candles.map((c) => c[4]));
  for (const c of daily) assert.equal(c.source, 'end-of-day');
  assert.equal(daily.at(-1).close, 23146.15);

  // BANK_NIFTY reads the collection's NIFTY_BANK file; weekly views roll the saved days up.
  const weekly = await p.getHistoricalCandles('BANK_NIFTY', '5Y', '2026-10-01', '2026-10-31');
  assert.deepEqual(weekly.map((c) => c.close), [23000, 23146.15]);
  assert.equal(weekly[1].high, Math.max(...candles.slice(5).map((c) => c[2])));
  assert.equal(weekly[1].volume, 5000);
});

test('when Upstox fails, intraday returns nothing and daily uses saved candles', async t => {
  const { dir } = await candleSandbox(t);
  stub(t, axios, 'get', async () => { throw new Error('upstox unreachable'); });
  const p = candleProvider(true, dir);

  assert.deepEqual(await p.getHistoricalCandles('NIFTY_50', '1D'), []);
  assert.deepEqual(await p.getHistoricalCandles('NIFTY_50', '1W'), []);
  const daily = await p.getHistoricalCandles('NIFTY_50', '1M', '2026-10-01', '2026-10-31');
  assert.equal(daily.length, 10);
  assert.ok(daily.every((c) => c.source === 'end-of-day'));
});

test('a symbol with no saved candles returns nothing rather than generated prices', async t => {
  const { dir } = await candleSandbox(t);
  stub(t, axios, 'get', async () => { throw new Error('upstox unreachable'); });
  const p = candleProvider(true, dir);
  assert.deepEqual(await p.getHistoricalCandles('SENSEX', '3M'), []);
  assert.deepEqual(await p.getHistoricalCandles('NSE:RELIANCE', '1Y'), []);
  assert.deepEqual(await p.getHistoricalCandles('../collection', '1Y'), []);
});

test('live Upstox candles are marked live', async t => {
  const { dir } = await candleSandbox(t);
  stub(t, axios, 'get', async () => ({ data: { data: { candles: [
    ['2026-10-16T09:20:00+05:30', 23100, 23110, 23090, 23105, 0, 0],
    ['2026-10-16T09:15:00+05:30', 23065.1, 23100, 23060, 23090, 0, 0],
  ] } } }));
  const p = candleProvider(true, dir);
  const intraday = await p.getHistoricalCandles('NIFTY_50', '1D');
  assert.deepEqual(intraday.map((c) => c.close), [23090, 23105]);
  assert.ok(intraday.every((c) => c.source === 'live'));
});

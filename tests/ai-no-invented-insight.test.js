import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import axios from 'axios';
import NodeCache from 'node-cache';
import { AIService, candleStudy, numbersGrounded } from '../server/services/aiService.js';

// Figures and directives the stock insight, quant lab and chat used to show without a source.
const INVENTED = [
  '1500', '1,500', '1250', '1,250.00', '984.6', '984.60', '78.4', '78%', '11.2', '8.6', '-4.8', '3,953', '58%',
  '156,250', '156250', '31,250', '10,000', '1 : 3.4', '9.2%', '12.5%', 'BUY', 'ACCUMULATE', 'Hurst', 'Monte Carlo',
  'Kelly', 'stop-loss', 'stopLoss', 'target1', 'Target 1', 'macro expansion', 'support is established',
  'resistance stands', 'institutional accumulation', 'Capex', 'Supercycle', 'Demat', 'FII', 'Quarterly operational',
];
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A figure matches only as a whole number (so '11.2' does not match a close of 1211.25).
const assertNoInvented = (value) => {
  const text = JSON.stringify(value);
  for (const s of INVENTED) {
    const re = /^[\d-]/.test(s) ? new RegExp(`(^|[^\\d.,])${escape(s)}(?!\\d|[.,]\\d)`) : new RegExp(escape(s));
    assert.ok(!re.test(text), `found invented "${s}" in ${text.slice(0, 400)}`);
  }
};
// Fixed label numbers the text may use ("50-day", "52-week", "NIFTY 50", "5% of sessions").
const LABELS = { a: 5, b: 50, c: 52, d: 200 };

function stub(t, obj, key, impl) {
  const original = obj[key];
  obj[key] = impl;
  t.after(() => { obj[key] = original; });
}

// Deterministic saved candles: the benchmark moves r_i a day and the stock exactly 2 × r_i,
// so the stock's beta against it is 2 and the correlation 1.
const START = Date.parse('2024-01-01T00:00:00Z');
function sessions(n) {
  const out = [];
  for (let d = 0; out.length < n; d += 1) {
    const day = new Date(START + d * 86400000);
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) out.push(day.toISOString().slice(0, 10));
  }
  return out;
}
const DATES = sessions(600);
const benchReturn = (i) => 0.01 * Math.sin(i / 3);
function series(base, scale, withVolume) {
  let close = base;
  return DATES.map((date, i) => {
    if (i) close *= 1 + scale * benchReturn(i);
    const c = Math.round(close * 100) / 100;
    return [`${date}T00:00:00+05:30`, c, Math.round(c * 1.01 * 100) / 100, Math.round(c * 0.99 * 100) / 100, c, withVolume ? 100000 + i * 10 : 0, 0];
  });
}
const STOCK = series(500, 2, true);
const NIFTY = series(20000, 1, false);

async function dataDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'pulse-ai-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'candles'), { recursive: true });
  await writeFile(join(dir, 'candles', 'TESTCO.json'), JSON.stringify({ symbol: 'TESTCO', sector: 'IT', benchmark: false, candles: STOCK }));
  await writeFile(join(dir, 'candles', 'NIFTY_50.json'), JSON.stringify({ symbol: 'NIFTY_50', sector: null, benchmark: true, candles: NIFTY }));
  await writeFile(join(dir, 'instrument-names.json'), JSON.stringify({ names: { TESTCO: 'TEST COMPANY LTD' } }));
  return dir;
}

const fallbackQuote = {
  symbol: 'NSE:TESTCO', name: 'TESTCO Limited', ltp: 1250, change: 15.5, changePercent: 1.25, open: 1238, high: 1262, low: 1235,
  previousClose: 1234.5, volume: 8500000, fiftyTwoWeekHigh: 1450, fiftyTwoWeekLow: 980, sector: 'Diversified', source: 'fallback',
};
const lastClose = STOCK[STOCK.length - 1][4];
// A live quote whose volume / 52-week fields are the provider's placeholders (circuit limits, 1,000,000).
const liveQuote = {
  symbol: 'NSE:TESTCO', name: 'TESTCO', ltp: 612.35, change: 4.1, changePercent: 0.67, open: 608, high: 615.9, low: 606.2,
  previousClose: 608.25, volume: 1000000, fiftyTwoWeekHigh: 7777.77, fiftyTwoWeekLow: 4444.44, sector: 'Equity', source: 'live',
};

const overview = {
  status: 'CLOSED', statusMessage: 'Weekend', source: 'end-of-day',
  sources: { indices: 'end-of-day', breadth: 'end-of-day' },
  asOf: { indices: '2026-10-16T10:30:00.000Z', breadth: '2026-10-16T10:30:00.000Z' },
  session: '2026-10-16',
  indices: [{ symbol: 'NIFTY_50', name: 'NIFTY 50', value: 23146.15, change: 148.8, changePercent: 0.65, high: 23149.85, low: 22913.8, previousClose: 22997.35 }],
  breadth: { advancing: 86, declining: 89, unchanged: 0, total: 175 },
};

function service(dir, { quote = fallbackQuote, news = [] } = {}) {
  const calls = [];
  const market = {
    getQuote: async (s) => { calls.push(s); return { ...quote, symbol: s }; },
    getOverview: async () => overview,
    getGainers: async () => [],
    getLosers: async () => [],
  };
  const ai = new AIService({ market, news: { getStockNews: async () => news }, cache: new NodeCache(), dataDir: dir });
  ai.apiKey = '';
  return { ai, calls };
}

// ── Stock insight ───────────────────────────────────────────────────────────

test('a fallback quote gives a neutral "data unavailable" insight with no figures', async (t) => {
  const { ai } = service(await dataDir(t));
  const insight = await ai.generateStockInsight('NSE:TESTCO');
  assertNoInvented(insight);
  assert.equal(insight.available, false);
  assert.equal(insight.sentiment, 'neutral');
  assert.deepEqual(insight.keyFactors, []);
  assert.equal(insight.technicalNote, null);
  assert.equal(insight.catalyst, null);
  assert.ok(!/\d/.test(insight.summary), insight.summary);
  assert.match(insight.summary, /unavailable/);
});

test('a failed quote also gives the neutral insight', async (t) => {
  const dir = await dataDir(t);
  const market = { getQuote: async () => { throw new Error('down'); } };
  const ai = new AIService({ market, news: { getStockNews: async () => [] }, cache: new NodeCache(), dataDir: dir });
  ai.apiKey = '';
  const insight = await ai.generateStockInsight('NSE:TESTCO');
  assert.equal(insight.available, false);
  assert.ok(!/\d/.test(insight.summary + insight.keyFactors.join('')));
});

test('a live quote insight uses only its prices and the saved candles, never placeholders', async (t) => {
  const news = [
    { title: 'Unlinked rumour', publishedAt: new Date().toISOString() },
    { title: 'TESTCO old story', sourceUrl: 'https://example.com/old', publishedAt: '2023-03-15T08:51:12Z' },
    { title: 'TESTCO wins order', sourceUrl: 'https://example.com/a', publishedAt: new Date(Date.now() - 86400000).toISOString() },
  ];
  const { ai } = service(await dataDir(t), { quote: liveQuote, news });
  const insight = await ai.generateStockInsight('NSE:TESTCO');
  assertNoInvented(insight);
  assert.equal(insight.available, true);

  const text = JSON.stringify({ s: insight.summary, k: insight.keyFactors, n: insight.technicalNote });
  for (const placeholder of ['7,777.77', '4,444.44', '1,000,000', 'Equity', 'support', 'resistance']) {
    assert.ok(!text.includes(placeholder), `found "${placeholder}"`);
  }
  const study = candleStudy(STOCK.map((c) => ({ date: c[0].slice(0, 10), open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] })), { years: 1 });
  assert.ok(numbersGrounded(text, { liveQuote, study, fromHigh: Math.abs((liveQuote.ltp - study.fiftyTwoWeek.high) / study.fiftyTwoWeek.high * 100), LABELS }), text);
  assert.match(insight.summary, /612\.35/);
  assert.ok(insight.keyFactors.some((f) => f.includes(Math.max(...STOCK.slice(-260).map((c) => c[2])).toLocaleString('en-IN', { minimumFractionDigits: 2 }))));
  assert.equal(insight.catalyst, 'TESTCO wins order');
  assert.equal(insight.sources.news.url, 'https://example.com/a');
});

test('a live quote with no saved history shows only the quote figures', async (t) => {
  const { ai } = service(await dataDir(t), { quote: liveQuote });
  const insight = await ai.generateStockInsight('NSE:NOFILE');
  assert.equal(insight.available, true);
  assert.deepEqual(insight.keyFactors, []);
  assert.equal(insight.technicalNote, null);
  assert.ok(numbersGrounded(insight.summary, liveQuote), insight.summary);
});

test('a Gemini stock insight citing figures outside the data is discarded', async (t) => {
  stub(t, axios, 'post', async () => ({
    data: { candidates: [{ content: { parts: [{ text: JSON.stringify({
      summary: 'TESTCO trades at ₹612.35 with support at ₹600.12.', keyFactors: ['Benefits from macro expansion'], technicalNote: 'Resistance at ₹627.66.',
    }) }] } }] },
  }));
  const { ai } = service(await dataDir(t), { quote: liveQuote });
  ai.apiKey = 'test-key';
  const insight = await ai.generateStockInsight('NSE:TESTCO');
  assert.ok(!JSON.stringify(insight).includes('600.12'));
  assert.ok(!JSON.stringify(insight).includes('627.66'));
});

test('a Gemini stock insight never runs for a fallback quote', async (t) => {
  let called = false;
  stub(t, axios, 'post', async () => { called = true; return { data: {} }; });
  const { ai } = service(await dataDir(t));
  ai.apiKey = 'test-key';
  const insight = await ai.generateStockInsight('NSE:TESTCO');
  assert.equal(called, false);
  assert.equal(insight.available, false);
});

// ── Historical study (quant lab) ────────────────────────────────────────────

test('the historical study computes every figure from the saved candles', async (t) => {
  const { ai } = service(await dataDir(t));
  const study = await ai.runAgenticAnalysis({ symbol: 'NSE:TESTCO', strategy: '5yr-trend-alpha', timeframe: '5Y' });
  assertNoInvented(study);
  assert.equal(study.available, true);
  assert.equal(study.name, 'TEST COMPANY LTD');
  assert.equal(study.source, 'end-of-day');
  assert.equal(study.asOf, DATES[DATES.length - 1]);
  assert.equal(study.basis.sessions, STOCK.length);
  assert.ok(!('directive' in study) && !('executiveDossier' in study));

  const m = study.metrics;
  const closes = STOCK.map((c) => c[4]);
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.equal(m.lastClose, lastClose);
  assert.equal(m.sma50, Math.round(mean(closes.slice(-50)) * 100) / 100);
  assert.equal(m.sma200, Math.round(mean(closes.slice(-200)) * 100) / 100);
  const year = STOCK.filter((c) => c[0].slice(0, 10) > new Date(Date.parse(`${study.asOf}T00:00:00Z`) - 365.25 * 86400000).toISOString().slice(0, 10));
  assert.equal(m.fiftyTwoWeek.high, Math.max(...year.map((c) => c[2])));
  assert.equal(m.fiftyTwoWeek.low, Math.min(...year.map((c) => c[3])));
  const years = (Date.parse(study.asOf) - Date.parse(DATES[0])) / (365.25 * 86400000);
  assert.equal(m.cagrPct, Math.round(((lastClose / closes[0]) ** (1 / years) - 1) * 10000) / 100);
  assert.ok(Math.abs(m.betaVsNifty - 2) < 0.02, `beta ${m.betaVsNifty}`);
  assert.ok(m.correlationVsNifty > 0.99);

  const trace = study.reasoningTrace.map((s) => s.observation).join(' ');
  assert.ok(numbersGrounded(trace, { metrics: m, LABELS }), trace);
});

test('the study has no figures for a symbol without saved candles', async (t) => {
  const { ai } = service(await dataDir(t));
  for (const symbol of ['NSE:TATAMOTORS', undefined, '../etc/passwd']) {
    const study = await ai.runAgenticAnalysis({ symbol });
    assertNoInvented(study);
    assert.equal(study.available, false);
    assert.ok(!('metrics' in study));
    assert.ok(!/\d/.test(study.message), study.message);
  }
});

test('an index study is in points, not rupees, and has no beta against itself', async (t) => {
  const { ai } = service(await dataDir(t));
  const study = await ai.runAgenticAnalysis({ symbol: 'NSE:NIFTY' });
  assert.equal(study.symbol, 'NIFTY_50');
  assert.equal(study.metrics.betaVsNifty, null);
  assert.ok(!JSON.stringify(study.reasoningTrace).includes('₹'));
});

const realCandles = resolve('data/pulse/candles/RELIANCE.json');
test('the study of a real saved file states no invented figures', { skip: !existsSync(realCandles) && 'no saved candles in this checkout' }, async () => {
  const ai = new AIService({ cache: new NodeCache(), dataDir: resolve('data/pulse') });
  const study = await ai.runAgenticAnalysis({ symbol: 'NSE:RELIANCE' });
  assertNoInvented(study);
  assert.equal(study.available, true);
  assert.ok(numbersGrounded(study.reasoningTrace.map((s) => s.observation).join(' '), { metrics: study.metrics, LABELS }));
});

// ── Chat ────────────────────────────────────────────────────────────────────

test('index questions get the market brief, never a quote for NSE:NIFTY', async (t) => {
  const { ai, calls } = service(await dataDir(t));
  for (const message of ['How is NIFTY doing?', 'what about sensex', 'Nifty 50 levels']) {
    assert.equal(ai._detectSymbol(message), null);
    const { reply, symbol } = await ai.chatResponse({ message });
    assert.equal(symbol, null);
    assertNoInvented(reply);
    assert.match(reply, /23,146\.15/);
  }
  const { reply } = await ai.chatResponse({ message: 'Tell me more', symbol: 'NSE:NIFTY' });
  assert.match(reply, /23,146\.15/);
  assert.ok(!reply.includes('1,250') && !reply.includes('1250'));
  assert.deepEqual(calls, []);
});

test('a stock question with a fallback quote shows no figures', async (t) => {
  const { ai } = service(await dataDir(t));
  const { reply, symbol } = await ai.chatResponse({ message: 'Analyze RELIANCE' });
  assert.equal(symbol, 'NSE:RELIANCE');
  assertNoInvented(reply);
  assert.ok(!/\d/.test(reply), reply);
});

test('ticker detection matches whole words only', () => {
  const ai = new AIService({ cache: new NodeCache() });
  assert.equal(ai._detectSymbol('Show me the results'), null);
  assert.equal(ai._detectSymbol('switch to dark mode'), null);
  assert.equal(ai._detectSymbol('How did L&T and LT do?'), 'NSE:LT');
  assert.equal(ai._detectSymbol('infy vs tcs'), 'NSE:TCS');
});

test('a Gemini chat reply citing figures outside the data is replaced', async (t) => {
  stub(t, axios, 'post', async () => ({
    data: { candidates: [{ content: { parts: [{ text: 'NIFTY is at 25,418 with FIIs buying ₹3,953 Cr.' }] } }] },
  }));
  const { ai } = service(await dataDir(t));
  ai.apiKey = 'test-key';
  const { reply } = await ai.chatResponse({ message: 'How is the market?' });
  assert.ok(!reply.includes('25,418') && !reply.includes('3,953'));
  assert.match(reply, /23,146\.15/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import axios from 'axios';
import { UpstoxProvider, SOURCE_LIVE } from '../server/providers/UpstoxProvider.js';
import { SOURCE_EOD } from '../server/providers/marketSnapshot.js';
import { MarketDataService } from '../server/services/marketDataService.js';
import { InstrumentDirectory } from '../server/providers/instrumentDirectory.js';

const INDEX_KEYS = ['NSE_INDEX|Nifty 50', 'BSE_INDEX|SENSEX', 'NSE_INDEX|Nifty Bank', 'NSE_INDEX|India VIX'];

function liveIndexPayload() {
  return Object.fromEntries(INDEX_KEYS.map((key, i) => [key, {
    last_price: 1000 + i, net_change: 5, ohlc: { open: 990, high: 1010, low: 985, close: 995 + i },
  }]));
}

// A provider reading an isolated data folder, so the developer's saved candles never leak in.
async function provider(t, { live, candles = {} }) {
  const dir = await mkdtemp(path.join(tmpdir(), 'polaris-quote-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'candles'), { recursive: true });
  for (const [symbol, rows] of Object.entries(candles)) {
    await writeFile(path.join(dir, 'candles', `${symbol}.json`), JSON.stringify({ candles: rows }));
  }
  const p = new UpstoxProvider();
  p.isLive = live;
  p.token = live ? 'test-token' : undefined;
  p.dataDir = dir;
  p.universe = { stocks: [], sectorIndices: [], headline: [] };
  p.names = {};
  p.directory = new InstrumentDirectory(dir, { fetcher: async () => { throw new Error('no network in tests'); } });
  p.directory.fetchedAt = new Date().toISOString();
  return p;
}

const RELIANCE_CANDLES = [
  ['2026-10-16T00:00:00+05:30', 1190, 1205, 1185, 1200, 1000],
  ['2026-10-19T00:00:00+05:30', 1201, 1215, 1198, 1210.5, 2000],
];

// The provider calls axios.get directly; swap it per test so nothing reaches the network.
function stubAxios(t, impl) {
  const original = axios.get;
  axios.get = impl;
  t.after(() => { axios.get = original; });
}

test('without a live quote a stock shows its last saved close, labelled end-of-day', async t => {
  stubAxios(t, async () => { throw new Error('network must not be called without a token'); });
  const p = await provider(t, { live: false, candles: { RELIANCE: RELIANCE_CANDLES } });
  const quote = await p.getQuote('NSE:RELIANCE');
  assert.equal(quote.source, SOURCE_EOD);
  assert.equal(quote.ltp, 1210.5);
  assert.equal(quote.previousClose, 1200);
  assert.equal(quote.asOf, '2026-10-19');
});

test('an unknown symbol is not found and an uncollected one is unavailable, never a built-in price', async t => {
  stubAxios(t, async () => { throw new Error('ETIMEDOUT'); });
  const p = await provider(t, { live: true });
  await assert.rejects(p.getQuote('NOTASTOCK'), err => err.statusCode === 404);
  await assert.rejects(p.getQuote('../../secrets'), err => err.statusCode === 404);
  await assert.rejects(p.getQuote('RELIANCE'), err => err.statusCode === 503); // known instrument, no saved candles
  assert.deepEqual(await p.getIndices(), []);
});

test('a successful Upstox response is marked live', async t => {
  stubAxios(t, async (url, { params }) => {
    if (params.instrument_key.includes(',')) return { data: { data: liveIndexPayload() } };
    return { data: { data: { [params.instrument_key]: { symbol: 'RELIANCE', last_price: 1411.2, net_change: 12.3, volume: 5, ohlc: { open: 1400, high: 1415, low: 1398, close: 1398.9 } } } } };
  });
  const p = await provider(t, { live: true });
  p.names = { RELIANCE: 'RELIANCE INDUSTRIES LTD' };

  const indices = await p.getIndices();
  assert.deepEqual(indices.map(i => i.symbol), ['NIFTY_50', 'SENSEX', 'BANK_NIFTY', 'INDIA_VIX']);
  for (const idx of indices) assert.equal(idx.source, SOURCE_LIVE);

  const quote = await p.getQuote('RELIANCE');
  assert.equal(quote.source, SOURCE_LIVE);
  assert.equal(quote.ltp, 1411.2);
  assert.equal(quote.name, 'RELIANCE INDUSTRIES LTD');
});

test('a failed or empty Upstox response falls back to the saved close and says so', async t => {
  let mode = 'throw';
  stubAxios(t, async () => {
    if (mode === 'throw') throw new Error('ETIMEDOUT');
    return { data: { data: {} } };
  });
  const p = await provider(t, { live: true, candles: { RELIANCE: RELIANCE_CANDLES } });
  for (mode of ['throw', 'empty']) {
    const quote = await p.getQuote('RELIANCE');
    assert.equal(quote.source, SOURCE_EOD, mode);
    assert.equal(quote.ltp, 1210.5, mode);
  }
});

test('the service keeps the source marker', async t => {
  stubAxios(t, async () => { throw new Error('unused'); });
  const service = new MarketDataService(await provider(t, { live: false, candles: { INFY: RELIANCE_CANDLES } }));
  assert.equal((await service.getQuote('INFY')).source, SOURCE_EOD);
});

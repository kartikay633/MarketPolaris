import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { UpstoxProvider, SOURCE_LIVE, SOURCE_FALLBACK } from '../server/providers/UpstoxProvider.js';
import { MarketDataService } from '../server/services/marketDataService.js';

const INDEX_KEYS = ['NSE_INDEX|Nifty 50', 'BSE_INDEX|SENSEX', 'NSE_INDEX|Nifty Bank', 'NSE_INDEX|India VIX'];

function liveIndexPayload() {
  return Object.fromEntries(INDEX_KEYS.map((key, i) => [key, {
    last_price: 1000 + i, net_change: 5, ohlc: { open: 990, high: 1010, low: 985, close: 995 + i },
  }]));
}

function provider({ live }) {
  const p = new UpstoxProvider();
  p.isLive = live;
  p.token = live ? 'test-token' : undefined;
  return p;
}

// The provider calls axios.get directly; swap it per test so nothing reaches the network.
function stubAxios(t, impl) {
  const original = axios.get;
  axios.get = impl;
  t.after(() => { axios.get = original; });
}

// The overview, movers and screener never serve built-in values; tests/market-snapshot.test.js
// covers them. This file covers the standalone index and single-quote paths.
test('without an Upstox token every index and quote is marked fallback', async t => {
  stubAxios(t, async () => { throw new Error('network must not be called without a token'); });
  const p = provider({ live: false });

  const indices = await p.getIndices();
  assert.ok(indices.length > 0);
  for (const idx of indices) assert.equal(idx.source, SOURCE_FALLBACK);

  for (const sym of ['RELIANCE', 'NSE:TCS', 'UNKNOWNCO']) {
    assert.equal((await p.getQuote(sym)).source, SOURCE_FALLBACK, sym);
  }
});

test('a successful Upstox response is marked live', async t => {
  stubAxios(t, async (url, { params }) => {
    if (params.instrument_key.includes(',')) return { data: { data: liveIndexPayload() } };
    return { data: { data: { [params.instrument_key]: { symbol: 'RELIANCE', last_price: 1411.2, net_change: 12.3, volume: 5, ohlc: { open: 1400, high: 1415, low: 1398, close: 1398.9 } } } } };
  });
  const p = provider({ live: true });

  const indices = await p.getIndices();
  assert.deepEqual(indices.map(i => i.symbol), ['NIFTY_50', 'SENSEX', 'BANK_NIFTY', 'INDIA_VIX']);
  for (const idx of indices) assert.equal(idx.source, SOURCE_LIVE);

  const quote = await p.getQuote('RELIANCE');
  assert.equal(quote.source, SOURCE_LIVE);
  assert.equal(quote.ltp, 1411.2);
});

test('a failed or empty Upstox response falls back and says so', async t => {
  let mode = 'throw';
  stubAxios(t, async () => {
    if (mode === 'throw') throw new Error('ETIMEDOUT');
    return { data: { data: {} } };
  });
  const p = provider({ live: true });

  for (mode of ['throw', 'empty']) {
    const indices = await p.getIndices();
    for (const idx of indices) assert.equal(idx.source, SOURCE_FALLBACK, mode);
    const quote = await p.getQuote('RELIANCE');
    assert.equal(quote.source, SOURCE_FALLBACK, mode);
    assert.equal(quote.ltp, 2980.5, 'built-in value is still served, only labelled');
  }
});

test('the service keeps the source marker', async t => {
  stubAxios(t, async () => { throw new Error('unused'); });
  const service = new MarketDataService(provider({ live: false }));
  assert.equal((await service.getQuote('INFY')).source, SOURCE_FALLBACK);
  for (const idx of await service.getIndices()) assert.equal(idx.source, SOURCE_FALLBACK);
});

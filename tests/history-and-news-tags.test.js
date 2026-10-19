import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { UpstoxProvider } from '../server/providers/UpstoxProvider.js';
import { MarketauxProvider } from '../server/providers/MarketauxProvider.js';

function stubAxios(t, impl) {
  const original = axios.get;
  axios.get = impl;
  t.after(() => { axios.get = original; });
}
const live = () => { const p = new UpstoxProvider(); p.isLive = true; p.token = 'test-token'; return p; };
const candle = (ts, close) => [ts, close, close + 1, close - 1, close, 100, 0];

test('1D history uses the intraday endpoint for today, in time order', async t => {
  const urls = [];
  stubAxios(t, async url => {
    urls.push(url);
    if (url.includes('/intraday/')) return { data: { data: { candles: [candle('2026-10-19T09:16:00+05:30', 101), candle('2026-10-19T09:15:00+05:30', 100)] } } };
    return { data: { data: { candles: [] } } };
  });
  const candles = await live().getHistoricalCandles('NIFTY_50', '1D');
  assert.ok(urls[0].includes('/historical-candle/intraday/'));
  assert.equal(candles.length, 2);
  assert.ok(candles[0].time < candles[1].time);
  assert.equal(candles[1].close, 101);
});

test('1D history falls back to the last completed session before the open', async t => {
  stubAxios(t, async url => ({ data: { data: { candles: url.includes('/intraday/') ? [] : [candle('2026-10-16T15:29:00+05:30', 99), candle('2026-10-16T15:28:00+05:30', 98)] } } }));
  const candles = await live().getHistoricalCandles('NIFTY_50', '1D');
  assert.equal(candles.length, 2);
  assert.equal(candles.at(-1).close, 99);
});

test('stock news asks for the exact NSE/BSE listing, not a text search', async t => {
  let params;
  stubAxios(t, async (_url, options) => { params = options.params; return { data: { data: [] } }; });
  const p = new MarketauxProvider();
  p.isLive = true;
  await p.getStockNews('NSE:RELIANCE');
  assert.equal(params.symbols, 'RELIANCE.NS,RELIANCE.BO');
  assert.equal(params.search, undefined);
});

test('news tags keep only Indian listings the article is clearly about', () => {
  const p = new MarketauxProvider();
  const article = p._normalizeArticle({
    uuid: 'x', title: 'PSU banks rally', url: 'https://example.com/a', published_at: '2026-10-19T06:00:00Z',
    entities: [
      { symbol: 'HDB.BA', match_score: 30, sentiment_score: .5 },
      { symbol: 'SBIN.BO', match_score: 23, sentiment_score: .4 },
      { symbol: 'PNB.NS', match_score: 25, sentiment_score: .6 },
      { symbol: 'PNB.BO', match_score: 25, sentiment_score: .6 },
      { symbol: 'INDIANB.BO', match_score: 16, sentiment_score: .2 },
    ],
  });
  assert.deepEqual(article.relatedSymbols, ['NSE:PNB', 'NSE:SBIN']);
  assert.equal(article.sentiment, 'positive');
});

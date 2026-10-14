import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCandles, mergeCandles, completedDate, candleUrl } from '../server/research/marketData.js';

const candle = ['2026-10-12T00:00:00+05:30', 100, 110, 90, 105, 1000, 0];
test('daily candles require finite prices, valid OHLC and completed dates', () => {
  assert.equal(validateCandles([candle], '2026-10-12').length, 1);
  assert.throws(() => validateCandles([[...candle.slice(0, 4), 120, 1000, 0]], '2026-10-12'));
  assert.throws(() => validateCandles([candle], '2026-10-11'));
  assert.throws(() => validateCandles([[candle[0], 100, NaN, 90, 105, 10]], '2026-10-12'));
});
test('merging overlapping downloads is idempotent and sorted', () => {
  assert.deepEqual(mergeCandles([candle], [candle]), [candle]);
  const revision = [...candle]; revision[4] = 106;
  assert.deepEqual(mergeCandles([candle], [revision]), [revision]);
});
test('exclude current Indian session conservatively, including pre-open', () => {
  assert.equal(completedDate(new Date('2026-10-13T01:00:00Z')), '2026-10-12');
});
test('V3 URL preserves BSE instrument identity and daily interval', () => {
  assert.equal(candleUrl('BSE_EQ|INE002A01018', '2021-10-13', '2026-10-12'), 'https://api.upstox.com/v3/historical-candle/BSE_EQ%7CINE002A01018/days/1/2026-10-12/2021-10-13');
});

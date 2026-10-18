// A live Upstox quote carries only what Upstox or the saved daily candles actually say:
// the 52-week range comes from the candles (never the circuit band), the sector from the
// research universe or the candle file, and volume, average volume and industry are null
// when nothing supplies them (never a placeholder).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import axios from 'axios';
import { UpstoxProvider, SOURCE_LIVE } from '../server/providers/UpstoxProvider.js';

const UPPER_CIRCUIT = 1332.3;
const LOWER_CIRCUIT = 1090.1;

// Upstox's market-quote shape, with circuit limits and no volume.
const upstoxQuote = (extra = {}) => ({
  symbol: 'RELIANCE', last_price: 1211.2, net_change: -6.4,
  ohlc: { open: 1215, high: 1215.4, low: 1193, close: 1217.6 },
  upper_circuit_limit: UPPER_CIRCUIT, lower_circuit_limit: LOWER_CIRCUIT,
  average_price: 1204.5, ...extra,
});

// Daily candles from 2025-06-01 to 2026-10-16: an all-time extreme more than a year back that the
// 52-week range must skip, then a year whose high is 1611.8 and low 1152.2.
function candles() {
  const rows = [];
  const start = Date.UTC(2025, 5, 1);
  const end = Date.UTC(2026, 9, 16);
  for (let t = start; t <= end; t += 86400000) {
    const date = new Date(t).toISOString().slice(0, 10);
    rows.push([`${date}T00:00:00+05:30`, 1300, 1310, 1290, 1300, 1000000, 0]);
  }
  rows[10] = [rows[10][0], 1300, 1900, 900, 1300, 1000000, 0];
  rows[rows.length - 100][2] = 1611.8;
  rows[rows.length - 50][3] = 1152.2;
  return rows;
}

async function setup(t, { sector = 'ENERGY', universeSector, withCandles = true } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pulse-quote-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  if (withCandles) {
    await mkdir(path.join(dir, 'candles'));
    await writeFile(path.join(dir, 'candles', 'RELIANCE.json'), JSON.stringify({ symbol: 'RELIANCE', sector, candles: candles() }));
  }
  const p = new UpstoxProvider();
  p.isLive = true;
  p.token = 'test-token';
  p.dataDir = dir;
  p.universe = {
    stocks: universeSector ? [{ symbol: 'RELIANCE', instrumentKey: 'NSE_EQ|INE002A01018', sector: universeSector }] : [],
    sectorIndices: [],
    headline: [],
  };
  return p;
}

function stubQuote(t, q) {
  const original = axios.get;
  axios.get = async (url, { params }) => ({ data: { data: { [params.instrument_key]: q } } });
  t.after(() => { axios.get = original; });
}

test('a live quote takes its 52-week range from the saved candles, never the circuit band', async t => {
  const p = await setup(t);
  stubQuote(t, upstoxQuote({ volume: 17225283 }));
  const quote = await p.getQuote('NSE:RELIANCE');

  assert.equal(quote.source, SOURCE_LIVE);
  assert.equal(quote.fiftyTwoWeekHigh, 1611.8);
  assert.equal(quote.fiftyTwoWeekLow, 1152.2);
  assert.notEqual(quote.fiftyTwoWeekHigh, UPPER_CIRCUIT);
  assert.notEqual(quote.fiftyTwoWeekLow, LOWER_CIRCUIT);
  assert.equal(quote.volume, 17225283);
  assert.equal(quote.previousClose, 1217.6);
  assert.equal(quote.sector, 'Energy & power');
});

test("today's range extends the saved 52-week range", async t => {
  const p = await setup(t);
  stubQuote(t, upstoxQuote({ last_price: 1650, net_change: 20, ohlc: { open: 1630, high: 1660, low: 1100, close: 1630 } }));
  const quote = await p.getQuote('RELIANCE');
  assert.equal(quote.fiftyTwoWeekHigh, 1660);
  assert.equal(quote.fiftyTwoWeekLow, 1100);
});

test('the research universe names the sector before the candle file', async t => {
  const p = await setup(t, { sector: 'ENERGY', universeSector: 'IT' });
  stubQuote(t, upstoxQuote());
  assert.equal((await p.getQuote('RELIANCE')).sector, 'IT');
});

test('fields with no source are null, not placeholders', async t => {
  const p = await setup(t, { withCandles: false });
  stubQuote(t, upstoxQuote({ ohlc: undefined }));
  const quote = await p.getQuote('RELIANCE');

  assert.equal(quote.source, SOURCE_LIVE);
  assert.equal(quote.ltp, 1211.2);
  for (const field of ['fiftyTwoWeekHigh', 'fiftyTwoWeekLow', 'volume', 'averageVolume', 'sector', 'industry', 'open', 'high', 'low']) {
    assert.equal(quote[field], null, field);
  }
  assert.ok(!['Equity', 'Equities'].includes(quote.sector));
  assert.ok(!['Equity', 'Equities'].includes(quote.industry));
});

test('a live quote never carries placeholder volume or average volume', async t => {
  const p = await setup(t);
  stubQuote(t, upstoxQuote({ volume: 0 }));
  const quote = await p.getQuote('RELIANCE');
  assert.equal(quote.volume, 0);
  assert.equal(quote.averageVolume, null);
  assert.equal(quote.industry, null);
});

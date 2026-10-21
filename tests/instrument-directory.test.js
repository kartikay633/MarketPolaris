import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { InstrumentDirectory, equitiesFrom } from '../server/providers/instrumentDirectory.js';

const row = (symbol, name, type = 'EQ', extra = {}) => ({ segment: 'NSE_EQ', instrument_type: type, trading_symbol: symbol, name,
  instrument_key: `NSE_EQ|IN${symbol}`, isin: `IN${symbol}`, ...extra });
const LIST = [
  row('RELIANCE', 'RELIANCE INDUSTRIES LTD', 'EQ', { short_name: 'Reliance Industries' }),
  row('ETERNAL', 'ETERNAL LIMITED', 'EQ', { short_name: 'Zomato' }),
  row('SICALLOG', 'SICAL LOGISTICS LIMITED', 'BE'),
  row('NIFTYBEES', 'NIP IND ETF NIFTY BEES'),
  row('SMECO', 'SOME SME LTD', 'SM'),
  { segment: 'NSE_FO', instrument_type: 'FUT', trading_symbol: 'RELIANCE FUT', instrument_key: 'NSE_FO|1' },
  ...Array.from({ length: 1000 }, (_, i) => row(`FILL${i}`, `FILLER ${i} LTD`)),
];

test('only NSE main-board equities (EQ and BE series) enter the directory', () => {
  const eq = equitiesFrom(LIST);
  assert.ok(eq.RELIANCE && eq.SICALLOG && eq.NIFTYBEES);
  assert.equal(eq.SMECO, undefined, 'SME listings are left out');
  assert.equal(eq['RELIANCE FUT'], undefined, 'derivatives are left out');
  assert.equal(eq.ETERNAL.name, 'ETERNAL LIMITED', 'the official name, not a stale short name');
});

test('search ranks exact and prefix symbol matches first, covered stocks ahead, and is saved for restarts', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'polaris-dir-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const d = new InstrumentDirectory(dir, { fetcher: async () => ({ data: gzipSync(JSON.stringify(LIST)) }) });
  await d.refresh();
  assert.equal(d.size, 1004);
  assert.equal(d.search('reliance')[0].symbol, 'NSE:RELIANCE');
  assert.equal(d.search('zomato')[0].symbol, 'NSE:ETERNAL', 'the former name still finds the stock');
  assert.equal(d.search('nifty bees')[0].symbol, 'NSE:NIFTYBEES');
  assert.equal(d.search('reliance', { covered: new Set(['RELIANCE']) })[0].covered, true);
  assert.deepEqual(d.search(''), []);
  assert.equal(d.get('NSE:SICALLOG').series, 'BE');

  const saved = JSON.parse(await readFile(path.join(dir, 'nse-equities.json'), 'utf8'));
  assert.equal(Object.keys(saved.equities).length, 1004);
  const reopened = new InstrumentDirectory(dir, { fetcher: async () => { throw new Error('no network'); } });
  assert.equal(reopened.get('RELIANCE').key, 'NSE_EQ|INRELIANCE');
});

test('a failed or truncated download keeps the saved list', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'polaris-dir-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const d = new InstrumentDirectory(dir, { fetcher: async () => ({ data: gzipSync(JSON.stringify(LIST.slice(0, 3))) }) });
  await d.refresh();
  assert.equal(d.size, 0);
});

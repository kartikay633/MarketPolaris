// Wide-universe study, amendment 1 (ml/WIDE_PROTOCOL.md): extends data/pulse-wide to twenty years
// of Upstox daily candles (the decade before the existing one, one request per instrument), and
// re-fetches instruments the first collection rejected. Rows failing basic OHLC checks are dropped
// one by one (ml.pulse.load_candles validates them again) instead of rejecting the whole stock.
// Run: node scripts/pulse-wide-history.js
import 'dotenv/config';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { atomicJson, readJson, candleUrl, mergeCandles } from '../server/research/marketData.js';

const DIR = path.resolve('data/pulse-wide');
const EARLIEST = '2006-10-22';
const token = process.env.UPSTOX_ANALYTICS_TOKEN || process.env.UPSTOX_ACCESS_TOKEN;
if (!token) throw new Error('Configure server-side UPSTOX_ANALYTICS_TOKEN');

async function get(url) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(45000) });
      if (res.ok) return res.json();
      if (res.status !== 429 && res.status < 500) throw new Error(`Upstox HTTP ${res.status}`);
    } catch (err) {
      if (attempt === 4 || /HTTP 4\d\d/.test(err.message)) throw err;
    }
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
  }
  throw new Error('Upstox request failed');
}

const valid = (c) => Array.isArray(c) && /^\d{4}-\d{2}-\d{2}/.test(String(c[0]))
  && [1, 2, 3, 4].every((i) => Number(c[i]) > 0) && Number(c[5]) >= 0
  && Number(c[2]) >= Math.max(Number(c[1]), Number(c[4]), Number(c[3])) && Number(c[3]) <= Math.min(Number(c[1]), Number(c[4]), Number(c[2]));

async function candles(key, from, to) {
  const body = await get(candleUrl(key, from, to));
  if (body.status !== 'success') throw new Error('Provider did not confirm success');
  const rows = (body.data?.candles || []).filter(valid);
  return { rows, dropped: (body.data?.candles || []).length - rows.length };
}

const manifest = await readJson(path.join(DIR, 'collection.json'));
const report = { startedAt: new Date().toISOString(), earliest: EARLIEST, instruments: [] };
for (const inst of manifest.instruments) {
  const file = path.join(DIR, 'candles', `${inst.symbol}.json`);
  try {
    const previous = await readJson(file);
    const firstDate = previous?.candles?.[0]?.[0]?.slice(0, 10);
    let incoming = [], dropped = 0;
    // The decade before the stored history (or both decades when nothing was stored).
    const end = firstDate ? new Date(Date.parse(`${firstDate}T00:00:00Z`) - 86400000).toISOString().slice(0, 10) : manifest.requestedTo;
    const ranges = firstDate ? [[EARLIEST, end]] : [[manifest.requestedFrom, manifest.requestedTo], [EARLIEST, new Date(Date.parse(`${manifest.requestedFrom}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)]];
    for (const [from, to] of ranges) {
      if (from > to) continue;
      const got = await candles(inst.instrumentKey, from, to);
      incoming.push(...got.rows);
      dropped += got.dropped;
      await new Promise((r) => setTimeout(r, 250));
    }
    const merged = mergeCandles(previous?.candles || [], incoming).filter((row) => row[0].slice(0, 10) >= EARLIEST);
    if (!merged.length) throw new Error('No candles');
    const { status, error, rows: _r, firstDate: _f, lastDate: _l, hash: _h, ...meta } = inst;
    const hash = createHash('sha256').update(JSON.stringify(merged)).digest('hex');
    await atomicJson(file, { ...meta, ...(previous ? { symbol: previous.symbol, instrumentKey: previous.instrumentKey, isin: previous.isin, exchange: previous.exchange, benchmark: previous.benchmark, sector: previous.sector } : {}),
      source: 'upstox-v3', fetchedAt: new Date().toISOString(), hash, candles: merged });
    report.instruments.push({ symbol: inst.symbol, rows: merged.length, firstDate: merged[0][0].slice(0, 10), added: incoming.length, droppedInvalid: dropped });
    console.log(`${inst.symbol}: ${merged.length} candles from ${merged[0][0].slice(0, 10)} (+${incoming.length}, dropped ${dropped})`);
  } catch (err) {
    report.instruments.push({ symbol: inst.symbol, error: err.message });
    console.log(`${inst.symbol}: ${err.message}`);
  }
  await atomicJson(path.join(DIR, 'history-extension.json'), report);
}
report.finishedAt = new Date().toISOString();
await atomicJson(path.join(DIR, 'history-extension.json'), report);
console.log(JSON.stringify({ instruments: report.instruments.length, errors: report.instruments.filter((x) => x.error).length }));

// Wide-universe research data (ml/WIDE_PROTOCOL.md): Upstox daily candles for the 755 NIFTY Total
// Market stocks of 21 October 2026, in data/pulse-wide, apart from v4's data.
// Run: node scripts/pulse-wide.js collect    (first collection, ten years; resumable)
//      node scripts/pulse-wide.js update     (nightly for the v5 shadow account: recent sessions only)
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { atomicJson, candleUrl, closedSessionDate, collectMarketData, completedDate, mergeCandles, readJson, request, sameDayCandleUrl, validateCandles } from '../server/research/marketData.js';

const DATA_DIR = path.resolve('data/pulse-wide');
const EARLIEST = '2006-10-22';
const OVERLAP_DAYS = 30;
const READJUSTED = .005; // a stored close differing from the provider's by more than this means history was re-adjusted
const LIST = path.join(DATA_DIR, 'universe-niftytotalmarket-2026-10-21.csv');
const SHA256 = 'b5e615e961ba861c38e191f0341dd1e352a92ea9cf9e3cfebb9de621cc323134';

// The saved list, verified against the hash fixed in the protocol: { symbols, sectorOf }.
export function wideUniverse(file = LIST) {
  const text = readFileSync(file, 'utf8');
  const hash = createHash('sha256').update(text).digest('hex');
  if (hash !== SHA256) throw new Error(`Universe file does not match the pre-registered list (sha256 ${hash})`);
  const rows = text.trim().split(/\r?\n/).slice(1).map((line) => line.split(','));
  const symbols = rows.map((r) => r[2].trim()).filter((s) => /^[A-Z0-9&-]{1,24}$/.test(s));
  return { symbols, sectorOf: Object.fromEntries(rows.map((r) => [r[2].trim(), r[1].trim()])) };
}

const plausible = (c) => Array.isArray(c) && /^\d{4}-\d{2}-\d{2}T/.test(String(c[0])) && [1, 2, 3, 4].every((i) => Number(c[i]) > 0) && Number(c[5]) >= 0
  && Number(c[2]) >= Math.max(Number(c[1]), Number(c[4]), Number(c[3])) && Number(c[3]) <= Math.min(Number(c[1]), Number(c[4]), Number(c[2]));

// Both decades again, when Upstox has re-adjusted a stock's history (a split or bonus since the last run).
// Single invalid rows are dropped, as in scripts/pulse-wide-history.js; ml.pulse validates again.
async function fullHistory(key, to, token) {
  const rows = [];
  const ranges = [];
  for (let from = EARLIEST; from <= to;) {
    // Upstox serves at most a decade per request.
    const end = new Date(Date.parse(`${Number(from.slice(0, 4)) + 10}${from.slice(4)}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    ranges.push([from, end < to ? end : to]);
    from = new Date(Date.parse(`${end}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  }
  for (const [from, end] of ranges) {
    const body = await request(candleUrl(key, from, end), token);
    if (body.status !== 'success') throw new Error('Provider did not confirm success');
    rows.push(...(body.data?.candles || []).filter(plausible));
    await new Promise((r) => setTimeout(r, 250));
  }
  return mergeCandles([], rows);
}

// Nightly: the last 30 days for every stored instrument, merged into the full history (nothing older is
// dropped and no snapshot is kept). If the overlap disagrees with what is stored, the provider has
// re-adjusted the stock's history, so the whole twenty years are fetched again.
export async function updateWide(dataDir = DATA_DIR) {
  const token = process.env.UPSTOX_ANALYTICS_TOKEN || process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) throw new Error('Configure server-side UPSTOX_ANALYTICS_TOKEN');
  const to = completedDate(), today = closedSessionDate();
  const report = { startedAt: new Date().toISOString(), requestedTo: today || to, updated: 0, readjusted: [], errors: [] };
  const files = (await readdir(path.join(dataDir, 'candles'))).filter((f) => f.endsWith('.json')).sort();
  for (const name of files) {
    const file = path.join(dataDir, 'candles', name);
    const previous = await readJson(file);
    try {
      const last = previous.candles.at(-1)[0].slice(0, 10);
      const start = new Date(Date.parse(`${last}T00:00:00Z`) - OVERLAP_DAYS * 86400000).toISOString().slice(0, 10);
      const body = await request(candleUrl(previous.instrumentKey, start, to), token);
      if (body.status !== 'success') throw new Error('Provider did not confirm success');
      const incoming = (body.data?.candles || []).filter((c) => plausible(c) && c[0].slice(0, 10) >= start && c[0].slice(0, 10) <= to)
        .sort((a, b) => a[0].localeCompare(b[0]));
      if (today) {
        try { incoming.push(...validateCandles((await request(sameDayCandleUrl(previous.instrumentKey), token)).data?.candles?.filter((r) => r?.[0]?.slice(0, 10) === today) || [], today, today)); }
        catch { /* the previous session stays the latest */ }
      }
      const stored = new Map(previous.candles.map((c) => [c[0].slice(0, 10), c[4]]));
      const shifted = incoming.filter((c) => stored.has(c[0].slice(0, 10)) && Math.abs(stored.get(c[0].slice(0, 10)) / c[4] - 1) > READJUSTED).length;
      let candles;
      if (shifted >= 2) {
        candles = mergeCandles(await fullHistory(previous.instrumentKey, to, token), incoming.filter((c) => c[0].slice(0, 10) > to));
        report.readjusted.push({ symbol: previous.symbol, shiftedSessions: shifted });
      } else {
        candles = mergeCandles(previous.candles, incoming);
      }
      const hash = createHash('sha256').update(JSON.stringify(candles)).digest('hex');
      if (hash !== previous.hash) {
        await atomicJson(file, { ...previous, fetchedAt: new Date().toISOString(), hash, candles });
        report.updated += 1;
      }
    } catch (error) {
      report.errors.push({ symbol: previous?.symbol || name, error: error.message });
    }
    await new Promise((r) => setTimeout(r, 120));
  }
  report.finishedAt = new Date().toISOString();
  report.status = report.errors.some((e) => /^(NIFTY|INDIA_VIX)/.test(e.symbol)) ? 'partial' : report.errors.length ? 'ready-with-gaps' : 'ready';
  await atomicJson(path.join(dataDir, 'update.json'), report);
  return report;
}

// Results calendar for the wide universe: NSE's board-meeting list for every company in one request
// (the last 60 days and the next 90), merged into each stock's stored history; nothing stored is dropped.
const ddmmyyyy = (d) => `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`;
const meetingKey = (r) => [r.bm_date, r.bm_purpose, r.bm_timestamp].map(String).join('|');
export async function updateBoardMeetings(dataDir = DATA_DIR, now = new Date()) {
  const { nseClient } = await import('../server/providers/nseClient.js');
  const from = ddmmyyyy(new Date(now.getTime() - 60 * 86400000)), to = ddmmyyyy(new Date(now.getTime() + 90 * 86400000));
  const rows = await nseClient.getJson(`/api/corporate-board-meetings?index=equities&from_date=${from}&to_date=${to}`,
    'https://www.nseindia.com/companies-listing/corporate-filings-board-meetings');
  if (!Array.isArray(rows)) throw new Error('Unexpected board-meetings response');
  const stocks = new Set((await readdir(path.join(dataDir, 'candles'))).map((f) => f.replace(/\.json$/, '')));
  const bySymbol = new Map();
  for (const r of rows) if (stocks.has(r.bm_symbol)) bySymbol.set(r.bm_symbol, [...(bySymbol.get(r.bm_symbol) || []), r]);
  for (const [symbol, fresh] of bySymbol) {
    const file = path.join(dataDir, 'news-history', 'board-meetings', `${symbol}.json`);
    const old = await readJson(file, { rows: [] });
    const merged = new Map(old.rows.map((r) => [meetingKey(r), r]));
    for (const r of fresh) merged.set(meetingKey(r), r);
    await atomicJson(file, { symbol, fetchedAt: new Date().toISOString(), from: old.from || from, to, rows: [...merged.values()] });
  }
  return { meetings: rows.length, companies: bySymbol.size };
}

if (process.argv[2] === 'board-meetings') console.log(JSON.stringify(await updateBoardMeetings()));

if (process.argv[2] === 'update') {
  const report = await updateWide();
  console.log(JSON.stringify({ status: report.status, updated: report.updated, readjusted: report.readjusted, errors: report.errors.length }));
  if (report.status === 'partial') process.exitCode = 1;
}

if (process.argv[2] === 'collect') {
  const { symbols, sectorOf } = wideUniverse();
  const result = await collectMarketData({ dataDir: DATA_DIR, symbols, sectorOf, series: ['EQ', 'BE'], full: process.argv.includes('--full') });
  console.log(JSON.stringify({ status: result.status, instruments: result.instruments.length, unresolved: result.unresolved, completedAt: result.completedAt }));
}

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { NSE_UNIVERSE, BENCHMARKS, SECTOR_OF } from './universe.js';

export const DATA_DIR = path.resolve('data/pulse');
export const UNIVERSE = NSE_UNIVERSE;
export async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  // Windows briefly locks a file that is being read or scanned (EPERM/EBUSY/EACCES); retry before failing.
  for (let attempt = 0; ; attempt += 1) {
    try { await fs.rename(tmp, file); return; }
    catch (error) {
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 8) throw error;
      await new Promise(resolve => setTimeout(resolve, 100 * 2 ** Math.min(attempt, 5)));
    }
  }
}
export async function readJson(file, fallback = null) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
export function completedDate(now = new Date()) {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return new Date(new Date(`${day}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
}
// NSE closes at 15:30 IST; from 18:00 the day's daily candle is final, so the evening
// run can record today's session instead of waiting a day. Null before then or at weekends.
export function closedSessionDate(now = new Date()) {
  const part = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(now).map(p => [p.type, p.value]));
  if (['Sat', 'Sun'].includes(part.weekday) || Number(part.hour) < 18) return null;
  return `${part.year}-${part.month}-${part.day}`;
}
// The historical endpoint serves completed past days only; today's daily candle comes from the intraday endpoint.
export function sameDayCandleUrl(key) {
  return `https://api.upstox.com/v3/historical-candle/intraday/${encodeURIComponent(key)}/days/1`;
}
export function candleUrl(key, from, to) {
  return `https://api.upstox.com/v3/historical-candle/${encodeURIComponent(key)}/days/1/${to}/${from}`;
}
export function validateCandles(candles, lastDate, firstDate = '2000-01-01') {
  if (!Array.isArray(candles)) throw new Error('Provider returned no candle array');
  const seen = new Set();
  for (const row of candles) {
    if (!Array.isArray(row) || row.length < 6 || !/^\d{4}-\d{2}-\d{2}T/.test(row[0]) || !Number.isFinite(Date.parse(row[0]))) throw new Error('Malformed candle');
    const date = row[0].slice(0, 10);
    const [o, h, l, c, v] = row.slice(1, 6);
    if (![o,h,l,c,v].every(Number.isFinite) || Math.min(o,h,l,c) <= 0 || v < 0 || h < Math.max(o,l,c) || l > Math.min(o,h,c)) throw new Error(`Invalid OHLCV at ${date}`);
    if (date > lastDate || date < firstDate || seen.has(date)) throw new Error(`Unexpected candle date ${date}`);
    seen.add(date);
  }
  return [...candles].sort((a,b) => a[0].localeCompare(b[0]));
}
export function mergeCandles(oldRows, newRows) {
  return [...new Map([...oldRows, ...newRows].map(row => [row[0].slice(0,10), row])).values()].sort((a,b) => a[0].localeCompare(b[0]));
}
export async function request(url, token, binary = false) {
  for (let attempt = 0; attempt < 4; attempt++) {
    let response;
    try {
      response = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}`, Accept: 'application/json' } : {}, signal: AbortSignal.timeout(30000) });
    } catch {
      if (attempt === 3) throw new Error('Provider connection failed after four attempts');
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt)); continue;
    }
    if (response.ok) return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
    if ((response.status === 429 || response.status >= 500) && attempt < 3) {
      const retry = Math.min(30, Number(response.headers.get('retry-after')) || 2 ** attempt);
      await new Promise(resolve => setTimeout(resolve, retry * 1000)); continue;
    }
    // Never serialize request options or provider response containing credentials.
    throw new Error(`Upstox HTTP ${response.status}${response.status === 401 ? ': renew server-side Upstox authentication' : ''}`);
  }
}
// sectorOf and series let a separate universe (e.g. data/pulse-wide) reuse this collector; the defaults are v4's.
export async function collectMarketData({ dataDir = DATA_DIR, full = false, symbols = UNIVERSE, years = 10, sectorOf = SECTOR_OF, series = ['EQ'] } = {}) {
  const token = process.env.UPSTOX_ANALYTICS_TOKEN || process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) throw new Error('Configure server-side UPSTOX_ANALYTICS_TOKEN');
  if (!symbols.length || symbols.some(s => !/^[A-Z0-9&-]{1,24}$/.test(s))) throw new Error('Invalid universe');
  if (!Number.isInteger(years) || years < 1 || years > 10) throw new Error('Upstox V3 daily history is limited to one decade per request');
  const metadata = JSON.parse(gunzipSync(await request('https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz', null, true)));
  const unresolved = [];
  const instruments = symbols.flatMap(symbol => {
    const instrument = metadata.find(x => x.segment === 'NSE_EQ' && series.includes(x.instrument_type) && x.trading_symbol === symbol);
    // Renamed or delisted symbols are reported rather than guessed from company names.
    if (!instrument) { unresolved.push(symbol); return []; }
    return [{ symbol, instrumentKey: instrument.instrument_key, isin: instrument.isin, exchange: 'NSE', benchmark: false, sector: sectorOf[symbol] || null }];
  });
  instruments.push(...BENCHMARKS.map(b => ({ ...b, exchange: 'NSE', benchmark: true, sector: b.sector || null })));
  const to = completedDate();
  const today = closedSessionDate();
  // The provider rejects ranges longer than a decade, so start the day after.
  const from = new Date(Date.parse(`${Number(to.slice(0,4))-years}${to.slice(4)}T00:00:00Z`) + 86400000).toISOString().slice(0,10);
  const manifest = { source:'upstox-v3', startedAt:new Date().toISOString(), requestedFrom:from, requestedTo:to, status:'collecting', instruments:[], unresolved, limitations:['Current constituent selection creates survivorship bias.', 'Corporate-action adjustment and historical revisions are not independently verified.', 'Daily price returns exclude dividend cash flows.', 'Upstox daily prices appear split/bonus adjusted (verified for the RELIANCE October 2024 bonus); other corporate actions are not independently verified.'] };
  await atomicJson(path.join(dataDir, 'collection.json'), manifest);
  for (const instrument of instruments) {
    try {
      const file = path.join(dataDir, 'candles', `${instrument.symbol}.json`);
      const previous = await readJson(file);
      const last = previous?.candles?.at(-1)?.[0]?.slice(0,10);
      const overlap = last ? new Date(Date.parse(`${last}T00:00:00Z`) - 10*86400000).toISOString().slice(0,10) : from;
      const start = full || !last ? from : (overlap < from ? from : overlap);
      const body = await request(candleUrl(instrument.instrumentKey, start, to), token);
      if (body.status !== 'success') throw new Error('Provider did not confirm successful response');
      const incoming = validateCandles(body.data?.candles, to, start);
      if (!incoming.length) throw new Error('No historical candles returned');
      let sameDay = [];
      if (today) {
        // Optional: on a holiday or provider hiccup the previous session simply stays the latest.
        try { sameDay = validateCandles((await request(sameDayCandleUrl(instrument.instrumentKey), token)).data?.candles?.filter(row => row?.[0]?.slice(0,10) === today) || [], today, today); }
        catch { sameDay = []; }
      }
      const candles = mergeCandles(full ? [] : previous?.candles || [], [...incoming, ...sameDay]).filter(row => row[0].slice(0,10) >= from);
      const fetchedAt = new Date().toISOString();
      const hash = createHash('sha256').update(JSON.stringify(candles)).digest('hex');
      if (previous && previous.hash !== hash) await atomicJson(path.join(dataDir,'snapshots', `${instrument.symbol}-${previous.hash || Date.now()}.json`), previous);
      await atomicJson(file, { ...instrument, source:'upstox-v3', fetchedAt, hash, candles });
      manifest.instruments.push({ ...instrument, status:'ready', rows:candles.length, firstDate:candles[0][0].slice(0,10), lastDate:candles.at(-1)[0].slice(0,10), hash });
      console.log(`${instrument.symbol}: ${candles.length} real daily candles`);
    } catch(error) {
      manifest.instruments.push({ ...instrument, status:'error', error:error.message });
      console.log(`${instrument.symbol}: ${error.message}`);
    }
    await atomicJson(path.join(dataDir,'collection.json'), manifest);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  // Unresolved stock symbols are reported; a failed benchmark download makes the run partial.
  manifest.status = manifest.instruments.some(x=>x.status==='error' && x.benchmark) ? 'partial' : manifest.instruments.some(x=>x.status==='error') ? 'ready-with-gaps' : 'ready';
  manifest.completedAt = new Date().toISOString();
  await atomicJson(path.join(dataDir,'collection.json'), manifest);
  return manifest;
}

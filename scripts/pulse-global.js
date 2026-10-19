import 'dotenv/config';
import path from 'node:path';
import { DATA_DIR, atomicJson, candleUrl, completedDate, readJson } from '../server/research/marketData.js';

// Global markets, commodities and currency from Upstox's GLOBAL_INDEX / GLOBAL_INDICATOR
// segments (daily history from April 2020) for the v5 shadow research. Stored apart from
// the NSE candles so a gap here never blocks the nightly NSE pipeline.
export const GLOBAL = [
  { symbol: 'SP500', instrumentKey: 'GLOBAL_INDEX|^GSPC', usableSameDay: false },
  { symbol: 'NASDAQ100', instrumentKey: 'GLOBAL_INDEX|IXIX', usableSameDay: false },
  { symbol: 'DOW', instrumentKey: 'GLOBAL_INDEX|^DJI', usableSameDay: false },
  { symbol: 'DOW_FUTURES', instrumentKey: 'GLOBAL_INDEX|DOW FUTURES', usableSameDay: false },
  { symbol: 'GIFT_NIFTY', instrumentKey: 'GLOBAL_INDEX|SGX NIFTY', usableSameDay: false },
  { symbol: 'NIKKEI', instrumentKey: 'GLOBAL_INDEX|^N225', usableSameDay: true },
  { symbol: 'HANG_SENG', instrumentKey: 'GLOBAL_INDEX|^HSI', usableSameDay: true },
  { symbol: 'DAX', instrumentKey: 'GLOBAL_INDEX|^GDAXI', usableSameDay: false },
  { symbol: 'FTSE', instrumentKey: 'GLOBAL_INDEX|^FTSE', usableSameDay: false },
  { symbol: 'BRENT', instrumentKey: 'GLOBAL_INDICATOR|BZUSD', usableSameDay: false },
  { symbol: 'WTI', instrumentKey: 'GLOBAL_INDICATOR|CLUSD', usableSameDay: false },
  { symbol: 'USDINR', instrumentKey: 'GLOBAL_INDICATOR|USDINR', usableSameDay: false },
];

export async function collectGlobal({ dataDir = DATA_DIR } = {}) {
  const token = process.env.UPSTOX_ANALYTICS_TOKEN || process.env.UPSTOX_ACCESS_TOKEN;
  if (!token) throw new Error('Configure server-side UPSTOX_ANALYTICS_TOKEN');
  const to = completedDate();
  const from = new Date(Date.parse(`${Number(to.slice(0, 4)) - 10}${to.slice(4)}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const status = { startedAt: new Date().toISOString(), source: 'upstox-v3 global', results: [] };
  for (const item of GLOBAL) {
    try {
      const res = await fetch(candleUrl(item.instrumentKey, from, to), { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`Upstox HTTP ${res.status}`);
      const body = await res.json();
      // Global series can carry zero volume and occasional flat bars; keep rows with a valid, positive close.
      const candles = (body.data?.candles || []).filter(c => Array.isArray(c) && /^\d{4}-\d{2}-\d{2}T/.test(c[0]) && Number.isFinite(c[4]) && c[4] > 0)
        .sort((a, b) => a[0].localeCompare(b[0]));
      if (!candles.length) throw new Error('No candles returned');
      const file = path.join(dataDir, 'global', `${item.symbol}.json`);
      const previous = await readJson(file);
      const merged = [...new Map([...(previous?.candles || []), ...candles].map(c => [c[0].slice(0, 10), c])).values()].sort((a, b) => a[0].localeCompare(b[0]));
      await atomicJson(file, { ...item, source: 'upstox-v3', fetchedAt: new Date().toISOString(), candles: merged });
      status.results.push({ symbol: item.symbol, rows: merged.length, first: merged[0][0].slice(0, 10), last: merged.at(-1)[0].slice(0, 10) });
    } catch (error) {
      status.results.push({ symbol: item.symbol, error: error.message });
    }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  status.finishedAt = new Date().toISOString();
  await atomicJson(path.join(dataDir, 'global', 'status.json'), status);
  return status;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('pulse-global.js')) {
  try {
    const status = await collectGlobal();
    console.log(JSON.stringify(status.results));
    if (status.results.every(r => r.error)) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

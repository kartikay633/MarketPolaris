// Wide-universe research data (ml/WIDE_PROTOCOL.md): ten years of Upstox daily candles for the
// 755 NIFTY Total Market stocks of 21 October 2026, in data/pulse-wide, apart from v4's data.
// Run: node scripts/pulse-wide.js collect    (resumable; then the Python steps in the protocol)
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { collectMarketData } from '../server/research/marketData.js';

const DATA_DIR = path.resolve('data/pulse-wide');
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

if (process.argv[2] === 'collect') {
  const { symbols, sectorOf } = wideUniverse();
  const result = await collectMarketData({ dataDir: DATA_DIR, symbols, sectorOf, series: ['EQ', 'BE'], full: process.argv.includes('--full') });
  console.log(JSON.stringify({ status: result.status, instruments: result.instruments.length, unresolved: result.unresolved, completedAt: result.completedAt }));
}

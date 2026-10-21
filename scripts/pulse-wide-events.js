// Wide study, amendment 1b (ml/WIDE_PROTOCOL.md): NSE's corporate-actions record, 2006 to date, for
// demergers, schemes of arrangement and capital reductions. ml/wide.py matches these against overnight
// price gaps to find the discontinuities to exclude. One request per calendar year.
// Run: node scripts/pulse-wide-events.js
import path from 'node:path';
import { atomicJson } from '../server/research/marketData.js';
import { nseClient } from '../server/providers/nseClient.js';

const STRUCTURAL = /demerg|scheme of arrangement|arrangement|spin[- ]?off|capital reduction|reduction of capital/i;
const out = { source: 'nseindia.com corporates-corporateActions', fetchedAt: new Date().toISOString(), years: {}, events: [] };
for (let year = 2006; year <= new Date().getFullYear(); year += 1) {
  try {
    const rows = await nseClient.getJson(`/api/corporates-corporateActions?index=equities&from_date=01-01-${year}&to_date=31-12-${year}`,
      'https://www.nseindia.com/companies-listing/corporate-filings-actions');
    const hits = (Array.isArray(rows) ? rows : []).filter((r) => STRUCTURAL.test(String(r.subject || '')) && r.symbol && r.exDate);
    for (const r of hits) out.events.push({ symbol: String(r.symbol).trim(), subject: String(r.subject).trim(), exDate: r.exDate, company: r.comp || null });
    out.years[year] = { rows: Array.isArray(rows) ? rows.length : 0, structural: hits.length };
    console.log(year, out.years[year]);
  } catch (err) {
    out.years[year] = { error: err.message };
    console.log(year, err.message);
  }
  await new Promise((r) => setTimeout(r, 1500));
}
await atomicJson(path.resolve('data/pulse-wide/corporate-actions.json'), out);
console.log(JSON.stringify({ events: out.events.length }));
process.exit(0);

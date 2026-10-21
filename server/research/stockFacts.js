// Facts about any NSE stock for Polaris AI, covered by the models or not: a year of price history
// summarised into returns, range, volatility and liquidity, and the company's latest NSE filings.
// Every value is computed from source data; nothing here is a forecast.

const round = (v, d = 4) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);

// Daily candles ({ time, open, high, low, close, volume }, oldest first) → price-history facts.
export function priceHistoryFacts(candles) {
  const rows = (candles || []).filter((c) => c.close > 0 && c.high > 0 && c.low > 0).sort((a, b) => a.time - b.time);
  if (rows.length < 20) return null;
  const last = rows.at(-1);
  const back = (sessions) => (rows.length > sessions ? rows[rows.length - 1 - sessions].close : null);
  const ret = (sessions) => { const p = back(sessions); return p ? round(last.close / p - 1) : null; };
  const year = rows.slice(-250);
  const high = Math.max(...year.map((c) => c.high)), low = Math.min(...year.map((c) => c.low));
  const logReturns = rows.slice(-61).map((c, i, a) => (i ? Math.log(c.close / a[i - 1].close) : null)).filter((v) => v !== null);
  const mean = logReturns.reduce((s, v) => s + v, 0) / logReturns.length;
  const vol = Math.sqrt(logReturns.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, logReturns.length - 1)) * Math.sqrt(252);
  const recent = rows.slice(-20);
  const tradedValueCr = recent.reduce((s, c) => s + c.volume * ((c.high + c.low + c.close) / 3), 0) / recent.length / 1e7;
  return {
    asOf: new Date((last.time + 19800) * 1000).toISOString().slice(0, 10),
    lastClose: last.close,
    return1Month: ret(21),
    return3Months: ret(63),
    return6Months: ret(126),
    return1Year: ret(249),
    high52Week: high,
    low52Week: low,
    belowHigh52Week: round(last.close / high - 1),
    aboveLow52Week: round(last.close / low - 1),
    volatility60DayAnnualised: round(vol),
    averageDailyTradedValueCrore20Day: round(tradedValueCr, 2),
    sessions: rows.length,
  };
}

const ROUTINE = /trading window|newspaper|share certificate|certificate under|schedule of analyst|loss of|duplicate/i;
const ddmmyyyy = (d) => `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;

// The company's material NSE announcements of the last `days` days, newest first (live from NSE).
export async function liveFilings(symbol, { nse, days = 10, now = new Date(), limit = 5 } = {}) {
  const from = new Date(now.getTime() - days * 86400000);
  const rows = await nse.getJson(`/api/corporate-announcements?index=equities&symbol=${encodeURIComponent(symbol)}&from_date=${ddmmyyyy(from)}&to_date=${ddmmyyyy(now)}`,
    'https://www.nseindia.com/companies-listing/corporate-filings-announcements');
  return (Array.isArray(rows) ? rows : [])
    .map((r) => ({ at: r.exchdisstime || r.an_dt, category: String(r.desc || '').trim(), text: String(r.attchmntText || '').trim(), url: r.attchmntFile || null }))
    .map((r) => ({ ...r, time: Date.parse(String(r.at || '').replace(/^(\d{2})-(\w{3})-(\d{4})/, '$2 $1 $3')) }))
    .filter((r) => Number.isFinite(r.time) && !ROUTINE.test(r.category))
    .sort((a, b) => b.time - a.time)
    .slice(0, limit);
}

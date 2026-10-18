// NSE public report endpoints: provisional FII/DII cash flows and the exchange turnover summary.
// nseindia.com serves its JSON APIs only to a browser-like client holding the session cookies
// set by the home page, so the client warms a cookie jar first and re-warms it on rejection.
import logger from '../utils/logger.js';

const BASE = 'https://www.nseindia.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const COOKIE_TTL_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 8000;
const CRORE = 1e7;

const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };

// '16-Oct-2026' → '2026-10-16'
export function nseDate(text) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(String(text || '').trim());
  return m && MONTHS[m[2].toUpperCase()] ? `${m[3]}-${MONTHS[m[2].toUpperCase()]}-${m[1].padStart(2, '0')}` : null;
}

const num = (v) => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};
const round2 = (n) => Math.round(n * 100) / 100;

// NSE's provisional cash-market activity of FII/FPI and DII for the latest session (₹ crore).
export function parseFiiDii(rows) {
  if (!Array.isArray(rows)) return null;
  const pick = (re) => rows.find((r) => re.test(String(r?.category || '')));
  const fii = pick(/^FII/i);
  const dii = pick(/^DII/i);
  const date = nseDate(fii?.date || dii?.date);
  const block = (r) => ({ buy: num(r?.buyValue), sell: num(r?.sellValue), net: num(r?.netValue) });
  const f = block(fii);
  const d = block(dii);
  if (!date || [f.buy, f.sell, f.net, d.buy, d.sell, d.net].some((v) => v === null)) return null;
  return {
    fiiBuy: f.buy, fiiSell: f.sell, fiiNet: f.net,
    diiBuy: d.buy, diiSell: d.sell, diiNet: d.net,
    date: fii?.date || dii?.date,
    asOf: date,
    publisher: 'NSE provisional',
  };
}

// NSE turnover summary: cash market (equity + SME + others) and equity derivatives, in ₹ crore.
export function parseTurnover(payload) {
  const data = payload?.data;
  const cm = Array.isArray(data?.equities) ? data.equities.filter((r) => r?.segment === 'CM') : [];
  const fo = Array.isArray(data?.equityDerivatives) ? data.equityDerivatives.filter((r) => r?.segment === 'FO') : [];
  if (!cm.length || !fo.length) return null;
  const sum = (rows, key) => rows.reduce((s, r) => s + (num(r[key]) || 0), 0);
  const equity = cm.find((r) => /^equity$/i.test(r.instrument));
  const cashTotal = data.equities.find((r) => r?.segment === 'total');
  const stamp = String(equity?.mktTimeStamp || cm[0].mktTimeStamp || '');
  const asOf = /^\d{4}-\d{2}-\d{2}/.test(stamp) ? stamp.slice(0, 10) : null;
  const cashCr = sum(cm, 'value') / CRORE;
  if (!asOf || !(cashCr > 0)) return null;
  return {
    nseCashCr: round2(cashCr),
    nseEquityCr: round2((num(equity?.value) || 0) / CRORE),
    nseFoNotionalCr: round2(sum(fo, 'notionalTurnover') / CRORE),
    nseFoPremiumCr: round2(sum(fo, 'premiumTurnover') / CRORE),
    cashTrades: num(cashTotal?.noOfTrades) ?? sum(cm, 'noOfTrades'),
    asOf,
    timestamp: stamp,
    publisher: 'NSE',
  };
}

export class NseClient {
  constructor({ fetchImpl = globalThis.fetch } = {}) {
    this.fetch = fetchImpl;
    this.cookie = null;
    this.cookieAt = 0;
  }

  async _warm() {
    const res = await this.fetch(`${BASE}/`, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const set = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    this.cookie = set.map((c) => c.split(';')[0]).join('; ');
    this.cookieAt = Date.now();
  }

  async getJson(apiPath, referer = `${BASE}/`) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!this.cookie || attempt > 0 || Date.now() - this.cookieAt > COOKIE_TTL_MS) await this._warm();
      const res = await this.fetch(`${BASE}${apiPath}`, {
        headers: { 'User-Agent': UA, Accept: 'application/json', Referer: referer, Cookie: this.cookie || '' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return res.json();
      if (res.status !== 401 && res.status !== 403) throw new Error(`NSE ${apiPath} HTTP ${res.status}`);
    }
    throw new Error(`NSE ${apiPath} refused the session`);
  }

  async getFiiDii() {
    try {
      return parseFiiDii(await this.getJson('/api/fiidiiTradeReact', `${BASE}/reports/fii-dii`));
    } catch (err) {
      logger.warn({ err: err.message }, 'NSE FII/DII report unavailable');
      return null;
    }
  }

  async getTurnover() {
    try {
      return parseTurnover(await this.getJson('/api/NextApi/apiClient?functionName=getMarketTurnoverSummary', `${BASE}/market-data/market-turnover`));
    } catch (err) {
      logger.warn({ err: err.message }, 'NSE turnover summary unavailable');
      return null;
    }
  }
}

export const nseClient = new NseClient();
export default nseClient;

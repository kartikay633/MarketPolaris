// NSE trading calendar and market status (IST, from the server clock, never the browser's).
// Holidays and special sessions (e.g. the Diwali Muhurat hour, a weekend Budget session) come from
// Upstox's official market-holidays feed, saved to <data dir>/market-holidays.json and refreshed
// every 12 hours. Without the feed, the built-in 2026 list below (copied from that feed) is used.
import { readFileSync } from 'node:fs';
import { writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { MARKET_HOURS } from '../config/constants.js';

const IST_MS = 19800000;
const REFRESH_MS = 12 * 3600 * 1000;
const FILE = path.resolve(process.env.PULSE_DATA_DIR || 'data/pulse', 'market-holidays.json');

// Official 2026 NSE trading holidays and special sessions (Upstox market-holidays feed, 21 Oct 2026).
const BUILT_IN = {
  '2026-01-15': { closed: true, name: 'Municipal Corporation Election' },
  '2026-01-26': { closed: true, name: 'Republic Day' },
  '2026-02-01': { closed: false, name: 'Budget Day Session', open: 555, close: 930 },
  '2026-03-03': { closed: true, name: 'Holi' },
  '2026-03-26': { closed: true, name: 'Ram Navami' },
  '2026-03-31': { closed: true, name: 'Mahavir Jayanti' },
  '2026-04-03': { closed: true, name: 'Good Friday' },
  '2026-04-14': { closed: true, name: 'Dr. Baba Saheb Ambedkar Jayanti' },
  '2026-05-01': { closed: true, name: 'Maharashtra Day' },
  '2026-05-28': { closed: true, name: 'Bakri Id / Eid-ul-Adha' },
  '2026-06-26': { closed: true, name: 'Muharram' },
  '2026-09-14': { closed: true, name: 'Ganesh Chaturthi' },
  '2026-10-02': { closed: true, name: 'Gandhi Jayanti' },
  '2026-10-20': { closed: true, name: 'Dussehra' },
  '2026-11-08': { closed: false, name: 'Diwali Laxmi Pujan (Muhurat trading)', open: 1080, close: 1140 },
  '2026-11-10': { closed: true, name: 'Diwali-Balipratipada' },
  '2026-11-24': { closed: true, name: 'Guru Nanak Jayanti' },
  '2026-12-25': { closed: true, name: 'Christmas' },
};

// Upstox market-holidays rows → { 'YYYY-MM-DD': { closed, name, open?, close? } } for NSE.
// Settlement-only holidays (NSE trades normally) are left out.
export function calendarFrom(rows) {
  const out = {};
  for (const h of rows || []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(h?.date || '')) continue;
    const session = (h.open_exchanges || []).find((e) => e.exchange === 'NSE');
    if ((h.closed_exchanges || []).includes('NSE')) out[h.date] = { closed: true, name: h.description || 'Holiday' };
    else if (h.holiday_type === 'SPECIAL_TIMING' && session) {
      const minutes = (ms) => { const d = new Date(ms + IST_MS); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
      out[h.date] = { closed: false, name: h.description || 'Special session', open: minutes(session.start_time), close: minutes(session.end_time) };
    }
  }
  return out;
}

let calendar = { ...BUILT_IN };
try {
  const saved = JSON.parse(readFileSync(FILE, 'utf8'));
  calendar = { ...BUILT_IN, ...saved.calendar };
} catch { /* not fetched yet: the built-in list applies */ }

export function setCalendar(entries) {
  calendar = { ...BUILT_IN, ...entries };
}

// Fetches the official calendar now and every 12 hours (server start only; tests never call it).
export function startCalendarRefresh({ token = process.env.UPSTOX_ANALYTICS_TOKEN, baseUrl = process.env.UPSTOX_API_BASE_URL || 'https://api.upstox.com/v2', fetcher = fetch, logger } = {}) {
  if (!token) return null;
  const refresh = async () => {
    try {
      const res = await fetcher(`${baseUrl}/market/holidays`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const entries = calendarFrom((await res.json())?.data);
      if (!Object.keys(entries).length) throw new Error('empty calendar');
      setCalendar(entries);
      await writeFile(`${FILE}.tmp`, JSON.stringify({ source: 'upstox market holidays', fetchedAt: new Date().toISOString(), calendar: entries }));
      await rename(`${FILE}.tmp`, FILE);
    } catch (err) {
      logger?.warn({ err: err.message }, 'Market calendar refresh failed; keeping the saved calendar');
    }
  };
  refresh();
  const timer = setInterval(refresh, REFRESH_MS);
  timer.unref?.();
  return timer;
}

const istParts = (now) => {
  const d = new Date(now.getTime() + IST_MS);
  return { date: d.toISOString().slice(0, 10), day: d.getUTCDay(), minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
};

// Today's NSE session in IST minutes, or null when the exchange is closed all day.
export function sessionOn(dateIso, weekday) {
  const entry = calendar[dateIso];
  if (entry?.closed) return null;
  if (entry && !entry.closed) return { open: entry.open, close: entry.close, special: entry.name };
  if (weekday === 0 || weekday === 6) return null;
  return { open: MARKET_HOURS.MARKET_OPEN, close: MARKET_HOURS.MARKET_CLOSE, special: null };
}

const hhmm = (m) => `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, '0')} ${m >= 720 ? 'PM' : 'AM'}`;

/**
 * Current Indian market status.
 * @returns {{ status: 'OPEN'|'PRE_MARKET'|'POST_MARKET'|'CLOSED', reason?: string, nextEvent?: string, tradingDay: boolean, session: object|null }}
 */
export function getMarketStatus(now = new Date()) {
  const { date, day, minutes } = istParts(now);
  const session = sessionOn(date, day);
  if (!session) {
    const entry = calendar[date];
    return {
      status: 'CLOSED',
      reason: entry?.closed ? `Holiday: ${entry.name}` : 'Weekend',
      nextEvent: 'Market opens next trading day 9:15 AM IST',
      tradingDay: false,
      session: null,
    };
  }
  const base = { tradingDay: true, session };
  const preOpen = session.special ? session.open : MARKET_HOURS.PRE_MARKET_START;
  if (minutes >= preOpen && minutes < session.open) return { ...base, status: 'PRE_MARKET', reason: 'Pre-open session', nextEvent: `Market opens at ${hhmm(session.open)} IST` };
  if (minutes >= session.open && minutes < session.close) return { ...base, status: 'OPEN', ...(session.special && { reason: session.special }) };
  if (minutes >= session.close && minutes < session.close + (MARKET_HOURS.POST_MARKET_END - MARKET_HOURS.MARKET_CLOSE)) {
    return { ...base, status: 'POST_MARKET', reason: 'Closing session', nextEvent: `Market closed at ${hhmm(session.close)} IST` };
  }
  return {
    ...base,
    status: 'CLOSED',
    reason: 'Outside trading hours',
    nextEvent: minutes < session.open ? `Market opens today at ${hhmm(session.open)} IST` : 'Market opens next trading day 9:15 AM IST',
  };
}

/** True while data should refresh actively (pre-open, open, closing session). */
export function isMarketActive(now = new Date()) {
  const { status } = getMarketStatus(now);
  return status === 'OPEN' || status === 'PRE_MARKET' || status === 'POST_MARKET';
}

/** True only during normal (or special) trading. */
export function isMarketOpen(now = new Date()) {
  return getMarketStatus(now).status === 'OPEN';
}

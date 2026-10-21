// ROADMAP: Section 8 — Upstox Integration (Market Hours)
import { MARKET_TIMEZONE, MARKET_HOURS } from '../config/constants.js';

// NSE/BSE holidays for 2026 — UPDATE ANNUALLY
// Source: NSE circular
const HOLIDAYS_2026 = [
  '2026-01-26', // Republic Day
  '2026-03-10', // Maha Shivaratri
  '2026-03-31', // Id-Ul-Fitr (Ramadan)
  '2026-04-02', // Ram Navami
  '2026-04-03', // Good Friday
  '2026-04-14', // Dr. Ambedkar Jayanti
  '2026-05-01', // May Day / Maharashtra Day
  '2026-06-07', // Eid-Ul-Adha (Bakri Id)
  '2026-07-06', // Muharram
  '2026-08-15', // Independence Day
  '2026-08-27', // Janmashtami
  '2026-09-04', // Milad-Un-Nabi
  '2026-10-02', // Mahatma Gandhi Jayanti
  '2026-10-20', // Dussehra (21 Oct is a trading day: the live feed showed trades that day)
  '2026-11-09', // Diwali (Laxmi Puja)
  '2026-11-10', // Diwali (Balipratipada)
  '2026-11-30', // Guru Nanak Jayanti
  '2026-12-25', // Christmas
];

/**
 * Get current IST Date object
 */
function getNowIST() {
  return new Date(
    new Date().toLocaleString('en-US', { timeZone: MARKET_TIMEZONE })
  );
}

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Check if a given IST date is an NSE/BSE holiday
 */
function isHoliday(istDate) {
  const dateStr = formatDate(istDate);
  return HOLIDAYS_2026.includes(dateStr);
}

/**
 * Determine current Indian market status.
 * Uses server clock converted to IST — never relies on browser clock.
 *
 * @returns {{ status: string, reason?: string, nextEvent?: string }}
 */
export function getMarketStatus() {
  const now = getNowIST();
  const day = now.getDay(); // 0 = Sunday, 6 = Saturday
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const timeMinutes = hours * 60 + minutes;

  // Weekend
  if (day === 0 || day === 6) {
    return {
      status: 'CLOSED',
      reason: 'Weekend',
      nextEvent: 'Market opens Monday 9:15 AM IST',
    };
  }

  // Holiday
  if (isHoliday(now)) {
    return {
      status: 'CLOSED',
      reason: `Holiday`,
      nextEvent: 'Market opens next trading day 9:15 AM IST',
    };
  }

  // Pre-market: 9:00 – 9:15
  if (timeMinutes >= MARKET_HOURS.PRE_MARKET_START && timeMinutes < MARKET_HOURS.MARKET_OPEN) {
    return {
      status: 'PRE_MARKET',
      reason: 'Pre-open session',
      nextEvent: 'Market opens at 9:15 AM IST',
    };
  }

  // Market open: 9:15 – 15:30
  if (timeMinutes >= MARKET_HOURS.MARKET_OPEN && timeMinutes < MARKET_HOURS.MARKET_CLOSE) {
    return {
      status: 'OPEN',
    };
  }

  // Post-market: 15:30 – 15:40
  if (timeMinutes >= MARKET_HOURS.MARKET_CLOSE && timeMinutes < MARKET_HOURS.POST_MARKET_END) {
    return {
      status: 'POST_MARKET',
      reason: 'Closing session',
      nextEvent: 'Market closed at 3:30 PM IST',
    };
  }

  // Closed (before 9:00 or after 15:40)
  return {
    status: 'CLOSED',
    reason: 'Outside trading hours',
    nextEvent: timeMinutes < MARKET_HOURS.PRE_MARKET_START
      ? 'Market opens today at 9:15 AM IST'
      : 'Market opens next trading day 9:15 AM IST',
  };
}

/**
 * Check if the market is currently in a state where data should be actively refreshed
 */
export function isMarketActive() {
  const { status } = getMarketStatus();
  return status === 'OPEN' || status === 'PRE_MARKET' || status === 'POST_MARKET';
}

/**
 * Check if market is currently strictly open for normal trading
 */
export function isMarketOpen() {
  return getMarketStatus().status === 'OPEN';
}

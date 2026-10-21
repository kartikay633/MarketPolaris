import test from 'node:test';
import assert from 'node:assert/strict';
import { getMarketStatus, isMarketOpen, calendarFrom, setCalendar } from '../server/utils/marketHours.js';

// An IST wall-clock time as a Date.
const ist = (date, time) => new Date(`${date}T${time}:00+05:30`);

test('the 2026 calendar matches the exchange: real holidays closed, ordinary days open', () => {
  setCalendar({});
  assert.equal(getMarketStatus(ist('2026-10-21', '12:00')).status, 'OPEN', '21 Oct is a trading day');
  assert.equal(getMarketStatus(ist('2026-10-20', '12:00')).reason, 'Holiday: Dussehra');
  assert.equal(getMarketStatus(ist('2026-11-24', '11:00')).status, 'CLOSED', 'Guru Nanak Jayanti');
  assert.equal(getMarketStatus(ist('2026-11-09', '11:00')).status, 'OPEN', '9 Nov trades normally');
  assert.equal(getMarketStatus(ist('2026-11-30', '11:00')).status, 'OPEN', '30 Nov trades normally');
  assert.equal(getMarketStatus(ist('2026-10-24', '11:00')).reason, 'Weekend');
});

test('special sessions open outside the usual days and hours', () => {
  setCalendar({});
  assert.equal(getMarketStatus(ist('2026-11-08', '18:30')).status, 'OPEN', 'Muhurat trading on a Sunday evening');
  assert.equal(getMarketStatus(ist('2026-11-08', '11:00')).status, 'CLOSED');
  assert.equal(getMarketStatus(ist('2026-11-08', '11:00')).nextEvent, 'Market opens today at 6:00 PM IST');
  assert.equal(isMarketOpen(ist('2026-02-01', '10:00')), true, 'Budget Day session on a Sunday');
});

test('normal session boundaries', () => {
  setCalendar({});
  assert.equal(getMarketStatus(ist('2026-10-22', '09:05')).status, 'PRE_MARKET');
  assert.equal(getMarketStatus(ist('2026-10-22', '09:15')).status, 'OPEN');
  assert.equal(getMarketStatus(ist('2026-10-22', '15:35')).status, 'POST_MARKET');
  const after = getMarketStatus(ist('2026-10-22', '20:00'));
  assert.equal(after.status, 'CLOSED');
  assert.equal(after.tradingDay, true);
});

test('the Upstox feed overrides the built-in list, and settlement-only holidays do not close trading', () => {
  const rows = [
    { date: '2027-01-26', description: 'Republic Day', holiday_type: 'TRADING_HOLIDAY', closed_exchanges: ['NSE', 'BSE'], open_exchanges: [] },
    { date: '2027-02-19', description: 'Settlement only', holiday_type: 'SETTLEMENT_HOLIDAY', closed_exchanges: [], open_exchanges: [{ exchange: 'NSE', start_time: 0, end_time: 0 }] },
    { date: '2027-10-31', description: 'Muhurat', holiday_type: 'SPECIAL_TIMING', closed_exchanges: [],
      open_exchanges: [{ exchange: 'NSE', start_time: Date.parse('2027-10-31T18:15:00+05:30'), end_time: Date.parse('2027-10-31T19:15:00+05:30') }] },
  ];
  const cal = calendarFrom(rows);
  assert.deepEqual(Object.keys(cal).sort(), ['2027-01-26', '2027-10-31']);
  assert.equal(cal['2027-10-31'].open, 18 * 60 + 15);
  setCalendar(cal);
  assert.equal(getMarketStatus(ist('2027-01-26', '11:00')).status, 'CLOSED');
  assert.equal(getMarketStatus(ist('2027-02-19', '11:00')).status, 'OPEN');
  assert.equal(getMarketStatus(ist('2027-10-31', '18:30')).status, 'OPEN');
  setCalendar({});
});

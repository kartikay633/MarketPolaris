// Lightweight Charts labels time in UTC; NSE sessions read in IST (09:15-15:30).
const fmt = (t, options) => new Date(t * 1000).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', ...options });

// tickMarkType: 0 year, 1 month, 2 day of month, 3 time, 4 time with seconds.
export function istTickMark(time, tickMarkType) {
  if (typeof time !== 'number') return null;
  if (tickMarkType === 0) return fmt(time, { year: 'numeric' });
  if (tickMarkType === 1) return fmt(time, { month: 'short', year: '2-digit' });
  if (tickMarkType === 2) return fmt(time, { day: 'numeric', month: 'short' });
  return fmt(time, { hour: '2-digit', minute: '2-digit', hour12: false });
}

export const istCrosshairTime = (time) =>
  typeof time === 'number' ? fmt(time, { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : String(time);

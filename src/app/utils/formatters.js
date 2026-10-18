// ROADMAP: Section 5 & 28 — Indian Number & Currency Formatters

/**
 * Format currency in Indian Rupees (₹) with Indian numbering (Lakhs/Crores)
 * e.g. 1000000 -> ₹10,00,000.00
 */
export function formatINR(val, options = {}) {
  if (val === null || val === undefined || isNaN(val)) return '₹0.00';
  const num = Number(val);
  const { decimals = 2, compact = false } = options;

  if (compact) {
    if (Math.abs(num) >= 10000000) {
      return `₹${(num / 10000000).toFixed(2)} Cr`;
    }
    if (Math.abs(num) >= 100000) {
      return `₹${(num / 100000).toFixed(2)} L`;
    }
    if (Math.abs(num) >= 1000) {
      return `₹${(num / 1000).toFixed(2)} K`;
    }
  }

  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
}

/**
 * Format volume in Indian Lakhs/Crores or K/M
 */
export function formatVolume(val) {
  if (!val || isNaN(val)) return '0';
  const num = Number(val);
  if (num >= 10000000) {
    return `${(num / 10000000).toFixed(2)} Cr`;
  }
  if (num >= 100000) {
    return `${(num / 100000).toFixed(2)} L`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)} K`;
  }
  return num.toLocaleString('en-IN');
}

/**
 * Format percentage change with + or - sign
 * e.g. 1.25 -> +1.25%
 */
export function formatPercent(val, decimals = 2) {
  if (val === null || val === undefined || isNaN(val)) return '0.00%';
  const num = Number(val);
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toFixed(decimals)}%`;
}

/**
 * Format plain number with Indian comma separators
 */
export function formatNumber(val, decimals = 2) {
  if (val === null || val === undefined || isNaN(val)) return '0';
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number(val));
}

export const formatIndianCurrency = formatINR;
export const formatIndianNumber = formatNumber;

/**
 * Freshness label for a market-data block from its API `source` and `asOf`.
 * 'Live' during the session; otherwise the session it describes:
 * 'As of 16 Oct close' (feed, market closed) or 'End of day · 16 Oct' (saved / exchange report).
 * Returns null for an unavailable block.
 */
export function dataStamp(source, asOf, isOpen) {
  if (!source || source === 'unavailable') return null;
  if (source === 'live' && isOpen) return 'Live';
  const date = asOf ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(asOf) ? `${asOf}T12:00:00+05:30` : asOf) : null;
  const day = date && !Number.isNaN(date.getTime())
    ? date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })
    : null;
  if (source === 'live') return day ? `As of ${day} close` : 'Last close';
  return day ? `End of day · ${day}` : 'End of day';
}

/**
 * Rupee amount given in crore, e.g. 122601.09 -> ₹1,22,601 Cr; 25452299 -> ₹254.52 Lakh Cr
 */
export function formatCrore(cr) {
  if (cr === null || cr === undefined || isNaN(cr)) return '—';
  const num = Number(cr);
  if (Math.abs(num) >= 100000) return `₹${(num / 100000).toFixed(2)} Lakh Cr`;
  return `₹${Math.round(num).toLocaleString('en-IN')} Cr`;
}

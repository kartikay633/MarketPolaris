// Institutional Live Financial Ticker Tape Component
import React from 'react';
import { useQueries } from '@tanstack/react-query';
import { useMarketOverview, stockQuoteQuery } from '../../hooks/useMarketData';
import { TrendingUp, TrendingDown } from 'lucide-react';

// Each half of the marquee needs enough items to span the track, otherwise
// the -50% scroll loop leaves a visible gap.
const MIN_ITEMS_PER_LOOP = 8;

const LARGE_CAPS = ['RELIANCE', 'HDFCBANK', 'TCS', 'INFY', 'ICICIBANK', 'BHARTIARTL'];

// The API marks each index and quote with `source`; anything not served live
// by the market feed (including responses without the marker) is not shown.
const isLive = (row) => row?.source === 'live';

function toTicker(symbol, rawValue, rawChangePercent, prefix = '') {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) return null;
  const changePercent = Number(rawChangePercent);
  const hasChange = Number.isFinite(changePercent);
  return {
    symbol,
    price: `${prefix}${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
    change: hasChange ? `${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%` : null,
    isPos: hasChange ? changePercent >= 0 : true,
  };
}

export function MarketTickerTape() {
  const { data: overview } = useMarketOverview();
  const quotes = useQueries({
    queries: LARGE_CAPS.map((symbol) => ({
      ...stockQuoteQuery(symbol),
      refetchInterval: (query) => (query.state.data?.marketStatus === 'OPEN' ? 30000 : 120000),
    })),
  });

  const tickers = [
    ...(overview?.indices || [])
      .filter(isLive)
      .map((idx) => toTicker(idx.name || idx.symbol, idx.value, idx.changePercent)),
    ...quotes
      .map((q, i) => (isLive(q.data) ? toTicker(LARGE_CAPS[i], q.data.ltp, q.data.changePercent, '₹') : null)),
  ].filter(Boolean);

  if (!tickers.length) {
    return (
      <div className="ticker-tape-container">
        <div className="ticker-tape-badge">
          <span className="ticker-tape-dot" />
          <span>NSE / BSE FEED</span>
        </div>
        <div className="ticker-tape-track">
          <div className="ticker-tape-item" role="status">
            <span className="ticker-tape-sym">Market data updating</span>
          </div>
        </div>
      </div>
    );
  }

  // Repeat to fill one loop, then duplicate for seamless infinite marquee scroll
  const loop = Array.from({ length: Math.ceil(MIN_ITEMS_PER_LOOP / tickers.length) }, () => tickers).flat();
  const displayTickers = [...loop, ...loop];

  return (
    <div className="ticker-tape-container">
      <div className="ticker-tape-badge">
        <span className="ticker-tape-dot" />
        <span>NSE / BSE FEED</span>
      </div>
      <div className="ticker-tape-track">
        <div className="ticker-tape-content">
          {displayTickers.map((t, idx) => (
            <div key={`${t.symbol}-${idx}`} className="ticker-tape-item">
              <span className="ticker-tape-sym">{t.symbol}</span>
              <span className="ticker-tape-price">{t.price}</span>
              {t.change && (
                <span className={`ticker-tape-change ${t.isPos ? 'text-positive' : 'text-negative'}`}>
                  {t.isPos ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                  {t.change}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default MarketTickerTape;

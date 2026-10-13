// ROADMAP: Section 5, 8 & Design Refinement — Institutional Indian Equity Treemap Heatmap
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, TrendingDown, Layers, ArrowUpRight } from 'lucide-react';
import { formatIndianNumber } from '../../utils/formatters';

const HEATMAP_DATA = [
  {
    sector: 'Banking & Financials',
    weight: 35,
    stocks: [
      { symbol: 'NSE:HDFCBANK', name: 'HDFC Bank', ltp: 731.00, change: 18.00, changePercent: 2.46, weight: 11 },
      { symbol: 'NSE:ICICIBANK', name: 'ICICI Bank', ltp: 1245.50, change: 14.20, changePercent: 1.15, weight: 8 },
      { symbol: 'NSE:SBIN', name: 'State Bank of India', ltp: 996.20, change: 7.50, changePercent: 0.75, weight: 6 },
      { symbol: 'NSE:KOTAKBANK', name: 'Kotak Mahindra Bank', ltp: 1780.00, change: -12.40, changePercent: -0.69, weight: 4 },
      { symbol: 'NSE:AXISBANK', name: 'Axis Bank', ltp: 1188.00, change: 8.50, changePercent: 0.72, weight: 4 },
      { symbol: 'NSE:BAJFINANCE', name: 'Bajaj Finance', ltp: 6920.00, change: -45.00, changePercent: -0.65, weight: 4 },
    ],
  },
  {
    sector: 'Technology & Software',
    weight: 22,
    stocks: [
      { symbol: 'NSE:TCS', name: 'Tata Consultancy Services', ltp: 2105.00, change: -85.00, changePercent: -4.04, weight: 10 },
      { symbol: 'NSE:INFY', name: 'Infosys Ltd', ltp: 1051.40, change: -7.20, changePercent: -0.68, weight: 7 },
      { symbol: 'NSE:HCLTECH', name: 'HCL Technologies', ltp: 1680.00, change: 15.60, changePercent: 0.94, weight: 3 },
      { symbol: 'NSE:WIPRO', name: 'Wipro Limited', ltp: 520.00, change: 3.10, changePercent: 0.60, weight: 2 },
    ],
  },
  {
    sector: 'Energy & Power',
    weight: 18,
    stocks: [
      { symbol: 'NSE:RELIANCE', name: 'Reliance Industries', ltp: 2980.50, change: 65.10, changePercent: 2.23, weight: 12 },
      { symbol: 'NSE:NTPC', name: 'NTPC Limited', ltp: 385.00, change: 4.20, changePercent: 1.10, weight: 3 },
      { symbol: 'NSE:ONGC', name: 'ONGC', ltp: 295.40, change: -2.10, changePercent: -0.71, weight: 3 },
    ],
  },
  {
    sector: 'Automobiles & Mobility',
    weight: 12,
    stocks: [
      { symbol: 'NSE:TATAMOTORS', name: 'Tata Motors', ltp: 303.80, change: -10.70, changePercent: -3.52, weight: 5 },
      { symbol: 'NSE:MARUTI', name: 'Maruti Suzuki', ltp: 12450.00, change: 185.00, changePercent: 1.51, weight: 4 },
      { symbol: 'NSE:M&M', name: 'Mahindra & Mahindra', ltp: 2850.00, change: 32.00, changePercent: 1.14, weight: 3 },
    ],
  },
  {
    sector: 'Consumer Goods & FMCG',
    weight: 10,
    stocks: [
      { symbol: 'NSE:ITC', name: 'ITC Limited', ltp: 262.30, change: -3.90, changePercent: -1.49, weight: 5 },
      { symbol: 'NSE:HINDUNILVR', name: 'Hindustan Unilever', ltp: 2380.00, change: 18.50, changePercent: 0.78, weight: 5 },
    ],
  },
];

function getChangeColorStyle(pct) {
  if (pct >= 2.0) {
    return {
      backgroundColor: 'rgba(16, 185, 129, 0.22)',
      border: '1px solid rgba(16, 185, 129, 0.40)',
    };
  }
  if (pct >= 0.5) {
    return {
      backgroundColor: 'rgba(16, 185, 129, 0.12)',
      border: '1px solid rgba(16, 185, 129, 0.25)',
    };
  }
  if (pct > -0.5) {
    return {
      backgroundColor: 'var(--surface)',
      border: '1px solid var(--border)',
    };
  }
  if (pct > -2.0) {
    return {
      backgroundColor: 'rgba(244, 63, 94, 0.12)',
      border: '1px solid rgba(244, 63, 94, 0.25)',
    };
  }
  return {
    backgroundColor: 'rgba(244, 63, 94, 0.22)',
    border: '1px solid rgba(244, 63, 94, 0.40)',
  };
}

export default function MarketHeatmap() {
  const navigate = useNavigate();
  const [hoveredStock, setHoveredStock] = useState(null);

  return (
    <div className="card card-padded">
      {/* Header */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          marginBottom: '16px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Layers size={16} color="var(--accent)" />
            <h2 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              Indian Equities Market Treemap
            </h2>
            <span className="badge badge--accent badge--sm">
              NIFTY 50 WEIGHTS
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '12px', margin: '3px 0 0' }}>
            Relative market weight tiles colored by daily price variation.
          </p>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px', color: 'var(--text-secondary)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: 'rgba(244, 63, 94, 0.6)' }} />
            <span>&lt; -2%</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: 'rgba(244, 63, 94, 0.3)' }} />
            <span>-0.5%</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} />
            <span>Unchanged</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: 'rgba(16, 185, 129, 0.3)' }} />
            <span>+0.5%</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '2px', backgroundColor: 'rgba(16, 185, 129, 0.6)' }} />
            <span>&gt; +2%</span>
          </div>
        </div>
      </div>

      {/* Sector Groups Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap: '12px' }}>
        {HEATMAP_DATA.map((group) => (
          <div
            key={group.sector}
            style={{
              backgroundColor: 'var(--surface)',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--border-subtle)',
              padding: '12px',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '11.5px' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{group.sector}</span>
              <span style={{ color: 'var(--text-muted)' }}>{group.weight}% Wt</span>
            </div>

            {/* Stocks in this sector */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 90px), 1fr))',
                gap: '6px',
                flex: 1,
              }}
            >
              {group.stocks.map((stk) => {
                const colorStyle = getChangeColorStyle(stk.changePercent);
                const isPos = stk.changePercent >= 0;

                return (
                  <div
                    key={stk.symbol}
                    onClick={() => navigate(`/stocks/${encodeURIComponent(stk.symbol)}`)}
                    onMouseEnter={() => setHoveredStock(stk)}
                    onMouseLeave={() => setHoveredStock(null)}
                    style={{
                      ...colorStyle,
                      borderRadius: 'var(--radius-sm)',
                      padding: '10px 8px',
                      cursor: 'pointer',
                      transition: 'transform var(--transition-fast), box-shadow var(--transition-fast), border-color var(--transition-fast)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      alignItems: 'center',
                      minHeight: '68px',
                      textAlign: 'center',
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.transform = 'scale(1.02)';
                      e.currentTarget.style.borderColor = 'var(--accent)';
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.transform = 'scale(1)';
                      e.currentTarget.style.borderColor = colorStyle.border.split(' ')[2];
                    }}
                  >
                    <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {stk.symbol.replace('NSE:', '')}
                    </div>
                    <div className="num-tabular" style={{ fontSize: '10.5px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      ₹{formatIndianNumber(stk.ltp)}
                    </div>
                    <div
                      className={`num-tabular ${isPos ? 'text-positive' : 'text-negative'}`}
                      style={{
                        fontSize: '11px',
                        fontWeight: 600,
                        marginTop: '2px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '2px',
                      }}
                    >
                      {isPos ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                      <span>
                        {isPos ? '+' : ''}
                        {stk.changePercent.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Hover Information Banner */}
      {hoveredStock && (
        <div
          className="card"
          style={{
            marginTop: '12px',
            backgroundColor: 'var(--surface)',
            padding: '8px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '12.5px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{hoveredStock.symbol}</span>
            <span style={{ color: 'var(--text-secondary)' }}>• {hoveredStock.name}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <span className="num-tabular" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>₹{formatIndianNumber(hoveredStock.ltp)}</span>
            <span
              className={`num-tabular ${hoveredStock.changePercent >= 0 ? 'text-positive' : 'text-negative'}`}
              style={{ fontWeight: 600 }}
            >
              {hoveredStock.changePercent >= 0 ? '+' : ''}
              {hoveredStock.changePercent.toFixed(2)}%
            </span>
            <span style={{ color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: '3px', fontWeight: 600, cursor: 'pointer' }}>
              View Stock <ArrowUpRight size={13} />
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

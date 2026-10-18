// ROADMAP: Section 5, 8 & Design Refinement — Institutional Indian Equity Treemap Heatmap
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { TrendingUp, TrendingDown, Layers, ArrowUpRight } from 'lucide-react';
import { formatIndianNumber } from '../../utils/formatters';

const TILES_PER_SECTOR = 8;

// Sector groups from the market snapshot, ordered by traded value. A sector's weight is its
// share of the tracked universe's traded value; tiles are its most-traded stocks.
function groupBySector(stocks) {
  const total = stocks.reduce((sum, s) => sum + (s.tradedValue || 0), 0) || 1;
  const groups = new Map();
  for (const s of stocks) {
    if (!groups.has(s.sector)) groups.set(s.sector, []);
    groups.get(s.sector).push(s);
  }
  return [...groups.entries()]
    .map(([sector, rows]) => ({
      sector,
      value: rows.reduce((sum, s) => sum + (s.tradedValue || 0), 0),
      count: rows.length,
      stocks: [...rows].sort((a, b) => b.tradedValue - a.tradedValue).slice(0, TILES_PER_SECTOR),
    }))
    .sort((a, b) => b.value - a.value)
    .map((g) => ({ ...g, weight: ((g.value / total) * 100).toFixed(1) }));
}

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

export default function MarketHeatmap({ stocks = [], stamp = null }) {
  const navigate = useNavigate();
  const [hoveredStock, setHoveredStock] = useState(null);
  const groups = useMemo(() => groupBySector(stocks), [stocks]);

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
              TRADED VALUE WEIGHTS
            </span>
            {stamp}
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '12px', margin: '3px 0 0' }}>
            Sectors of the tracked universe by share of traded value; each shows its most-traded stocks, colored by day change.
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
        {groups.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '24px 0' }}>Market data is unavailable right now.</div>
        )}
        {groups.map((group) => (
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
              <span style={{ color: 'var(--text-muted)' }} title={`${group.count} tracked stocks`}>{group.weight}% of value</span>
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

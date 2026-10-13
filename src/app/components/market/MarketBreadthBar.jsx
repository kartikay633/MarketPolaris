// ROADMAP: Section 2 & Design Refinement — Institutional Market Breadth Bar
import React from 'react';
import { formatNumber } from '../../utils/formatters';
import { ArrowUpRight, ArrowDownRight, Activity, ShieldAlert } from 'lucide-react';

export function MarketBreadthBar({ breadth }) {
  if (!breadth) return null;

  const { advancing = 0, declining = 0, unchanged = 0 } = breadth;
  const total = advancing + declining + unchanged || 1;

  const advPct = ((advancing / total) * 100).toFixed(1);
  const decPct = ((declining / total) * 100).toFixed(1);
  const unchPct = ((unchanged / total) * 100).toFixed(1);

  const adRatio = declining > 0 ? (advancing / declining).toFixed(2) : advancing;
  const isBullish = parseFloat(adRatio) >= 1.0;

  return (
    <div
      className="card card-padded"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Top Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: isBullish ? '#10B981' : '#F43F5E', boxShadow: 'none' }} />
          <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            NSE Market Breadth & Participation
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span 
            className="badge" 
            style={{ 
              backgroundColor: isBullish ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)',
              color: isBullish ? 'var(--positive-text)' : 'var(--negative-text)',
              border: `1px solid ${isBullish ? 'rgba(16, 185, 129, 0.35)' : 'rgba(244, 63, 94, 0.35)'}`,
              padding: '3px 10px',
              fontSize: '11px',
              fontWeight: 700,
            }}
          >
            {isBullish ? 'BULLISH SKEW' : 'BEARISH SKEW'} • A/D {adRatio}
          </span>
        </div>
      </div>

      {/* 3 Metric Tiles */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: '10px' }}>
        {/* Advancing Tile */}
        <div style={{ padding: '10px 14px', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.20)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Advancing</div>
            <div className="num-tabular" style={{ fontSize: '18px', fontWeight: 800, color: 'var(--positive-text)' }}>
              {formatNumber(advancing, 0)} <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>({advPct}%)</span>
            </div>
          </div>
          <ArrowUpRight size={18} color="var(--positive)" />
        </div>

        {/* Declining Tile */}
        <div style={{ padding: '10px 14px', borderRadius: 'var(--radius-sm)', backgroundColor: 'rgba(244, 63, 94, 0.08)', border: '1px solid rgba(244, 63, 94, 0.20)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Declining</div>
            <div className="num-tabular" style={{ fontSize: '18px', fontWeight: 800, color: 'var(--negative-text)' }}>
              {formatNumber(declining, 0)} <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>({decPct}%)</span>
            </div>
          </div>
          <ArrowDownRight size={18} color="var(--negative)" />
        </div>

        {/* Unchanged Tile */}
        <div style={{ padding: '10px 14px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--card-hover)', border: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>Unchanged</div>
            <div className="num-tabular" style={{ fontSize: '18px', fontWeight: 800, color: 'var(--text-primary)' }}>
              {formatNumber(unchanged, 0)} <span style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-muted)' }}>({unchPct}%)</span>
            </div>
          </div>
          <Activity size={18} color="var(--text-muted)" />
        </div>
      </div>

      {/* Segmented Breadth Bar */}
      <div
        style={{
          width: '100%',
          height: '8px',
          borderRadius: '4px',
          backgroundColor: 'var(--card-hover)',
          display: 'flex',
          overflow: 'hidden',
          gap: '2px',
        }}
      >
        <div
          style={{
            width: `${advPct}%`,
            background: 'var(--positive)',
            borderRadius: '4px 0 0 4px',
            boxShadow: 'none',
            transition: 'width 0.4s ease',
          }}
          title={`Advancing: ${advancing} (${advPct}%)`}
        />
        <div
          style={{
            width: `${unchPct}%`,
            backgroundColor: 'rgba(255, 255, 255, 0.2)',
            transition: 'width 0.4s ease',
          }}
          title={`Unchanged: ${unchanged} (${unchPct}%)`}
        />
        <div
          style={{
            width: `${decPct}%`,
            background: 'var(--negative)',
            borderRadius: '0 4px 4px 0',
            boxShadow: 'none',
            transition: 'width 0.4s ease',
          }}
          title={`Declining: ${declining} (${decPct}%)`}
        />
      </div>
    </div>
  );
}

export default MarketBreadthBar;

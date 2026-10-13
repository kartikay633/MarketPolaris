// ROADMAP: Section 5 & Design Refinement — Institutional Index Card
import React from 'react';
import { formatNumber, formatPercent } from '../../utils/formatters';
import { TrendingUp, TrendingDown } from 'lucide-react';

export function IndexCard({ index, onClick }) {
  if (!index) return null;

  const isPositive = index.change >= 0;
  const strokeColor = isPositive ? 'var(--positive)' : 'var(--negative)';
  const gradId = `spark-${index.symbol || index.name}`.replace(/[^a-zA-Z0-9]/g, '');

  // Calculate day range percentage (low to high)
  const range = (index.high && index.low && index.high > index.low)
    ? Math.min(Math.max(((index.value - index.low) / (index.high - index.low)) * 100, 0), 100)
    : 50;

  // Mini sparkline path representation
  const sparklinePoints = isPositive
    ? "0,28 15,24 30,26 45,18 60,20 75,12 90,14 105,6 120,4 135,2 140,2"
    : "0,4 15,6 30,12 45,10 60,18 75,16 90,22 105,20 120,26 135,28 140,28";

  const areaPoints = isPositive
    ? `0,28 15,24 30,26 45,18 60,20 75,12 90,14 105,6 120,4 135,2 140,2 140,32 0,32`
    : `0,4 15,6 30,12 45,10 60,18 75,16 90,22 105,20 120,26 135,28 140,28 140,32 0,32`;

  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick(event); } } : undefined}
      className={`index-card ${isPositive ? 'index-card--positive' : 'index-card--negative'}`}
      style={{ cursor: onClick ? 'pointer' : 'default', position: 'relative' }}
    >
      {/* Ambient corner glow */}
      <div
        style={{
          position: 'absolute',
          top: '-20px',
          right: '-20px',
          width: '90px',
          height: '90px',
          background: 'transparent',
          pointerEvents: 'none',
          filter: 'blur(10px)',
        }}
      />

      {/* Header: Name & Change Badge */}
      <div className="index-card-heading" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', zIndex: 1 }}>
        <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.02em' }}>
          {index.name}
        </span>
        <span 
          className={`badge ${isPositive ? 'badge--positive' : 'badge--negative'}`}
          style={{
            padding: '3px 8px',
            fontSize: '11px',
            fontWeight: 700,
            borderRadius: 'var(--radius-xs)',
            boxShadow: 'none',
          }}
        >
          {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {formatPercent(index.changePercent)}
        </span>
      </div>

      {/* Mid Section: Value & Mini Sparkline Graphic */}
      <div className="index-card-value" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: '12px', position: 'relative', zIndex: 1 }}>
        <div>
          <div className="num-tabular" style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            {formatNumber(index.value, 2)}
          </div>
          <div className="num-tabular" style={{ fontSize: '12.5px', fontWeight: 600, color: isPositive ? 'var(--positive-text)' : 'var(--negative-text)', marginTop: '4px' }}>
            {isPositive ? '+' : ''}{formatNumber(index.change, 2)}
          </div>
        </div>

        {/* Mini SVG Sparkline */}
        <div className="index-card-sparkline" style={{ width: '85px', height: '32px', opacity: 0.85 }}>
          <svg viewBox="0 0 140 32" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={strokeColor} stopOpacity="0.35" />
                <stop offset="100%" stopColor={strokeColor} stopOpacity="0.0" />
              </linearGradient>
            </defs>
            <polygon points={areaPoints} fill={`url(#${gradId})`} />
            <polyline
              points={sparklinePoints}
              fill="none"
              stroke={strokeColor}
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>

      {/* Day Range Bar with Position Indicator */}
      {index.low && index.high && (
        <div style={{ marginTop: '14px', position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10.5px', color: 'var(--text-muted)', marginBottom: '5px', fontWeight: 500 }}>
            <span>L: <strong style={{ color: 'var(--text-secondary)' }}>{formatNumber(index.low, 1)}</strong></span>
            <span>H: <strong style={{ color: 'var(--text-secondary)' }}>{formatNumber(index.high, 1)}</strong></span>
          </div>

          <div 
            style={{ 
              height: '4px', 
              borderRadius: '2px', 
              backgroundColor: 'var(--card-hover)',
              position: 'relative',
              overflow: 'visible',
            }}
          >
            {/* Active Range Fill */}
            <div
              style={{
                height: '100%',
                width: `${range}%`,
                backgroundColor: isPositive ? 'var(--positive)' : 'var(--negative)',
                borderRadius: '2px',
                boxShadow: 'none',
              }}
            />
            {/* Glowing pin dot marker */}
            <div
              style={{
                position: 'absolute',
                top: '-3px',
                left: `calc(${range}% - 5px)`,
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                backgroundColor: '#FFFFFF',
                border: `2px solid ${strokeColor}`,
                boxShadow: 'none',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default IndexCard;

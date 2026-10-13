// Flagship Sector Performance Bar — Premium sentiment-colored sector cards
import React from 'react';
import { formatPercent } from '../../utils/formatters';

export function SectorBar({ sectors = [] }) {
  if (!sectors || sectors.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
          Sectoral Performance
        </h3>
        <span style={{ fontSize: '10.5px', color: 'var(--text-dim)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          NSE Sector Indices
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: '8px' }}>
        {sectors.map((sec) => {
          const isPos = sec.changePercent >= 0;
          const barWidth = Math.min(Math.abs(sec.changePercent) * 25, 100);

          return (
            <div
              key={sec.name}
              style={{
                padding: '12px 14px',
                borderRadius: 'var(--radius-md)',
                background: isPos
                  ? 'linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(255,255,255,0.01) 100%)'
                  : 'linear-gradient(135deg, rgba(244,63,94,0.08) 0%, rgba(255,255,255,0.01) 100%)',
                border: isPos
                  ? '1px solid rgba(16,185,129,0.20)'
                  : '1px solid rgba(244,63,94,0.20)',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                transition: 'all var(--transition-fast)',
                cursor: 'default',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.3)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = '';
                e.currentTarget.style.boxShadow = '';
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {sec.name}
                </span>
                <span
                  className="num-tabular"
                  style={{
                    fontSize: '12px',
                    fontWeight: 700,
                    color: isPos ? 'var(--positive-text)' : 'var(--negative-text)',
                    padding: '1px 6px',
                    borderRadius: 'var(--radius-xs)',
                    backgroundColor: isPos ? 'rgba(16,185,129,0.10)' : 'rgba(244,63,94,0.10)',
                  }}
                >
                  {isPos ? '+' : ''}{formatPercent(sec.changePercent)}
                </span>
              </div>

              {/* Mini Bar Track */}
              <div style={{
                width: '100%', height: '3px', borderRadius: '2px',
                backgroundColor: 'var(--card-hover)', overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${barWidth}%`,
                  background: isPos
                    ? 'var(--positive)'
                    : 'var(--negative)',
                  boxShadow: 'none',
                  borderRadius: '2px',
                  transition: 'width 0.4s ease',
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default SectorBar;

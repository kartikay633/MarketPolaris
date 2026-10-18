// Sector pane — diverging bars around a zero line, scaled to the day's largest move.
import React from 'react';
import { formatPercent } from '../../utils/formatters';

export function SectorBar({ sectors = [], stamp = null }) {
  if (!sectors || sectors.length === 0) return null;

  const sorted = [...sectors].sort((a, b) => b.changePercent - a.changePercent);
  const maxAbs = Math.max(...sorted.map((s) => Math.abs(s.changePercent)), 0.5);

  return (
    <div className="fd-pane">
      <div className="fd-pane-head">
        <span className="fd-lbl">NSE sector indices · % change</span>
        {stamp || <span className="fd-lbl">NSE sector indices</span>}
      </div>
      <div style={{ marginTop: '10px' }}>
        {sorted.map((sec, i) => {
          const isPos = sec.changePercent >= 0;
          const half = (Math.abs(sec.changePercent) / maxAbs) * 50;
          return (
            <div key={sec.name} className="fd-sector">
              <span className="fd-sector-name" title={sec.name}>{sec.name.replace(/^Nifty\s+/i, '')}</span>
              <span className="fd-sector-track" aria-hidden="true">
                <span
                  style={{
                    left: isPos ? '50%' : `${50 - half}%`,
                    width: `${half}%`,
                    background: isPos ? 'var(--positive)' : 'var(--negative)',
                    animationDelay: `${i * 40}ms`,
                  }}
                />
              </span>
              <span className="fd-sector-pct" style={{ color: isPos ? 'var(--positive-text)' : 'var(--negative-text)' }}>
                {formatPercent(sec.changePercent)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default SectorBar;

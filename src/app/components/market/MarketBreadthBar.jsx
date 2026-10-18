// Market breadth pane — advancing / unchanged / declining counts across the tracked NSE universe.
import React from 'react';
import { formatNumber } from '../../utils/formatters';

export function MarketBreadthBar({ breadth, stamp = null }) {
  if (!breadth) return null;

  const { advancing = 0, declining = 0, unchanged = 0 } = breadth;
  const total = advancing + declining + unchanged || 1;

  const advPct = ((advancing / total) * 100).toFixed(1);
  const decPct = ((declining / total) * 100).toFixed(1);

  const adRatio = declining > 0 ? (advancing / declining).toFixed(2) : advancing;
  const isBullish = parseFloat(adRatio) >= 1.0;

  return (
    <div className="fd-pane">
      <div className="fd-pane-head">
        <span className="fd-lbl">Breadth · tracked NSE stocks</span>
        {stamp}
      </div>

      <div className="fd-breadth-nums">
        <div>
          <div className="fd-breadth-big" style={{ color: 'var(--positive-text)' }}>{formatNumber(advancing, 0)}</div>
          <div className="fd-breadth-sub">▲ Advancing · {advPct}%</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div className="fd-breadth-big" style={{ fontSize: '32px', color: 'var(--text-secondary)' }}>{formatNumber(unchanged, 0)}</div>
          <div className="fd-breadth-sub">Unchanged</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="fd-breadth-big" style={{ color: 'var(--negative-text)' }}>{formatNumber(declining, 0)}</div>
          <div className="fd-breadth-sub">{decPct}% · Declining ▼</div>
        </div>
      </div>

      <div
        className="fd-breadth-bar"
        role="img"
        aria-label={`${advancing} advancing, ${unchanged} unchanged, ${declining} declining`}
      >
        <div className="adv" style={{ flex: advancing || 0.0001 }} />
        <div className="unc" style={{ flex: unchanged || 0.0001 }} />
        <div className="dec" style={{ flex: declining || 0.0001 }} />
      </div>
      <div className="fd-lbl" style={{ marginTop: '12px', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
        <span>{formatNumber(total, 0)} large &amp; mid caps tracked</span>
        <span style={{ color: isBullish ? 'var(--positive-text)' : 'var(--negative-text)' }}>A/D {adRatio}</span>
      </div>
    </div>
  );
}

export default MarketBreadthBar;

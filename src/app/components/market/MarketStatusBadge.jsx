// ROADMAP: Section 2 & 8 — Market Status Badge Component
// Institutional Terminal Styling — Exact Market Pulse Design System
import React from 'react';

export function MarketStatusBadge({ status = 'CLOSED', reason, nextEvent, compact = false }) {
  const isLive = status === 'OPEN';
  const isPre = status === 'PRE_MARKET';
  const isPost = status === 'POST_MARKET';

  const dotColor = isLive
    ? 'var(--positive)'
    : isPre
    ? 'var(--warning)'
    : isPost
    ? 'var(--accent)'
    : 'var(--text-muted)';

  const bgColor = isLive
    ? 'var(--positive-muted)'
    : isPre
    ? 'var(--warning-muted)'
    : isPost
    ? 'var(--accent-muted)'
    : 'var(--card)';

  const borderColor = isLive
    ? 'var(--positive-border)'
    : isPre
    ? 'rgba(245, 158, 11, 0.25)'
    : isPost
    ? 'var(--accent-border)'
    : 'var(--border)';

  const label = isLive
    ? 'MARKET LIVE'
    : isPre
    ? 'PRE-OPEN'
    : isPost
    ? 'POST-MARKET'
    : 'MARKET CLOSED';

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: compact ? '2px 7px' : '4px 10px',
        borderRadius: 'var(--radius-xs)',
        backgroundColor: bgColor,
        border: `1px solid ${borderColor}`,
        fontSize: compact ? '10px' : '11px',
        fontWeight: 700,
        color: dotColor,
        letterSpacing: '0.04em',
        boxShadow: 'none',
      }}
      title={nextEvent || reason || label}
    >
      <span
        style={{
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          backgroundColor: dotColor,
          boxShadow: 'none',
        }}
        className={isLive ? 'animate-pulse' : ''}
      />
      <span style={{ color: dotColor }}>{label}</span>
      {!compact && nextEvent && (
        <span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: '10.5px', marginLeft: '4px' }}>
          • {nextEvent}
        </span>
      )}
    </div>
  );
}

export default MarketStatusBadge;

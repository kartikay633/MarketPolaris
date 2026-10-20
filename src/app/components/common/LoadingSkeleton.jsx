// ROADMAP: Section 5 — Loading Skeleton Component
// Institutional Terminal Styling — Exact Market Polaris Design System
import React from 'react';

export function Skeleton({ width = '100%', height = '20px', borderRadius = 'var(--radius-sm)', style = {} }) {
  return (
    <div
      className="skeleton"
      style={{
        width,
        height,
        borderRadius,
        ...style,
      }}
    />
  );
}

export function CardSkeleton() {
  return (
    <div
      className="card card-padded"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Skeleton width="90px" height="14px" />
        <Skeleton width="45px" height="18px" borderRadius="10px" />
      </div>
      <Skeleton width="130px" height="28px" />
      <div style={{ display: 'flex', gap: '8px' }}>
        <Skeleton width="60px" height="14px" />
        <Skeleton width="50px" height="14px" />
      </div>
    </div>
  );
}

export function TableSkeleton({ rows = 5 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="card"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <Skeleton width="120px" height="14px" />
            <Skeleton width="80px" height="12px" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
            <Skeleton width="90px" height="16px" />
            <Skeleton width="55px" height="12px" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ height = '460px' }) {
  return (
    <div
      className="card card-padded"
      style={{
        width: '100%',
        height,
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Skeleton width="180px" height="24px" />
        <Skeleton width="120px" height="24px" />
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: '8px', padding: '20px 0' }}>
        {Array.from({ length: 24 }).map((_, i) => (
          <Skeleton
            key={i}
            width="100%"
            height={`${30 + Math.sin(i) * 25 + (i % 5) * 10}%`}
            borderRadius="3px"
          />
        ))}
      </div>
    </div>
  );
}

export const LoadingSkeleton = Skeleton;
export default Skeleton;

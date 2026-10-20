// ROADMAP: Section 5 & 10 — AIInsightPanel Component
// Institutional Terminal Styling — Exact Market Polaris Design System
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAIStockInsight } from '../../hooks/useAI';
import { TrendingUp, TrendingDown, ArrowRight, ShieldCheck, Activity, Cpu } from 'lucide-react';
import { Skeleton } from '../common/LoadingSkeleton';

export default function AIInsightPanel({ symbol }) {
  const navigate = useNavigate();
  const { data: insight, isLoading } = useAIStockInsight(symbol);

  if (isLoading) {
    return (
      <div className="card card-padded" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Skeleton width="160px" height="20px" />
          <Skeleton width="70px" height="18px" borderRadius="4px" />
        </div>
        <Skeleton width="100%" height="45px" />
        <Skeleton width="85%" height="16px" />
      </div>
    );
  }

  const sentiment = insight?.sentiment || 'neutral';
  const isBullish = sentiment === 'bullish';
  const isBearish = sentiment === 'bearish';

  return (
    <div className="card card-padded">
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: 'var(--radius-xs)',
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent)',
            }}
          >
            <Cpu size={15} />
          </div>
          <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
            Pulse Research • AI Synthesis
          </h3>
        </div>

        <span
          className={`badge ${
            isBullish ? 'badge--positive' : isBearish ? 'badge--negative' : 'badge--accent'
          }`}
          style={{ textTransform: 'uppercase' }}
        >
          {isBullish ? <TrendingUp size={11} /> : isBearish ? <TrendingDown size={11} /> : <Activity size={11} />}
          {sentiment}
        </span>
      </div>

      {/* Insight Narrative */}
      <div
        style={{
          padding: '12px 14px',
          backgroundColor: 'var(--surface)',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--border-subtle)',
          marginBottom: '12px',
          fontSize: '13px',
          color: 'var(--text-primary)',
          lineHeight: 1.6,
        }}
      >
        {insight?.summary}
      </div>

      {/* Technical Note / Key Factor */}
      {insight?.technicalNote && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '14px' }}>
          <strong style={{ color: 'var(--accent)', fontWeight: 600 }}>Technical Factor:</strong>
          <span>{insight.technicalNote}</span>
        </div>
      )}

      {/* Action Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '10px', borderTop: '1px solid var(--border-subtle)' }}>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <ShieldCheck size={12} color="var(--positive)" /> Grounded on Upstox & Marketaux data
        </span>
        <button
          onClick={() => navigate(`/ai?q=Deep%20dive%20into%20${encodeURIComponent(symbol)}`)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            background: 'none',
            border: 'none',
            color: 'var(--accent)',
            fontWeight: 600,
            fontSize: '12px',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          <span>Terminal Query for {symbol}</span>
          <ArrowRight size={13} />
        </button>
      </div>
    </div>
  );
}

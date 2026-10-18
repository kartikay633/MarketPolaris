// ROADMAP: Section 5, 10 & Design Refinement — Institutional Market Intelligence Card
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAIMarketSummary } from '../../hooks/useAI';
import {
  Activity,
  ArrowRight,
  RefreshCw,
  ShieldCheck,
  Clock,
  Sparkles,
  TrendingUp,
  FileText,
  Compass,
  CheckCircle2,
  Calendar,
} from 'lucide-react';
import { Skeleton } from '../common/LoadingSkeleton';

export default function AISummaryCard() {
  const { data: summary, isLoading, refetch, isFetching } = useAIMarketSummary();
  const [activeTab, setActiveTab] = useState('summary'); // 'summary' | 'postmarket' | 'pivots'

  if (isLoading) {
    return (
      <div className="card card-padded" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Skeleton width="180px" height="18px" />
          <Skeleton width="90px" height="18px" borderRadius="4px" />
        </div>
        <Skeleton width="100%" height="24px" />
        <Skeleton width="90%" height="14px" />
        <Skeleton width="75%" height="14px" />
      </div>
    );
  }

  const isAfterMarket = summary?.isAfterMarket ?? true;
  const isBullish = summary?.marketStance === 'Bullish Momentum';
  // Everything below comes from the server's data-built brief; a missing figure is left out.
  const sessionFeed = summary?.sessionFeed || [];
  const pivots = summary?.levels?.pivots || null;
  const options = summary?.levels?.options || null;
  const levelTiles = [
    pivots && { label: 'NIFTY 50 Support', value: pivots.support, color: 'var(--positive)' },
    pivots && { label: 'NIFTY 50 Resistance', value: pivots.resistance, color: 'var(--negative)' },
    options?.maxPain && { label: 'Options Max Pain', value: `${options.maxPain} Strike`, color: 'var(--accent-bright)' },
    options?.pcr && { label: 'Put-Call Ratio (PCR)', value: options.pcr, color: 'var(--text-primary)' },
    options?.putWall && { label: 'Highest Put OI', value: `${options.putWall} Strike`, color: 'var(--positive)' },
    options?.callWall && { label: 'Highest Call OI', value: `${options.callWall} Strike`, color: 'var(--negative)' },
  ].filter(Boolean);

  return (
    <div 
      className="card card-padded" 
      style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        gap: '12px',
        border: isAfterMarket ? '1px solid rgba(59, 130, 246, 0.28)' : '1px solid var(--border)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Subtle background ambient orb for AI */}
      <div 
        style={{
          position: 'absolute',
          top: '-20px',
          right: '-20px',
          width: '120px',
          height: '120px',
          background: 'transparent',
          pointerEvents: 'none',
          filter: 'blur(15px)',
        }}
      />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <img
            src="/pulse_ai_core.jpg"
            alt="Pulse AI"
            style={{
              width: '24px',
              height: '24px',
              borderRadius: '50%',
              objectFit: 'cover',
              border: '1px solid rgba(59, 130, 246, 0.5)',
              boxShadow: 'none',
            }}
          />
          <div>
            <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>Pulse AI Intelligence</span>
              {isAfterMarket && (
                <span style={{ fontSize: '10px', color: 'var(--accent-bright)', fontWeight: 600 }}>• POST-MARKET</span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span className={`badge badge--sm ${isAfterMarket ? 'badge--accent' : (isBullish ? 'badge--positive' : 'badge--accent')}`} style={{ fontSize: '10px' }}>
            {isAfterMarket ? 'EOD SYNTHESIS' : (summary?.marketStance || 'Neutral')}
          </span>

          <button
            onClick={() => refetch()}
            title="Refresh Intelligence Digest"
            className="btn-icon"
            style={{ padding: '4px', width: '28px', height: '28px' }}
          >
            <RefreshCw size={12} style={{ animation: isFetching ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div 
        className="tab-group" 
        style={{ 
          backgroundColor: 'var(--card-hover)',
          border: '1px solid var(--border-subtle)',
          padding: '2px',
          borderRadius: 'var(--radius-sm)',
        }}
      >
        <button
          type="button"
          onClick={() => setActiveTab('summary')}
          className={`tab-pill${activeTab === 'summary' ? ' tab-pill--active' : ''}`}
          style={{ fontSize: '11px', padding: '4px 10px' }}
        >
          <FileText size={11} />
          <span>Last Day Wrap</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('postmarket')}
          className={`tab-pill${activeTab === 'postmarket' ? ' tab-pill--active' : ''}`}
          style={{ fontSize: '11px', padding: '4px 10px' }}
        >
          <Clock size={11} />
          <span>Session Data ({sessionFeed.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('pivots')}
          className={`tab-pill${activeTab === 'pivots' ? ' tab-pill--active' : ''}`}
          style={{ fontSize: '11px', padding: '4px 10px' }}
        >
          <Compass size={11} />
          <span>Key Levels</span>
        </button>
      </div>

      {/* TAB 1: Last Day Summary & Key Closing Drivers */}
      {activeTab === 'summary' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', position: 'relative', zIndex: 1 }}>
          <h3 style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-primary)', margin: 0, lineHeight: 1.4 }}>
            {summary?.headline}
          </h3>

          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0 }}>
            {summary?.summary}
          </p>

          {/* Key Drivers */}
          {summary?.keyDrivers && summary.keyDrivers.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', backgroundColor: 'var(--card-hover)', padding: '8px 10px', borderRadius: 'var(--radius-xs)', border: '1px solid var(--border-subtle)' }}>
              {summary.keyDrivers.map((driver, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: '6px', fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--accent)', fontWeight: 700, minWidth: '10px' }}>•</span>
                  <span style={{ lineHeight: 1.45 }}>{driver}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: The exchange data behind the brief, each with the time it was published */}
      {activeTab === 'postmarket' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', position: 'relative', zIndex: 1 }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px' }}>
            <Calendar size={12} />
            <span>{sessionFeed.length ? 'Exchange data behind this brief, with the time each figure is as of:' : 'Session data will appear once exchange figures are available.'}</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {sessionFeed.map((event, idx) => (
              <div 
                key={idx}
                style={{
                  padding: '8px 10px',
                  backgroundColor: 'rgba(255, 255, 255, 0.025)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '10.5px', fontWeight: 700, color: 'var(--accent-bright)', fontFamily: 'var(--font-mono)' }}>
                      {event.time}
                    </span>
                    <span className="badge badge--neutral" style={{ fontSize: '9px', padding: '1px 5px' }}>
                      {event.tag}
                    </span>
                  </div>
                </div>

                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {event.title}
                </div>

                <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                  {event.detail}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: Levels computed from the session's index and option-chain data */}
      {activeTab === 'pivots' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', position: 'relative', zIndex: 1 }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            {levelTiles.length === 0
              ? "Levels appear once the session's index and option-chain data are available."
              : [
                pivots && `Classic floor pivots from the ${pivots.basis} (pivot ${pivots.pivot})`,
                options && `NIFTY option chain${options.expiry ? ` for the ${options.expiry} expiry` : ''}`,
              ].filter(Boolean).join('; ') + '.'}
          </div>

          {levelTiles.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
              {levelTiles.map((tile) => (
                <div key={tile.label} style={{ padding: '8px', backgroundColor: 'var(--card-hover)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)' }}>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{tile.label}</div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: tile.color, fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                    {tile.value}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Footer CTA to /ai */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '8px', borderTop: '1px solid var(--border-subtle)', position: 'relative', zIndex: 1 }}>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <ShieldCheck size={12} color="var(--positive)" /> Built from NSE &amp; Upstox market data
        </span>
        <Link
          to="/ai"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px',
            fontSize: '12px',
            color: 'var(--accent-bright)',
            fontWeight: 600,
            textDecoration: 'none',
            backgroundColor: 'rgba(168, 85, 247, 0.12)',
            padding: '3px 8px',
            borderRadius: 'var(--radius-xs)',
            border: '1px solid rgba(168, 85, 247, 0.3)',
          }}
        >
          <Sparkles size={12} color="#c084fc" />
          <span>Launch Agentic Quant Lab (5-Yr ML)</span>
          <ArrowRight size={13} />
        </Link>
      </div>
    </div>
  );
}

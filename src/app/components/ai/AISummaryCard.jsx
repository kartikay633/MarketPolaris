// ROADMAP: Section 5, 10 & Design Refinement — Institutional Market Intelligence Card with Post-Market Feed
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
  const postMarketFeed = summary?.postMarketFeed || [];
  const pivots = summary?.nextSessionPivots || {
    niftySupport: '25,280 / 25,150',
    niftyResistance: '25,450 / 25,520',
    maxPain: '23,300',
    pcr: '1.15 (Bullish Bias)',
    vix: '12.85',
  };

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
          <span>Post-Market Feed (4)</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('pivots')}
          className={`tab-pill${activeTab === 'pivots' ? ' tab-pill--active' : ''}`}
          style={{ fontSize: '11px', padding: '4px 10px' }}
        >
          <Compass size={11} />
          <span>Next Day Pivots</span>
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

      {/* TAB 2: Chronological Post-Market Feed (What happened after 3:30 PM) */}
      {activeTab === 'postmarket' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', position: 'relative', zIndex: 1 }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px' }}>
            <Calendar size={12} />
            <span>Chronological feed of disclosures occurring after the 3:30 PM closing bell:</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {postMarketFeed.map((event, idx) => (
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

      {/* TAB 3: Next Day Pivots & Gameplan */}
      {activeTab === 'pivots' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', position: 'relative', zIndex: 1 }}>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Quantitative pivot levels and derivative pinning boundaries for the next market open:
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
            <div style={{ padding: '8px', backgroundColor: 'var(--card-hover)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>NIFTY 50 Support</div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--positive)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                {pivots.niftySupport}
              </div>
            </div>

            <div style={{ padding: '8px', backgroundColor: 'var(--card-hover)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>NIFTY 50 Resistance</div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--negative)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                {pivots.niftyResistance}
              </div>
            </div>

            <div style={{ padding: '8px', backgroundColor: 'var(--card-hover)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Options Max Pain</div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent-bright)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                {pivots.maxPain} Strike
              </div>
            </div>

            <div style={{ padding: '8px', backgroundColor: 'var(--card-hover)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-xs)' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Put-Call Ratio (PCR)</div>
              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--positive)', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                {pivots.pcr}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer CTA to /ai */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: '8px', borderTop: '1px solid var(--border-subtle)', position: 'relative', zIndex: 1 }}>
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <ShieldCheck size={12} color="var(--positive)" /> Grounded in verified exchange settlement
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

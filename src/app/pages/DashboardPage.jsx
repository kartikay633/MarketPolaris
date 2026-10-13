// ROADMAP: Section 2, 5 & Design Refinement — Institutional Market Terminal Dashboard (Market overview)
import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useMarketOverview, useGainers, useLosers, useActive } from '../hooks/useMarketData';
import { useMarketNews } from '../hooks/useNews';
import { usePortfolio, useResetPortfolio, useAddFunds } from '../hooks/useTrade';
import IndexCard from '../components/market/IndexCard';
import MarketBreadthBar from '../components/market/MarketBreadthBar';
import SectorBar from '../components/market/SectorBar';
import CompanyLogo from '../components/common/CompanyLogo';
import AISummaryCard from '../components/ai/AISummaryCard';
import { CardSkeleton, TableSkeleton } from '../components/common/LoadingSkeleton';
import ErrorBoundary from '../components/common/ErrorBoundary';
import { formatINR, formatIndianNumber } from '../utils/formatters';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Wallet,
  ArrowRight,
  RefreshCw,
  Newspaper,
  ShieldCheck,
  Zap,
  Sparkles,
  Star,
  BarChart3,
  Flame,
  ArrowUpRight,
  ExternalLink,
  Layers,
  PlusCircle,
  RotateCcw,
} from 'lucide-react';

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user, profile } = useAuthStore();
  const [activeTab, setActiveTab] = useState('gainers');

  const { data: overview, isLoading: isOverviewLoading, refetch: refetchOverview } = useMarketOverview();
  const { data: gainers = [], isLoading: isGainersLoading } = useGainers(15);
  const { data: losers = [], isLoading: isLosersLoading } = useLosers(15);
  const { data: active = [], isLoading: isActiveLoading } = useActive(15);
  const { data: marketNews = [] } = useMarketNews('all', 6);

  // Live Simulated Capital Queries & Mutations
  const { data: portfolioData, refetch: refetchPortfolio } = usePortfolio();
  const resetMutation = useResetPortfolio();
  const addFundsMutation = useAddFunds();

  const cashBalance = portfolioData?.account?.cashBalance ?? 1000000;
  const portfolioTotalValue = portfolioData?.account?.portfolioTotalValue ?? cashBalance;

  const displayName = profile?.displayName || user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Trader';

  const [isRefreshing, setIsRefreshing] = useState(false);
  const handleRefresh = () => {
    setIsRefreshing(true);
    refetchOverview();
    refetchPortfolio();
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  // Institutional data from overview or fallback
  const institutionalFlows = overview?.institutionalFlows || {
    fiiNet: 1842.60,
    fiiBuy: 12410.20,
    fiiSell: 10567.60,
    diiNet: 2110.45,
    diiBuy: 9820.50,
    diiSell: 7710.05,
    date: '19-Sep-2026',
  };

  const turnover = overview?.turnover || {
    nseCash: '₹42,180 Cr',
    bseCash: '₹6,430 Cr',
    totalCash: '₹48,610 Cr',
    nseFo: '₹182.4 Lakh Cr',
    totalTrades: '2.45 Cr',
  };

  // 52-week high breakout stocks (filtered from gainers/active near high)
  const breakouts = gainers.filter(s => {
    if (!s.fiftyTwoWeekHigh || !s.ltp) return false;
    return (s.ltp / s.fiftyTwoWeekHigh) >= 0.90;
  });

  return (
    <ErrorBoundary>
      <div className="page-container dashboard-page">
        {/* Terminal Header & Virtual Capital Telemetry */}
        <div 
          className="dashboard-heading"
          style={{ 
            display: 'flex', 
            flexWrap: 'wrap', 
            alignItems: 'center', 
            justifyContent: 'space-between', 
            gap: '18px',
            background: 'var(--surface)',
            borderColor: 'rgba(59, 130, 246, 0.25)',
            boxShadow: 'none',
            position: 'relative',
            overflow: 'hidden'
          }}
        >
          {/* Subtle ambient light orb */}
          <div 
            style={{
              position: 'absolute',
              top: '-30px',
              left: '-20px',
              width: '180px',
              height: '180px',
              background: 'transparent',
              pointerEvents: 'none',
              filter: 'blur(20px)',
            }} 
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 style={{ fontSize: 'var(--text-xl)', fontWeight: 700, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>
                Market overview
              </h1>
              {overview?.status === 'CLOSED' ? (
                <span className="badge badge--accent" style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                  POST-MARKET WRAP &amp; OVERNIGHT FEED
                </span>
              ) : (
                <span className="badge badge--live">
                  NSE &amp; BSE LIVE TELEMETRY
                </span>
              )}
            </div>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: 0 }}>
              {overview?.status === 'CLOSED'
                ? 'Last trading session closing settlement & after-hours corporate disclosures synchronized.'
                : 'National & Bombay Stock Exchange feeds synchronized.'}{' '}
              Welcome back, <strong style={{ color: 'var(--text-primary)' }}>{displayName}</strong>.
            </p>

            {/* Quick Action Navigation Pills */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
              <Link
                to="/trade"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '5px 12px',
                  borderRadius: 'var(--radius-xs)',
                  backgroundColor: 'rgba(59, 130, 246, 0.18)',
                  color: 'var(--accent-bright)',
                  border: '1px solid rgba(59, 130, 246, 0.40)',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  textDecoration: 'none',
                  boxShadow: 'none',
                }}
              >
                <Zap size={13} />
                <span>Paper trading</span>
              </Link>
              <Link
                to="/markets"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '5px 12px',
                  borderRadius: 'var(--radius-xs)',
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border)',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  textDecoration: 'none',
                }}
              >
                <BarChart3 size={13} color="var(--accent)" />
                <span>Screener &amp; heatmap</span>
              </Link>
              <Link
                to="/ai"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '5px 12px',
                  borderRadius: 'var(--radius-xs)',
                  backgroundColor: 'rgba(168, 85, 247, 0.15)',
                  color: 'var(--accent-bright)',
                  border: '1px solid rgba(168, 85, 247, 0.40)',
                  fontSize: '11.5px',
                  fontWeight: 600,
                  textDecoration: 'none',
                  boxShadow: 'none',
                }}
              >
                <Sparkles size={13} color="#c084fc" />
                <span>Pulse AI research</span>
              </Link>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', position: 'relative', zIndex: 1 }}>
            {/* Live Virtual Capital Console */}
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '12px', 
              padding: '10px 18px', 
              borderRadius: 'var(--radius-md)', 
              backgroundColor: 'var(--surface)', 
              border: '1px solid var(--border)',
              boxShadow: 'none',
              backdropFilter: 'blur(10px)'
            }}>
              <div style={{ 
                width: '32px', 
                height: '32px', 
                borderRadius: 'var(--radius-sm)', 
                backgroundColor: 'rgba(59, 130, 246, 0.12)', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                border: '1px solid rgba(59, 130, 246, 0.25)'
              }}>
                <Wallet size={16} color="var(--accent-bright)" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                  Available Cash
                </span>
                <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--positive)', fontFamily: 'var(--font-mono)', letterSpacing: '-0.02em' }}>
                  ₹{formatIndianNumber(cashBalance)}
                </span>
              </div>

              {/* Quick Add Funds in Header */}
              <button
                type="button"
                onClick={() => addFundsMutation.mutate(100000)}
                disabled={addFundsMutation.isPending}
                title="Add ₹1L virtual trading cash"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '3px',
                  padding: '4px 8px',
                  borderRadius: 'var(--radius-xs)',
                  backgroundColor: 'rgba(16, 185, 129, 0.12)',
                  color: 'var(--positive)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  marginLeft: '4px',
                }}
              >
                <PlusCircle size={11} />
                <span>+₹1L</span>
              </button>
            </div>

            <button
              className="btn-icon"
              onClick={handleRefresh}
              title="Refresh Quotes"
              style={{
                width: '38px',
                height: '38px',
                backgroundColor: 'var(--card-hover)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                boxShadow: 'none'
              }}
            >
              <RefreshCw size={15} className={isRefreshing ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {/* Benchmark Indices Grid */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 600, color: 'var(--text-primary)', letterSpacing: '0.02em', margin: 0 }}>
              Benchmark Indices
            </h2>
            <Link to="/markets" style={{ fontSize: 'var(--text-sm)', color: 'var(--accent)', fontWeight: 500 }}>
              Explore markets &rarr;
            </Link>
          </div>

          {isOverviewLoading ? (
            <div className="benchmark-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: '12px' }}>
              <CardSkeleton />
              <CardSkeleton />
              <CardSkeleton />
              <CardSkeleton />
            </div>
          ) : (
            <div className="benchmark-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: '12px' }}>
              {overview?.indices?.map((idx) => (
                <IndexCard key={idx.symbol} index={idx} onClick={() => navigate('/markets')} />
              ))}
            </div>
          )}
        </section>

        {/* Institutional Command Telemetry Ribbon */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',
          gap: '12px',
        }}>
          {/* Turnover Telemetry Card */}
          <div className="card card-padded" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Market Turnover (Cash &amp; F&amp;O)
              </span>
              <span className="badge badge--neutral" style={{ fontSize: '10px' }}>NSE + BSE</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                {turnover.totalCash}
              </span>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Cash</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11.5px', color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)', paddingTop: '6px' }}>
              <span>NSE Cash: <strong style={{ color: 'var(--text-primary)' }}>{turnover.nseCash}</strong></span>
              <span>F&amp;O Notional: <strong style={{ color: 'var(--accent-bright)' }}>{turnover.nseFo}</strong></span>
            </div>
          </div>

          {/* FII / DII Institutional Flows Card */}
          <div className="card card-padded" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                FII &amp; DII Institutional Flow
              </span>
              <span className="badge badge--positive" style={{ fontSize: '10px' }}>NET BUYERS</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>FII NET</div>
                <div style={{ fontSize: '15px', fontWeight: 700, color: institutionalFlows.fiiNet >= 0 ? 'var(--positive)' : 'var(--negative)', fontFamily: 'var(--font-mono)' }}>
                  {institutionalFlows.fiiNet >= 0 ? '+' : ''}₹{formatIndianNumber(institutionalFlows.fiiNet)} Cr
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)' }}>DII NET</div>
                <div style={{ fontSize: '15px', fontWeight: 700, color: institutionalFlows.diiNet >= 0 ? 'var(--positive)' : 'var(--negative)', fontFamily: 'var(--font-mono)' }}>
                  {institutionalFlows.diiNet >= 0 ? '+' : ''}₹{formatIndianNumber(institutionalFlows.diiNet)} Cr
                </div>
              </div>
            </div>
            {/* Visual Net Accumulation Track */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10.5px', color: 'var(--positive)' }}>
              <TrendingUp size={12} />
              <span>Total Institutional Inflow: <strong>+₹{formatIndianNumber(institutionalFlows.fiiNet + institutionalFlows.diiNet)} Cr</strong></span>
            </div>
          </div>

          {/* Volatility & Regime Radar */}
          <div className="card card-padded" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Volatility &amp; Market Regime
              </span>
              <span className="badge badge--accent" style={{ fontSize: '10px' }}>RISK NORMAL</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                INDIA VIX: 12.85
              </span>
              <span style={{ fontSize: '12px', color: 'var(--positive)', fontWeight: 600 }}>-3.16%</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11.5px', color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)', paddingTop: '6px' }}>
              <span>Regime: <strong style={{ color: 'var(--positive)' }}>Low Volatility Bullish</strong></span>
              <span>PCR: <strong style={{ color: 'var(--accent-bright)' }}>1.15</strong></span>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* EXECUTIVE INTELLIGENCE & BREAKING MARKET WIRE (PROMINENT TOP SECTION)      */}
        {/* ========================================================================= */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sparkles size={16} color="var(--accent-bright)" />
              <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '0.02em', margin: 0 }}>
                Research &amp; market news
              </h2>
            </div>
            <span className="badge badge--accent" style={{ fontSize: '10.5px' }}>
              MARKET INTELLIGENCE
            </span>
          </div>

          <div className="research-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: '16px', alignItems: 'start' }}>
            {/* Left: Pulse AI Post-Market Intelligence Suite (Last Day Wrap, Overnight Feed, Pivots) */}
            <div>
              <AISummaryCard />
            </div>

            {/* Right: Breaking Market Wire */}
            <div className="card card-padded" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Newspaper size={15} color="var(--accent-bright)" />
                  <span style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text-primary)' }}>Breaking Market Wire</span>
                </div>
                <Link to="/news" style={{ fontSize: '11.5px', color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}>
                  All news &rarr;
                </Link>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {marketNews.length > 0 ? (
                  marketNews.slice(0, 5).map((article) => (
                    <a
                      key={article.id}
                      href={article.sourceUrl || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="card--interactive dashboard-news-item"
                      style={{
                        padding: '10px 12px',
                        backgroundColor: 'var(--surface)',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--border-subtle)',
                        textDecoration: 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '5px',
                        transition: 'all var(--transition-fast)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontSize: '10.5px', fontWeight: 600, color: 'var(--accent-bright)' }}>
                            {article.source}
                          </span>
                          <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>•</span>
                          <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                            {new Date(article.publishedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <span
                          className={`badge ${
                            article.sentiment === 'positive' ? 'badge--positive' :
                            article.sentiment === 'negative' ? 'badge--negative' :
                            'badge--neutral'
                          }`}
                          style={{ fontSize: '9.5px', padding: '1px 6px', textTransform: 'uppercase' }}
                        >
                          {article.sentiment || 'neutral'}
                        </span>
                      </div>

                      <div style={{ fontSize: '12.5px', fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.4 }}>
                        {article.title}
                      </div>

                      {article.relatedSymbols && article.relatedSymbols.length > 0 && (
                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '2px' }}>
                          {article.relatedSymbols.slice(0, 2).map(sym => (
                            <span key={sym} style={{ fontSize: '10px', color: 'var(--accent)', backgroundColor: 'rgba(59, 130, 246, 0.1)', padding: '1px 5px', borderRadius: '3px' }}>
                              #{sym.replace('NSE:', '')}
                            </span>
                          ))}
                        </div>
                      )}
                    </a>
                  ))
                ) : (
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', padding: '10px' }}>Loading financial news feed...</div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Market Breadth */}
        <section>
          {overview?.breadth && <MarketBreadthBar breadth={overview.breadth} />}
        </section>

        {/* Two-Column Terminal Layout: Movers on Left, Sector Rotation on Right */}
        <div className="market-analysis-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.45fr) minmax(0, 1fr)', gap: '16px', alignItems: 'start' }}>
          {/* Left Column: Intraday Market Movers & Institutional Activity */}
          <div className="card card-padded" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Tab Controls */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
              <div className="tab-group">
                <button
                  type="button"
                  onClick={() => setActiveTab('gainers')}
                  className={`tab-pill${activeTab === 'gainers' ? ' tab-pill--positive' : ''}`}
                >
                  <TrendingUp size={13} />
                  <span>Top Gainers ({gainers.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('losers')}
                  className={`tab-pill${activeTab === 'losers' ? ' tab-pill--negative' : ''}`}
                >
                  <TrendingDown size={13} />
                  <span>Top Losers ({losers.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('active')}
                  className={`tab-pill${activeTab === 'active' ? ' tab-pill--accent' : ''}`}
                >
                  <Activity size={13} />
                  <span>Volume Shockers ({active.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('breakouts')}
                  className={`tab-pill${activeTab === 'breakouts' ? ' tab-pill--active' : ''}`}
                >
                  <Flame size={13} />
                  <span>52W Breakouts ({breakouts.length})</span>
                </button>
              </div>

              <Link to="/markets" style={{ fontSize: '11.5px', color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}>
                Full Screener &rarr;
              </Link>
            </div>

            {/* High-Fidelity Stock Movers Table */}
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table dashboard-movers-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12.5px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    <th style={{ padding: '8px 12px', fontWeight: 600 }}>Instrument</th>
                    <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>LTP</th>
                    <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>24h Change</th>
                    <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Day Range</th>
                    <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Volume</th>
                    <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'center' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {isGainersLoading || isLosersLoading || isActiveLoading ? (
                    <tr>
                      <td colSpan={6} style={{ padding: '20px' }}>
                        <TableSkeleton rows={8} />
                      </td>
                    </tr>
                  ) : (
                    (() => {
                      const displayList = 
                        activeTab === 'gainers' ? gainers :
                        activeTab === 'losers' ? losers :
                        activeTab === 'active' ? active :
                        breakouts;

                      return displayList.slice(0, 10).map((s) => {
                        const isPositive = s.change >= 0;
                        const low = s.low || (s.ltp * 0.98);
                        const high = s.high || (s.ltp * 1.02);
                        const rangeSpan = Math.max(0.01, high - low);
                        const progressPct = Math.min(100, Math.max(0, ((s.ltp - low) / rangeSpan) * 100));

                        return (
                          <tr 
                            key={s.symbol}
                            style={{ 
                              borderBottom: '1px solid var(--border-subtle)', 
                              transition: 'background-color var(--transition-fast)',
                              cursor: 'pointer',
                            }}
                            className="stock-table-row"
                            onClick={() => navigate(`/stocks/${encodeURIComponent(s.symbol)}`)}
                          >
                            {/* Instrument + Logo */}
                            <td style={{ padding: '10px 12px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <CompanyLogo symbol={s.symbol} name={s.name} size={30} />
                                <div style={{ display: 'flex', flexDirection: 'column' }}>
                                  <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '13px' }}>
                                    {s.symbol.replace('NSE:', '').replace('BSE:', '')}
                                  </span>
                                  <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {s.name}
                                  </span>
                                </div>
                              </div>
                            </td>

                            {/* LTP */}
                            <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>
                              {formatINR(s.ltp)}
                            </td>

                            {/* 24h Change */}
                            <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                              <span
                                style={{
                                  display: 'inline-block',
                                  padding: '2px 8px',
                                  borderRadius: 'var(--radius-xs)',
                                  fontSize: '11.5px',
                                  fontWeight: 600,
                                  fontFamily: 'var(--font-mono)',
                                  backgroundColor: isPositive ? 'rgba(16, 185, 129, 0.14)' : 'rgba(244, 63, 94, 0.14)',
                                  color: isPositive ? 'var(--positive)' : 'var(--negative)',
                                  border: `1px solid ${isPositive ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)'}`,
                                }}
                              >
                                {isPositive ? '+' : ''}{s.changePercent?.toFixed(2)}%
                              </span>
                            </td>

                            {/* Day Range Mini-Bar */}
                            <td style={{ padding: '10px 12px', textAlign: 'right', minWidth: '110px' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-end' }}>
                                <div style={{ width: '80px', height: '4px', backgroundColor: 'var(--border)', borderRadius: '2px', position: 'relative' }}>
                                  <div 
                                    style={{ 
                                      position: 'absolute', 
                                      left: `${progressPct}%`, 
                                      top: '-2px', 
                                      width: '8px', 
                                      height: '8px', 
                                      borderRadius: '50%', 
                                      backgroundColor: isPositive ? 'var(--positive)' : 'var(--negative)',
                                      transform: 'translateX(-50%)',
                                      boxShadow: 'none',
                                    }} 
                                  />
                                </div>
                                <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                                  L: {formatIndianNumber(Math.round(low))} - H: {formatIndianNumber(Math.round(high))}
                                </span>
                              </div>
                            </td>

                            {/* Volume */}
                            <td style={{ padding: '10px 12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                              {formatIndianNumber(s.volume || 1000000)}
                            </td>

                            {/* Action: Fast Trade */}
                            <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate(`/trade?symbol=${encodeURIComponent(s.symbol)}`);
                                }}
                                style={{
                                  padding: '4px 10px',
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  borderRadius: 'var(--radius-xs)',
                                  backgroundColor: 'rgba(59, 130, 246, 0.12)',
                                  color: 'var(--accent-bright)',
                                  border: '1px solid rgba(59, 130, 246, 0.3)',
                                  cursor: 'pointer',
                                  transition: 'all var(--transition-fast)',
                                }}
                              >
                                Trade
                              </button>
                            </td>
                          </tr>
                        );
                      });
                    })()
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right Column: Sector Rotation & Screener Card */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Sector Performance Rotation */}
            {overview?.sectors && <SectorBar sectors={overview.sectors} />}

            {/* Quick Institutional Screener Callout */}
            <div 
              className="card card-padded"
              style={{
                background: 'var(--surface)',
                border: '1px solid rgba(59, 130, 246, 0.2)',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <BarChart3 size={15} color="var(--accent-bright)" />
                  <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                    Sector Heatmap &amp; Treemap
                  </span>
                </div>
                <span className="badge badge--accent" style={{ fontSize: '9.5px' }}>INTERACTIVE</span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>
                Visualize relative performance across Banking, IT, Energy, Auto, and Pharma sectors with size proportional to market capitalization.
              </p>
              <Link
                to="/markets"
                className="btn btn-secondary"
                style={{ padding: '8px 12px', fontSize: '12px', alignSelf: 'flex-start', marginTop: '4px', gap: '6px' }}
              >
                <span>Explore sector heatmap</span>
                <ArrowRight size={13} />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}

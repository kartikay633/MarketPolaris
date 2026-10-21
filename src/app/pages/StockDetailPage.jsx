// ROADMAP: Section 5, 8 & Phase 3 — StockDetailPage Component
// Institutional Terminal Styling — Exact Market Polaris Design System
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useStockQuote, useCandleHistory } from '../../app/hooks/useStockData';
import { useStockNews } from '../../app/hooks/useNews';
import { useWatchlist, useAddToWatchlist, useRemoveFromWatchlist } from '../hooks/useWatchlist';
import StockChart from '../components/charts/StockChart';
import NewsCard from '../components/news/NewsCard';
import AIInsightPanel from '../components/ai/AIInsightPanel';
import { MarketStatusBadge } from '../components/market/MarketStatusBadge';
import { LoadingSkeleton } from '../components/common/LoadingSkeleton';
import {
  TrendingUp,
  TrendingDown,
  Star,
  Zap,
  Share2,
  ArrowLeft,
  Newspaper,
  Info,
  Building,
} from 'lucide-react';
import { formatIndianNumber } from '../utils/formatters';
import { toast } from 'sonner';
import CompanyLogo from '../components/common/CompanyLogo';

export default function StockDetailPage() {
  const { symbol } = useParams();
  const navigate = useNavigate();
  const [timeframe, setTimeframe] = useState('1D');

  // Fetch stock quote, candles, and stock news
  const { data: quote, isLoading: isQuoteLoading, error: quoteError } = useStockQuote(symbol);
  const history = useCandleHistory(symbol, timeframe);
  const { data: stockNews = [] } = useStockNews(symbol, 4);

  // Watchlist integration
  const { data: watchlistItems = [] } = useWatchlist();
  const addWatchlistMutation = useAddToWatchlist();
  const removeWatchlistMutation = useRemoveFromWatchlist();

  const isWatchlisted = watchlistItems.some(
    (item) => (item.symbol || '').toUpperCase() === (symbol || '').toUpperCase()
  );

  const handleToggleWatchlist = () => {
    const sym = quote?.symbol || symbol;
    if (isWatchlisted) {
      removeWatchlistMutation.mutate(sym);
    } else {
      addWatchlistMutation.mutate(sym);
    }
  };

  const handleShare = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(window.location.href);
      toast.success('Symbol URL copied to clipboard');
    }
  };

  if (isQuoteLoading) {
    return (
      <div className="page-container-wide stock-detail-page">
        <LoadingSkeleton type="chart" />
        <div className="terminal-pair-grid" style={{ marginTop: '24px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
          <LoadingSkeleton type="card" />
          <LoadingSkeleton type="card" />
          <LoadingSkeleton type="card" />
          <LoadingSkeleton type="card" />
        </div>
      </div>
    );
  }

  if (quoteError || !quote) {
    return (
      <div className="empty-state" style={{ padding: '80px 20px', maxWidth: '480px', margin: '0 auto' }}>
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            backgroundColor: 'var(--card)',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
            color: 'var(--text-muted)',
          }}
        >
          <Info size={24} />
        </div>
        <h2 className="empty-state-title" style={{ fontSize: '18px' }}>
          Instrument Not Found
        </h2>
        <p className="empty-state-description" style={{ marginBottom: '24px' }}>
          Could not locate market data for symbol "{symbol}". Please check the ticker code or select an instrument from Markets.
        </p>
        <button
          onClick={() => navigate('/markets')}
          className="btn btn-primary"
        >
          <ArrowLeft size={15} />
          <span>Back to Markets</span>
        </button>
      </div>
    );
  }

  const isPositive = quote.change >= 0;
  const ltp = quote.ltp ?? 0;
  const change = quote.change ?? 0;
  const changePercent = quote.changePercent ?? 0;

  // A field the data source does not provide arrives as null and is shown as unavailable.
  const has = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));
  const price = (v) => (has(v) ? `₹${formatIndianNumber(v)}` : '—');

  // 52-Week Range calculation (only when both ends are known)
  const low52 = quote.fiftyTwoWeekLow;
  const high52 = quote.fiftyTwoWeekHigh;
  const has52 = has(low52) && has(high52);
  const range52Percent = has52 ? Math.min(Math.max(((ltp - low52) / (high52 - low52 || 1)) * 100, 0), 100) : 0;

  return (
    <div className="page-container-wide stock-detail-page">
      {/* Navigation Breadcrumb */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', fontSize: '12.5px' }}>
        <button
          onClick={() => navigate(-1)}
          className="btn btn-ghost"
          style={{ padding: '4px 8px', fontSize: '12px' }}
        >
          <ArrowLeft size={13} />
          <span>Back</span>
        </button>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ color: 'var(--text-muted)' }}>Equities</span>
        <span style={{ color: 'var(--border)' }}>/</span>
        <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{quote.symbol}</span>
      </div>

      {/* Stock Header Section */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {/* Company Logo — flagship branding moment */}
          <CompanyLogo
            symbol={(quote.symbol || '').replace('NSE:', '').replace('BSE:', '')}
            size={56}
            style={{ borderRadius: '10px', boxShadow: 'none' }}
          />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
              <h1 className="page-title" style={{ fontSize: '24px' }}>
                {quote.symbol}
              </h1>
              <span className="badge badge--accent">
                {quote.exchange || 'NSE'}
              </span>
              <MarketStatusBadge status={quote.marketStatus} />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', fontSize: '13px' }}>
              <span style={{ fontWeight: 500, color: 'var(--text-secondary)' }}>{quote.name}</span>
              {quote.sector && (
                <>
                  <span style={{ color: 'var(--border)' }}>•</span>
                  <span className="badge badge--sm">{quote.sector}</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Price & Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '20px' }}>
          <div style={{ textAlign: 'right' }}>
            <div className="num-tabular" style={{ fontSize: '32px', fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              ₹{formatIndianNumber(ltp)}
            </div>
            <div
              className={`num-tabular ${isPositive ? 'text-positive' : 'text-negative'}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '13px',
                fontWeight: 600,
                marginTop: '4px',
              }}
            >
              {isPositive ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              <span>
                {isPositive ? '+' : ''}₹{formatIndianNumber(Math.abs(change))} ({isPositive ? '+' : ''}{changePercent.toFixed(2)}%)
              </span>
            </div>
          </div>

          {/* Action CTAs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={handleToggleWatchlist}
              className="btn btn-secondary"
              style={{
                padding: '8px 14px',
                fontSize: '12px',
                borderColor: isWatchlisted ? 'var(--warning)' : undefined,
                color: isWatchlisted ? 'var(--warning)' : undefined,
              }}
            >
              <Star size={14} fill={isWatchlisted ? 'var(--warning)' : 'none'} />
              <span>{isWatchlisted ? 'Tracked' : 'Watchlist'}</span>
            </button>

            <button
              onClick={() => navigate(`/trade?symbol=${encodeURIComponent(quote.symbol)}`)}
              className="btn btn-primary"
              style={{ padding: '8px 16px', fontSize: '12px' }}
            >
              <Zap size={14} />
              <span>Simulate Order</span>
            </button>

            <button
              onClick={handleShare}
              title="Share Stock Link"
              className="btn-icon"
              style={{ padding: '8px 10px' }}
            >
              <Share2 size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Main Chart Section */}
      <div style={{ marginBottom: '24px' }}>
        <StockChart
          symbol={quote.symbol}
          candles={history.candles}
          isLoading={history.isLoading}
          selectedTimeframe={timeframe}
          onTimeframeChange={(tf) => setTimeframe(tf)}
          onLoadOlder={history.loadOlder}
          isLoadingOlder={history.loadingOlder}
          historyExhausted={history.exhausted}
        />
      </div>

      {/* Key Statistics Grid */}
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '12px', letterSpacing: '-0.01em' }}>
          Market Statistics
        </h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
            gap: '12px',
          }}
        >
          {/* Day Open */}
          <div className="card card-padded">
            <div className="stat-card-label" style={{ marginBottom: '4px' }}>
              Day Open
            </div>
            <div className="stat-card-value" style={{ fontSize: '18px' }}>
              {price(quote.open)}
            </div>
          </div>

          {/* Day Range (High / Low) */}
          <div className="card card-padded">
            <div className="stat-card-label" style={{ marginBottom: '4px' }}>
              Day Range
            </div>
            <div className="num-tabular" style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>
              {has(quote.high) && has(quote.low)
                ? <><span className="text-positive">{price(quote.high)}</span> / <span className="text-negative">{price(quote.low)}</span></>
                : '—'}
            </div>
          </div>

          {/* Previous Close */}
          <div className="card card-padded">
            <div className="stat-card-label" style={{ marginBottom: '4px' }}>
              Previous Close
            </div>
            <div className="stat-card-value" style={{ fontSize: '18px' }}>
              {price(quote.previousClose)}
            </div>
          </div>

          {/* Volume */}
          <div className="card card-padded">
            <div className="stat-card-label" style={{ marginBottom: '4px' }}>
              Trading Volume
            </div>
            <div className="stat-card-value" style={{ fontSize: '18px' }}>
              {has(quote.volume) ? formatIndianNumber(quote.volume, 0) : '—'}
            </div>
          </div>

          {/* 52-Week Range Bar */}
          <div className="card card-padded" style={{ gridColumn: 'span 2' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span className="stat-card-label">
                52-Week Range
              </span>
              <span className="num-tabular" style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                Current: <strong style={{ color: 'var(--text-primary)' }}>₹{formatIndianNumber(ltp)}</strong>
              </span>
            </div>
            {has52 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span className="num-tabular text-negative" style={{ fontSize: '12px', fontWeight: 600 }}>
                  {price(low52)}
                </span>
                <div className="progress-bar-track" style={{ flex: 1, height: '4px', position: 'relative', overflow: 'visible' }}>
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: `${range52Percent}%`,
                      backgroundColor: 'var(--accent)',
                      borderRadius: '2px',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      left: `${range52Percent}%`,
                      top: '-4px',
                      width: '12px',
                      height: '12px',
                      borderRadius: '50%',
                      backgroundColor: 'var(--text-primary)',
                      border: '2px solid var(--accent)',
                      transform: 'translateX(-50%)',
                      boxShadow: 'none',
                    }}
                  />
                </div>
                <span className="num-tabular text-positive" style={{ fontSize: '12px', fontWeight: 600 }}>
                  {price(high52)}
                </span>
              </div>
            ) : (
              <div style={{ fontSize: '12.5px', color: 'var(--text-muted)' }}>Not available</div>
            )}
          </div>

          {/* Classification */}
          <div className="card card-padded" style={{ gridColumn: 'span 2' }}>
            <div className="stat-card-label" style={{ marginBottom: '6px' }}>
              Classification
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Building size={15} color="var(--accent)" />
              <span style={{ fontSize: '13px', fontWeight: 600, color: quote.sector ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                {quote.sector || 'Sector not available'}
              </span>
              {quote.industry && (
                <>
                  <span style={{ color: 'var(--border)' }}>•</span>
                  <span style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                    {quote.industry}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Two Column Section: AI Synthesis & Related News */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: '16px', alignItems: 'start' }}>
        {/* Polaris AI Insights Panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {quote.covered === false && (
            <div className="alert-box" role="note">
              <span>
                Polaris AI forecasts and the AI portfolios cover 175 large and mid-cap NSE stocks, and this is not one of them.
                Its price, chart, news and paper trading work as usual.
              </span>
            </div>
          )}
          <AIInsightPanel symbol={quote.symbol} />
        </div>

        {/* Latest Stock News & Catalysts */}
        <div className="card card-padded">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
            <Newspaper size={16} color="var(--accent)" />
            <h3 style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
              Corporate Wire & Disclosures
            </h3>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {stockNews.length > 0 ? (
              stockNews.map((article) => (
                <NewsCard key={article.id} article={article} compact />
              ))
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px', padding: '16px 0' }}>
                No direct corporate filings or news found for this ticker today.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

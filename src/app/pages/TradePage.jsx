// ROADMAP: Section 5 & 11 — Paper Trade Terminal Component
// Institutional Terminal Styling — Exact Market Polaris Design System
import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useStockQuote } from '../hooks/useMarketData';
import { usePortfolio, useOrders, useExecuteTrade, useResetPortfolio, useAddFunds } from '../hooks/useTrade';
import {
  Zap,
  TrendingUp,
  TrendingDown,
  Clock,
  ArrowRight,
  AlertCircle,
  RefreshCw,
  Wallet,
  ShieldCheck,
  Search,
  CheckCircle2,
  ChevronDown,
  Sparkles,
  RotateCcw,
  PlusCircle,
  Sliders,
  DollarSign,
  Info,
  Layers,
  ArrowUpRight,
} from 'lucide-react';
import { formatIndianNumber, formatINR } from '../utils/formatters';
import ErrorBoundary from '../components/common/ErrorBoundary';
import CompanyLogo from '../components/common/CompanyLogo';
import { EQUITIES_UNIVERSE, searchEquities } from '../constants/equities';

const POPULAR_SYMBOLS = [
  'NSE:TATAMOTORS',
  'NSE:TATASTEEL',
  'NSE:TCS',
  'NSE:RELIANCE',
  'NSE:HDFCBANK',
  'NSE:INFY',
  'NSE:ICICIBANK',
  'NSE:SBIN',
];

// High-tech institutional synthesizer sound cue
function playExecutionSound(type = 'BUY') {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === 'BUY') {
      // Pleasant dual-pitch institutional chime (D5 -> A5)
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    } else {
      // Crisp exit tone (E5 -> C5)
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(659.25, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(523.25, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.3);
    }
  } catch (err) {
    // Web Audio blocked or unsupported; silent fallback
  }
}

// Highlight matching substring for YouTube-style autocomplete
function HighlightMatch({ text, query }) {
  if (!query || !text) return <span>{text}</span>;
  const q = query.trim().toLowerCase().replace(/^nse:|^bse:/, '');
  const index = text.toLowerCase().indexOf(q);
  if (index === -1) return <span>{text}</span>;

  const before = text.slice(0, index);
  const match = text.slice(index, index + q.length);
  const after = text.slice(index + q.length);

  return (
    <span>
      {before}
      <strong style={{ color: 'var(--accent-bright)', textDecoration: 'underline' }}>{match}</strong>
      {after}
    </span>
  );
}

export default function TradePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const urlSymbol = searchParams.get('symbol') || 'NSE:TATAMOTORS';
  const [selectedSymbol, setSelectedSymbol] = useState(urlSymbol);
  const [customInput, setCustomInput] = useState('');
  const [orderType, setOrderType] = useState('BUY'); // 'BUY' | 'SELL'
  const [quantity, setQuantity] = useState(10);
  const [isSuccessGlow, setIsSuccessGlow] = useState(false);

  // Typeahead Autocomplete State
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const searchContainerRef = useRef(null);

  // Sync if URL query param changes
  useEffect(() => {
    if (urlSymbol && urlSymbol !== selectedSymbol) {
      setSelectedSymbol(urlSymbol);
    }
  }, [urlSymbol]);

  // Live Quote & Portfolio Queries
  const { data: quote, isLoading: isQuoteLoading, refetch: refetchQuote } = useStockQuote(selectedSymbol);
  const { data: portfolioData, isLoading: isPortfolioLoading, refetch: refetchPortfolio } = usePortfolio();
  const { data: orders = [], isLoading: isOrdersLoading, refetch: refetchOrders } = useOrders(50);

  // Mutations
  const executeMutation = useExecuteTrade();
  const resetMutation = useResetPortfolio();
  const addFundsMutation = useAddFunds();

  const cashBalance = portfolioData?.account?.cashBalance ?? 1000000;
  const totalInvested = portfolioData?.account?.totalInvested ?? 0;
  const portfolioTotalValue = portfolioData?.account?.portfolioTotalValue ?? cashBalance;
  const positions = portfolioData?.positions ?? [];

  const currentPosition = positions.find(
    (p) => p.symbol.toUpperCase() === selectedSymbol.toUpperCase()
  );

  const ltp = quote?.ltp || 0;
  const isPositive = (quote?.change ?? 0) >= 0;

  // The paper engine fills delivery market orders at the live price (no limit orders, no leverage),
  // so the estimate uses the live price and the full order value.
  const effectivePrice = ltp;
  const marketOpen = quote?.marketStatus === 'OPEN';

  // Calculations
  const grossValue = Number((quantity * effectivePrice).toFixed(2));
  const requiredMargin = grossValue;

  // Validation
  const canBuy = marketOpen && orderType === 'BUY' && cashBalance >= requiredMargin && quantity > 0 && effectivePrice > 0;
  const canSell =
    marketOpen &&
    orderType === 'SELL' &&
    currentPosition &&
    currentPosition.quantity >= quantity &&
    quantity > 0 &&
    effectivePrice > 0;
  const isExecutable = orderType === 'BUY' ? canBuy : canSell;

  // Autocomplete Suggestions
  const suggestions = searchEquities(customInput, 8);
  const [dropdownDismissed, setDropdownDismissed] = useState(false);
  const showDropdown = !dropdownDismissed && customInput.trim().length > 0 && suggestions.length > 0;

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
        setIsSearchFocused(false);
        setDropdownDismissed(true);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectSymbol = (sym) => {
    setSelectedSymbol(sym);
    setSearchParams({ symbol: sym });
    setCustomInput('');
    setIsSearchFocused(false);
    setActiveSuggestionIndex(-1);
  };

  const handleSearchKeyDown = (e) => {
    if (!showDropdown || suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveSuggestionIndex((prev) => (prev + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveSuggestionIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeSuggestionIndex >= 0 && activeSuggestionIndex < suggestions.length) {
        handleSelectSymbol(suggestions[activeSuggestionIndex].symbol);
      } else if (suggestions.length > 0) {
        handleSelectSymbol(suggestions[0].symbol);
      }
    } else if (e.key === 'Escape') {
      setIsSearchFocused(false);
      setDropdownDismissed(true);
    }
  };

  const handleCustomSymbolSubmit = (e) => {
    e.preventDefault();
    if (!customInput.trim()) return;
    const sym = customInput.trim().toUpperCase();
    const formatted = sym.includes(':') ? sym : `NSE:${sym}`;
    handleSelectSymbol(formatted);
  };

  const handleExecute = () => {
    if (!isExecutable || executeMutation.isPending) return;

    playExecutionSound(orderType);
    setIsSuccessGlow(true);
    setTimeout(() => setIsSuccessGlow(false), 800);

    executeMutation.mutate(
      {
        symbol: selectedSymbol,
        type: orderType,
        quantity: parseInt(quantity, 10),
      },
      {
        onSuccess: () => {
          refetchQuote();
          refetchPortfolio();
          refetchOrders();
        },
      }
    );
  };

  // Allocation Percentage Quick Setters
  const handleSetAllocation = (percent) => {
    if (!effectivePrice || effectivePrice <= 0) return;
    const availableAllocated = cashBalance * (percent / 100);
    const maxAffordable = Math.floor(availableAllocated / effectivePrice);
    setQuantity(Math.max(1, maxAffordable));
  };

  const quickQtyList = [1, 5, 10, 25, 50, 100, 250];

  return (
    <ErrorBoundary>
      <div className="page-container-wide trade-page">
        {/* Institutional Simulated Capital Cockpit */}
        <div
          className="trade-heading"
          style={{
            marginBottom: '18px',
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            background: 'var(--surface)',
            borderColor: 'rgba(59, 130, 246, 0.28)',
            boxShadow: 'none',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* Header & Subtitle */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 className="page-title" style={{ fontSize: '20px', margin: 0 }}>
                Paper trading
              </h1>
              <span className="badge badge--live" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                <Zap size={11} /> LIVE EXECUTION ENGINE
              </span>
            </div>
            <p style={{ fontSize: '12.5px', color: 'var(--text-secondary)', margin: 0 }}>
              Zero-risk simulated terminal executing against live NSE / BSE price discovery ticks.
            </p>
          </div>

          {/* Capital Telemetry & Interactive Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', zIndex: 1 }}>
            {/* Free Cash Balance */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 16px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
              }}
            >
              <Wallet size={18} color="var(--accent-bright)" />
              <div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Available Cash
                </div>
                <div className="num-tabular" style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  ₹{formatIndianNumber(cashBalance)}
                </div>
              </div>
            </div>

            {/* Capital Quick Add & Reset Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                type="button"
                onClick={() => addFundsMutation.mutate(100000)}
                disabled={addFundsMutation.isPending}
                className="btn btn-secondary"
                style={{ padding: '6px 10px', fontSize: '11.5px', gap: '4px' }}
                title="Add ₹1,00,000 virtual trading cash"
              >
                <PlusCircle size={13} color="var(--positive)" />
                <span>+₹1L</span>
              </button>

              <button
                type="button"
                onClick={() => addFundsMutation.mutate(500000)}
                disabled={addFundsMutation.isPending}
                className="btn btn-secondary"
                style={{ padding: '6px 10px', fontSize: '11.5px', gap: '4px' }}
                title="Add ₹5,00,000 virtual trading cash"
              >
                <PlusCircle size={13} color="var(--positive)" />
                <span>+₹5L</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Reset virtual portfolio to ₹10,00,000 capital and clear paper positions?')) {
                    resetMutation.mutate();
                  }
                }}
                disabled={resetMutation.isPending}
                className="btn btn-ghost"
                style={{ padding: '6px 10px', fontSize: '11.5px', gap: '4px', color: 'var(--text-muted)' }}
                title="Reset portfolio back to ₹10,00,000 default"
              >
                <RotateCcw size={12} />
                <span>Reset</span>
              </button>
            </div>
          </div>
        </div>

        {/* Quick Select Ticker Bar + YouTube-style Live Search Dropdown */}
        <div style={{ marginBottom: '18px', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', marginRight: '4px' }}>
              Institutional Watchlist:
            </span>
            {POPULAR_SYMBOLS.map((sym) => {
              const isSel = sym.toUpperCase() === selectedSymbol.toUpperCase();
              const cleanSym = sym.replace('NSE:', '');
              return (
                <button
                  key={sym}
                  onClick={() => handleSelectSymbol(sym)}
                  className={`quick-select-chip ${isSel ? 'quick-select-chip--active' : ''}`}
                  style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <CompanyLogo symbol={cleanSym} size={18} />
                  <span>{cleanSym}</span>
                </button>
              );
            })}
          </div>

          {/* YouTube-Style Autocomplete Search Container */}
          <div
            ref={searchContainerRef}
            style={{
              position: 'relative',
              marginLeft: 'auto',
              minWidth: '280px',
            }}
          >
            <form onSubmit={handleCustomSymbolSubmit} style={{ display: 'flex', width: '100%' }}>
              <div style={{ position: 'relative', width: '100%' }}>
                <Search size={14} className="input-icon" style={{ color: 'var(--accent-bright)' }} />
                <input
                  id="trade-stock-search-input"
                  data-testid="stock-search"
                  type="text"
                  autoComplete="off"
                  value={customInput}
                  onChange={(e) => {
                    setCustomInput(e.target.value);
                    setDropdownDismissed(false);
                    setActiveSuggestionIndex(-1);
                    if (!isSearchFocused) setIsSearchFocused(true);
                  }}
                  onFocus={() => {
                    setIsSearchFocused(true);
                    setDropdownDismissed(false);
                  }}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Search stock e.g. 'tat' (Tata Motors, Tata Steel)..."
                  className="input input--with-icon"
                  style={{
                    width: '100%',
                    padding: '8px 12px 8px 36px',
                    fontSize: '12.5px',
                    borderRadius: showDropdown ? 'var(--radius-sm) var(--radius-sm) 0 0' : 'var(--radius-sm)',
                    borderColor: showDropdown ? 'var(--accent)' : 'var(--border)',
                    boxShadow: 'none',
                  }}
                />
              </div>
            </form>

            {/* Floating YouTube-style Typeahead Dropdown */}
            {showDropdown && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  width: '380px',
                  maxHeight: '360px',
                  overflowY: 'auto',
                  backgroundColor: 'var(--surface-elevated, #0d121f)',
                  border: '1px solid rgba(59, 130, 246, 0.35)',
                  borderTop: 'none',
                  borderRadius: '0 0 var(--radius-md) var(--radius-md)',
                  boxShadow: 'none',
                  zIndex: 9999,
                  backdropFilter: 'blur(20px)',
                }}
              >
                <div
                  style={{
                    padding: '6px 12px',
                    fontSize: '10px',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: 'var(--text-muted)',
                    borderBottom: '1px solid var(--border-subtle)',
                    display: 'flex',
                    justifyContent: 'space-between',
                  }}
                >
                  <span>Matches ({suggestions.length})</span>
                  <span>Use &uarr; &darr; arrow keys &amp; Enter</span>
                </div>

                {suggestions.map((item, idx) => {
                  const isActive = idx === activeSuggestionIndex;
                  const itemPositive = (item.change ?? 0) >= 0;

                  return (
                    <div
                      key={item.symbol}
                      onClick={() => handleSelectSymbol(item.symbol)}
                      onMouseEnter={() => setActiveSuggestionIndex(idx)}
                      style={{
                        padding: '10px 14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: '12px',
                        cursor: 'pointer',
                        backgroundColor: isActive ? 'rgba(59, 130, 246, 0.16)' : 'transparent',
                        borderLeft: isActive ? '3px solid var(--accent)' : '3px solid transparent',
                        borderBottom: '1px solid var(--border-subtle)',
                        transition: 'background-color 0.1s ease',
                      }}
                    >
                      {/* Logo + Ticker + Name */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                        <CompanyLogo symbol={item.symbol.replace('NSE:', '')} size={28} />
                        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                              <HighlightMatch text={item.symbol.replace('NSE:', '')} query={customInput} />
                            </span>
                            <span className="badge badge--accent badge--sm" style={{ fontSize: '9.5px', padding: '1px 5px' }}>
                              NSE
                            </span>
                          </div>
                          <span
                            style={{
                              fontSize: '11px',
                              color: 'var(--text-secondary)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              maxWidth: '170px',
                            }}
                          >
                            <HighlightMatch text={item.name} query={customInput} />
                          </span>
                        </div>
                      </div>

                      {/* LTP & Change */}
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div className="num-tabular" style={{ fontSize: '13px', fontWeight: 700, color: 'var(--text-primary)' }}>
                          ₹{formatIndianNumber(item.ltp)}
                        </div>
                        <div
                          className={`num-tabular ${itemPositive ? 'text-positive' : 'text-negative'}`}
                          style={{ fontSize: '11px', fontWeight: 600 }}
                        >
                          {itemPositive ? '+' : ''}{item.changePercent?.toFixed(2)}%
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* 2-Column Terminal Layout: Upgraded Order Ticket on Left, Position & Audit Log on Right */}
        <div className="terminal-panel-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(360px, 440px) 1fr', gap: '20px', alignItems: 'start' }}>
          {/* Order Ticket Card */}
          <div
            className="card card-padded"
            style={{
              transition: 'box-shadow 0.3s ease, border-color 0.3s ease',
              boxShadow: 'none',
            }}
          >
            {/* Live Ticker Header */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                marginBottom: '16px',
                paddingBottom: '14px',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <CompanyLogo symbol={selectedSymbol.replace('NSE:', '').replace('BSE:', '')} size={42} />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
                      {quote?.symbol || selectedSymbol}
                    </h2>
                    <span className="badge badge--accent badge--sm">NSE</span>
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '12px', marginTop: '2px' }}>
                    {quote?.name || 'Listed Equity'}
                  </div>
                </div>
              </div>

              <div style={{ textAlign: 'right' }}>
                <div className="num-tabular" style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)' }}>
                  ₹{formatIndianNumber(ltp)}
                </div>
                <div
                  className={`num-tabular ${isPositive ? 'text-positive' : 'text-negative'}`}
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: '4px',
                    marginTop: '2px',
                  }}
                >
                  {isPositive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                  <span>
                    {isPositive ? '+' : ''}₹{formatIndianNumber(Math.abs(quote?.change ?? 0))} ({isPositive ? '+' : ''}
                    {(quote?.changePercent ?? 0).toFixed(2)}%)
                  </span>
                </div>
              </div>
            </div>

            {/* Order Type Switcher (BUY vs SELL) */}
            <div className="order-type-switcher" style={{ marginBottom: '14px' }}>
              <button
                type="button"
                onClick={() => setOrderType('BUY')}
                className={`order-type-btn ${orderType === 'BUY' ? 'order-type-btn--buy' : ''}`}
              >
                <TrendingUp size={14} />
                <span>BUY / LONG</span>
              </button>
              <button
                type="button"
                onClick={() => setOrderType('SELL')}
                className={`order-type-btn ${orderType === 'SELL' ? 'order-type-btn--sell' : ''}`}
              >
                <TrendingDown size={14} />
                <span>SELL / EXIT</span>
              </button>
            </div>

            {/* The paper engine fills delivery (cash) market orders at the live price while the market is open. */}
            <div style={{ marginBottom: '14px', fontSize: '11.5px', color: 'var(--text-muted)' }}>
              Delivery order at market price · fills at the live price during market hours (9:15 AM – 3:30 PM IST)
            </div>
            {/* Quantity Input */}
            <div style={{ marginBottom: '14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <label className="form-label" style={{ marginBottom: 0 }}>Quantity (Shares)</label>
                {currentPosition && (
                  <span style={{ fontSize: '11px', color: 'var(--accent-bright)', fontWeight: 600 }}>
                    Owned: {currentPosition.quantity} shares
                  </span>
                )}
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)',
                  overflow: 'hidden',
                }}
              >
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="num-tabular"
                  style={{
                    flex: 1,
                    padding: '9px 12px',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-primary)',
                    fontSize: '15px',
                    fontWeight: 700,
                    outline: 'none',
                  }}
                />
                <div style={{ padding: '0 14px', color: 'var(--text-muted)', fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em' }}>
                  SHARES
                </div>
              </div>

              {/* Quick Stepper Pills */}
              <div className="qty-stepper" style={{ marginTop: '8px' }}>
                {quickQtyList.map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => setQuantity(num)}
                    className={`qty-stepper-btn ${quantity === num ? 'qty-stepper-btn--active' : ''}`}
                  >
                    +{num}
                  </button>
                ))}
              </div>

              {/* Capital Allocation % Chips (Calculates max affordable shares) */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' }}>
                <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontWeight: 600 }}>Capital %:</span>
                {[25, 50, 75, 100].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => handleSetAllocation(pct)}
                    style={{
                      padding: '3px 8px',
                      fontSize: '10.5px',
                      fontWeight: 600,
                      borderRadius: 'var(--radius-xs)',
                      backgroundColor: 'var(--card-hover)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {pct === 100 ? 'MAX 100%' : `${pct}%`}
                  </button>
                ))}
              </div>
            </div>

            {/* Institutional Margin & Cost Calculation Card */}
            <div
              style={{
                backgroundColor: 'var(--surface)',
                borderRadius: 'var(--radius-sm)',
                padding: '14px',
                border: '1px solid var(--border)',
                marginBottom: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Execution Price</span>
                <span className="num-tabular" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>₹{formatIndianNumber(effectivePrice)}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Gross Order Value</span>
                <span className="num-tabular" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>₹{formatIndianNumber(grossValue)}</span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', fontWeight: 600 }}>
                <span style={{ color: 'var(--accent-bright)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  {orderType === 'BUY' ? 'Cash required' : 'Cash received'}
                </span>
                <span className="num-tabular" style={{ color: 'var(--accent-bright)', fontSize: '13.5px' }}>
                  ₹{formatIndianNumber(requiredMargin)}
                </span>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '12px',
                  paddingTop: '6px',
                  borderTop: '1px solid var(--border-subtle)',
                }}
              >
                <span style={{ color: 'var(--text-secondary)' }}>Cash Post-Trade</span>
                <span
                  className={`num-tabular ${
                    orderType === 'BUY'
                      ? cashBalance - requiredMargin >= 0
                        ? 'text-positive'
                        : 'text-negative'
                      : 'text-positive'
                  }`}
                  style={{ fontWeight: 600 }}
                >
                  ₹{formatIndianNumber(orderType === 'BUY' ? cashBalance - requiredMargin : cashBalance + requiredMargin)}
                </span>
              </div>
            </div>

            {quote && !marketOpen && (
              <div className="alert-box" style={{ marginBottom: '14px' }}>
                <AlertCircle size={14} />
                <span>The market is closed, so paper orders cannot fill now. They fill at the live price from 9:15 AM to 3:30 PM IST on trading days.</span>
              </div>
            )}

            {/* Error / Insufficient Funds Alert */}
            {orderType === 'BUY' && cashBalance < requiredMargin && (
              <div className="alert-box alert-box--error" style={{ marginBottom: '14px' }}>
                <AlertCircle size={14} />
                <span>
                  Insufficient cash balance. Need ₹{formatIndianNumber(requiredMargin)} (Available: ₹{formatIndianNumber(cashBalance)}). Click <strong>+₹1L</strong> above to inject capital.
                </span>
              </div>
            )}

            {orderType === 'SELL' && (!currentPosition || currentPosition.quantity < quantity) && (
              <div className="alert-box alert-box--error" style={{ marginBottom: '14px' }}>
                <AlertCircle size={14} />
                <span>You hold {currentPosition?.quantity || 0} shares of {selectedSymbol}. Sell order exceeds available inventory.</span>
              </div>
            )}

            {/* Execute Button */}
            <button
              type="button"
              disabled={!isExecutable || executeMutation.isPending}
              onClick={handleExecute}
              className={`btn ${orderType === 'BUY' ? 'btn-buy' : 'btn-sell'}`}
              style={{
                width: '100%',
                padding: '12px',
                fontSize: '14px',
                fontWeight: 700,
                letterSpacing: '0.01em',
              }}
            >
              {executeMutation.isPending ? (
                <span>Executing Simulated Fill...</span>
              ) : (
                <>
                  <Zap size={16} />
                  <span>
                    Execute {orderType} Order • ₹{formatIndianNumber(requiredMargin)}
                  </span>
                </>
              )}
            </button>

            {/* Zero Brokerage & Execution Slip Callout */}
            <div
              style={{
                marginTop: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                color: 'var(--text-muted)',
                fontSize: '10.5px',
              }}
            >
              <ShieldCheck size={13} color="var(--positive)" />
              <span>Paper trading · no brokerage or taxes deducted · fills at the live price</span>
            </div>
          </div>

          {/* Right Column: Active Position Card & Order History Table */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Active Position Card */}
            {currentPosition && (
              <div
                className="card card-padded"
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '16px',
                  borderLeft: currentPosition.unrealizedPL >= 0 ? '3px solid var(--positive)' : '3px solid var(--negative)',
                }}
              >
                <div>
                  <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Active Holding ({currentPosition.symbol})
                  </div>
                  <div className="num-tabular" style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', marginTop: '2px' }}>
                    {currentPosition.quantity} Shares @ avg ₹{formatIndianNumber(currentPosition.avgPrice)}
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Unrealized P&L
                  </div>
                  <div
                    className={`num-tabular ${currentPosition.unrealizedPL >= 0 ? 'text-positive' : 'text-negative'}`}
                    style={{
                      fontSize: '15px',
                      fontWeight: 600,
                      marginTop: '2px',
                    }}
                  >
                    {currentPosition.unrealizedPL >= 0 ? '+' : ''}₹{formatIndianNumber(currentPosition.unrealizedPL)} (
                    {currentPosition.unrealizedPLPercent >= 0 ? '+' : ''}
                    {currentPosition.unrealizedPLPercent}%)
                  </div>
                </div>

                <button
                  onClick={() => navigate('/portfolio')}
                  className="btn btn-secondary"
                  style={{ padding: '6px 12px', fontSize: '12px' }}
                >
                  <span>View in Portfolio</span>
                  <ArrowRight size={12} />
                </button>
              </div>
            )}

            {/* Order Audit Log Table */}
            <div className="card" style={{ overflow: 'hidden' }}>
              <div
                style={{
                  padding: '12px 18px',
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  backgroundColor: 'var(--surface)',
                }}
              >
                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Clock size={14} color="var(--accent)" />
                  <span>Simulated Order Audit Log ({orders.length})</span>
                </div>
                <button
                  onClick={() => refetchOrders()}
                  title="Refresh orders"
                  className="btn btn-ghost"
                  style={{ padding: '4px 8px', fontSize: '11px', gap: '4px' }}
                >
                  <RefreshCw size={11} />
                  <span>Refresh</span>
                </button>
              </div>

              {orders.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-title">No executed paper orders yet</div>
                  <div className="empty-state-description">
                    Submit an order with the ticket on the left to start building your simulated portfolio.
                  </div>
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>TIME</th>
                        <th>INSTRUMENT</th>
                        <th>SIDE</th>
                        <th style={{ textAlign: 'right' }}>QTY</th>
                        <th style={{ textAlign: 'right' }}>EXEC PRICE</th>
                        <th style={{ textAlign: 'right' }}>VALUE</th>
                        <th style={{ textAlign: 'center' }}>STATUS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((o) => {
                        const isBuy = o.type === 'BUY';
                        const timeStr = o.createdAt
                          ? new Date(o.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                          : '--';
                        return (
                          <tr key={o.id}>
                            <td style={{ color: 'var(--text-muted)' }}>{timeStr}</td>
                            <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{o.symbol}</td>
                            <td>
                              <span className={`badge ${isBuy ? 'badge--positive' : 'badge--negative'}`}>
                                {o.type}
                              </span>
                            </td>
                            <td className="num-tabular" style={{ textAlign: 'right', color: 'var(--text-primary)' }}>{o.quantity}</td>
                            <td className="num-tabular" style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>₹{formatIndianNumber(o.price)}</td>
                            <td className="num-tabular" style={{ textAlign: 'right', fontWeight: 600, color: 'var(--text-primary)' }}>
                              ₹{formatIndianNumber(o.price * o.quantity)}
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <span className="badge badge--positive">
                                <CheckCircle2 size={10} />
                                EXECUTED
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}

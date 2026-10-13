// ROADMAP: Section 2, 5 & Design Refinement — Institutional Equities Screener & Market Structure Workstation
import React, { useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useMarketOverview, useGainers, useLosers, useActive } from '../hooks/useMarketData';
import MarketHeatmap from '../components/market/MarketHeatmap';
import CompanyLogo from '../components/common/CompanyLogo';
import { CardSkeleton, TableSkeleton } from '../components/common/LoadingSkeleton';
import ErrorBoundary from '../components/common/ErrorBoundary';
import { formatINR, formatIndianNumber } from '../utils/formatters';
import {
  Search,
  SlidersHorizontal,
  Layers,
  BarChart3,
  TrendingUp,
  TrendingDown,
  Activity,
  Flame,
  ShieldAlert,
  ArrowUpDown,
  Zap,
  ChevronDown,
  Info,
  ExternalLink,
} from 'lucide-react';

// Comprehensive Indian Equities Universe with Multi-Factor Attributes
const EQUITIES_UNIVERSE = [
  { symbol: 'NSE:RELIANCE', name: 'Reliance Industries Ltd', ltp: 2980.50, change: 65.10, changePercent: 2.23, high: 2995.00, low: 2922.00, fiftyTwoWeekHigh: 3217.90, fiftyTwoWeekLow: 2221.05, volume: 14200000, marketCap: '₹20.16T', sector: 'Energy & Power', pe: 28.4, beta: 1.12 },
  { symbol: 'NSE:TCS', name: 'Tata Consultancy Services', ltp: 4290.00, change: 62.00, changePercent: 1.47, high: 4320.00, low: 4235.00, fiftyTwoWeekHigh: 4592.25, fiftyTwoWeekLow: 3311.00, volume: 6800000, marketCap: '₹15.52T', sector: 'Technology & Software', pe: 31.8, beta: 0.85 },
  { symbol: 'NSE:HDFCBANK', name: 'HDFC Bank Limited', ltp: 1675.00, change: 28.50, changePercent: 1.73, high: 1684.00, low: 1648.50, fiftyTwoWeekHigh: 1794.00, fiftyTwoWeekLow: 1363.45, volume: 29400000, marketCap: '₹12.75T', sector: 'Banking & Financials', pe: 19.5, beta: 1.08 },
  { symbol: 'NSE:BHARTIARTL', name: 'Bharti Airtel Ltd', ltp: 1610.40, change: 26.20, changePercent: 1.65, high: 1622.00, low: 1585.00, fiftyTwoWeekHigh: 1690.00, fiftyTwoWeekLow: 890.00, volume: 11200000, marketCap: '₹9.42T', sector: 'Telecom & Infrastructure', pe: 54.2, beta: 0.92 },
  { symbol: 'NSE:ICICIBANK', name: 'ICICI Bank Ltd', ltp: 1228.30, change: 16.10, changePercent: 1.33, high: 1236.00, low: 1214.00, fiftyTwoWeekHigh: 1310.00, fiftyTwoWeekLow: 899.00, volume: 19800000, marketCap: '₹8.65T', sector: 'Banking & Financials', pe: 18.2, beta: 1.15 },
  { symbol: 'NSE:INFY', name: 'Infosys Limited', ltp: 1942.20, change: 52.80, changePercent: 2.80, high: 1955.00, low: 1898.00, fiftyTwoWeekHigh: 1990.00, fiftyTwoWeekLow: 1358.00, volume: 18200000, marketCap: '₹8.05T', sector: 'Technology & Software', pe: 29.6, beta: 1.04 },
  { symbol: 'NSE:SBIN', name: 'State Bank of India', ltp: 796.20, change: 7.80, changePercent: 0.99, high: 802.00, low: 789.00, fiftyTwoWeekHigh: 912.00, fiftyTwoWeekLow: 555.20, volume: 21300000, marketCap: '₹7.10T', sector: 'Banking & Financials', pe: 10.4, beta: 1.28 },
  { symbol: 'NSE:ITC', name: 'ITC Limited', ltp: 512.40, change: 5.20, changePercent: 1.03, high: 515.50, low: 507.00, fiftyTwoWeekHigh: 528.50, fiftyTwoWeekLow: 399.30, volume: 16500000, marketCap: '₹6.40T', sector: 'Consumer Goods & FMCG', pe: 27.5, beta: 0.65 },
  { symbol: 'NSE:LT', name: 'Larsen & Toubro Ltd', ltp: 3680.00, change: 44.50, changePercent: 1.22, high: 3705.00, low: 3640.00, fiftyTwoWeekHigh: 3919.90, fiftyTwoWeekLow: 2865.00, volume: 5400000, marketCap: '₹5.06T', sector: 'Engineering & Infrastructure', pe: 34.1, beta: 1.18 },
  { symbol: 'NSE:HCLTECH', name: 'HCL Technologies', ltp: 1680.00, change: 15.60, changePercent: 0.94, high: 1695.00, low: 1665.00, fiftyTwoWeekHigh: 1835.00, fiftyTwoWeekLow: 1205.00, volume: 4900000, marketCap: '₹4.56T', sector: 'Technology & Software', pe: 26.8, beta: 0.88 },
  { symbol: 'NSE:SUNPHARMA', name: 'Sun Pharmaceutical Ltd', ltp: 1845.00, change: -36.50, changePercent: -1.94, high: 1888.00, low: 1838.00, fiftyTwoWeekHigh: 1960.00, fiftyTwoWeekLow: 1110.00, volume: 8200000, marketCap: '₹4.43T', sector: 'Pharma & Healthcare', pe: 38.5, beta: 0.74 },
  { symbol: 'NSE:BAJFINANCE', name: 'Bajaj Finance', ltp: 6920.00, change: -45.00, changePercent: -0.65, high: 6990.00, low: 6890.00, fiftyTwoWeekHigh: 8190.00, fiftyTwoWeekLow: 6360.00, volume: 3100000, marketCap: '₹4.28T', sector: 'Banking & Financials', pe: 29.4, beta: 1.35 },
  { symbol: 'NSE:MARUTI', name: 'Maruti Suzuki India', ltp: 12450.00, change: 140.00, changePercent: 1.14, high: 12520.00, low: 12310.00, fiftyTwoWeekHigh: 13680.00, fiftyTwoWeekLow: 9737.00, volume: 1800000, marketCap: '₹3.91T', sector: 'Automobiles & Mobility', pe: 28.2, beta: 0.96 },
  { symbol: 'NSE:NTPC', name: 'NTPC Limited', ltp: 385.00, change: 3.40, changePercent: 0.89, high: 388.50, low: 381.00, fiftyTwoWeekHigh: 425.00, fiftyTwoWeekLow: 228.00, volume: 13500000, marketCap: '₹3.73T', sector: 'Energy & Power', pe: 16.5, beta: 1.05 },
  { symbol: 'NSE:ONGC', name: 'ONGC Limited', ltp: 295.40, change: -2.10, changePercent: -0.71, high: 299.00, low: 293.50, fiftyTwoWeekHigh: 344.00, fiftyTwoWeekLow: 179.00, volume: 15600000, marketCap: '₹3.72T', sector: 'Energy & Power', pe: 8.4, beta: 1.22 },
  { symbol: 'NSE:TATAMOTORS', name: 'Tata Motors Ltd', ltp: 984.60, change: 38.40, changePercent: 4.06, high: 994.00, low: 951.20, fiftyTwoWeekHigh: 1179.00, fiftyTwoWeekLow: 600.50, volume: 24500000, marketCap: '₹3.62T', sector: 'Automobiles & Mobility', pe: 16.2, beta: 1.42 },
  { symbol: 'NSE:KOTAKBANK', name: 'Kotak Mahindra Bank', ltp: 1780.00, change: -12.40, changePercent: -0.69, high: 1798.00, low: 1772.00, fiftyTwoWeekHigh: 1932.00, fiftyTwoWeekLow: 1544.00, volume: 6200000, marketCap: '₹3.54T', sector: 'Banking & Financials', pe: 21.0, beta: 1.02 },
  { symbol: 'NSE:M&M', name: 'Mahindra & Mahindra', ltp: 2850.00, change: 24.50, changePercent: 0.87, high: 2875.00, low: 2828.00, fiftyTwoWeekHigh: 3175.00, fiftyTwoWeekLow: 1475.00, volume: 4100000, marketCap: '₹3.54T', sector: 'Automobiles & Mobility', pe: 27.6, beta: 1.18 },
  { symbol: 'NSE:ASIANPAINT', name: 'Asian Paints Ltd', ltp: 3180.00, change: -34.00, changePercent: -1.06, high: 3225.00, low: 3165.00, fiftyTwoWeekHigh: 3568.00, fiftyTwoWeekLow: 2766.00, volume: 4300000, marketCap: '₹3.05T', sector: 'Consumer Goods & FMCG', pe: 52.4, beta: 0.82 },
  { symbol: 'NSE:TITAN', name: 'Titan Company Ltd', ltp: 3420.00, change: -22.00, changePercent: -0.64, high: 3450.00, low: 3405.00, fiftyTwoWeekHigh: 3886.95, fiftyTwoWeekLow: 3055.00, volume: 2900000, marketCap: '₹3.04T', sector: 'Consumer Goods & FMCG', pe: 82.1, beta: 0.95 },
  { symbol: 'NSE:COALINDIA', name: 'Coal India Ltd', ltp: 488.50, change: -7.10, changePercent: -1.43, high: 497.00, low: 485.20, fiftyTwoWeekHigh: 527.40, fiftyTwoWeekLow: 275.00, volume: 12800000, marketCap: '₹3.01T', sector: 'Energy & Power', pe: 8.1, beta: 1.14 },
  { symbol: 'NSE:WIPRO', name: 'Wipro Limited', ltp: 520.00, change: 3.10, changePercent: 0.60, high: 524.50, low: 516.00, fiftyTwoWeekHigh: 580.00, fiftyTwoWeekLow: 375.00, volume: 8800000, marketCap: '₹2.72T', sector: 'Technology & Software', pe: 23.4, beta: 0.89 },
  { symbol: 'NSE:JSWSTEEL', name: 'JSW Steel Ltd', ltp: 948.00, change: -13.20, changePercent: -1.37, high: 963.00, low: 944.00, fiftyTwoWeekHigh: 1040.00, fiftyTwoWeekLow: 737.00, volume: 9100000, marketCap: '₹2.32T', sector: 'Metals & Mining', pe: 25.1, beta: 1.34 },
  { symbol: 'NSE:TATASTEEL', name: 'Tata Steel Ltd', ltp: 151.20, change: -4.80, changePercent: -3.08, high: 156.40, low: 150.80, fiftyTwoWeekHigh: 184.60, fiftyTwoWeekLow: 114.25, volume: 32100000, marketCap: '₹1.88T', sector: 'Metals & Mining', pe: 42.0, beta: 1.55 },
  { symbol: 'NSE:HINDALCO', name: 'Hindalco Industries Ltd', ltp: 672.40, change: -18.20, changePercent: -2.64, high: 691.00, low: 669.50, fiftyTwoWeekHigh: 715.00, fiftyTwoWeekLow: 448.00, volume: 14500000, marketCap: '₹1.51T', sector: 'Metals & Mining', pe: 15.8, beta: 1.48 },
  { symbol: 'NSE:CIPLA', name: 'Cipla Limited', ltp: 1624.10, change: -27.30, changePercent: -1.65, high: 1655.00, low: 1618.00, fiftyTwoWeekHigh: 1702.00, fiftyTwoWeekLow: 1131.00, volume: 6400000, marketCap: '₹1.31T', sector: 'Pharma & Healthcare', pe: 28.9, beta: 0.68 },
  { symbol: 'NSE:DRREDDY', name: "Dr. Reddy's Laboratories", ltp: 6620.00, change: -82.00, changePercent: -1.22, high: 6710.00, low: 6595.00, fiftyTwoWeekHigh: 7104.00, fiftyTwoWeekLow: 5212.00, volume: 2400000, marketCap: '₹1.10T', sector: 'Pharma & Healthcare', pe: 20.4, beta: 0.72 },
];

const SECTOR_OPTIONS = [
  'All Sectors',
  'Banking & Financials',
  'Technology & Software',
  'Energy & Power',
  'Automobiles & Mobility',
  'Consumer Goods & FMCG',
  'Pharma & Healthcare',
  'Metals & Mining',
  'Telecom & Infrastructure',
  'Engineering & Infrastructure',
];

export default function MarketsPage() {
  const navigate = useNavigate();
  const { data: overview, isLoading: isOverviewLoading } = useMarketOverview();
  
  // Tab view: 'screener' vs 'treemap'
  const [viewMode, setViewMode] = useState('screener');

  // Screener filter states
  const [filterPreset, setFilterPreset] = useState('all');
  const [selectedSector, setSelectedSector] = useState('All Sectors');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('changePercent');
  const [sortOrder, setSortOrder] = useState('desc');

  // Derivatives metrics from overview or fallback
  const derivatives = overview?.derivatives || {
    pcr: 1.15,
    maxPain: 23300,
    atmIv: 12.4,
    callWall: 23500,
    putWall: 23200,
    sentiment: 'Bullish (PCR > 1.0)',
  };

  // Filtered & Sorted equities universe
  const filteredStocks = useMemo(() => {
    return EQUITIES_UNIVERSE.filter((stock) => {
      // Sector filter
      if (selectedSector !== 'All Sectors' && stock.sector !== selectedSector) {
        return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesSym = stock.symbol.toLowerCase().includes(q);
        const matchesName = stock.name.toLowerCase().includes(q);
        if (!matchesSym && !matchesName) return false;
      }

      // Presets
      if (filterPreset === 'gainers') {
        return stock.changePercent > 0;
      }
      if (filterPreset === 'losers') {
        return stock.changePercent < 0;
      }
      if (filterPreset === 'breakouts') {
        // within 6% of 52W high
        return (stock.ltp / stock.fiftyTwoWeekHigh) >= 0.94;
      }
      if (filterPreset === 'volume') {
        return stock.volume >= 15000000;
      }
      if (filterPreset === 'momentum') {
        return Math.abs(stock.changePercent) >= 1.5 || stock.beta >= 1.2;
      }
      if (filterPreset === 'value') {
        return stock.pe <= 22;
      }

      return true;
    }).sort((a, b) => {
      let valA = a[sortBy];
      let valB = b[sortBy];

      if (sortBy === 'marketCap') {
        // parse trillion
        valA = parseFloat(a.marketCap.replace('₹', '').replace('T', ''));
        valB = parseFloat(b.marketCap.replace('₹', '').replace('T', ''));
      }

      if (sortOrder === 'asc') {
        return valA > valB ? 1 : -1;
      }
      return valA < valB ? 1 : -1;
    });
  }, [filterPreset, selectedSector, searchQuery, sortBy, sortOrder]);

  const handleSort = (column) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
    } else {
      setSortBy(column);
      setSortOrder('desc');
    }
  };

  return (
    <ErrorBoundary>
      <div className="page-container markets-page">
        {/* Page Header */}
        <div className="page-header" style={{ marginBottom: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
              <h1 className="page-title">Markets &amp; screener</h1>
              <span className="badge badge--accent">
                QUANTITATIVE WORKSTATION
              </span>
            </div>
            <p className="page-subtitle">
              Multi-factor stock screening, derivatives PCR &amp; Max Pain telemetry, and dynamic equity treemap
            </p>
          </div>

          {/* View Mode Toggle Pill */}
          <div className="tab-group" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <button
              type="button"
              onClick={() => setViewMode('screener')}
              className={`tab-pill${viewMode === 'screener' ? ' tab-pill--active' : ''}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <SlidersHorizontal size={13} />
              <span>Equities Screener</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('treemap')}
              className={`tab-pill${viewMode === 'treemap' ? ' tab-pill--active' : ''}`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <Layers size={13} />
              <span>Market Treemap</span>
            </button>
          </div>
        </div>

        {/* Derivatives & Market Structure Radar Banner */}
        <div 
          className="card card-padded"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
            gap: '14px',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            boxShadow: 'none',
          }}
        >
          {/* NIFTY PCR */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              NIFTY Put-Call Ratio (PCR)
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span style={{ fontSize: '20px', fontWeight: 700, color: 'var(--positive)', fontFamily: 'var(--font-mono)' }}>
                {derivatives.pcr}
              </span>
              <span className="badge badge--positive" style={{ fontSize: '9.5px', padding: '1px 6px' }}>BULLISH BIAS</span>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Support accumulation zone</span>
          </div>

          {/* Max Pain Strike */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              Expiry Max Pain Strike
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span style={{ fontSize: '20px', fontWeight: 700, color: 'var(--accent-bright)', fontFamily: 'var(--font-mono)' }}>
                {formatIndianNumber(derivatives.maxPain)}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>25-SEP</span>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>F&amp;O Pinning Target</span>
          </div>

          {/* Major Call Wall (Resistance) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              Call Resistance Wall
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span style={{ fontSize: '20px', fontWeight: 700, color: 'var(--negative)', fontFamily: 'var(--font-mono)' }}>
                {formatIndianNumber(derivatives.callWall)} CE
              </span>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>1.20 Cr Open Interest</span>
          </div>

          {/* Major Put Wall (Support) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              Put Support Wall
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span style={{ fontSize: '20px', fontWeight: 700, color: 'var(--positive)', fontFamily: 'var(--font-mono)' }}>
                {formatIndianNumber(derivatives.putWall)} PE
              </span>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>1.45 Cr Open Interest</span>
          </div>

          {/* ATM Implied Volatility */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              ATM Implied Volatility (IV)
            </span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                {derivatives.atmIv}%
              </span>
              <span className="badge badge--neutral" style={{ fontSize: '9.5px', padding: '1px 6px' }}>MODERATE</span>
            </div>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Standard Options Premium</span>
          </div>
        </div>

        {/* VIEW 1: Institutional Quantitative Stock Screener */}
        {viewMode === 'screener' && (
          <div className="card card-padded" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Screener Controls Toolbar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {/* Top Row: Presets Tabs & Search */}
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                {/* Preset Filters */}
                <div className="tab-group" style={{ flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => setFilterPreset('all')}
                    className={`tab-pill${filterPreset === 'all' ? ' tab-pill--active' : ''}`}
                  >
                    All Equities ({EQUITIES_UNIVERSE.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterPreset('gainers')}
                    className={`tab-pill${filterPreset === 'gainers' ? ' tab-pill--positive' : ''}`}
                  >
                    <TrendingUp size={12} />
                    <span>Gainers</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterPreset('losers')}
                    className={`tab-pill${filterPreset === 'losers' ? ' tab-pill--negative' : ''}`}
                  >
                    <TrendingDown size={12} />
                    <span>Losers</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterPreset('breakouts')}
                    className={`tab-pill${filterPreset === 'breakouts' ? ' tab-pill--active' : ''}`}
                  >
                    <Flame size={12} />
                    <span>52W Breakouts</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterPreset('volume')}
                    className={`tab-pill${filterPreset === 'volume' ? ' tab-pill--accent' : ''}`}
                  >
                    <Activity size={12} />
                    <span>Volume Heavy</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterPreset('momentum')}
                    className={`tab-pill${filterPreset === 'momentum' ? ' tab-pill--active' : ''}`}
                  >
                    <Zap size={12} />
                    <span>High Beta</span>
                  </button>
                </div>

                {/* Search Bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--surface)', border: '1px solid var(--border)', minWidth: '220px' }}>
                  <Search size={13} color="var(--text-muted)" />
                  <input
                    type="text"
                    placeholder="Search symbol, company..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ background: 'none', border: 'none', outline: 'none', color: 'var(--text-primary)', fontSize: 'var(--text-sm)', width: '100%' }}
                  />
                </div>
              </div>

              {/* Bottom Row: Sector Selector & Results Count */}
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '10px', paddingTop: '8px', borderTop: '1px solid var(--border-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 500 }}>Filter Sector:</span>
                  <select
                    value={selectedSector}
                    onChange={(e) => setSelectedSector(e.target.value)}
                    style={{
                      backgroundColor: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-xs)',
                      padding: '5px 10px',
                      color: 'var(--text-primary)',
                      fontSize: '12px',
                      outline: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    {SECTOR_OPTIONS.map((sec) => (
                      <option key={sec} value={sec}>{sec}</option>
                    ))}
                  </select>
                </div>

                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                  Showing <strong style={{ color: 'var(--text-primary)' }}>{filteredStocks.length}</strong> matching institutional equities
                </div>
              </div>
            </div>

            {/* Screener Data Table */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12.5px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    <th style={{ padding: '10px 12px', fontWeight: 600 }}>Instrument</th>
                    <th style={{ padding: '10px 12px', fontWeight: 600 }}>Sector</th>
                    <th 
                      style={{ padding: '10px 12px', fontWeight: 600, textAlign: 'right', cursor: 'pointer' }}
                      onClick={() => handleSort('marketCap')}
                    >
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <span>M-Cap</span>
                        <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th 
                      style={{ padding: '10px 12px', fontWeight: 600, textAlign: 'right', cursor: 'pointer' }}
                      onClick={() => handleSort('ltp')}
                    >
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <span>LTP</span>
                        <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th 
                      style={{ padding: '10px 12px', fontWeight: 600, textAlign: 'right', cursor: 'pointer' }}
                      onClick={() => handleSort('changePercent')}
                    >
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <span>24h Change</span>
                        <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th style={{ padding: '10px 12px', fontWeight: 600, textAlign: 'right' }}>Day Range</th>
                    <th style={{ padding: '10px 12px', fontWeight: 600, textAlign: 'right' }}>52W Range</th>
                    <th 
                      style={{ padding: '10px 12px', fontWeight: 600, textAlign: 'right', cursor: 'pointer' }}
                      onClick={() => handleSort('volume')}
                    >
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <span>Volume</span>
                        <ArrowUpDown size={11} />
                      </div>
                    </th>
                    <th style={{ padding: '10px 12px', fontWeight: 600, textAlign: 'center' }}>Trade</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStocks.length === 0 ? (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                        No instruments match the selected screener criteria. Try broadening your filter.
                      </td>
                    </tr>
                  ) : (
                    filteredStocks.map((s) => {
                      const isPositive = s.change >= 0;
                      
                      // Day Range calculation
                      const daySpan = Math.max(0.01, s.high - s.low);
                      const dayProgress = Math.min(100, Math.max(0, ((s.ltp - s.low) / daySpan) * 100));

                      // 52W Range calculation
                      const yrSpan = Math.max(0.01, s.fiftyTwoWeekHigh - s.fiftyTwoWeekLow);
                      const yrProgress = Math.min(100, Math.max(0, ((s.ltp - s.fiftyTwoWeekLow) / yrSpan) * 100));

                      return (
                        <tr
                          key={s.symbol}
                          style={{
                            borderBottom: '1px solid var(--border-subtle)',
                            cursor: 'pointer',
                            transition: 'background-color var(--transition-fast)',
                          }}
                          className="stock-table-row"
                          onClick={() => navigate(`/stocks/${encodeURIComponent(s.symbol)}`)}
                        >
                          {/* Instrument + Logo */}
                          <td style={{ padding: '12px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <CompanyLogo symbol={s.symbol} name={s.name} size={30} />
                              <div style={{ display: 'flex', flexDirection: 'column' }}>
                                <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '13px' }}>
                                  {s.symbol.replace('NSE:', '')}
                                </span>
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                  {s.name}
                                </span>
                              </div>
                            </div>
                          </td>

                          {/* Sector */}
                          <td style={{ padding: '12px' }}>
                            <span 
                              style={{ 
                                fontSize: '11px', 
                                color: 'var(--text-secondary)',
                                backgroundColor: 'var(--card-hover)',
                                border: '1px solid var(--border-subtle)',
                                padding: '2px 8px',
                                borderRadius: 'var(--radius-xs)',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {s.sector}
                            </span>
                          </td>

                          {/* M-Cap */}
                          <td style={{ padding: '12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                            {s.marketCap}
                          </td>

                          {/* LTP */}
                          <td style={{ padding: '12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--text-primary)' }}>
                            {formatINR(s.ltp)}
                          </td>

                          {/* 24h Change */}
                          <td style={{ padding: '12px', textAlign: 'right' }}>
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

                          {/* Day Range */}
                          <td style={{ padding: '12px', textAlign: 'right', minWidth: '110px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-end' }}>
                              <div style={{ width: '80px', height: '4px', backgroundColor: 'var(--border)', borderRadius: '2px', position: 'relative' }}>
                                <div 
                                  style={{ 
                                    position: 'absolute', 
                                    left: `${dayProgress}%`, 
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
                                {formatIndianNumber(Math.round(s.low))} - {formatIndianNumber(Math.round(s.high))}
                              </span>
                            </div>
                          </td>

                          {/* 52W Range */}
                          <td style={{ padding: '12px', textAlign: 'right', minWidth: '110px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'flex-end' }}>
                              <div style={{ width: '80px', height: '4px', backgroundColor: 'var(--border)', borderRadius: '2px', position: 'relative' }}>
                                <div 
                                  style={{ 
                                    position: 'absolute', 
                                    left: `${yrProgress}%`, 
                                    top: '-2px', 
                                    width: '8px', 
                                    height: '8px', 
                                    borderRadius: '50%', 
                                    backgroundColor: 'var(--accent-bright)',
                                    transform: 'translateX(-50%)',
                                  }} 
                                />
                              </div>
                              <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                                {formatIndianNumber(Math.round(s.fiftyTwoWeekLow))} - {formatIndianNumber(Math.round(s.fiftyTwoWeekHigh))}
                              </span>
                            </div>
                          </td>

                          {/* Volume */}
                          <td style={{ padding: '12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                            {formatIndianNumber(s.volume)}
                          </td>

                          {/* Action Button */}
                          <td style={{ padding: '12px', textAlign: 'center' }}>
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
                                backgroundColor: 'rgba(59, 130, 246, 0.14)',
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
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* VIEW 2: Institutional Sector Treemap */}
        {viewMode === 'treemap' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <MarketHeatmap />
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}

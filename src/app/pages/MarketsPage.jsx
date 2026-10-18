// ROADMAP: Section 2, 5 & Design Refinement — Equities Screener & Market Structure Workstation
// Rows are the covered research universe priced by /api/market/stocks (live Upstox quotes or the
// latest saved end-of-day candles); the derivatives banner reads the NIFTY option chain.
import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMarketOverview, useMarketStocks } from '../hooks/useMarketData';
import MarketHeatmap from '../components/market/MarketHeatmap';
import CompanyLogo from '../components/common/CompanyLogo';
import { TableSkeleton } from '../components/common/LoadingSkeleton';
import ErrorBoundary from '../components/common/ErrorBoundary';
import DataStamp from '../components/common/DataStamp';
import { formatINR, formatIndianNumber, formatCrore } from '../utils/formatters';
import {
  Search,
  SlidersHorizontal,
  Layers,
  TrendingUp,
  TrendingDown,
  Activity,
  Flame,
  ArrowUpDown,
} from 'lucide-react';

const ALL_SECTORS = 'All Sectors';
const TOP_TRADED = 25;

const formatDay = (ymd) => new Date(`${ymd}T12:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).toUpperCase();
const formatOi = (n) => (n >= 1e7 ? `${(n / 1e7).toFixed(2)} Cr` : `${(n / 1e5).toFixed(2)} L`);

// Open-interest PCR read as positioning, not a forecast.
function pcrTone(pcr) {
  if (pcr >= 1.2) return { label: 'PUT-HEAVY', badge: 'badge--positive', note: 'More put than call open interest' };
  if (pcr <= 0.8) return { label: 'CALL-HEAVY', badge: 'badge--negative', note: 'More call than put open interest' };
  return { label: 'BALANCED', badge: 'badge--neutral', note: 'Put and call open interest roughly even' };
}

function DerivativeCell({ label, children, note }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <span style={{ fontSize: '11px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
        {label}
      </span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>{children}</div>
      <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{note}</span>
    </div>
  );
}

export default function MarketsPage() {
  const navigate = useNavigate();
  const { data: overview } = useMarketOverview();
  const { data: snapshot, isLoading: isStocksLoading } = useMarketStocks();
  const isOpen = overview?.status === 'OPEN';

  // Tab view: 'screener' vs 'treemap'
  const [viewMode, setViewMode] = useState('screener');

  // Screener filter states
  const [filterPreset, setFilterPreset] = useState('all');
  const [selectedSector, setSelectedSector] = useState(ALL_SECTORS);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('changePercent');
  const [sortOrder, setSortOrder] = useState('desc');

  const derivatives = overview?.derivatives || null;
  const stocks = useMemo(() => snapshot?.stocks || [], [snapshot]);
  const sectorOptions = useMemo(() => [ALL_SECTORS, ...[...new Set(stocks.map((s) => s.sector))].sort()], [stocks]);
  const topTraded = useMemo(
    () => new Set([...stocks].sort((a, b) => b.tradedValue - a.tradedValue).slice(0, TOP_TRADED).map((s) => s.symbol)),
    [stocks],
  );

  // Filtered & Sorted equities universe
  const filteredStocks = useMemo(() => {
    return stocks.filter((stock) => {
      // Sector filter
      if (selectedSector !== ALL_SECTORS && stock.sector !== selectedSector) {
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
        // within 5% of the trailing 52-week high
        return stock.fiftyTwoWeekHigh > 0 && (stock.ltp / stock.fiftyTwoWeekHigh) >= 0.95;
      }
      if (filterPreset === 'volume') {
        return topTraded.has(stock.symbol);
      }

      return true;
    }).sort((a, b) => {
      const valA = a[sortBy];
      const valB = b[sortBy];
      if (sortOrder === 'asc') {
        return valA > valB ? 1 : -1;
      }
      return valA < valB ? 1 : -1;
    });
  }, [stocks, topTraded, filterPreset, selectedSector, searchQuery, sortBy, sortOrder]);

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
              {stocks.length ? `${stocks.length} tracked NSE large & mid caps` : 'Tracked NSE large & mid caps'}, NIFTY option-chain read-outs and a sector heatmap
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

        {/* Derivatives & Market Structure Radar Banner — NIFTY option chain, nearest expiry */}
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
          {derivatives ? (() => {
            const tone = pcrTone(derivatives.pcr);
            return (
              <>
                <DerivativeCell label="NIFTY Put-Call Ratio (OI)" note={tone.note}>
                  <span style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                    {derivatives.pcr.toFixed(2)}
                  </span>
                  <span className={`badge ${tone.badge}`} style={{ fontSize: '9.5px', padding: '1px 6px' }}>{tone.label}</span>
                </DerivativeCell>

                <DerivativeCell label="Expiry Max Pain Strike" note="Strike with the least option-holder payout">
                  <span style={{ fontSize: '20px', fontWeight: 700, color: 'var(--accent-bright)', fontFamily: 'var(--font-mono)' }}>
                    {formatIndianNumber(derivatives.maxPain, 0)}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{formatDay(derivatives.expiry)}</span>
                </DerivativeCell>

                <DerivativeCell label="Largest Call OI" note={`${formatOi(derivatives.callWallOi)} open interest`}>
                  <span style={{ fontSize: '20px', fontWeight: 700, color: 'var(--negative)', fontFamily: 'var(--font-mono)' }}>
                    {formatIndianNumber(derivatives.callWall, 0)} CE
                  </span>
                </DerivativeCell>

                <DerivativeCell label="Largest Put OI" note={`${formatOi(derivatives.putWallOi)} open interest`}>
                  <span style={{ fontSize: '20px', fontWeight: 700, color: 'var(--positive)', fontFamily: 'var(--font-mono)' }}>
                    {formatIndianNumber(derivatives.putWall, 0)} PE
                  </span>
                </DerivativeCell>

                <DerivativeCell
                  label="ATM Implied Volatility"
                  note={<>{formatIndianNumber(derivatives.atmStrike, 0)} strike · <DataStamp source={overview?.sources?.derivatives} asOf={overview?.asOf?.derivatives} isOpen={isOpen} /></>}
                >
                  <span style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                    {Number.isFinite(derivatives.atmIv) ? `${derivatives.atmIv.toFixed(1)}%` : '—'}
                  </span>
                </DerivativeCell>
              </>
            );
          })() : (
            <DerivativeCell label="NIFTY option chain" note="PCR, max pain, open-interest walls and ATM IV appear when the Upstox option chain is reachable.">
              <span style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-muted)' }}>Unavailable right now</span>
            </DerivativeCell>
          )}
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
                    All Equities ({stocks.length})
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
                    <span>Near 52W High</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterPreset('volume')}
                    className={`tab-pill${filterPreset === 'volume' ? ' tab-pill--accent' : ''}`}
                  >
                    <Activity size={12} />
                    <span>Top {TOP_TRADED} by Value</span>
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
                    {sectorOptions.map((sec) => (
                      <option key={sec} value={sec}>{sec}</option>
                    ))}
                  </select>
                </div>

                <div style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span>Showing <strong style={{ color: 'var(--text-primary)' }}>{filteredStocks.length}</strong> of {stocks.length} tracked stocks</span>
                  <DataStamp source={snapshot?.source} asOf={snapshot?.asOf} isOpen={isOpen} />
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
                      onClick={() => handleSort('tradedValue')}
                    >
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <span>Traded Value</span>
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
                        <span>Day Change</span>
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
                  {isStocksLoading ? (
                    <tr><td colSpan={9} style={{ padding: '20px' }}><TableSkeleton rows={8} /></td></tr>
                  ) : !stocks.length ? (
                    <tr>
                      <td colSpan={9} style={{ textAlign: 'center', padding: '30px', color: 'var(--text-muted)' }}>
                        Market data is unavailable right now: no live feed and no saved end-of-day prices.
                      </td>
                    </tr>
                  ) : filteredStocks.length === 0 ? (
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

                      // 52W Range calculation (null when no saved candles cover the stock)
                      const has52 = s.fiftyTwoWeekHigh != null && s.fiftyTwoWeekLow != null;
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
                                <span style={{ fontSize: '11px', color: 'var(--text-muted)', whiteSpace: 'nowrap', maxWidth: '160px', overflow: 'hidden', textOverflow: 'ellipsis' }} title={s.name}>
                                  {s.name !== s.symbol.replace('NSE:', '') ? s.name : ''}
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

                          {/* Traded value */}
                          <td
                            style={{ padding: '12px', textAlign: 'right', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}
                            title={s.tradedValueEstimated ? 'Estimated: volume × typical price' : 'Volume × average traded price'}
                          >
                            {s.tradedValueEstimated ? '≈ ' : ''}{formatCrore(s.tradedValue / 1e7)}
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
                            {has52 ? (
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
                            ) : (
                              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>—</span>
                            )}
                          </td>

                          {/* Volume */}
                          <td style={{ padding: '12px', textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                            {formatIndianNumber(s.volume, 0)}
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
            <MarketHeatmap stocks={stocks} stamp={<DataStamp source={snapshot?.source} asOf={snapshot?.asOf} isOpen={isOpen} />} />
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}

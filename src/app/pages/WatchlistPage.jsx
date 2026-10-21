// Flagship Watchlist Page — Real company logos + premium design
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWatchlist, useAddToWatchlist, useRemoveFromWatchlist } from '../hooks/useWatchlist';
import { Star, Plus, Trash2, Zap, TrendingUp, TrendingDown, Search, ArrowUpRight, ArrowDownRight, ExternalLink } from 'lucide-react';
import { formatIndianNumber } from '../utils/formatters';
import { TableSkeleton } from '../components/common/LoadingSkeleton';
import ErrorBoundary from '../components/common/ErrorBoundary';
import CompanyLogo from '../components/common/CompanyLogo';

const POPULAR_ADD_SUGGESTIONS = ['NSE:BHARTIARTL', 'NSE:TMPV', 'NSE:ITC', 'NSE:LT', 'NSE:SBIN', 'NSE:MARUTI'];

export default function WatchlistPage() {
  const navigate = useNavigate();
  const { data: items = [], isLoading } = useWatchlist();
  const addMutation = useAddToWatchlist();
  const removeMutation = useRemoveFromWatchlist();
  const [addInput, setAddInput] = useState('');

  const handleAddSymbol = (sym) => {
    const symbolToAdd = (sym || addInput).trim().toUpperCase();
    if (!symbolToAdd) return;
    const formatted = symbolToAdd.includes(':') ? symbolToAdd : `NSE:${symbolToAdd}`;
    addMutation.mutate(formatted, { onSuccess: () => setAddInput('') });
  };

  const handleRemove = (e, symbol) => {
    e.stopPropagation();
    removeMutation.mutate(symbol);
  };

  const advances = items.filter((i) => (i.change ?? 0) >= 0).length;
  const declines = items.filter((i) => (i.change ?? 0) < 0).length;

  return (
    <ErrorBoundary>
      <div className="page-container-wide watchlist-page">
        {/* Page Header */}
        <div className="page-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
              <h1 className="page-title">My Watchlist</h1>
              <span className="badge badge--accent">
                {items.length} INSTRUMENTS
              </span>
            </div>
            <p className="page-subtitle">
              Your stocks at live NSE prices, refreshed every 15 seconds.
            </p>
          </div>

          {/* Breadth Pill */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '8px 16px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            backdropFilter: 'blur(12px)',
          }}>
            <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Breadth</span>
            <div style={{ width: '1px', height: '14px', background: 'var(--border)' }} />
            <span className="text-positive num-tabular" style={{ fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
              <TrendingUp size={13} /> {advances} Up
            </span>
            <div style={{ width: '1px', height: '14px', background: 'var(--border)' }} />
            <span className="text-negative num-tabular" style={{ fontSize: '13px', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
              <TrendingDown size={13} /> {declines} Down
            </span>
          </div>
        </div>

        {/* Add Symbol Row */}
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          marginBottom: '16px',
          padding: '12px 16px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          backdropFilter: 'blur(12px)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '280px' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={14} className="input-icon" style={{ color: 'var(--text-dim)' }} />
              <input
                type="text"
                placeholder="Add instrument symbol (e.g. RELIANCE, TCS, INFY)..."
                value={addInput}
                onChange={(e) => setAddInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddSymbol()}
                className="input input--with-icon"
                style={{ padding: '8px 12px 8px 36px', fontSize: '12.5px' }}
              />
            </div>
            <button
              onClick={() => handleAddSymbol()}
              disabled={!addInput.trim() || addMutation.isPending}
              className="btn btn-primary"
              style={{ padding: '8px 14px', fontSize: '12px' }}
            >
              <Plus size={13} />
              <span>Add Symbol</span>
            </button>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '10.5px', color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Quick Add:
            </span>
            {POPULAR_ADD_SUGGESTIONS.slice(0, 4).map((sym) => {
              const clean = sym.replace('NSE:', '');
              const alreadyHas = items.some((i) => i.symbol === sym);
              if (alreadyHas) return null;
              return (
                <button
                  key={sym}
                  onClick={() => handleAddSymbol(sym)}
                  className="chip"
                  style={{ cursor: 'pointer', padding: '3px 9px', fontSize: '11px' }}
                >
                  +{clean}
                </button>
              );
            })}
          </div>
        </div>

        {/* Watchlist Table */}
        <div className="terminal-table-scroll" style={{
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
          background: 'var(--card)',
          overflow: 'hidden',
          boxShadow: 'none',
        }}>
          {/* Table Header */}
          <div className="terminal-data-row" style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(200px, 2.5fr) minmax(110px, 1fr) minmax(130px, 1fr) minmax(140px, 1fr) minmax(120px, 1fr) 130px',
            padding: '10px 18px',
            borderBottom: '1px solid var(--border)',
            background: 'var(--surface)',
          }}>
            {['INSTRUMENT', 'PRICE (LTP)', 'CHANGE (%)', 'HIGH / LOW', 'VOLUME', 'ACTIONS'].map((h, i) => (
              <span key={h} style={{
                fontSize: '10.5px',
                fontWeight: 700,
                color: 'var(--text-dim)',
                textTransform: 'uppercase',
                letterSpacing: '0.07em',
                textAlign: i > 0 ? 'right' : 'left',
              }}>
                {h}
              </span>
            ))}
          </div>

          {/* Table Body */}
          {isLoading ? (
            <div style={{ padding: '16px' }}>
              <TableSkeleton rows={6} />
            </div>
          ) : items.length === 0 ? (
            <div className="empty-state">
              <Star size={36} className="empty-state-icon" />
              <div className="empty-state-title">Your watchlist is empty</div>
              <div className="empty-state-description">
                Add any NSE stock to follow its live price and trade it from here.
              </div>
              <button
                onClick={() => handleAddSymbol('NSE:RELIANCE')}
                className="btn btn-primary"
                style={{ padding: '9px 18px', fontSize: '13px' }}
              >
                <Plus size={14} /> Add RELIANCE
              </button>
            </div>
          ) : (
            <div>
              {items.map((item, idx) => {
                const isPos = (item.change ?? 0) >= 0;
                const cleanSym = item.symbol.replace('NSE:', '').replace('BSE:', '');
                return (
                  <div
                    key={item.symbol}
                    onClick={() => navigate(`/stocks/${item.symbol}`)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(200px, 2.5fr) minmax(110px, 1fr) minmax(130px, 1fr) minmax(140px, 1fr) minmax(120px, 1fr) 130px',
                      padding: '12px 18px',
                      alignItems: 'center',
                      cursor: 'pointer',
                      borderBottom: idx < items.length - 1 ? '1px solid var(--border-subtle)' : 'none',
                      transition: 'background 0.15s ease',
                    }}
                    className="watchlist-row terminal-data-row"
                  >
                    {/* Company Logo + Symbol */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', overflow: 'hidden' }}>
                      <CompanyLogo symbol={cleanSym} size={36} />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '13.5px' }}>
                            {cleanSym}
                          </span>
                          <span style={{
                            fontSize: '9px', padding: '1px 5px', borderRadius: '3px',
                            backgroundColor: 'rgba(59,130,246,0.12)', color: 'var(--accent-bright)',
                            border: '1px solid rgba(59,130,246,0.25)', fontWeight: 700, letterSpacing: '0.04em',
                          }}>
                            {item.exchange || 'NSE'}
                          </span>
                        </div>
                        <div style={{ fontSize: '11px', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.name || 'Listed Stock'}
                        </div>
                      </div>
                    </div>

                    {/* LTP */}
                    <div className="num-tabular" style={{ textAlign: 'right', fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
                      ₹{formatIndianNumber(item.ltp)}
                    </div>

                    {/* Change */}
                    <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '3px' }}>
                      <span className="num-tabular" style={{
                        fontSize: '12.5px', fontWeight: 700,
                        color: isPos ? 'var(--positive-text)' : 'var(--negative-text)',
                        display: 'flex', alignItems: 'center', gap: '2px',
                      }}>
                        {isPos ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                        {isPos ? '+' : ''}{(item.changePercent ?? 0).toFixed(2)}%
                      </span>
                      <span className="num-tabular" style={{ fontSize: '11px', color: 'var(--text-dim)', fontWeight: 500 }}>
                        {isPos ? '+' : ''}₹{formatIndianNumber(Math.abs(item.change ?? 0))}
                      </span>
                    </div>

                    {/* High / Low */}
                    <div className="num-tabular" style={{ textAlign: 'right', fontSize: '12px' }}>
                      <span className="text-positive">₹{formatIndianNumber(item.high || item.ltp)}</span>
                      <span style={{ color: 'var(--text-dim)', margin: '0 3px' }}>/</span>
                      <span className="text-negative">₹{formatIndianNumber(item.low || item.ltp)}</span>
                    </div>

                    {/* Volume */}
                    <div className="num-tabular" style={{ textAlign: 'right', fontSize: '12px', color: 'var(--text-muted)', fontWeight: 600 }}>
                      {formatIndianNumber(item.volume || 1000000)}
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '6px' }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/trade?symbol=${encodeURIComponent(item.symbol)}`);
                        }}
                        className="btn btn-secondary"
                        style={{ padding: '5px 10px', fontSize: '11.5px', gap: '4px' }}
                      >
                        <Zap size={11} />
                        <span>Trade</span>
                      </button>
                      <button
                        onClick={(e) => handleRemove(e, item.symbol)}
                        className="btn-icon"
                        style={{ padding: '5px', color: 'var(--text-muted)' }}
                        title="Remove"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </ErrorBoundary>
  );
}

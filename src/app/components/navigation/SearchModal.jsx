// ROADMAP: Section 5 & 16 — SearchModal Component
// Institutional Terminal Styling — Exact Market Polaris Design System
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Search, Clock, X, ArrowRight, CornerDownLeft } from 'lucide-react';
import CompanyLogo from '../common/CompanyLogo';

const RECENT_KEY = 'marketpulse_recent_searches';

export default function SearchModal({ isOpen, onClose }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [recentSearches, setRecentSearches] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  // Load recent searches on mount / open
  useEffect(() => {
    if (isOpen) {
      try {
        const stored = localStorage.getItem(RECENT_KEY);
        if (stored) {
          setRecentSearches(JSON.parse(stored));
        }
      } catch {
        setRecentSearches([]);
      }
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery('');
      setSelectedIndex(0);
    }
  }, [isOpen]);

  // Debounced search query
  useEffect(() => {
    if (!isOpen) return;

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await axios.get(`/api/search?q=${encodeURIComponent(query.trim())}`);
        setResults(res.data?.results || []);
        setSelectedIndex(0);
      } catch (err) {
        console.error('Search request error:', err);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query, isOpen]);

  // Keyboard navigation listener (ArrowUp, ArrowDown, Enter, Escape)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      const activeList = query.trim() ? results : (recentSearches.length > 0 ? recentSearches : results);
      if (!activeList || activeList.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % activeList.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + activeList.length) % activeList.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeList[selectedIndex]) {
          handleSelect(activeList[selectedIndex]);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, results, recentSearches, selectedIndex, query]);

  const handleSelect = (item) => {
    try {
      const updated = [
        item,
        ...recentSearches.filter((s) => s.symbol !== item.symbol),
      ].slice(0, 6);
      setRecentSearches(updated);
      localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
    } catch {
      // ignore
    }

    onClose();
    navigate(`/stocks/${item.symbol}`);
  };

  const handleClearRecents = (e) => {
    e.stopPropagation();
    setRecentSearches([]);
    localStorage.removeItem(RECENT_KEY);
  };

  if (!isOpen) return null;

  const displayList = query.trim() ? results : (recentSearches.length > 0 ? recentSearches : results);

  return (
    <div
      onClick={onClose}
      className="modal-backdrop"
      style={{ alignItems: 'flex-start', paddingTop: '10vh' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-label="Search stocks and indices"
        style={{
          maxWidth: '580px',
          padding: 0,
          overflow: 'hidden',
        }}
      >
        {/* Search Input Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '14px 18px',
            borderBottom: '1px solid var(--border)',
            backgroundColor: 'var(--surface)',
          }}
        >
          <Search size={16} color="var(--accent)" />
          <input
            ref={inputRef}
            aria-label="Search equities"
            type="text"
            placeholder="Search any NSE stock by symbol or company name (e.g. RELIANCE, Suzlon)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: 'var(--text-primary)',
              fontSize: '13.5px',
            }}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              aria-label="Clear search"
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 0 }}
            >
              <X size={15} />
            </button>
          )}
          <button type="button" className="search-close" onClick={onClose} aria-label="Close search">
            <X size={16} />
          </button>
        </div>

        {/* Results List */}
        <div style={{ maxHeight: '380px', overflowY: 'auto', padding: '6px' }}>
          {!query.trim() && recentSearches.length > 0 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 12px 6px',
                fontSize: '11px',
                color: 'var(--text-muted)',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              <span>Recent Searches</span>
              <button
                onClick={handleClearRecents}
                className="btn-ghost"
                style={{
                  fontSize: '11px',
                  padding: '2px 6px',
                  color: 'var(--text-muted)',
                }}
              >
                Clear
              </button>
            </div>
          )}

          {loading ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
              Searching NSE stocks…
            </div>
          ) : displayList.length === 0 ? (
            <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
              {query.trim() ? `No matching tickers found for "${query}"` : 'Type a symbol or company name to search'}
            </div>
          ) : (
            displayList.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={item.symbol}
                  onClick={() => handleSelect(item)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: isSelected ? 'var(--accent-muted)' : 'transparent',
                    border: isSelected ? '1px solid var(--accent-border)' : '1px solid transparent',
                    cursor: 'pointer',
                    transition: 'all var(--transition-fast)',
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <CompanyLogo symbol={item.symbol} size={28} />
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
                          {item.symbol}
                        </span>
                        <span className="badge badge--sm">
                          NSE
                        </span>
                        {item.covered !== undefined && (
                          <span className={`badge badge--sm ${item.covered ? 'badge--accent' : ''}`} title={item.covered ? 'Polaris AI forecasts cover this stock' : 'Price, chart and paper trading only'}>
                            {item.covered ? 'Polaris AI' : 'Price & chart'}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '1px' }}>
                        {item.name || item.description || 'Listed Equity'}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    {item.ltp !== undefined && (
                      <div style={{ textAlign: 'right' }}>
                        <div className="num-tabular" style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-primary)' }}>
                          ₹{item.ltp}
                        </div>
                        {item.changePercent !== undefined && (
                          <div
                            className={`num-tabular ${item.changePercent >= 0 ? 'text-positive' : 'text-negative'}`}
                            style={{
                              fontSize: '11px',
                              fontWeight: 600,
                            }}
                          >
                            {item.changePercent >= 0 ? '+' : ''}{item.changePercent.toFixed(2)}%
                          </div>
                        )}
                      </div>
                    )}
                    {isSelected && <CornerDownLeft size={13} color="var(--accent)" />}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '8px 16px',
            backgroundColor: 'var(--surface)',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '11px',
            color: 'var(--text-muted)',
          }}
        >
          <span>Use ↑ and ↓ to navigate, Enter to select</span>
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Market Polaris Search</span>
        </div>
      </div>
    </div>
  );
}

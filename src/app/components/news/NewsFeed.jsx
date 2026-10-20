// ROADMAP: Section 5 & 9 — NewsFeed Component
// Institutional Terminal Styling — Exact Market Polaris Design System
import React, { useState } from 'react';
import NewsCard from './NewsCard';
import { Skeleton } from '../common/LoadingSkeleton';
import { Search, RefreshCw, Newspaper } from 'lucide-react';

const CATEGORIES = [
  { id: 'all', label: 'All News' },
  { id: 'markets', label: 'Markets' },
  { id: 'stocks', label: 'Equities & Companies' },
  { id: 'economy', label: 'Economy & Policy' },
];

export default function NewsFeed({
  articles = [],
  isLoading = false,
  selectedCategory = 'all',
  onCategoryChange,
  onRefresh,
}) {
  const [filterText, setFilterText] = useState('');

  const filtered = articles.filter((a) => {
    if (!filterText.trim()) return true;
    const q = filterText.toLowerCase();
    return (
      a.title?.toLowerCase().includes(q) ||
      a.summary?.toLowerCase().includes(q) ||
      a.source?.toLowerCase().includes(q) ||
      (a.relatedSymbols || []).some((s) => s.toLowerCase().includes(q))
    );
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      {/* Category Pills & Search Filter Bar */}
      <div
        className="card"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          padding: '10px 16px',
        }}
      >
        {/* Category Tabs */}
        <div className="tab-group" style={{ flexWrap: 'wrap' }}>
          {CATEGORIES.map((cat) => {
            const isActive = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => onCategoryChange && onCategoryChange(cat.id)}
                className={`tab-pill ${isActive ? 'tab-pill--active' : ''}`}
                style={{ fontSize: '12px', padding: '5px 12px' }}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        {/* Search Input & Refresh */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ position: 'relative' }}>
            <Search size={13} className="input-icon" />
            <input
              type="text"
              placeholder="Filter headlines..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="input input--with-icon"
              style={{ width: '160px', padding: '6px 10px 6px 30px', fontSize: '12px' }}
            />
          </div>

          {onRefresh && (
            <button
              onClick={onRefresh}
              title="Refresh News"
              className="btn-icon"
              style={{ padding: '6px 8px' }}
            >
              <RefreshCw size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Loading Skeletons */}
      {isLoading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="card"
              style={{
                padding: '16px 20px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
              }}
            >
              <Skeleton width="120px" height="14px" />
              <Skeleton width="85%" height="16px" />
              <Skeleton width="60%" height="13px" />
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!isLoading && filtered.length === 0 && (
        <div className="card empty-state">
          <Newspaper size={36} className="empty-state-icon" />
          <div className="empty-state-title">No Articles Found</div>
          <div className="empty-state-description">
            No news matching your filter criteria. Try adjusting your query or category.
          </div>
        </div>
      )}

      {/* Articles Feed */}
      {!isLoading && filtered.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {filtered.map((article) => (
            <NewsCard key={article.id} article={article} />
          ))}
        </div>
      )}
    </div>
  );
}

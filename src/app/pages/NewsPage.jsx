// ROADMAP: Section 5 & 9 — Financial News Page
// Institutional Terminal Styling — Exact Market Pulse Design System
import React, { useState } from 'react';
import { useMarketNews } from '../hooks/useNews';
import NewsFeed from '../components/news/NewsFeed';
import { Globe, TrendingUp } from 'lucide-react';
import ErrorBoundary from '../components/common/ErrorBoundary';

const TRENDING_TOPICS = [
  { tag: 'RBI Monetary Policy', category: 'economy' },
  { tag: 'NIFTY 50 Record', category: 'markets' },
  { tag: 'IT Earnings Disclosures', category: 'stocks' },
  { tag: 'Green Energy Capex', category: 'stocks' },
  { tag: 'Auto Monthly Volumes', category: 'economy' },
  { tag: 'Banking FII Flows', category: 'markets' },
];

export default function NewsPage() {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const { data: articles = [], isLoading, refetch } = useMarketNews(selectedCategory, 30);

  return (
    <ErrorBoundary>
      <div className="page-container-wide news-page">
        {/* Page Header */}
        <div className="page-header">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <h1 className="page-title">
                Financial News Wire
              </h1>
              <span className="badge badge--accent">
                LIVE TELEMETRY
              </span>
            </div>
            <p className="page-subtitle">
              Real-time Indian market disclosures, macroeconomic policy feeds, and corporate announcements.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-muted)' }}>
            <Globe size={13} color="var(--accent)" />
            <span>Marketaux Wire & Verified Indian Exchanges</span>
          </div>
        </div>

        {/* Main Content Grid (News Feed + Sidebar) */}
        <div className="terminal-panel-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.5fr) minmax(280px, 1fr)', gap: '20px', alignItems: 'start' }}>
          {/* Left Column: News Feed */}
          <div>
            <NewsFeed
              articles={articles}
              isLoading={isLoading}
              selectedCategory={selectedCategory}
              onCategoryChange={(cat) => setSelectedCategory(cat)}
              onRefresh={() => refetch()}
            />
          </div>

          {/* Right Column: Trending Topics & Sentiment Summary */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Trending Topics Card */}
            <div className="card card-padded">
              <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '12px', letterSpacing: '-0.01em' }}>
                Macro & Sector Themes
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {TRENDING_TOPICS.map((topic) => (
                  <button
                    key={topic.tag}
                    onClick={() => setSelectedCategory(topic.category)}
                    className="chip"
                    style={{ cursor: 'pointer', fontSize: '11.5px', padding: '5px 10px' }}
                  >
                    #{topic.tag}
                  </button>
                ))}
              </div>
            </div>

            {/* Indian Market Sentiment Meter */}
            <div className="card card-padded">
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
                <TrendingUp size={15} color="var(--positive)" />
                <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  Newswire Tone
                </h3>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', fontSize: '12px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Indian Index Disclosures:</span>
                <span className="text-positive" style={{ fontWeight: 600 }}>Moderately Positive</span>
              </div>

              {/* Progress track */}
              <div className="progress-bar-track" style={{ height: '6px', marginBottom: '8px' }}>
                <div style={{ width: '58%', backgroundColor: 'var(--positive)', borderRadius: '4px 0 0 4px' }} />
                <div style={{ width: '22%', backgroundColor: 'var(--text-muted)' }} />
                <div style={{ width: '20%', backgroundColor: 'var(--negative)', borderRadius: '0 4px 4px 0' }} />
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)' }}>
                <span className="text-positive" style={{ fontWeight: 500 }}>58% Bullish</span>
                <span>22% Neutral</span>
                <span className="text-negative" style={{ fontWeight: 500 }}>20% Bearish</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}

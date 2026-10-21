// ROADMAP: Section 5 & 9 — Financial News Page
// Institutional Terminal Styling — Exact Market Polaris Design System
import React, { useState } from 'react';
import { useMarketNews } from '../hooks/useNews';
import NewsFeed from '../components/news/NewsFeed';
import { Globe, TrendingUp } from 'lucide-react';
import ErrorBoundary from '../components/common/ErrorBoundary';

// Tone of the articles on screen, from each article's own sentiment score (Marketaux entity
// sentiment). Shown only when there are enough scored articles to say anything.
function newsTone(articles) {
  const scored = articles.filter((a) => ['positive', 'negative', 'neutral'].includes(a.sentiment));
  if (scored.length < 3) return null;
  const share = (s) => Math.round((scored.filter((a) => a.sentiment === s).length / scored.length) * 100);
  const positive = share('positive'), negative = share('negative');
  return { count: scored.length, positive, negative, neutral: 100 - positive - negative };
}

export default function NewsPage() {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const { data: articles = [], isLoading, refetch } = useMarketNews(selectedCategory, 30);
  const tone = newsTone(articles);

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

          {/* Right Column: tone of the articles shown */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="card card-padded">
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px' }}>
                <TrendingUp size={15} color="var(--accent)" />
                <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                  Tone of these articles
                </h3>
              </div>
              {tone ? (
                <>
                  <div className="progress-bar-track" style={{ height: '6px', marginBottom: '8px' }}>
                    <div style={{ width: `${tone.positive}%`, backgroundColor: 'var(--positive)' }} />
                    <div style={{ width: `${tone.neutral}%`, backgroundColor: 'var(--text-muted)' }} />
                    <div style={{ width: `${tone.negative}%`, backgroundColor: 'var(--negative)' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-muted)' }}>
                    <span className="text-positive" style={{ fontWeight: 500 }}>{tone.positive}% positive</span>
                    <span>{tone.neutral}% neutral</span>
                    <span className="text-negative" style={{ fontWeight: 500 }}>{tone.negative}% negative</span>
                  </div>
                  <p style={{ fontSize: '11px', color: 'var(--text-muted)', margin: '8px 0 0' }}>
                    From the sentiment Marketaux scores for the {tone.count} articles listed.
                  </p>
                </>
              ) : (
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>Not enough scored articles to show a tone.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
}

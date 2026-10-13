// Flagship NewsCard — Premium financial news card with sentiment accents
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, TrendingUp, TrendingDown, Clock, FileText } from 'lucide-react';
import CompanyLogo from '../common/CompanyLogo';

export default function NewsCard({ article, compact = false }) {
  const navigate = useNavigate();
  if (!article) return null;

  const formatTimeAgo = (isoString) => {
    if (!isoString) return '';
    try {
      const diffMs = Date.now() - new Date(isoString).getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 60) return `${Math.max(diffMins, 1)}m ago`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      return `${Math.floor(diffHours / 24)}d ago`;
    } catch { return ''; }
  };

  const sentiment = article.sentiment || 'neutral';
  const isPositive = sentiment === 'positive';
  const isNegative = sentiment === 'negative';

  const sentimentClass = isPositive ? 'news-card--bullish' : isNegative ? 'news-card--bearish' : '';

  return (
    <article className={`news-card ${sentimentClass}`}>
      {/* Meta Row */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        fontSize: '11.5px',
        color: 'var(--text-muted)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <FileText size={11} color="var(--accent)" />
            {article.source}
          </span>
          <span style={{ color: 'var(--border)' }}>•</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <Clock size={11} />
            {formatTimeAgo(article.publishedAt)}
          </span>
        </div>

        {sentiment !== 'neutral' && (
          <span className={`badge badge--sm ${isPositive ? 'badge--positive' : 'badge--negative'}`} style={{ gap: '4px' }}>
            {isPositive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
            {isPositive ? 'Bullish' : 'Bearish'}
          </span>
        )}
      </div>

      {/* Title */}
      <h3 style={{
        margin: 0,
        fontSize: compact ? '13.5px' : '14.5px',
        fontWeight: 600,
        lineHeight: 1.45,
        color: 'var(--text-primary)',
        letterSpacing: '-0.01em',
      }}>
        <a
          href={article.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: 'inherit',
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'baseline',
            gap: '6px',
            transition: 'color var(--transition-fast)',
          }}
          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent-bright)'}
          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-primary)'}
        >
          <span>{article.title}</span>
          <ExternalLink size={11} style={{ flexShrink: 0, opacity: 0.5, transform: 'translateY(2px)' }} />
        </a>
      </h3>

      {/* Summary */}
      {!compact && article.summary && (
        <p style={{
          margin: 0,
          fontSize: '12.5px',
          color: 'var(--text-muted)',
          lineHeight: 1.6,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {article.summary}
        </p>
      )}

      {/* Related Symbols */}
      {article.relatedSymbols?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '5px', marginTop: '4px' }}>
          <span style={{ fontSize: '10px', color: 'var(--text-dim)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>Related:</span>
          {article.relatedSymbols.slice(0, 4).map((sym) => {
            const clean = sym.replace('NSE:', '').replace('^', '');
            return (
              <button
                key={sym}
                onClick={(e) => { e.stopPropagation(); navigate(`/stocks/${sym}`); }}
                className="badge badge--accent badge--sm"
                style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 7px' }}
              >
                <CompanyLogo symbol={clean} size={20} style={{ borderRadius: '4px' }} />
                <span>{clean}</span>
              </button>
            );
          })}
        </div>
      )}
    </article>
  );
}

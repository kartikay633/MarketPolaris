// NewsCard: one company news item — an NSE filing or a publisher story — with its event type,
// time (IST), source and the companies it concerns. No sentiment guesswork.
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, Clock, FileText, Newspaper } from 'lucide-react';
import CompanyLogo from '../common/CompanyLogo';

const EVENT_TONE = {
  results: 'badge--accent', orders: 'badge--positive', deals: 'badge--accent', management: 'badge--warning', legal: 'badge--negative',
  capital: 'badge--accent', ratings: 'badge--warning', corporate: 'badge--positive', operations: '', exchange: 'badge--warning', views: '', price: '', other: '',
};

function when(iso) {
  if (!iso) return '';
  const t = new Date(iso);
  const mins = Math.floor((Date.now() - t.getTime()) / 60000);
  const time = t.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
  const day = t.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
  const ago = mins < 60 ? `${Math.max(mins, 1)}m ago` : mins < 1440 ? `${Math.floor(mins / 60)}h ago` : `${Math.floor(mins / 1440)}d ago`;
  return `${day === today ? time : `${day}, ${time}`} IST · ${ago}`;
}

export default function NewsCard({ article, compact = false }) {
  const navigate = useNavigate();
  if (!article) return null;
  const isFiling = article.kind === 'filing';
  const companies = article.companies?.length ? article.companies : (article.relatedSymbols || []).map((s) => ({ symbol: s.replace(/^NSE:/, ''), name: '' }));

  return (
    <article className={`news-card${article.materiality === 'high' ? ' news-card--key' : ''}`}>
      {/* Meta row: source, time, event type */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', fontSize: '11.5px', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '5px' }}>
            {isFiling ? <FileText size={11} color="var(--accent)" /> : <Newspaper size={11} color="var(--accent)" />}
            {article.source}
          </span>
          <span style={{ color: 'var(--border)' }}>•</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <Clock size={11} />
            {when(article.publishedAt)}
          </span>
        </div>
        {article.category && (
          <span className={`badge badge--sm ${EVENT_TONE[article.eventType] || ''}`}>
            {article.category}
          </span>
        )}
      </div>

      {/* Title */}
      <h3 style={{ margin: 0, fontSize: compact ? '13.5px' : '14.5px', fontWeight: 600, lineHeight: 1.45, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
        {article.sourceUrl ? (
          <a
            href={article.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'inherit', textDecoration: 'none', display: 'inline-flex', alignItems: 'baseline', gap: '6px', transition: 'color var(--transition-fast)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--accent-bright)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
          >
            <span>{isFiling && companies[0]?.name ? `${companies[0].name}: ${article.title}` : article.title}</span>
            <ExternalLink size={11} style={{ flexShrink: 0, opacity: 0.5, transform: 'translateY(2px)' }} />
          </a>
        ) : (
          <span>{article.title}</span>
        )}
      </h3>

      {/* Summary (publisher's standfirst; filings show their NSE category in the badge) */}
      {!compact && !isFiling && article.summary && (
        <p style={{ margin: 0, fontSize: '12.5px', color: 'var(--text-muted)', lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {article.summary}
        </p>
      )}

      {/* Companies */}
      {companies.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '5px', marginTop: '4px' }}>
          {companies.slice(0, 4).map((c) => (
            <button
              key={c.symbol}
              onClick={(e) => { e.stopPropagation(); navigate(`/stocks/NSE:${c.symbol}`); }}
              className="badge badge--accent badge--sm"
              style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 7px' }}
              title={c.name || c.symbol}
            >
              <CompanyLogo symbol={c.symbol} size={20} style={{ borderRadius: '4px' }} />
              <span>{c.symbol}</span>
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

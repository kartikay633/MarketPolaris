// Overview teaser for the post-market brief: headline, a short summary and a link to the full brief.
import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useAIMarketSummary } from '../../hooks/useAI';

export default function MarketBriefTeaser() {
  const { data: summary, isLoading } = useAIMarketSummary();
  if (!isLoading && !summary?.headline) return null;
  const label = summary?.isAfterMarket ? 'Post-market brief' : 'Market brief';
  return (
    <section className="fd-brief-teaser fd-wrap" aria-labelledby="fd-brief-teaser-title">
      <div className="fd-brief-teaser-inner">
        <div className="fd-brief-teaser-copy">
          <span className="fd-lbl fd-lbl--accent">{label}{summary?.marketStance && !summary?.isAfterMarket ? ` · ${summary.marketStance}` : ''}</span>
          <h2 id="fd-brief-teaser-title" className="fd-brief-teaser-title">{isLoading ? 'Preparing today’s brief…' : summary.headline}</h2>
          {summary?.summary && <p className="fd-brief-teaser-text">{summary.summary}</p>}
        </div>
        <Link to="/ai?tab=brief" className="fd-btn fd-btn--solid fd-brief-teaser-cta">
          Read full analysis <ArrowRight size={15} />
        </Link>
      </div>
    </section>
  );
}

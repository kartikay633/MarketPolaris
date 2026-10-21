// Company news wire: NSE filings from every listed company and company stories from Indian
// business publishers, with the panels a trader checks: today's corporate activity, results filed,
// block and bulk deals, credit-rating actions and the companies most in the news.
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, RefreshCw, FileText, Newspaper } from 'lucide-react';
import { useMarketNews, useNewsPulse } from '../hooks/useNews';
import NewsCard from '../components/news/NewsCard';
import ErrorBoundary from '../components/common/ErrorBoundary';
import { Skeleton } from '../components/common/LoadingSkeleton';

const TYPES = [
  ['all', 'All'], ['results', 'Results'], ['orders', 'Orders'], ['deals', 'M&A & stakes'], ['management', 'Management'],
  ['legal', 'Regulatory & legal'], ['capital', 'Fund raising & IPOs'], ['ratings', 'Ratings'], ['corporate', 'Dividends & actions'],
  ['operations', 'Business'], ['exchange', 'Exchange queries'], ['views', 'Brokerage views'],
];
const inr = (cr) => (cr >= 100 ? `₹${Math.round(cr).toLocaleString('en-IN')} cr` : `₹${cr.toFixed(1)} cr`);
const time = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) : '—');

function Toggle({ value, options, onChange }) {
  return (
    <div className="nw-toggle" role="group">
      {options.map(([id, label]) => (
        <button key={id} type="button" className={value === id ? 'is-active' : ''} onClick={() => onChange(id)}>{label}</button>
      ))}
    </div>
  );
}

function Panel({ title, note, children }) {
  return (
    <section className="card nw-panel">
      <h3>{title}</h3>
      {children}
      {note && <small>{note}</small>}
    </section>
  );
}

function DealRow({ d, onOpen }) {
  return (
    <div className="nw-row">
      <button type="button" onClick={() => onOpen(d.symbol)} title={d.client}>
        <span className={d.side === 'BUY' ? 'text-positive' : 'text-negative'}>{d.side === 'BUY' ? 'Buy' : 'Sell'}</span> {d.symbol}
        <span style={{ display: 'block', fontSize: '10.5px', color: 'var(--text-muted)' }}>{d.client}</span>
      </button>
      <span className="nw-num">{inr(d.valueCr)}</span>
    </div>
  );
}

function Pulse({ pulse, onType }) {
  const navigate = useNavigate();
  if (!pulse) return <div className="card nw-panel"><Skeleton height={180} /></div>;
  const types = Object.entries(pulse.activity.byType).filter(([k, n]) => n > 0 && k !== 'other').sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...types.map(([, n]) => n));
  const stock = (symbol) => navigate(`/stocks/NSE:${symbol}`);
  const ratings = [...pulse.ratings.upgrades.map((r) => ({ ...r, up: true })), ...pulse.ratings.downgrades.map((r) => ({ ...r, up: false }))];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <Panel title="Today's corporate activity" note={`${pulse.activity.filings} material NSE filings · ${pulse.activity.stories} company stories · updated ${time(pulse.refreshedAt)} IST`}>
        {types.length ? types.map(([k, n]) => (
          <div className="nw-row" key={k}>
            <button type="button" onClick={() => onType(k)}>{pulse.activity.labels[k]}</button>
            <span className="nw-bar"><span style={{ width: `${(n / max) * 100}%` }} /></span>
            <span className="nw-num">{n}</span>
          </div>
        )) : <small>No material company news yet today.</small>}
      </Panel>

      {pulse.results.length > 0 && (
        <Panel title={`Results filed today (${pulse.results.length})`} note="Companies that filed financial results with NSE today.">
          <div className="nw-chips">
            {pulse.results.map((c) => <button key={c.symbol} type="button" className="chip" onClick={() => stock(c.symbol)} title={c.name}>{c.symbol}</button>)}
          </div>
        </Panel>
      )}

      <Panel title="Block deals" note={pulse.deals.asOf ? `NSE block deals, ${pulse.deals.asOf}. Value at the traded price.` : 'Published by NSE after the block-deal windows.'}>
        {pulse.deals.block.length ? pulse.deals.block.slice(0, 8).map((d, i) => <DealRow key={`${d.symbol}-${d.client}-${i}`} d={d} onOpen={stock} />)
          : <small>No block deals reported today.</small>}
      </Panel>

      <Panel title="Large bulk deals" note={`Deals of ₹5 crore or more, out of ${pulse.deals.bulkCount} bulk deals NSE reported.`}>
        {pulse.deals.bulk.length ? pulse.deals.bulk.slice(0, 8).map((d, i) => <DealRow key={`${d.symbol}-${d.client}-${i}`} d={d} onOpen={stock} />)
          : <small>No bulk deals of ₹5 crore or more today.</small>}
      </Panel>

      <Panel title="Credit rating actions" note={`Upgrades and downgrades in NSE's credit-rating database, last ${pulse.ratings.windowDays} days; ${pulse.ratings.filingsToday} rating filings today.`}>
        {ratings.length ? ratings.slice(0, 10).map((r, i) => (
          <div className="nw-row" key={`${r.company}-${i}`}>
            <span>
              <span className={r.up ? 'text-positive' : 'text-negative'}>{r.up ? '▲ Upgrade' : '▼ Downgrade'}</span>{' '}
              {r.symbol ? <button type="button" onClick={() => stock(r.symbol)}>{r.company}</button> : r.company}
              <span style={{ display: 'block', fontSize: '10.5px', color: 'var(--text-muted)' }}>{r.agency} · {r.previous ? `${r.previous} → ` : ''}{r.rating}</span>
            </span>
            <span className="nw-num" style={{ fontSize: '11px' }}>{r.date}</span>
          </div>
        )) : <small>No upgrades or downgrades in the window.</small>}
      </Panel>

      <Panel title="Most in the news today">
        {pulse.mostInNews.length ? pulse.mostInNews.map((c) => (
          <div className="nw-row" key={c.symbol}>
            <button type="button" onClick={() => stock(c.symbol)} title={c.name}>{c.symbol}</button>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{c.filings} filings · {c.stories} stories</span>
          </div>
        )) : <small>Nothing yet today.</small>}
      </Panel>
    </div>
  );
}

export default function NewsPage() {
  const [type, setType] = useState('all');
  const [kind, setKind] = useState('all');
  const [days, setDays] = useState('1');
  const [keyOnly, setKeyOnly] = useState(false);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => { const t = setTimeout(() => setQuery(text.trim()), 350); return () => clearTimeout(t); }, [text]);

  const { data: articles = [], isLoading, isFetching, refetch } = useMarketNews(type, 120, {
    kind: kind === 'all' ? undefined : kind, materiality: keyOnly ? 'high' : 'medium', days: Number(days), q: query,
  });
  const { data: pulse } = useNewsPulse();

  return (
    <ErrorBoundary>
      <div className="page-container-wide news-page">
        <div className="page-header">
          <div>
            <h1 className="page-title">Company news</h1>
            <p className="page-subtitle">
              Every material NSE filing from listed companies, and company stories from Economic Times, Business Standard, Mint and BusinessLine.
              Market commentary and routine notices are left out. Updated every 5 minutes.
            </p>
          </div>
        </div>

        <div className="terminal-panel-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.4fr) minmax(280px, 1fr)', gap: '20px', alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 }}>
            <div className="card nw-controls">
              <div className="tab-group" style={{ flexWrap: 'wrap' }}>
                {TYPES.map(([id, label]) => (
                  <button key={id} type="button" onClick={() => setType(id)} className={`tab-pill ${type === id ? 'tab-pill--active' : ''}`} style={{ fontSize: '12px', padding: '5px 11px' }}>
                    {label}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                <Toggle value={kind} onChange={setKind} options={[['all', 'All sources'], ['filing', 'NSE filings'], ['story', 'Publishers']]} />
                <Toggle value={days} onChange={setDays} options={[['1', 'Today'], ['2', '2 days'], ['7', '7 days']]} />
                <Toggle value={keyOnly ? 'key' : 'all'} onChange={(v) => setKeyOnly(v === 'key')} options={[['all', 'All material'], ['key', 'Key events']]} />
                <div style={{ position: 'relative' }}>
                  <Search size={13} style={{ position: 'absolute', left: 9, top: 9, color: 'var(--text-muted)' }} />
                  <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder="Company or keyword" aria-label="Filter news"
                    style={{ paddingLeft: 28, width: 190, height: 31, fontSize: 12 }} />
                </div>
                <button type="button" className="btn btn-ghost" onClick={() => refetch()} aria-label="Refresh news" style={{ padding: '6px 8px' }}>
                  <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {isLoading ? (
              Array.from({ length: 6 }, (_, i) => <div key={i} className="card" style={{ padding: 18 }}><Skeleton height={64} /></div>)
            ) : articles.length ? (
              <>
                <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', display: 'flex', gap: '14px' }}>
                  <span><FileText size={11} /> {articles.filter((a) => a.kind === 'filing').length} NSE filings</span>
                  <span><Newspaper size={11} /> {articles.filter((a) => a.kind === 'story').length} publisher stories</span>
                </div>
                {articles.map((article) => <NewsCard key={article.id} article={article} />)}
              </>
            ) : (
              <div className="card" style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>
                No company news matches these filters{days === '1' ? ' today' : ''}. Try a wider date range or another type.
              </div>
            )}
          </div>

          <Pulse pulse={pulse} onType={setType} />
        </div>
      </div>
    </ErrorBoundary>
  );
}

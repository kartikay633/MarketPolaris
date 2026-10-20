import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Activity, ArrowUpRight, BookOpen, Bot, MessageSquare, Newspaper, PieChart, RefreshCw, Search, Send, Wallet, X } from 'lucide-react';
import api from '../services/api';
import { usePortfolio } from '../hooks/useTrade';
import CompanyLogo from '../components/common/CompanyLogo';
import ErrorBoundary from '../components/common/ErrorBoundary';
import PortfolioPlanner from '../components/research/PortfolioPlanner';
import AiPortfolios from '../components/research/AiPortfolios';
import AISummaryCard from '../components/ai/AISummaryCard';
import '../styles/markdown.css';
import '../styles/pulse-research.css';

// Model evaluation, forward testing and the news ledger run in the backend pipeline and are not shown to customers.
const tabs = [['brief', 'Market brief', Newspaper], ['planner', 'Plan my portfolio', Wallet], ['opportunities', 'Stock outlook', Activity], ['portfolio', 'Portfolio', PieChart], ['bots', 'AI portfolios', Bot], ['chat', 'Research chat', MessageSquare]];
const pct = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'Unavailable';
const num = (value, digits = 3) => Number.isFinite(value) ? value.toLocaleString('en-IN', { maximumFractionDigits: digits }) : 'Unavailable';
const date = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : 'Unavailable';
const cleanSymbol = value => (value || '').replace(/^(NSE|BSE):/, '').toUpperCase();
const safeUrl = value => /^https?:\/\//i.test(value || '') ? value : undefined;
function Note({ children, error = false }) { return <div className={`pr-note${error ? ' pr-note--error' : ''}`} role={error ? 'alert' : undefined}>{children}</div>; }
function Empty({ title, children }) { return <div className="pr-empty"><BookOpen size={24} /><h3>{title}</h3><p>{children}</p></div>; }
function Panel({ title, subtitle, children, action }) { return <section className="pr-panel"><header className="pr-panel-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</header>{children}</section>; }
function Facts({ rows }) { return <dl className="pr-facts">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>; }

const RISK_LABEL = { elevated: 'Elevated', normal: 'Normal', calm: 'Calm' };
const RISK_CLASS = { elevated: 'down', normal: 'uncertain', calm: 'up' };

export default function AIPage() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState(params.get('q') ? 'chat' : tabs.some(([id]) => id === params.get('tab')) ? params.get('tab') : params.get('symbol') ? 'opportunities' : 'planner');
  const [horizon, setHorizon] = useState(params.get('horizon') === '20' ? 20 : 5);
  const [symbol, setSymbol] = useState(cleanSymbol(params.get('symbol')));
  const [search, setSearch] = useState('');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [pending, setPending] = useState(false);
  const [chatError, setChatError] = useState('');
  const [chatNotice, setChatNotice] = useState('');
  const [retryPayload, setRetryPayload] = useState(null);
  const searchRef = useRef(null), inputRef = useRef(null), endRef = useRef(null), pendingRef = useRef(false), initialQueryRef = useRef(''), controllerRef = useRef(null);
  const status = useQuery({ queryKey: ['pulse-research-status'], queryFn: async ({ signal }) => (await api.get('/research/status', { signal })).data, staleTime: 30000, refetchInterval: 60000, retry: 1 });
  const portfolio = usePortfolio();
  const data = status.data, instruments = data?.collection?.instruments || [], stocks = instruments.filter(i => !i.benchmark);
  const predictions = (data?.predictions?.predictions || []).filter(p => p.horizon === horizon);
  const current = predictions.find(p => p.symbol === symbol);
  const ranked = predictions.some(p => Number.isFinite(p.peerRankPercentile));
  const visible = predictions.filter(p => p.symbol.toLowerCase().includes(search.toLowerCase())).sort((a, b) => ranked ? b.peerRankPercentile - a.peerRankPercentile : b.probabilityUp - a.probabilityUp);
  const riskBySymbol = Object.fromEntries((data?.riskPredictions?.predictions || []).map(r => [r.symbol, r]));
  const currentRisk = riskBySymbol[symbol];
  const positions = portfolio.data?.positions || [];
  const valuesAvailable = positions.length > 0 && positions.every(p => Number.isFinite(p.currentValue) && p.currentValue >= 0);
  const totalValue = valuesAvailable ? positions.reduce((sum, p) => sum + p.currentValue, 0) : null;
  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => { if (!symbol && stocks.length) setSymbol(stocks[0].symbol); }, [stocks, symbol]);
  useEffect(() => { if (tab === 'chat') endRef.current?.scrollIntoView({ block: 'nearest' }); }, [messages, pending, tab]);
  const select = (nextSymbol, nextHorizon = horizon) => {
    setSymbol(nextSymbol); setHorizon(nextHorizon);
    setParams(previous => { const next = new URLSearchParams(previous); next.set('symbol', nextSymbol); next.set('horizon', String(nextHorizon)); return next; }, { replace: true });
  };
  const send = async (text, retry = null) => {
    const question = (text || input).trim();
    if (!question || question.length > 4000 || pendingRef.current) return;
    let history = messages.filter(m => !m.failed).slice(-12).map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));
    while (history.reduce((n, m) => n + m.content.length, 0) > 8000) history.shift();
    const payload = retry || { message: question, history, horizon, ...(symbol ? { symbol } : {}) };
    if (!retry) setMessages(previous => [...previous, { role: 'user', content: question }]);
    setInput(''); setChatError(''); setChatNotice(''); setPending(true); pendingRef.current = true; setRetryPayload(payload); setTab('chat');
    controllerRef.current = new AbortController();
    try {
      const response = (await api.post('/research/chat', payload, { timeout: 70000, signal: controllerRef.current.signal })).data;
      const answered = ['gemini', 'grounded'].includes(response.provider);
      setMessages(previous => [...previous, { role: 'assistant', content: response.reply, provider: response.provider, evidence: response.evidence, warning: response.warning, failed: !answered }]);
      // A data-built answer is still an answer: a quiet note offers the full analysis on retry.
      if (response.provider === 'grounded') setChatNotice('This is a brief summary from our data. Retry for the full analysis.');
      else if (!answered) setChatError('Polaris AI could not prepare an answer right now. Your question is saved; retry in a moment.');
      else setRetryPayload(null);
    } catch (error) { if (error.code !== 'ERR_CANCELED') setChatError(error.response?.data?.error || 'The research assistant could not be reached. Your question is saved; retry the request.'); }
    finally { setPending(false); pendingRef.current = false; }
  };
  useEffect(() => { const q = params.get('q')?.trim(); if (q && q !== initialQueryRef.current && !pendingRef.current) { initialQueryRef.current = q; send(q); } }, [params]);
  const discussPortfolio = () => {
    const holdings = positions.map(p => `${p.symbol}: ${p.quantity} shares${Number.isFinite(p.currentValue) ? `, provided market value INR ${p.currentValue.toFixed(2)}` : ', current value unavailable'}`).join('; ');
    setInput(`Review concentration, model coverage and risks for my paper portfolio: ${holdings}. Ask about my investment horizon and risk tolerance before suggesting a strategy.`.slice(0, 4000));
    setTab('chat'); setTimeout(() => inputRef.current?.focus(), 0);
  };
  return <ErrorBoundary><div className="pulse-research page-container-wide">
    <header className="pr-heading"><div><div className="pr-eyebrow">MARKET POLARIS / RESEARCH</div><h1>Polaris AI</h1><p>AI-ranked outlooks for NSE stocks, with risk context and an analyst you can question.</p></div><button className="btn btn-secondary" type="button" disabled={status.isFetching} onClick={() => status.refetch()}><RefreshCw size={15} className={status.isFetching ? 'pr-spinning' : ''} />Refresh results</button></header>
    <div className="pr-status-strip"><span><i className={predictions.length ? 'pr-status-dot' : 'pr-status-dot pr-status-dot--muted'} />{predictions.length ? 'Outlooks live' : data ? 'Outlooks updating' : 'Connecting'}</span><span>{num(stocks.length, 0)} NSE stocks covered</span><span>Market data as of {date(data?.predictions?.asOf)}</span></div>
    <nav className="pr-tabs" aria-label="Polaris AI research views">{tabs.map(([id, title, Icon]) => <button key={id} type="button" aria-pressed={tab === id} className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}><Icon size={16} />{title}</button>)}</nav>
    {!['brief', 'planner', 'bots'].includes(tab) && <div className="pr-toolbar"><label>Prediction horizon<select value={horizon} onChange={e => select(symbol, Number(e.target.value))}><option value={5}>5 trading sessions</option><option value={20}>20 trading sessions</option></select></label><label>Research stock<select value={symbol} onChange={e => select(e.target.value)}><option value="">Select stock</option>{symbol && !stocks.some(s => s.symbol === symbol) && <option value={symbol}>{symbol} · outside collection</option>}{stocks.map(s => <option key={s.symbol} value={s.symbol}>{s.symbol}</option>)}</select></label></div>}
    {status.isPending && <div className="pr-loading" role="status">Loading outlooks…</div>}
    {status.isError && <Note error>Outlooks could not be loaded right now. Please use Refresh results in a moment.</Note>}
    {data?.stale && predictions.length > 0 && <Note>Outlooks refresh after each market close. Figures below are as of {date(data?.predictions?.asOf)}.</Note>}
    {tab === 'brief' && <div className="pr-content"><Note>The market brief is built from NSE and Upstox data after each session. It describes the market; it is not investment advice.</Note><AISummaryCard full /></div>}
    {tab === 'planner' && <PortfolioPlanner onDiscuss={text => send(text)} />}
    {tab === 'bots' && <AiPortfolios />}
    {tab === 'opportunities' && <div className="pr-content"><Note>Model-based outlooks for research and paper trading. They are probabilities, not guarantees or investment advice.</Note><div className="pr-outlook-grid"><Panel title="Stock outlook" subtitle={ranked ? `${horizon}-session horizon · ranked by probability of beating peers` : `${horizon}-session horizon · ranked by estimated probability of a positive return`} action={<div className="pr-search"><Search size={15} /><input ref={searchRef} aria-label="Search outlook stocks" placeholder="Find a stock" value={search} onChange={e => setSearch(e.target.value)} />{search && <button type="button" aria-label="Clear stock search" onClick={() => { setSearch(''); searchRef.current?.focus(); }}><X size={15} /></button>}</div>}>
      {!predictions.length ? <Empty title="Outlooks are updating">New outlooks appear after the next market-close update.</Empty> : !visible.length ? <Empty title="No matching stocks">Clear the search or try another symbol.</Empty> : <div className="pr-table-scroll"><table className="pr-table"><thead><tr><th>Stock</th>{ranked && <th>Sector</th>}<th>{ranked ? 'Beat peers' : 'Probability up'}</th>{ranked && <th>Beat NIFTY</th>}<th>{ranked ? 'Outlook' : 'Signal'}</th>{ranked && <th>Volatility risk</th>}<th>As of</th></tr></thead><tbody>{visible.map(p => <tr key={p.symbol} className={symbol === p.symbol ? 'is-selected' : ''}><th scope="row"><button type="button" className="pr-stock-button" onClick={() => select(p.symbol)}><CompanyLogo symbol={p.symbol} size={24} />{p.symbol}</button></th>{ranked && <td>{p.sector || '—'}</td>}<td>{pct(ranked ? p.probabilityOutperformPeers : p.probabilityUp)}</td>{ranked && <td>{pct(p.probabilityBeatNifty)}</td>}<td><span className={`pr-signal pr-signal--${p.signal}`}>{ranked ? (p.tier === 'top quintile' ? 'Top ranked' : p.tier === 'bottom quintile' ? 'Bottom ranked' : 'Neutral') : p.signal === 'up' ? 'Up signal' : p.signal === 'down' ? 'Down signal' : 'Uncertain'}</span></td>{ranked && <td>{riskBySymbol[p.symbol] ? <span className={`pr-signal pr-signal--${RISK_CLASS[riskBySymbol[p.symbol].riskTier]}`}>{RISK_LABEL[riskBySymbol[p.symbol].riskTier]}</span> : '—'}</td>}<td>{date(p.asOf)}</td></tr>)}</tbody></table></div>}</Panel>
      <Panel title={symbol || 'Stock detail'} subtitle={`Next ${horizon} trading sessions`}>{current ? <>{ranked ? <div className="pr-probability"><span>Estimated probability of beating the peer median</span><strong>{pct(current.probabilityOutperformPeers)}</strong><div className="pr-probability-track" aria-hidden="true"><div style={{ width: `${Math.max(0, Math.min(100, current.peerRankPercentile * 100))}%` }} /></div><small>Ranked above {pct(current.peerRankPercentile)} of covered stocks · as of {date(current.asOf)}</small></div> : <div className="pr-probability"><span>Estimated probability of a positive return</span><strong>{pct(current.probabilityUp)}</strong><div className="pr-probability-track" aria-hidden="true"><div style={{ width: `${Math.max(0, Math.min(100, current.probabilityUp * 100))}%` }} /></div><small>{horizon} trading sessions · as of {date(current.asOf)}</small></div>}<Facts rows={[
        ...(ranked ? [['Beat NIFTY 50', pct(current.probabilityBeatNifty)], ['Positive return', pct(current.probabilityUp)], ['Sector', current.sector || 'Unavailable']] : []),
      ]} />{currentRisk && <div className="pr-panel-body pr-risk"><h3 className="pr-small">Volatility risk · next {currentRisk.horizon} sessions</h3><div className="pr-risk-row"><strong>{pct(currentRisk.probabilityHighVolatility)}</strong><span className={`pr-signal pr-signal--${RISK_CLASS[currentRisk.riskTier]}`}>{RISK_LABEL[currentRisk.riskTier]}</span></div><p className="pr-small">Chance that price swings will be larger than usual for this stock. Current volatility {pct(currentRisk.currentVolatilityAnnualised)} a year vs a normal {pct(currentRisk.normalVolatilityAnnualised)}. Useful for position size and stop distance; it does not indicate direction.</p></div>}{current.drivers?.length > 0 && <div className="pr-panel-body"><h3 className="pr-small">Key factors</h3><ul className="pr-limitations">{current.drivers.map(d => <li key={d.feature}><strong>{d.label}</strong> {d.direction} the outlook · {pct(d.percentile)} percentile among covered stocks</li>)}</ul></div>}<div className="pr-panel-body pr-actions"><button type="button" className="btn btn-primary" disabled={pending} onClick={() => send(`Explain the ${horizon}-session outlook for ${symbol}: its key factors, counterarguments and risks.`)}>Discuss this outlook<ArrowUpRight size={14} /></button><Link className="btn btn-secondary" to={`/stocks/${encodeURIComponent(`NSE:${symbol}`)}`}>Open stock details</Link><Link className="btn btn-secondary" to={`/trade?symbol=${encodeURIComponent(`NSE:${symbol}`)}`}>Open paper trading</Link></div></> : <Empty title="No outlook for this stock">Select a stock from the list. Outlooks cover the stocks shown in the table.</Empty>}</Panel></div></div>}
    {tab === 'portfolio' && <div className="pr-content"><Panel title="Your paper portfolio" subtitle="Review concentration and research coverage before discussing a strategy" action={<Link className="btn btn-secondary" to="/portfolio">Open portfolio<ArrowUpRight size={14} /></Link>}>{portfolio.isPending ? <div className="pr-loading" role="status">Loading your paper positions…</div> : portfolio.isError ? <div className="pr-panel-body"><Note error>Portfolio data could not be loaded.</Note><button type="button" className="btn btn-secondary" onClick={() => portfolio.refetch()}>Retry portfolio</button></div> : !positions.length ? <Empty title="No open paper positions">Your existing paper holdings will appear here when available. You can still discuss a hypothetical allocation in Research chat.</Empty> : <><div className="pr-table-scroll"><table className="pr-table"><thead><tr><th>Holding</th><th>Quantity</th><th>Provided current value</th><th>Weight in holdings</th><th>Outlook coverage</th></tr></thead><tbody>{positions.map(p => <tr key={p.symbol}><th scope="row">{p.symbol}</th><td>{num(p.quantity, 0)}</td><td>{Number.isFinite(p.currentValue) ? `₹${num(p.currentValue, 2)}` : 'Unavailable'}</td><td>{totalValue > 0 ? pct(p.currentValue / totalValue) : 'Unavailable'}</td><td>{predictions.some(x => x.symbol === cleanSymbol(p.symbol)) ? 'Covered' : 'Not covered'}</td></tr>)}</tbody></table></div><div className="pr-panel-body"><p className="pr-small">Weights exclude cash and use only the portfolio service’s provided current values. These are simulated holdings. Strategy discussion does not execute trades.</p><button type="button" className="btn btn-primary" onClick={discussPortfolio}>Prepare portfolio discussion<ArrowUpRight size={14} /></button></div></>}</Panel></div>}
    {tab === 'chat' && <section className="pr-chat pr-panel"><header className="pr-panel-heading"><div><h2>Research conversation</h2><p>Ask about any covered stock, its outlook and risks, or your paper portfolio.</p></div></header><div className="pr-chat-messages" aria-live="polite">{!messages.length && <Empty title="Ask Polaris AI">Ask what drives a stock’s outlook, which stocks carry the most risk, or how concentrated your portfolio is.</Empty>}{messages.map((message, index) => <article key={index} className={`pr-message pr-message--${message.role}`}><div className="pr-message-label">{message.role === 'user' ? 'You' : 'Polaris AI'}</div><div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown></div>{message.evidence?.some(e => safeUrl(e.url)) && <details className="pr-details"><summary>Sources</summary><ul>{message.evidence.filter(e => safeUrl(e.url)).map(e => <li key={e.id}><a href={e.url} target="_blank" rel="noopener noreferrer">{e.title || e.source}</a></li>)}</ul></details>}</article>)}{pending && <div className="pr-small" role="status">Polaris AI is preparing an answer…</div>}<div ref={endRef} /></div><div className="pr-chat-composer">{chatError && <Note error>{chatError} {retryPayload && <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => send(retryPayload.message, retryPayload)}>Retry answer</button>}</Note>}{!chatError && chatNotice && <Note>{chatNotice} {retryPayload && <button type="button" className="btn btn-secondary" disabled={pending} onClick={() => send(retryPayload.message, retryPayload)}>Get full analysis</button>}</Note>}<div className="pr-prompts">{['Which stocks rank highest right now, and why?', 'Which stocks carry the highest volatility risk?', ...(symbol ? [`What are the main risks for ${symbol}?`] : []), 'How can I reduce risk in my paper portfolio?'].map(q => <button type="button" key={q} disabled={pending} onClick={() => send(q)}>{q}</button>)}</div><form noValidate onSubmit={e => { e.preventDefault(); send(); }}><label htmlFor="pulse-research-question" className="pr-small">Question · {symbol || 'all covered stocks'} · {horizon} sessions</label><div className="pr-compose-row"><textarea id="pulse-research-question" ref={inputRef} value={input} maxLength={4000} rows={3} placeholder="Ask about a stock, its outlook, or a portfolio scenario…" onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} /><button type="submit" className="btn btn-primary" disabled={pending || !input.trim()}><Send size={15} />{pending ? 'Working…' : 'Send'}</button></div><div className="pr-compose-hint"><span>Enter to send · Shift + Enter for a new line</span><span>{input.length}/4,000</span></div></form></div></section>}
  </div></ErrorBoundary>;
}

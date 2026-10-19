import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bot } from 'lucide-react';
import api from '../../services/api';
import CompanyLogo from '../common/CompanyLogo';

const inr = (v, d = 0) => Number.isFinite(v) ? `₹${v.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d })}` : '—';
const pct = (v, d = 2) => Number.isFinite(v) ? `${v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%` : '—';
const date = v => v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : '—';
function Metric({ label, value, detail }) { return <div className="pr-metric"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>; }

// Account value and NIFTY 50, both rebased to the bot's start.
function Growth({ equity }) {
  if (!equity || equity.length < 2) return <p className="pr-small pr-panel-body">The growth chart appears after a few trading days.</p>;
  const w = 640, h = 120, n = equity.length;
  const a = equity.map(e => e.value / equity[0].value), b = equity.map(e => e.nifty / equity[0].nifty);
  const lo = Math.min(...a, ...b), hi = Math.max(...a, ...b), span = hi - lo || 1;
  const line = s => s.map((v, i) => `${(i / (n - 1)) * w},${h - ((v - lo) / span) * h}`).join(' ');
  return <div className="pr-panel-body"><svg className="pr-growth" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Account value versus NIFTY 50 since start">
    <polyline points={line(b)} className="pr-growth-nifty" /><polyline points={line(a)} className="pr-growth-bot" /></svg>
    <p className="pr-small"><span className="pr-key pr-key--bot" /> AI account <span className="pr-key pr-key--nifty" /> NIFTY 50, both from the start date</p></div>;
}

function BotCard({ bot }) {
  if (bot.status !== 'running') return <section className="pr-panel"><header className="pr-panel-heading"><div><h2>{bot.label}</h2><p>{bot.description}</p></div></header>
    <div className="pr-empty"><Bot size={24} /><h3>Not started yet</h3><p>It starts with ₹2,00,000 on the first evening its model publishes forecasts.</p></div></section>;
  const vsNifty = Number.isFinite(bot.niftyReturnPct) ? bot.returnPct - bot.niftyReturnPct : null;
  return <section className="pr-panel">
    <header className="pr-panel-heading"><div><h2>{bot.label}</h2><p>{bot.description} · trading since {date(bot.startAsOf)} · values as of {date(bot.asOf)} close</p></div></header>
    <div className="pr-metrics pr-panel-body">
      <Metric label="Account value" value={inr(bot.value)} detail={`Started with ${inr(bot.startCash)}; no money added`} />
      <Metric label="Return" value={pct(bot.returnPct)} detail={vsNifty === null ? 'NIFTY comparison after the first day' : `${pct(vsNifty)} versus NIFTY 50 (${pct(bot.niftyReturnPct)})`} />
      <Metric label="Worst dip" value={pct(bot.maxDrawdown)} detail="Largest fall from a previous high" />
      <Metric label="Largest holding" value={pct(bot.largestPositionWeight, 1).replace('+', '')} detail={`${bot.positions.length} stocks · cash ${inr(bot.cash)}`} />
    </div>
    <Growth equity={bot.equity} />
    {bot.pending.length > 0 && <div className="pr-panel-body"><h3 className="pr-small">Orders for the next market open</h3>
      <ul className="pr-limitations">{bot.pending.map((o, i) => <li key={i}><strong>{o.side === 'BUY' ? 'Buy' : 'Sell'} {o.quantity} {o.symbol}</strong> — {o.reason}</li>)}</ul></div>}
    {bot.positions.length > 0 && <div className="pr-table-scroll"><table className="pr-table"><thead><tr><th>Holding</th><th>Shares</th><th>Avg cost</th><th>Price</th><th>Value</th><th>Weight</th><th>Profit / loss</th><th>Since</th></tr></thead>
      <tbody>{bot.positions.map(p => <tr key={p.symbol}><th scope="row"><Link className="pr-stock-button" to={`/stocks/${encodeURIComponent(`NSE:${p.symbol}`)}`}><CompanyLogo symbol={p.symbol} size={22} />{p.symbol}</Link></th>
        <td>{p.quantity}</td><td>{inr(p.avgPrice, 2)}</td><td>{inr(p.price, 2)}</td><td>{inr(p.value)}</td><td>{pct(p.weight, 1).replace('+', '')}</td>
        <td className={p.unrealized >= 0 ? 'text-positive' : 'text-negative'}>{inr(p.unrealized)}</td><td>{date(p.openedOn)}</td></tr>)}</tbody></table></div>}
    {bot.trades.length > 0 && <details className="pr-details pr-panel-body"><summary>Trade history ({bot.trades.length})</summary>
      <div className="pr-table-scroll"><table className="pr-table"><thead><tr><th>Date</th><th>Action</th><th>Stock</th><th>Shares</th><th>Price</th><th>Result</th><th>Why</th></tr></thead>
        <tbody>{bot.trades.map((t, i) => <tr key={i}><td>{date(t.date)}</td><td>{t.status === 'filled' ? (t.side === 'BUY' ? 'Bought' : 'Sold') : 'Cancelled'}</td><td>{t.symbol}</td><td>{t.quantity}</td><td>{inr(t.price, 2)}</td>
          <td className={t.pnl > 0 ? 'text-positive' : t.pnl < 0 ? 'text-negative' : ''}>{Number.isFinite(t.pnl) ? inr(t.pnl) : t.note || '—'}</td><td className="pr-why">{t.reason}</td></tr>)}</tbody></table></div></details>}
    <div className="pr-panel-body"><h3 className="pr-small">What the losses taught us</h3>
      {bot.learnings.length ? <ul className="pr-limitations">{bot.learnings.map((l, i) => <li key={i}><strong>{l.symbol} · {l.category}</strong> ({pct(l.stockReturn)} vs NIFTY {pct(l.niftyReturn)}, {date(l.openedOn)}–{date(l.exitDate)}): {l.lesson}</li>)}</ul>
        : <p className="pr-small">No losing exits yet. Every losing sale is reviewed here: whole-market fall, results, company news, an expected high-risk swing, or a genuine model miss.</p>}
    </div>
  </section>;
}

export default function AiPortfolios() {
  const bots = useQuery({ queryKey: ['pulse-bots'], queryFn: async () => (await api.get('/research/bots')).data.bots, staleTime: 60000, refetchInterval: 300000 });
  return <div className="pr-content">
    <div className="pr-note">Pulse AI trades these paper accounts on its own. Each started with ₹2,00,000 and can never add money. Decisions are made after the evening data update and filled at the next market open, with brokerage and taxes deducted. Paper trading only; not investment advice.</div>
    {bots.isPending && <div className="pr-loading" role="status">Loading AI portfolios…</div>}
    {bots.isError && <div className="pr-note pr-note--error" role="alert">AI portfolios are unavailable right now.</div>}
    {bots.data?.map(bot => <BotCard key={bot.id} bot={bot} />)}
  </div>;
}

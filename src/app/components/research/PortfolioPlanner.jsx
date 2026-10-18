import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, CheckCircle2, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../services/api';
import { usePortfolio } from '../../hooks/useTrade';
import CompanyLogo from '../common/CompanyLogo';

const HORIZONS = [['1w', '1 week'], ['1m', '1 month'], ['3m', '3 months'], ['1y', '1 year']];
const RISKS = [
  ['conservative', 'Conservative', 'Steadier stocks, 12 holdings, 20% kept in cash'],
  ['balanced', 'Balanced', '10 holdings across sectors, 10% cash'],
  ['growth', 'Growth', '8 higher-conviction holdings, 5% cash'],
];
const PRESETS = [50000, 100000, 200000, 500000, 1000000];
const ACTION = { add: ['Buy more', 'up'], hold: ['Hold', 'uncertain'], trim: ['Trim', 'down'], sell: ['Sell', 'down'], review: ['Review', 'uncertain'] };
const RISK_LABEL = { elevated: 'Elevated', normal: 'Normal', calm: 'Calm' };
const RISK_CLASS = { elevated: 'down', normal: 'uncertain', calm: 'up' };
const STORE = 'pulse-planner-profile';

const inr = (v, digits = 0) => Number.isFinite(v) ? `₹${v.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits })}` : '—';
const pct = (v, digits = 1) => Number.isFinite(v) ? `${(v * 100).toFixed(digits)}%` : '—';
const date = v => v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '—';
function loadProfile() {
  try { return { budget: 200000, horizon: '1m', risk: 'balanced', ...JSON.parse(localStorage.getItem(STORE) || '{}') }; }
  catch { return { budget: 200000, horizon: '1m', risk: 'balanced' }; }
}
function Metric({ label, value, detail }) { return <div className="pr-metric"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>; }

export default function PortfolioPlanner({ onDiscuss }) {
  const [profile, setProfile] = useState(loadProfile);
  const [budgetText, setBudgetText] = useState(String(loadProfile().budget));
  const [placing, setPlacing] = useState(false);
  const queryClient = useQueryClient();
  const portfolio = usePortfolio();
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify(profile)); } catch { /* preference only */ } }, [profile]);
  const budget = Number(budgetText.replace(/[^\d]/g, ''));
  const budgetValid = budget >= 10000 && budget <= 100000000;

  const plan = useMutation({ mutationFn: async input => (await api.post('/research/advisor/plan', input, { timeout: 30000 })).data });
  const positions = portfolio.data?.positions || [];
  const cash = portfolio.data?.cashBalance ?? portfolio.data?.account?.cashBalance;
  const reviewInput = useMemo(() => ({ ...profile, cash: Number.isFinite(cash) ? cash : undefined,
    positions: positions.filter(p => p.quantity > 0).map(p => ({ symbol: p.symbol, quantity: p.quantity, avgPrice: p.avgPrice, ...(p.priceLive && p.currentPrice > 0 ? { currentPrice: p.currentPrice } : {}) })) }),
  [profile, positions, cash]);
  const review = useQuery({ queryKey: ['pulse-checkup', reviewInput], enabled: reviewInput.positions.length > 0,
    queryFn: async () => (await api.post('/research/advisor/review', reviewInput, { timeout: 30000 })).data, staleTime: 60000 });
  const record = useQuery({ queryKey: ['pulse-track-record'], queryFn: async () => (await api.get('/research/advisor/track-record')).data, staleTime: 300000 });

  const trade = async (symbol, type, quantity) => {
    const res = await api.post('/trade/order', { symbol: `NSE:${symbol}`, type, quantity });
    return res.data;
  };
  const placePlan = async () => {
    if (!plan.data || placing) return;
    setPlacing(true);
    let done = 0;
    const failed = [];
    for (const h of plan.data.holdings) {
      try { await trade(h.symbol, 'BUY', h.quantity); done += 1; }
      catch (error) { failed.push(`${h.symbol}: ${error.response?.data?.error || 'order failed'}`); }
    }
    setPlacing(false);
    queryClient.invalidateQueries({ queryKey: ['portfolio'] });
    queryClient.invalidateQueries({ queryKey: ['trade', 'orders'] });
    if (done) toast.success(`Placed ${done} paper ${done === 1 ? 'order' : 'orders'}`);
    if (failed.length) toast.error(failed.slice(0, 3).join(' · '));
  };
  const act = useMutation({
    mutationFn: ({ symbol, action, quantity }) => trade(symbol, action === 'add' ? 'BUY' : 'SELL', quantity),
    onSuccess: (_d, v) => { toast.success(`${ACTION[v.action][0]}: ${v.quantity} ${v.symbol}`); queryClient.invalidateQueries({ queryKey: ['portfolio'] }); },
    onError: e => toast.error(e.response?.data?.error || 'Paper order failed'),
  });

  const p = plan.data;
  const scored = record.data?.model?.plans || 0;
  return <div className="pr-content">
    <section className="pr-panel">
      <header className="pr-panel-heading"><div><h2>Plan my portfolio</h2><p>Tell Pulse AI your budget and timeline. It builds a diversified paper portfolio sized to each stock’s expected risk.</p></div></header>
      <div className="pr-panel-body pr-planner-form">
        <label className="pr-field"><span>How much do you want to invest?</span>
          <div className="pr-budget"><b>₹</b><input inputMode="numeric" aria-label="Investment amount in rupees" value={budget ? budget.toLocaleString('en-IN') : ''} onChange={e => setBudgetText(e.target.value)} onBlur={() => budgetValid && setProfile(v => ({ ...v, budget }))} /></div>
          <div className="pr-chips">{PRESETS.map(v => <button key={v} type="button" className={budget === v ? 'is-active' : ''} onClick={() => { setBudgetText(String(v)); setProfile(x => ({ ...x, budget: v })); }}>{inr(v)}</button>)}</div>
          {!budgetValid && budgetText && <small className="pr-field-error">Enter between ₹10,000 and ₹10 crore.</small>}
        </label>
        <div className="pr-field"><span>For how long?</span>
          <div className="pr-chips">{HORIZONS.map(([id, label]) => <button key={id} type="button" aria-pressed={profile.horizon === id} className={profile.horizon === id ? 'is-active' : ''} onClick={() => setProfile(v => ({ ...v, horizon: id }))}>{label}</button>)}</div>
        </div>
        <div className="pr-field"><span>Your risk style</span>
          <div className="pr-risk-options">{RISKS.map(([id, label, detail]) => <button key={id} type="button" aria-pressed={profile.risk === id} className={profile.risk === id ? 'is-active' : ''} onClick={() => setProfile(v => ({ ...v, risk: id }))}><strong>{label}</strong><small>{detail}</small></button>)}</div>
        </div>
        <div className="pr-actions"><button type="button" className="btn btn-primary" disabled={!budgetValid || plan.isPending} onClick={() => { const input = { ...profile, budget }; setProfile(input); plan.mutate(input); }}><Sparkles size={15} />{plan.isPending ? 'Building your plan…' : 'Build my plan'}</button></div>
        {plan.isError && <div className="pr-note pr-note--error" role="alert">{plan.error?.response?.data?.error || 'The plan could not be built right now. Please try again.'}</div>}
      </div>
    </section>

    {p && <section className="pr-panel">
      <header className="pr-panel-heading"><div><h2>Your {p.horizon.toLowerCase()} {p.profile.toLowerCase()} plan</h2><p>Prices as of {date(p.asOf)} close · {p.holdings.length} holdings across {p.risk.sectors} sectors</p></div>
        <div className="pr-actions"><button type="button" className="btn btn-primary" disabled={placing} onClick={placePlan}><CheckCircle2 size={15} />{placing ? 'Placing orders…' : 'Place paper orders'}</button>{onDiscuss && <button type="button" className="btn btn-secondary" onClick={() => onDiscuss(`I am considering this ${p.horizon} ${p.profile} paper plan of ${inr(p.input.budget)}: ${p.holdings.map(h => `${h.symbol} ${pct(h.weight, 0)}`).join(', ')}. Explain the main risks and what could go wrong.`)}>Discuss with Pulse AI</button>}</div></header>
      <div className="pr-metrics pr-panel-body">
        <Metric label="Invested" value={inr(p.invested)} detail={`${pct(p.invested / p.input.budget, 0)} of your budget`} />
        <Metric label="Kept in cash" value={inr(p.cash)} detail="Buffer for dips and rebalancing" />
        <Metric label={`Typical swing over ${p.horizon}`} value={`±${pct(p.risk.typicalRangeOverHorizon)}`} detail="About two in three outcomes fall inside this range" />
        <Metric label="Bad-case drawdown" value={inr(p.risk.badCaseAmount)} detail={`Roughly a 1-in-40 outcome over ${p.horizon}`} />
      </div>
      <div className="pr-table-scroll"><table className="pr-table"><thead><tr><th>Stock</th><th>Sector</th><th>Shares</th><th>Price</th><th>Amount</th><th>Weight</th><th>Volatility</th><th>Review if below</th><th>Why</th></tr></thead>
        <tbody>{p.holdings.map(h => <tr key={h.symbol}><th scope="row"><Link className="pr-stock-button" to={`/stocks/${encodeURIComponent(`NSE:${h.symbol}`)}`}><CompanyLogo symbol={h.symbol} size={22} />{h.symbol}</Link></th><td>{h.sector || '—'}</td><td>{h.quantity}</td><td>{inr(h.price, 2)}</td><td>{inr(h.amount)}</td><td>{pct(h.weight)}</td><td><span className={`pr-signal pr-signal--${RISK_CLASS[h.riskTier]}`}>{RISK_LABEL[h.riskTier]}</span></td><td>{inr(h.reviewBelow, 2)}</td><td className="pr-why">{h.reasons.join(' · ')}</td></tr>)}</tbody></table></div>
      <ul className="pr-limitations pr-panel-body">{p.notes.map(n => <li key={n}>{n}</li>)}<li>{p.reviewSchedule}.</li></ul>
    </section>}

    <section className="pr-panel">
      <header className="pr-panel-heading"><div><h2>Daily check-up</h2><p>What Pulse AI would do with your paper holdings today, using your {RISKS.find(r => r[0] === profile.risk)[1].toLowerCase()} {HORIZONS.find(h => h[0] === profile.horizon)[1]} profile</p></div>
        <div className="pr-actions"><button type="button" className="btn btn-secondary" disabled={review.isFetching} onClick={() => review.refetch()}><RefreshCw size={14} className={review.isFetching ? 'pr-spinning' : ''} />Refresh</button><Link className="btn btn-secondary" to="/portfolio">Open portfolio<ArrowUpRight size={14} /></Link></div></header>
      {!reviewInput.positions.length ? <div className="pr-empty"><ShieldCheck size={24} /><h3>No paper holdings yet</h3><p>Build a plan and place paper orders. Your check-up appears here every day after the market close update.</p></div>
        : review.isPending ? <div className="pr-loading pr-panel-body" role="status">Checking your holdings…</div>
        : review.isError ? <div className="pr-panel-body"><div className="pr-note pr-note--error" role="alert">The check-up is unavailable right now.</div></div>
        : <>
          <div className="pr-table-scroll"><table className="pr-table"><thead><tr><th>Holding</th><th>Suggestion</th><th>Shares</th><th>Weight</th><th>Volatility</th><th>Why</th><th /></tr></thead>
            <tbody>{review.data.actions.map(a => <tr key={a.symbol}><th scope="row">{a.symbol}</th><td><span className={`pr-signal pr-signal--${ACTION[a.action][1]}`}>{ACTION[a.action][0]}</span></td><td>{a.quantity || '—'}</td><td>{pct(a.weight)}</td><td>{a.riskTier ? RISK_LABEL[a.riskTier] : '—'}</td><td className="pr-why">{a.reasons.join(' · ')}</td>
              <td>{['add', 'trim', 'sell'].includes(a.action) && a.quantity > 0 && <button type="button" className="btn btn-secondary" disabled={act.isPending} onClick={() => act.mutate(a)}>{ACTION[a.action][0]}</button>}</td></tr>)}</tbody></table></div>
          {review.data.ideas.length > 0 && <p className="pr-panel-body pr-small">New ideas ranked highest today: {review.data.ideas.map(i => i.symbol).join(', ')}.</p>}
        </>}
    </section>

    <section className="pr-panel">
      <header className="pr-panel-heading"><div><h2>Track record</h2><p>Every evening Pulse AI records model portfolios for each risk style and timeline, then scores them against NIFTY 50 when they mature. Records are never edited.</p></div></header>
      <div className="pr-metrics pr-panel-body">{scored > 0 ? <>
        <Metric label="Matured model portfolios" value={scored} />
        <Metric label="Beat NIFTY 50" value={pct(record.data.model.beatNiftyRate)} detail="Share of matured portfolios" />
        <Metric label="Average excess return" value={pct(record.data.model.meanExcessReturn, 2)} detail="Versus NIFTY 50, same dates" />
      </> : <Metric label="Portfolios being tracked" value={record.data?.plans ?? '—'} detail="The first one-week results arrive about a week after tracking began" />}</div>
    </section>
    <p className="pr-small">Paper trading only. Pulse AI provides model-based research to support your own decisions; it is not investment advice.</p>
  </div>;
}

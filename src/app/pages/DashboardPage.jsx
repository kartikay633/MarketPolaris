// Flight Deck dashboard — market overview, paper capital, flows, participation, movers and the wire.
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useMarketOverview, useGainers, useLosers, useActive, useMarketStocks } from '../hooks/useMarketData';
import { useMarketNews } from '../hooks/useNews';
import { usePortfolio, useAddFunds } from '../hooks/useTrade';
import { useStockHistory } from '../hooks/useStockData';
import MarketBreadthBar from '../components/market/MarketBreadthBar';
import SectorBar from '../components/market/SectorBar';
import CompanyLogo from '../components/common/CompanyLogo';
import AISummaryCard from '../components/ai/AISummaryCard';
import { TableSkeleton } from '../components/common/LoadingSkeleton';
import ErrorBoundary from '../components/common/ErrorBoundary';
import DataStamp from '../components/common/DataStamp';
import { formatINR, formatNumber, formatVolume, formatCrore } from '../utils/formatters';
import { TrendingUp, TrendingDown, Activity, Flame, RefreshCw } from 'lucide-react';

const IST_OFFSET_S = 19800;
const SESSION_OPEN_MIN = 555; // 09:15 IST
const SESSION_LEN_MIN = 375; // 09:15 → 15:30
const TRACE_W = 1000;
const TRACE_H = 236;
const AXIS_TICKS = ['09:15', '10:30', '11:45', '13:00', '14:15', '15:30'];
const VIX_MIN = 10;
const VIX_MAX = 35;

const istDay = (t) => new Date((t + IST_OFFSET_S) * 1000).toISOString().slice(0, 10);
const signed = (n, digits = 2) => `${n >= 0 ? '+' : '−'}${formatNumber(Math.abs(n), digits)}`;
const clampPct = (n) => Math.min(100, Math.max(0, n));
const rangePos = (value, low, high) => (high > low ? clampPct(((value - low) / (high - low)) * 100) : 50);

// Volatility regime read straight off India VIX; direction from breadth of the tracked universe.
function vixRegime(vix) {
  if (!Number.isFinite(vix)) return null;
  if (vix < 13) return { short: 'Calm', word: 'Low volatility' };
  if (vix < 18) return { short: 'Normal', word: 'Normal volatility' };
  if (vix < 24) return { short: 'Elevated', word: 'Elevated volatility' };
  return { short: 'Stressed', word: 'High volatility' };
}

function breadthTone(breadth) {
  if (!breadth?.total) return null;
  const adv = breadth.advancing / breadth.total;
  const dec = breadth.declining / breadth.total;
  if (adv >= 0.6) return 'broad advance';
  if (dec >= 0.6) return 'broad decline';
  return 'mixed breadth';
}

const formatDay = (ymd) => new Date(`${ymd}T12:00:00+05:30`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

function Unavailable({ title, children }) {
  return (
    <div className="fd-pane">
      <div className="fd-lbl">{title}</div>
      <div className="fd-unavailable">
        <span>Unavailable right now</span>
        <span style={{ fontSize: '12px', color: 'var(--text-dim)' }}>{children}</span>
      </div>
    </div>
  );
}

// Builds the intraday trace for the most recent session in the candle history.
function buildSessionTrace(candles, previousClose) {
  if (!candles?.length) return null;
  const sorted = [...candles].filter((c) => Number.isFinite(c?.close)).sort((a, b) => a.time - b.time);
  if (sorted.length < 2) return null;
  const lastDay = istDay(sorted[sorted.length - 1].time);
  const session = sorted.filter((c) => istDay(c.time) === lastDay);
  if (session.length < 2) return null;

  const closes = session.map((c) => c.close);
  const refs = Number.isFinite(previousClose) ? [...closes, previousClose] : closes;
  const lo = Math.min(...refs);
  const hi = Math.max(...refs);
  const span = Math.max(hi - lo, 0.0001);
  const pad = 18;
  const y = (v) => pad + (1 - (v - lo) / span) * (TRACE_H - pad * 2);
  const x = (t) => {
    const minute = (((t + IST_OFFSET_S) % 86400) / 60) - SESSION_OPEN_MIN;
    return (Math.min(Math.max(minute, 0), SESSION_LEN_MIN) / SESSION_LEN_MIN) * TRACE_W;
  };

  const pts = session.map((c) => [x(c.time), y(c.close)]);
  const line = pts.map(([px, py], i) => `${i ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1];
  return {
    line,
    fill: `${line} L${last[0].toFixed(1)} ${TRACE_H} L${pts[0][0].toFixed(1)} ${TRACE_H} Z`,
    prevY: Number.isFinite(previousClose) ? y(previousClose) : null,
    endX: last[0] / TRACE_W,
    endY: last[1] / TRACE_H,
    lastClose: closes[closes.length - 1],
    date: new Date((session[0].time + IST_OFFSET_S) * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' }),
  };
}

function useIstClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { user, profile } = useAuthStore();
  const [activeTab, setActiveTab] = useState('gainers');
  const now = useIstClock();

  const { data: overview, isLoading: isOverviewLoading, refetch: refetchOverview } = useMarketOverview();
  const { data: gainers = [], isLoading: isGainersLoading } = useGainers(15);
  const { data: losers = [], isLoading: isLosersLoading } = useLosers(15);
  const { data: active = [], isLoading: isActiveLoading } = useActive(15);
  const { data: universe } = useMarketStocks();
  const { data: marketNews = [], isLoading: isNewsLoading } = useMarketNews('all', 6);

  // Live Simulated Capital Queries & Mutations
  const { data: portfolioData, refetch: refetchPortfolio } = usePortfolio();
  const addFundsMutation = useAddFunds();

  const cashBalance = portfolioData?.account?.cashBalance ?? 1000000;
  const portfolioTotalValue = portfolioData?.account?.portfolioTotalValue ?? cashBalance;

  const displayName = profile?.displayName || user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Trader';

  const [isRefreshing, setIsRefreshing] = useState(false);
  const handleRefresh = () => {
    setIsRefreshing(true);
    refetchOverview();
    refetchPortfolio();
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  // Each block is null when its source is unavailable; the pane then says so instead of guessing.
  const institutionalFlows = overview?.institutionalFlows || null;
  const turnover = overview?.turnover || null;
  const derivatives = overview?.derivatives || null;
  const sources = overview?.sources || {};
  const asOf = overview?.asOf || {};

  // Stocks that set a new 52-week high in the session (day high at the trailing 52-week high).
  const breakouts = (universe?.stocks || [])
    .filter((s) => s.fiftyTwoWeekHigh && s.high >= s.fiftyTwoWeekHigh)
    .sort((a, b) => b.changePercent - a.changePercent);

  const indices = overview?.indices || [];
  const nifty = indices.find((i) => i.symbol === 'NIFTY_50') || indices[0];
  const vixIndex = indices.find((i) => i.symbol === 'INDIA_VIX');
  const stripIndices = indices.filter((i) => i !== nifty);

  const { data: niftyCandles = [] } = useStockHistory(nifty?.symbol, '1D');
  const trace = useMemo(() => buildSessionTrace(niftyCandles, nifty?.previousClose), [niftyCandles, nifty?.previousClose]);

  const isOpen = overview?.status === 'OPEN';
  const breadth = overview?.breadth;
  const vixValue = vixIndex?.value;
  const vixChange = vixIndex?.changePercent;
  const hasVix = Number.isFinite(vixValue);
  const vixPos = hasVix ? clampPct(((vixValue - VIX_MIN) / (VIX_MAX - VIX_MIN)) * 100) : 0;
  const regime = vixRegime(vixValue);
  const tone = breadthTone(breadth);
  const totalInflow = institutionalFlows ? institutionalFlows.fiiNet + institutionalFlows.diiNet : null;
  const moversSource = (gainers[0] || losers[0] || active[0]);

  const istTime = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
  const istDate = now.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

  const niftyUp = (nifty?.change ?? 0) >= 0;
  const [niftyInt, niftyDec] = nifty ? formatNumber(nifty.value, 2).split('.') : ['—', null];

  const moverTabs = [
    { id: 'gainers', label: 'Gainers', icon: TrendingUp, count: gainers.length },
    { id: 'losers', label: 'Losers', icon: TrendingDown, count: losers.length },
    { id: 'active', label: 'Most active', icon: Activity, count: active.length },
    { id: 'breakouts', label: '52W highs', icon: Flame, count: breakouts.length },
  ];
  const displayList =
    activeTab === 'gainers' ? gainers :
    activeTab === 'losers' ? losers :
    activeTab === 'active' ? active :
    breakouts;

  return (
    <ErrorBoundary>
      <div className="fd-dash dashboard-page">
        {/* ── Hero: the index, live ─────────────────────────── */}
        <section className="fd-hero" aria-labelledby="fd-index-title">
          <div className="fd-hero-world" aria-hidden="true">
            <div className="fd-stars" />
            <div className="fd-floor" />
          </div>
          <div className="fd-hero-inner fd-wrap">
            <div className="fd-hero-top">
              <div className="fd-hero-main">
                <div className="fd-status fd-lbl">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
                    <span className={`fd-live-dot${isOpen ? '' : ' fd-live-dot--closed'}`} />
                    {isOpen ? 'NSE · BSE live' : (overview?.statusMessage || 'Market closed')}
                  </span>
                  <span className="fd-num">{istDate} · {istTime} IST</span>
                  <span>Welcome back, {displayName}</span>
                </div>
                <h1 id="fd-index-title" className="fd-index-name">{nifty?.name || 'NIFTY 50'} &nbsp;/&nbsp; Index level</h1>
                <div className="fd-index-value" aria-live="polite">
                  {isOverviewLoading && !nifty ? '—' : <>{niftyInt}{niftyDec && <small>.{niftyDec}</small>}</>}
                </div>
                {nifty && (
                  <div className="fd-index-change">
                    <span className="fd-num" style={{ color: niftyUp ? 'var(--positive-text)' : 'var(--negative-text)' }}>
                      {niftyUp ? '▲' : '▼'} {signed(nifty.change)}
                    </span>
                    <span className="fd-num" style={{ color: niftyUp ? 'var(--positive-text)' : 'var(--negative-text)' }}>
                      {signed(nifty.changePercent)}%
                    </span>
                    {Number.isFinite(nifty.previousClose) && (
                      <span style={{ color: 'var(--text-dim)' }}>PREV CLOSE {formatNumber(nifty.previousClose, 2)}</span>
                    )}
                    <DataStamp source={nifty.source} asOf={nifty.asOf} isOpen={isOpen} />
                  </div>
                )}
              </div>

              <dl className="fd-readouts">
                <div><dt className="fd-lbl">Day high</dt><dd>{nifty ? formatNumber(nifty.high, 2) : '—'}</dd></div>
                <div><dt className="fd-lbl">Day low</dt><dd>{nifty ? formatNumber(nifty.low, 2) : '—'}</dd></div>
                <div>
                  <dt className="fd-lbl">Adv / Dec</dt>
                  <dd>{breadth ? <>{formatNumber(breadth.advancing, 0)} <span style={{ color: 'var(--border-strong)' }}>/</span> {formatNumber(breadth.declining, 0)}</> : '—'}</dd>
                </div>
                <div><dt className="fd-lbl">VIX regime</dt><dd>{regime ? regime.short : '—'}</dd></div>
                <div>
                  <dt className="fd-lbl">FII net · ₹ Cr</dt>
                  {institutionalFlows
                    ? <dd style={{ color: institutionalFlows.fiiNet >= 0 ? 'var(--positive-text)' : 'var(--negative-text)' }}>{signed(institutionalFlows.fiiNet)}</dd>
                    : <dd>—</dd>}
                </div>
                <div>
                  <dt className="fd-lbl">DII net · ₹ Cr</dt>
                  {institutionalFlows
                    ? <dd style={{ color: institutionalFlows.diiNet >= 0 ? 'var(--positive-text)' : 'var(--negative-text)' }}>{signed(institutionalFlows.diiNet)}</dd>
                    : <dd>—</dd>}
                </div>
              </dl>
            </div>

            {/* Intraday trajectory of the latest session */}
            <figure className="fd-trajectory" aria-label={trace ? `${nifty?.name || 'NIFTY 50'} intraday trajectory, ${trace.date}` : 'Day range'}>
              {trace ? (
                <>
                  <svg className="fd-trace" viewBox={`0 0 ${TRACE_W} ${TRACE_H}`} preserveAspectRatio="none" aria-hidden="true">
                    {trace.prevY !== null && (
                      <line x1="0" x2={TRACE_W} y1={trace.prevY} y2={trace.prevY} stroke="var(--border-strong)" strokeDasharray="2 6" vectorEffect="non-scaling-stroke" />
                    )}
                    <path className="fd-trace-fill" d={trace.fill} fill="var(--accent)" fillOpacity="0.07" />
                    <path d={trace.line} fill="none" stroke="var(--fd-trace)" strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                    <line x1={trace.endX * TRACE_W} x2={trace.endX * TRACE_W} y1="0" y2={TRACE_H} stroke="var(--accent)" strokeOpacity="0.45" vectorEffect="non-scaling-stroke" />
                  </svg>
                  <div className="fd-trace-overlay">
                    <svg className="fd-now-ping" viewBox="0 0 40 40" style={{ left: `${trace.endX * 100}%`, top: `${trace.endY * 100}%` }} aria-hidden="true">
                      <circle className="fd-ping" cx="20" cy="20" r="4" fill="none" stroke="var(--accent)" />
                      <circle cx="20" cy="20" r="4" fill="var(--accent)" />
                    </svg>
                  </div>
                  <span className="fd-lbl" style={{ left: 0, top: 0 }}>09:15 · Open · {trace.date}</span>
                  <span className="fd-lbl fd-lbl--accent" style={{ left: `${trace.endX * 100}%`, top: 0, transform: trace.endX > 0.8 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }}>
                    {isOpen ? 'Now' : 'Last'} · {formatNumber(trace.lastClose, 2)}
                  </span>
                  <div className="fd-axis fd-lbl">{AXIS_TICKS.map((t) => <span key={t}>{t}</span>)}</div>
                </>
              ) : nifty ? (
                <>
                  <span className="fd-lbl" style={{ left: 0, top: 0 }}>Day range · {formatNumber(nifty.low, 2)} – {formatNumber(nifty.high, 2)}</span>
                  <div className="fd-range-rail"><span style={{ left: `${rangePos(nifty.value, nifty.low, nifty.high)}%` }} /></div>
                </>
              ) : null}
            </figure>
          </div>
        </section>

        {/* ── Command strip: other benchmarks + paper capital ── */}
        <div className="fd-band">
        <div className="fd-strip fd-wrap">
          {isOverviewLoading && !stripIndices.length
            ? [0, 1, 2].map((k) => <div key={k}><div className="fd-lbl">Loading</div><div className="fd-strip-value">—</div></div>)
            : stripIndices.map((idx) => {
                const up = idx.change >= 0;
                return (
                  <button key={idx.symbol} type="button" className="fd-strip-cell" onClick={() => navigate('/markets')}>
                    <div className="fd-lbl">{idx.name}</div>
                    <div className="fd-strip-value">{formatNumber(idx.value, 2)}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', marginTop: '6px' }}>
                      <span className="fd-num" style={{ fontFamily: 'var(--font-mono)', fontSize: '12.5px', color: up ? 'var(--positive-text)' : 'var(--negative-text)' }}>
                        {up ? '▲' : '▼'} {signed(idx.change)}&nbsp;&nbsp;{signed(idx.changePercent)}%
                      </span>
                      <span className="fd-mini-rail" title={`Day range ${formatNumber(idx.low, 2)} – ${formatNumber(idx.high, 2)}`}>
                        <span style={{ left: `${rangePos(idx.value, idx.low, idx.high)}%` }} />
                      </span>
                    </div>
                  </button>
                );
              })}
          <div className="fd-capital">
            <div className="fd-lbl">Paper capital</div>
            <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
              <div><div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>Cash</div><div className="fd-capital-value">₹{formatNumber(cashBalance, 0)}</div></div>
              <div><div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>Total value</div><div className="fd-capital-value">₹{formatNumber(portfolioTotalValue, 0)}</div></div>
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              <button
                type="button"
                className="fd-btn fd-btn--solid fd-btn--sm"
                onClick={() => addFundsMutation.mutate(100000)}
                disabled={addFundsMutation.isPending}
                title="Add ₹1L virtual trading cash"
              >
                + ₹1L
              </button>
              <button type="button" className="fd-btn fd-btn--sm fd-btn--icon" onClick={handleRefresh} title="Refresh quotes" aria-label="Refresh quotes">
                <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
        </div>
        </div>

        <div className="fd-band">
        <nav className="fd-routes fd-wrap" aria-label="Quick routes">
          <Link to="/trade" className="fd-route">Paper trading <span className="fd-route-arrow" aria-hidden="true">→</span></Link>
          <Link to="/markets" className="fd-route">Screener &amp; heatmap <span className="fd-route-arrow" aria-hidden="true">→</span></Link>
          <Link to="/ai" className="fd-route">Pulse AI research <span className="fd-route-arrow" aria-hidden="true">→</span></Link>
        </nav>
        </div>

        <div className="fd-wrap">
          {/* ── 01 Market state ─────────────────────────────── */}
          <section className="fd-section fd-reveal">
            <div className="fd-section-head">
              <span className="fd-lbl fd-lbl--accent">01</span>
              <h2 className="fd-h2">Market state</h2>
              <span className="fd-lbl">Turnover &amp; flows via NSE</span>
            </div>
            <div className="fd-panes fd-panes--3">
              {turnover ? (
                <div className="fd-pane">
                  <div className="fd-pane-head">
                    <span className="fd-lbl">Cash turnover · NSE</span>
                    <DataStamp source={sources.turnover} asOf={asOf.turnover} isOpen={isOpen} />
                  </div>
                  <div className="fd-big">{formatCrore(turnover.nseCashCr)}</div>
                  <dl className="fd-dl">
                    <dt>Equity segment</dt><dd>{formatCrore(turnover.nseEquityCr)}</dd>
                    <dt>F&amp;O notional</dt><dd>{formatCrore(turnover.nseFoNotionalCr)}</dd>
                    <dt>F&amp;O premium</dt><dd>{formatCrore(turnover.nseFoPremiumCr)}</dd>
                    <dt>Cash trades</dt><dd>{formatVolume(turnover.cashTrades)}</dd>
                  </dl>
                </div>
              ) : (
                <Unavailable title="Cash turnover · NSE">The NSE turnover report could not be reached.</Unavailable>
              )}

              {institutionalFlows ? (
                <div className="fd-pane">
                  <div className="fd-pane-head">
                    <span className="fd-lbl">FII / DII cash flows · ₹ Cr</span>
                    <DataStamp source={sources.institutionalFlows} asOf={asOf.institutionalFlows} isOpen={isOpen} />
                  </div>
                  <div className="fd-big" style={{ color: totalInflow >= 0 ? 'var(--positive-text)' : 'var(--negative-text)' }}>{signed(totalInflow)}</div>
                  <div className="fd-lbl" style={{ marginTop: '-4px', color: totalInflow >= 0 ? 'var(--positive-text)' : 'var(--negative-text)' }}>
                    {totalInflow >= 0 ? 'Net buyers' : 'Net sellers'} · NSE provisional
                  </div>
                  {[
                    ['FII / FPI', institutionalFlows.fiiNet, institutionalFlows.fiiBuy, institutionalFlows.fiiSell],
                    ['DII', institutionalFlows.diiNet, institutionalFlows.diiBuy, institutionalFlows.diiSell],
                  ].map(([label, net, buy, sell]) => (
                    <div className="fd-flow" key={label}>
                      <div className="fd-flow-head">
                        <span>{label}</span>
                        <span className="fd-num" style={{ fontFamily: 'var(--font-mono)', color: net >= 0 ? 'var(--positive-text)' : 'var(--negative-text)' }}>{signed(net)}</span>
                      </div>
                      <div className="fd-flow-bar" aria-hidden="true"><span style={{ flex: buy || 1 }} /><span style={{ flex: sell || 1 }} /></div>
                      <div className="fd-flow-foot fd-num"><span>BUY {formatNumber(buy, 2)}</span><span>SELL {formatNumber(sell, 2)}</span></div>
                    </div>
                  ))}
                </div>
              ) : (
                <Unavailable title="FII / DII cash flows · ₹ Cr">The NSE provisional FII/DII report could not be reached.</Unavailable>
              )}

              <div className="fd-pane">
                <div className="fd-pane-head">
                  <span className="fd-lbl">Volatility &amp; regime</span>
                  {regime && <span className="fd-lbl fd-lbl--accent">VIX · {regime.short}</span>}
                </div>
                {hasVix ? (
                  <>
                    <div className="fd-regime-word">{regime.word}{tone && <>,<br />{tone}</>}</div>
                    <div className="fd-scale" aria-label={`India VIX ${formatNumber(vixValue, 2)} on a ${VIX_MIN} to ${VIX_MAX} scale`}>
                      <div className="fd-scale-track" aria-hidden="true">
                        {Array.from({ length: 10 }, (_, k) => <span key={k} className={(k + 0.5) * 10 <= vixPos ? 'on' : ''} />)}
                      </div>
                      <span className="fd-scale-marker" style={{ left: `calc(${vixPos}% - 1px)` }} aria-hidden="true" />
                      <div className="fd-scale-legend fd-lbl"><span>VIX {VIX_MIN} · calm</span><span>{VIX_MAX} · stressed</span></div>
                    </div>
                  </>
                ) : (
                  <div className="fd-unavailable" style={{ minHeight: '80px' }}>India VIX unavailable right now</div>
                )}
                <dl className="fd-dl">
                  {hasVix && <>
                    <dt>India VIX</dt>
                    <dd>{formatNumber(vixValue, 2)} <span style={{ color: vixChange >= 0 ? 'var(--negative-text)' : 'var(--positive-text)' }}>{signed(vixChange)}%</span></dd>
                  </>}
                  {derivatives ? <>
                    <dt>NIFTY put / call (OI)</dt><dd>{formatNumber(derivatives.pcr, 2)}</dd>
                    <dt>Max pain</dt><dd>{formatNumber(derivatives.maxPain, 0)}</dd>
                    {Number.isFinite(derivatives.atmIv) && <><dt>ATM IV</dt><dd>{formatNumber(derivatives.atmIv, 1)}%</dd></>}
                  </> : <><dt>NIFTY options</dt><dd style={{ color: 'var(--text-dim)' }}>Unavailable</dd></>}
                </dl>
                {derivatives && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: '10px' }}>
                    <span className="fd-lbl">Expiry {formatDay(derivatives.expiry)}</span>
                    <DataStamp source={sources.derivatives} asOf={asOf.derivatives} isOpen={isOpen} />
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* ── 02 Participation ────────────────────────────── */}
          <section className="fd-section fd-reveal">
            <div className="fd-section-head">
              <span className="fd-lbl fd-lbl--accent">02</span>
              <h2 className="fd-h2">Participation</h2>
              <Link to="/markets" className="fd-link-lbl">Sector heatmap →</Link>
            </div>
            <div className="fd-panes fd-panes--2">
              {breadth
                ? <MarketBreadthBar breadth={breadth} stamp={<DataStamp source={sources.breadth} asOf={asOf.breadth} isOpen={isOpen} />} />
                : <div className="fd-pane fd-empty">{isOverviewLoading ? 'Breadth loads with the market overview.' : 'Breadth unavailable right now.'}</div>}
              {overview?.sectors?.length
                ? <SectorBar sectors={overview.sectors} stamp={<DataStamp source={sources.sectors} asOf={asOf.sectors} isOpen={isOpen} />} />
                : <div className="fd-pane fd-empty">{isOverviewLoading ? 'Sector data loads with the market overview.' : 'Sector indices unavailable right now.'}</div>}
            </div>
          </section>

          {/* ── 03 Movers ───────────────────────────────────── */}
          <section className="fd-section fd-reveal">
            <div className="fd-movers-head">
              <span className="fd-lbl fd-lbl--accent">03</span>
              <h2 className="fd-h2">Movers</h2>
              <div className="tab-group" role="tablist" aria-label="Movers">
                {moverTabs.map(({ id, label, icon: Icon, count }) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === id}
                    onClick={() => setActiveTab(id)}
                    className={`tab-pill${activeTab === id ? ' tab-pill--active' : ''}`}
                  >
                    <Icon size={13} />
                    <span>{label} ({count})</span>
                  </button>
                ))}
              </div>
              {moversSource && <DataStamp source={moversSource.source} asOf={moversSource.asOf} isOpen={isOpen} />}
              <Link to="/markets" className="fd-link-lbl">Full screener →</Link>
            </div>

            <div className="fd-table-box">
              <table className="fd-table">
                <thead>
                  <tr>
                    <th>Instrument</th>
                    <th className="r">LTP</th>
                    <th className="r">Change</th>
                    <th>Day range</th>
                    <th className="r">{activeTab === 'active' ? 'Traded value' : 'Volume'}</th>
                    <th className="r">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {isGainersLoading || isLosersLoading || isActiveLoading ? (
                    <tr><td colSpan={6} style={{ padding: '20px' }}><TableSkeleton rows={8} /></td></tr>
                  ) : displayList.length === 0 ? (
                    <tr><td colSpan={6} className="fd-empty">No instruments in this list right now.</td></tr>
                  ) : (
                    displayList.slice(0, 10).map((s) => {
                      const isPositive = s.change >= 0;
                      const low = s.low;
                      const high = s.high;
                      const progressPct = rangePos(s.ltp, low, high);
                      return (
                        <tr key={s.symbol} className="stock-table-row" onClick={() => navigate(`/stocks/${encodeURIComponent(s.symbol)}`)}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                              <CompanyLogo symbol={s.symbol} name={s.name} size={32} />
                              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                <span style={{ fontWeight: 500 }}>{s.symbol.replace('NSE:', '').replace('BSE:', '')}</span>
                                <span style={{ fontSize: '12px', color: 'var(--text-dim)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name !== s.symbol.replace('NSE:', '') ? s.name : s.sector}</span>
                              </div>
                            </div>
                          </td>
                          <td className="r mono">{formatINR(s.ltp)}</td>
                          <td className="r mono" style={{ color: isPositive ? 'var(--positive-text)' : 'var(--negative-text)' }}>
                            {isPositive ? '▲ +' : '▼ '}{s.changePercent?.toFixed(2)}%
                          </td>
                          <td>
                            <div className="fd-range">
                              <span>{formatNumber(low, 2)}</span>
                              <span className="fd-range-track"><span style={{ left: `${progressPct}%` }} /></span>
                              <span>{formatNumber(high, 2)}</span>
                            </div>
                          </td>
                          <td className="r mono" style={{ color: 'var(--text-secondary)' }}>
                            {activeTab === 'active' ? formatCrore(s.tradedValue / 1e7) : formatVolume(s.volume)}
                          </td>
                          <td className="r">
                            <button
                              type="button"
                              className="fd-btn fd-btn--sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/trade?symbol=${encodeURIComponent(s.symbol)}`);
                              }}
                            >
                              Trade
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── 04 Wire + Pulse AI brief ────────────────────── */}
          <section className="fd-section fd-wire-grid fd-reveal">
            <div className="fd-wire">
              <div className="fd-section-head">
                <span className="fd-lbl fd-lbl--accent">04</span>
                <h2 className="fd-h2">Market wire</h2>
                <Link to="/news" className="fd-link-lbl">All news →</Link>
              </div>
              {marketNews.length > 0 ? (
                <ol className="fd-wire-list">
                  {marketNews.slice(0, 5).map((article) => (
                    <li key={article.id}>
                      <a href={article.sourceUrl || '#'} target="_blank" rel="noopener noreferrer" className="fd-wire-item">
                        <span className="fd-num" style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-dim)' }}>
                          {new Date(article.publishedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span>
                          <span className="fd-wire-title">{article.title}</span>
                          <span className="fd-wire-src">
                            {article.source}
                            {article.relatedSymbols?.length > 0 && ` · ${article.relatedSymbols.slice(0, 2).map((sym) => sym.replace('NSE:', '')).join(' · ')}`}
                          </span>
                        </span>
                        <span className={`badge ${article.sentiment === 'positive' ? 'badge--positive' : article.sentiment === 'negative' ? 'badge--negative' : 'badge--neutral'}`}>
                          {article.sentiment || 'neutral'}
                        </span>
                      </a>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="fd-wire-list fd-empty">{isNewsLoading ? 'Loading financial news feed…' : 'No new market headlines right now.'}</div>
              )}
            </div>
            <aside className="fd-brief" aria-label="Pulse AI market brief">
              <AISummaryCard />
            </aside>
          </section>

          <footer className="fd-foot fd-lbl">
            <span>Quotes &amp; NIFTY options via Upstox &nbsp;/&nbsp; Turnover &amp; FII/DII via NSE &nbsp;/&nbsp; News via Marketaux</span>
            <span>Paper trading only · Not investment advice</span>
          </footer>
        </div>
      </div>
    </ErrorBoundary>
  );
}

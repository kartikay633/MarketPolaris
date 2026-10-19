import path from 'node:path';
import { DATA_DIR, atomicJson, readJson } from './marketData.js';
import { buildPlan, reviewPortfolio } from './advisor.js';

// AI-managed paper accounts. Each bot owns ₹2,00,000 of paper money, can never add
// funds, decides after the evening data update and fills at the next session's open
// (so it never trades on a price it could not have had), pays realistic costs, and
// writes a post-mortem for every losing exit. Records are append-only.

export const BOTS = [
  { id: 'pulse-v4', label: 'Pulse AI v4', riskFile: 'risk-predictions.json', description: 'Live models: peer ranking + volatility v4 sizing' },
  { id: 'pulse-v5', label: 'Pulse AI v5 (shadow)', riskFile: 'risk-predictions-v5.json', description: 'Shadow models under evaluation; starts when v5 forecasts exist' },
];
export const START_CASH = 200000;
export const COST = .0012; // per side: brokerage, STT and exchange charges, approximated
const POLICY = { horizon: '1m', risk: 'balanced' };
const REBALANCE_EVERY = 21;
const MIN_TRADE_SHARE = .02; // rebalance trades smaller than 2% of equity are skipped

const round = (v, d = 2) => Number(v.toFixed(d));

class Prices {
  constructor(dataDir) { this.dataDir = dataDir; this.cache = new Map(); }
  async rows(symbol) {
    if (!this.cache.has(symbol)) {
      const file = await readJson(path.join(this.dataDir, 'candles', `${symbol}.json`));
      this.cache.set(symbol, new Map((file?.candles || []).map(c => [c[0].slice(0, 10), c])));
    }
    return this.cache.get(symbol);
  }
  async on(symbol, date) { return (await this.rows(symbol)).get(date) || null; }
  async closeAtOrBefore(symbol, date) {
    let best = null;
    for (const [d, c] of await this.rows(symbol)) if (d <= date && (!best || d > best[0])) best = [d, c[4]];
    return best?.[1] ?? null;
  }
  async sessions() { return [...(await this.rows('NIFTY_50')).keys()].sort(); }
}

function fresh(bot, asOf) {
  return { id: bot.id, label: bot.label, description: bot.description, riskFile: bot.riskFile, createdAt: new Date().toISOString(),
    startAsOf: asOf, startCash: START_CASH, cash: START_CASH, positions: {}, pending: [], trades: [], equity: [], decisions: [],
    learnings: [], lastDecisionAsOf: null, lastRebalanceAsOf: null, policy: POLICY, costPerSide: COST };
}

// Why a losing exit lost money, from information available after the fact.
async function postMortem(dataDir, prices, position, symbol, exitDate, exitPrice) {
  const opened = position.openedOn;
  const stockReturn = exitPrice / position.avgPrice - 1;
  const n0 = await prices.on('NIFTY_50', opened), n1 = await prices.on('NIFTY_50', exitDate);
  const niftyReturn = n0 && n1 ? n1[4] / n0[1] - 1 : 0;
  const excess = stockReturn - niftyReturn;
  const meetings = (await readJson(path.join(dataDir, 'news-history', 'board-meetings', `${symbol}.json`)))?.rows || [];
  const toIso = s => { const d = new Date(`${s} UTC`); return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null; };
  const results = meetings.some(m => /result/i.test(m.bm_purpose || '') && (d => d && d >= opened && d <= exitDate)(toIso(m.bm_date)));
  const news = ((await readJson(path.join(dataDir, 'news.json')))?.events || [])
    .filter(e => e.symbols?.includes(symbol) && e.availableAt?.slice(0, 10) >= opened && e.availableAt?.slice(0, 10) <= exitDate);
  let category, lesson;
  if (niftyReturn < -.02 && excess > -.02) { category = 'market-wide fall'; lesson = 'The whole market fell; the stock did not do worse than NIFTY. Position sizing, not stock choice, decides this loss.'; }
  else if (results) { category = 'results reaction'; lesson = 'Quarterly results landed inside the holding period. The volatility model expects bigger moves around results; direction stays a coin flip.'; }
  else if (news.length) { category = 'company news'; lesson = `${news.length} exchange filing(s) during the holding period may explain the move; review whether a disclosure type should carry more weight.`; }
  else if (position.entryRiskTier === 'elevated') { category = 'flagged high risk'; lesson = 'Entered while volatility was forecast to be elevated, so a larger swing was expected and sized for.'; }
  else { category = 'model miss'; lesson = 'No market fall, results or filing explains this loss. Candidate for a missing input; logged for the next model review.'; }
  return { symbol, openedOn: opened, exitDate, stockReturn: round(stockReturn, 4), niftyReturn: round(niftyReturn, 4), excessReturn: round(excess, 4),
    entryRiskTier: position.entryRiskTier || null, category, lesson };
}

async function execute(state, prices, dataDir, sessions, asOf) {
  const keep = [];
  const orders = [...state.pending].sort((a, b) => (a.side === 'SELL' ? 0 : 1) - (b.side === 'SELL' ? 0 : 1));
  for (const order of orders) {
    const day = sessions.find(d => d > order.decidedOn);
    if (!day || day > asOf) { keep.push(order); continue; }
    const candle = await prices.on(order.symbol, day);
    if (!candle) { state.trades.push({ ...order, date: day, status: 'cancelled', note: 'No trading data for this stock that session' }); continue; }
    const price = candle[1];
    const held = state.positions[order.symbol];
    if (order.side === 'SELL') {
      const quantity = Math.min(order.quantity, held?.quantity || 0);
      if (!quantity) continue;
      const proceeds = quantity * price * (1 - COST);
      const pnl = proceeds - quantity * held.avgPrice;
      state.cash = round(state.cash + proceeds);
      state.trades.push({ date: day, side: 'SELL', symbol: order.symbol, quantity, price, value: round(quantity * price), cost: round(quantity * price * COST),
        pnl: round(pnl), reason: order.reason, decidedOn: order.decidedOn, status: 'filled' });
      if (pnl < 0) state.learnings.push(await postMortem(dataDir, prices, held, order.symbol, day, price * (1 - COST)));
      held.quantity -= quantity;
      if (held.quantity <= 0) delete state.positions[order.symbol];
    } else {
      const quantity = Math.min(order.quantity, Math.floor(state.cash / (price * (1 + COST))));
      if (quantity <= 0) { state.trades.push({ ...order, date: day, status: 'cancelled', note: 'Not enough cash at the open' }); continue; }
      const outlay = quantity * price * (1 + COST);
      state.cash = round(state.cash - outlay);
      const prev = held || { quantity: 0, avgPrice: 0, openedOn: day, entryRiskTier: order.riskTier || null };
      const total = prev.quantity + quantity;
      state.positions[order.symbol] = { ...prev, quantity: total, avgPrice: round((prev.quantity * prev.avgPrice + outlay) / total, 4) };
      state.trades.push({ date: day, side: 'BUY', symbol: order.symbol, quantity, price, value: round(quantity * price), cost: round(quantity * price * COST),
        reason: order.reason, decidedOn: order.decidedOn, status: 'filled' });
    }
  }
  state.pending = keep;
}

async function markToMarket(state, prices, asOf) {
  let value = state.cash;
  for (const [symbol, p] of Object.entries(state.positions)) value += p.quantity * ((await prices.closeAtOrBefore(symbol, asOf)) ?? p.avgPrice);
  const nifty = await prices.closeAtOrBefore('NIFTY_50', asOf);
  const last = state.equity.at(-1);
  if (!last || last.date < asOf) state.equity.push({ date: asOf, value: round(value), cash: state.cash, nifty });
  return value;
}

async function decide(state, prices, dataDir, sessions, asOf, equity) {
  const held = Object.keys(state.positions);
  const since = state.lastRebalanceAsOf ? sessions.filter(d => d > state.lastRebalanceAsOf && d <= asOf).length : Infinity;
  const orders = [];
  const budget = Math.floor(equity);
  if (since >= REBALANCE_EVERY) {
    const plan = await buildPlan({ budget, ...POLICY }, { dataDir, riskFile: state.riskFile });
    const target = Object.fromEntries(plan.holdings.map(h => [h.symbol, h]));
    for (const symbol of held) if (!target[symbol]) orders.push({ side: 'SELL', symbol, quantity: state.positions[symbol].quantity, reason: 'Monthly rebalance: no longer among the top-ranked, risk-sized picks' });
    for (const h of plan.holdings) {
      const diff = h.quantity - (state.positions[h.symbol]?.quantity || 0);
      if (Math.abs(diff) * h.price < MIN_TRADE_SHARE * equity && state.positions[h.symbol]) continue;
      if (diff > 0) orders.push({ side: 'BUY', symbol: h.symbol, quantity: diff, riskTier: h.riskTier, reason: `${state.positions[h.symbol] ? 'Rebalance up to plan size' : 'New pick'}: ${h.reasons.join('; ')}` });
      if (diff < 0) orders.push({ side: 'SELL', symbol: h.symbol, quantity: -diff, reason: 'Rebalance down to plan size (risk-based weight)' });
    }
    state.lastRebalanceAsOf = asOf;
  } else if (held.length) {
    const positions = [];
    for (const symbol of held) positions.push({ symbol: `NSE:${symbol}`, quantity: state.positions[symbol].quantity, avgPrice: state.positions[symbol].avgPrice,
      currentPrice: (await prices.closeAtOrBefore(symbol, asOf)) ?? state.positions[symbol].avgPrice });
    const review = await reviewPortfolio({ budget, ...POLICY, cash: Math.max(0, state.cash), positions }, { dataDir, riskFile: state.riskFile });
    for (const a of review.actions) {
      if (!a.quantity || !['sell', 'trim', 'add'].includes(a.action)) continue;
      orders.push({ side: a.action === 'add' ? 'BUY' : 'SELL', symbol: a.symbol, quantity: a.quantity, riskTier: a.riskTier, reason: `Daily check-up (${a.action}): ${a.reasons.join('; ')}` });
    }
  }
  state.pending.push(...orders.map(o => ({ ...o, decidedOn: asOf })));
  state.decisions.push({ asOf, orders: orders.length, rebalance: since >= REBALANCE_EVERY, equity: round(equity) });
  state.lastDecisionAsOf = asOf;
}

// One evening step for every bot: fill yesterday's decisions at today's open, value
// the account at today's close, then decide tomorrow's orders. Safe to run twice.
export async function runBots(dataDir = DATA_DIR) {
  const predictions = await readJson(path.join(dataDir, 'predictions.json'));
  if (!predictions?.asOf) throw new Error('Model outlooks are unavailable');
  const asOf = predictions.asOf;
  const prices = new Prices(dataDir);
  const sessions = await prices.sessions();
  const out = [];
  for (const bot of BOTS) {
    const file = path.join(dataDir, 'bots', `${bot.id}.json`);
    let state = await readJson(file);
    const risk = await readJson(path.join(dataDir, bot.riskFile));
    if (!state && risk?.asOf !== asOf) { out.push({ id: bot.id, status: 'waiting for model forecasts' }); continue; }
    if (risk?.asOf !== asOf) { out.push({ id: bot.id, status: 'skipped: forecasts not refreshed' }); continue; }
    state ||= fresh(bot, asOf);
    if (state.lastDecisionAsOf && state.lastDecisionAsOf >= asOf) { out.push({ id: bot.id, status: 'already up to date' }); continue; }
    await execute(state, prices, dataDir, sessions, asOf);
    const equity = await markToMarket(state, prices, asOf);
    await decide(state, prices, dataDir, sessions, asOf, equity);
    state.riskModel = risk.modelVersion;
    await atomicJson(file, state);
    out.push({ id: bot.id, status: 'ok', equity: round(equity), positions: Object.keys(state.positions).length, pending: state.pending.length });
  }
  return { asOf, bots: out };
}

// Read-only summary for the AI Portfolios page.
export async function botSummaries(dataDir = DATA_DIR) {
  const prices = new Prices(dataDir);
  const result = [];
  for (const bot of BOTS) {
    const s = await readJson(path.join(dataDir, 'bots', `${bot.id}.json`));
    if (!s) { result.push({ id: bot.id, label: bot.label, description: bot.description, status: 'not started' }); continue; }
    const last = s.equity.at(-1), first = s.equity[0];
    const value = last?.value ?? s.startCash;
    const positions = [];
    for (const [symbol, p] of Object.entries(s.positions)) {
      const price = (await prices.closeAtOrBefore(symbol, last?.date || s.startAsOf)) ?? p.avgPrice;
      positions.push({ symbol, quantity: p.quantity, avgPrice: p.avgPrice, price, value: round(p.quantity * price), weight: value ? p.quantity * price / value : 0,
        unrealized: round(p.quantity * (price - p.avgPrice)), openedOn: p.openedOn });
    }
    positions.sort((a, b) => b.value - a.value);
    let peak = -Infinity, maxDrawdown = 0;
    for (const e of s.equity) { peak = Math.max(peak, e.value); maxDrawdown = Math.min(maxDrawdown, e.value / peak - 1); }
    const closed = s.trades.filter(t => t.side === 'SELL' && t.status === 'filled');
    const niftyStart = first?.nifty, niftyNow = last?.nifty;
    result.push({ id: s.id, label: s.label, description: s.description, status: 'running', startAsOf: s.startAsOf, asOf: last?.date || s.startAsOf,
      startCash: s.startCash, value, cash: s.cash, returnPct: value / s.startCash - 1,
      niftyReturnPct: niftyStart && niftyNow ? niftyNow / niftyStart - 1 : null, maxDrawdown,
      largestPositionWeight: positions[0]?.weight || 0, positions, pending: s.pending, equity: s.equity,
      trades: s.trades.slice(-60).reverse(), closedTrades: closed.length, winRate: closed.length ? closed.filter(t => t.pnl > 0).length / closed.length : null,
      learnings: s.learnings.slice(-30).reverse(), riskModel: s.riskModel, policy: s.policy, costPerSide: s.costPerSide });
  }
  return result;
}


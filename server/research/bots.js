import path from 'node:path';
import { DATA_DIR, atomicJson, readJson } from './marketData.js';
import { buildPlan, reviewPortfolio } from './advisor.js';

// AI-managed paper accounts. Each bot owns ₹2,00,000 of paper money, can never add
// funds, decides after the evening data update and fills at the next session's open
// (so it never trades on a price it could not have had), pays realistic costs, and
// writes a post-mortem for every losing exit. Records are append-only.

// Each bot reads its forecasts and prices from its own data folder (v5: the wide universe in
// data/pulse-wide); account files all live in the main data folder's bots/.
export const WIDE_DIR = path.resolve('data/pulse-wide');
export const BOTS = [
  { id: 'pulse-v4', label: 'Polaris AI v4', rankFile: 'predictions.json', riskFile: 'risk-predictions.json', description: 'Live models: peer ranking + volatility v4 sizing' },
  { id: 'pulse-v5', label: 'Polaris AI v5 (shadow)', dataDir: WIDE_DIR, rankFile: 'predictions-v5.json', riskFile: 'risk-predictions-v5.json',
    description: 'Shadow model under evaluation: chooses from about 750 NSE stocks, buying only those trading at least ₹10 crore a day' },
];
const botDir = (bot, dataDir, dirs = {}) => dirs[bot.id] || bot.dataDir || dataDir;
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

async function decide(state, prices, dataDir, sessions, asOf, equity, bot) {
  const held = Object.keys(state.positions);
  const since = state.lastRebalanceAsOf ? sessions.filter(d => d > state.lastRebalanceAsOf && d <= asOf).length : Infinity;
  const orders = [];
  const budget = Math.floor(equity);
  if (since >= REBALANCE_EVERY) {
    const plan = await buildPlan({ budget, ...POLICY }, { dataDir, riskFile: bot.riskFile, rankFile: bot.rankFile });
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
    const review = await reviewPortfolio({ budget, ...POLICY, cash: Math.max(0, state.cash), positions }, { dataDir, riskFile: bot.riskFile, rankFile: bot.rankFile });
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
// the account at today's close, then decide tomorrow's orders. Safe to run twice, and run
// again after a later model's forecasts land (bots already up to date are left alone).
// dirs overrides a bot's data folder (tests).
export async function runBots(dataDir = DATA_DIR, { dirs } = {}) {
  const out = [];
  let asOf = null;
  for (const bot of BOTS) {
    const dir = botDir(bot, dataDir, dirs);
    const predictions = await readJson(path.join(dir, bot.rankFile));
    const file = path.join(dataDir, 'bots', `${bot.id}.json`);
    let state = await readJson(file);
    if (!predictions?.asOf) { out.push({ id: bot.id, status: state ? 'skipped: forecasts not refreshed' : 'waiting for model forecasts' }); continue; }
    const botAsOf = predictions.asOf;
    asOf ??= botAsOf;
    const risk = await readJson(path.join(dir, bot.riskFile));
    if (!state && risk?.asOf !== botAsOf) { out.push({ id: bot.id, status: 'waiting for model forecasts' }); continue; }
    if (risk?.asOf !== botAsOf) { out.push({ id: bot.id, status: 'skipped: forecasts not refreshed' }); continue; }
    state ||= fresh(bot, botAsOf);
    if (state.lastDecisionAsOf && state.lastDecisionAsOf >= botAsOf) { out.push({ id: bot.id, status: 'already up to date' }); continue; }
    const prices = new Prices(dir);
    const sessions = await prices.sessions();
    await execute(state, prices, dir, sessions, botAsOf);
    const equity = await markToMarket(state, prices, botAsOf);
    await decide(state, prices, dir, sessions, botAsOf, equity, bot);
    state.riskModel = risk.modelVersion;
    state.rankModel = predictions.modelVersion || null;
    await atomicJson(file, state);
    out.push({ id: bot.id, status: 'ok', asOf: botAsOf, equity: round(equity), positions: Object.keys(state.positions).length, pending: state.pending.length });
  }
  if (!asOf) throw new Error('Model outlooks are unavailable');
  return { asOf, bots: out };
}

// Symbols the running bots hold, so live quotes can be fetched for stocks outside the snapshot.
export async function heldSymbols(dataDir = DATA_DIR) {
  const held = new Set();
  for (const bot of BOTS) for (const symbol of Object.keys((await readJson(path.join(dataDir, 'bots', `${bot.id}.json`)))?.positions || {})) held.add(symbol);
  return [...held];
}

// Read-only summary for the AI Portfolios page. With `live` ({ asOf, session, open, prices: Map of
// symbol -> last price, nifty }), holdings are valued at live prices once the live session is newer
// than the last evening close. Display only: the account file and its equity history are untouched.
export async function botSummaries(dataDir = DATA_DIR, live = null, { dirs } = {}) {
  const result = [];
  for (const bot of BOTS) {
    const prices = new Prices(botDir(bot, dataDir, dirs));
    const s = await readJson(path.join(dataDir, 'bots', `${bot.id}.json`));
    if (!s) { result.push({ id: bot.id, label: bot.label, description: bot.description, status: 'not started' }); continue; }
    const last = s.equity.at(-1), first = s.equity[0];
    const bookDate = last?.date || s.startAsOf;
    const useLive = Boolean(live?.session > bookDate && Object.keys(s.positions).every(symbol => live.prices.has(symbol)));
    const positions = [];
    for (const [symbol, p] of Object.entries(s.positions)) {
      const price = useLive ? live.prices.get(symbol) : (await prices.closeAtOrBefore(symbol, bookDate)) ?? p.avgPrice;
      positions.push({ symbol, quantity: p.quantity, avgPrice: p.avgPrice, price, value: round(p.quantity * price),
        unrealized: round(p.quantity * (price - p.avgPrice)), openedOn: p.openedOn });
    }
    const value = useLive ? round(s.cash + positions.reduce((sum, p) => sum + p.quantity * p.price, 0)) : last?.value ?? s.startCash;
    for (const p of positions) p.weight = value ? p.quantity * p.price / value : 0;
    positions.sort((a, b) => b.value - a.value);
    let peak = -Infinity, maxDrawdown = 0;
    for (const e of [...s.equity, ...(useLive ? [{ value }] : [])]) { peak = Math.max(peak, e.value); maxDrawdown = Math.min(maxDrawdown, e.value / peak - 1); }
    const closed = s.trades.filter(t => t.side === 'SELL' && t.status === 'filled');
    const niftyStart = first?.nifty, niftyNow = useLive && live.nifty ? live.nifty : last?.nifty;
    // Display names come from the code, so a rename reaches accounts that started earlier.
    result.push({ id: s.id, label: bot.label, description: bot.description, status: 'running', startAsOf: s.startAsOf, asOf: bookDate,
      pricing: useLive ? { source: 'live', asOf: live.asOf, open: Boolean(live.open) } : { source: 'close', asOf: bookDate },
      startCash: s.startCash, value, cash: s.cash, returnPct: value / s.startCash - 1,
      niftyReturnPct: niftyStart && niftyNow ? niftyNow / niftyStart - 1 : null, maxDrawdown,
      largestPositionWeight: positions[0]?.weight || 0, positions, pending: s.pending, equity: s.equity,
      trades: s.trades.slice(-60).reverse(), closedTrades: closed.length, winRate: closed.length ? closed.filter(t => t.pnl > 0).length / closed.length : null,
      learnings: s.learnings.slice(-30).reverse(), riskModel: s.riskModel, policy: s.policy, costPerSide: s.costPerSide });
  }
  return result;
}


import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { DATA_DIR, atomicJson, readJson } from './marketData.js';

// Pulse AI portfolio planner for paper trading. Candidates come from the peer-ranking
// model; position sizes come from the volatility forecast (volatility-managed sizing),
// which is where the evaluated models are strongest. Every plan uses saved model
// output only: no prices, outcomes or recommendations are invented.

export const HORIZONS = {
  '1w': { label: '1 week', sessions: 5, signal: 5 },
  '1m': { label: '1 month', sessions: 21, signal: 20 },
  '3m': { label: '3 months', sessions: 63, signal: 20 },
  '1y': { label: '1 year', sessions: 252, signal: 20 },
};
export const PROFILES = {
  // positions, cash buffer, max weight, max names per sector, elevated-risk handling
  conservative: { label: 'Conservative', positions: 12, cash: .2, maxWeight: .12, perSector: 2, elevated: 'exclude' },
  balanced: { label: 'Balanced', positions: 10, cash: .1, maxWeight: .15, perSector: 2, elevated: 'halve' },
  growth: { label: 'Growth', positions: 8, cash: .05, maxWeight: .2, perSector: 3, elevated: 'allow' },
};
const MIN_POSITION = 2500;
const ASSUMED_CORRELATION = .3; // typical average pairwise correlation of large-cap NSE stocks
const REVIEW_SIGMAS = 2;

const planSchema = z.object({
  budget: z.number().finite().min(10000).max(100000000),
  horizon: z.enum(Object.keys(HORIZONS)),
  risk: z.enum(Object.keys(PROFILES)),
});
const reviewSchema = planSchema.extend({
  positions: z.array(z.object({
    symbol: z.string().regex(/^(?:(?:NSE|BSE):)?[A-Z0-9&_-]{1,24}$/),
    quantity: z.number().int().positive().max(10000000),
    avgPrice: z.number().finite().positive(),
    currentPrice: z.number().finite().positive().optional(),
  })).max(200),
  cash: z.number().finite().min(0).optional(),
});
export const validatePlan = body => planSchema.parse(body);
export const validateReview = body => reviewSchema.parse(body);
const clean = symbol => symbol.replace(/^(NSE|BSE):/, '');

const priceCache = new Map();
// Latest saved close for every covered stock, read once per data date (always the full universe,
// so one request's filters never hide stocks from the next).
async function latestCloses(dataDir, asOf, symbols) {
  const key = `${dataDir}|${asOf}`;
  if (priceCache.has(key)) return priceCache.get(key);
  const closes = {};
  await Promise.all(symbols.map(async symbol => {
    const file = await readJson(path.join(dataDir, 'candles', `${symbol}.json`));
    const row = file?.candles?.filter(c => c[0].slice(0, 10) <= asOf).at(-1);
    if (row) closes[symbol] = { close: row[4], date: row[0].slice(0, 10) };
  }));
  priceCache.clear();
  priceCache.set(key, closes);
  return closes;
}

async function loadSignals(dataDir) {
  const [rank, risk] = await Promise.all([readJson(path.join(dataDir, 'predictions.json')), readJson(path.join(dataDir, 'risk-predictions.json'))]);
  if (!rank?.predictions?.length || !risk?.predictions?.length) throw new Error('Model outlooks are unavailable');
  const riskBy = Object.fromEntries(risk.predictions.map(r => [r.symbol, r]));
  const symbols = [...new Set(rank.predictions.map(p => p.symbol))];
  return { asOf: rank.asOf, rankModel: rank.modelVersion, riskModel: risk.modelVersion, rank: rank.predictions, riskBy, symbols };
}

// Expected annualised volatility over the horizon: the stock's current and normal levels,
// tilted by the forecast probability that volatility runs above normal.
function forecastVol(r) {
  const base = .5 * r.currentVolatilityAnnualised + .5 * r.normalVolatilityAnnualised;
  return base * (.8 + .4 * r.probabilityHighVolatility);
}

function reasons(p, r) {
  const out = [`Ranks above ${Math.round(p.peerRankPercentile * 100)}% of covered stocks for the next ${p.horizon} sessions`];
  const support = (p.drivers || []).filter(d => d.direction === 'supports').slice(0, 2).map(d => d.label.toLowerCase());
  if (support.length) out.push(`Supported by ${support.join(' and ')}`);
  out.push(r.riskTier === 'calm' ? 'Volatility expected to stay calm' : r.riskTier === 'elevated' ? 'Price swings expected to be larger than usual' : 'Volatility expected near normal');
  return out;
}

export async function buildPlan(body, { dataDir = DATA_DIR, record = false, source = 'user' } = {}) {
  const input = validatePlan(body);
  const horizon = HORIZONS[input.horizon], profile = PROFILES[input.risk];
  const signals = await loadSignals(dataDir);
  const candidates = signals.rank.filter(p => p.horizon === horizon.signal && signals.riskBy[p.symbol])
    .filter(p => profile.elevated !== 'exclude' || signals.riskBy[p.symbol].riskTier !== 'elevated')
    .sort((a, b) => b.probabilityOutperformPeers - a.probabilityOutperformPeers);
  const closes = await latestCloses(dataDir, signals.asOf, signals.symbols);
  const investable = input.budget * (1 - profile.cash);
  // Enough names for the weight cap to be reachable, fewer for very small budgets.
  const minimumNames = Math.ceil((1 - profile.cash) / profile.maxWeight - 1e-9);
  const slots = Math.max(minimumNames, Math.min(profile.positions, Math.floor(investable / MIN_POSITION)));
  const picks = [], perSector = {};
  for (const p of candidates) {
    if (picks.length >= slots) break;
    if (!closes[p.symbol] || closes[p.symbol].close > input.budget * profile.maxWeight) continue; // one share must fit the cap
    if ((perSector[p.sector] || 0) >= profile.perSector) continue;
    perSector[p.sector] = (perSector[p.sector] || 0) + 1;
    picks.push(p);
  }
  if (!picks.length) throw new Error('No covered stock fits this budget');
  // Volatility-managed weights: inverse forecast volatility, capped, elevated-risk names reduced.
  let raw = picks.map(p => {
    const r = signals.riskBy[p.symbol];
    return (1 / forecastVol(r)) * (profile.elevated === 'halve' && r.riskTier === 'elevated' ? .5 : 1);
  });
  // Shares of the invested amount, capped so no holding exceeds maxWeight of the budget.
  const cap = profile.maxWeight / (1 - profile.cash);
  const total0 = raw.reduce((a, b) => a + b, 0);
  raw = raw.map(w => w / total0);
  for (let pass = 0; pass < 10; pass++) {
    const capped = raw.map(w => Math.min(w, cap));
    const spare = 1 - capped.reduce((a, b) => a + b, 0);
    const freeTotal = capped.reduce((a, w) => a + (w < cap - 1e-9 ? w : 0), 0);
    raw = capped.map(w => w < cap - 1e-9 && freeTotal > 0 ? w + spare * w / freeTotal : w);
    if (spare < 1e-9 || freeTotal === 0) break;
  }
  const weightsTotal = 1; // any share left uncapped stays in cash
  const holdings = picks.map((p, i) => {
    const r = signals.riskBy[p.symbol], price = closes[p.symbol].close, vol = forecastVol(r);
    const weight = raw[i] / weightsTotal * (1 - profile.cash);
    const quantity = Math.floor(input.budget * weight / price);
    const reviewDrop = Math.min(.35, REVIEW_SIGMAS * vol * Math.sqrt(Math.min(horizon.sessions, 21) / 252));
    return { symbol: p.symbol, sector: p.sector, price, priceDate: closes[p.symbol].date, quantity, amount: Number((quantity * price).toFixed(2)),
      targetWeight: weight, probabilityBeatPeers: p.probabilityOutperformPeers, rankPercentile: p.peerRankPercentile, riskTier: r.riskTier,
      probabilityHighVolatility: r.probabilityHighVolatility, forecastVolatility: vol, reviewBelow: Number((price * (1 - reviewDrop)).toFixed(2)),
      reviewDrop, reasons: reasons(p, r) };
  });
  // Whole-share rounding leaves cash idle: top up the most under-weight holdings one share
  // at a time while the cash buffer and weight caps hold.
  let spendable = input.budget * (1 - profile.cash) - holdings.reduce((a, h) => a + h.amount, 0);
  for (let guard = 0; guard < 10000; guard++) {
    const next = holdings.filter(h => h.price <= spendable && (h.amount + h.price) / input.budget <= profile.maxWeight)
      .sort((a, b) => (b.targetWeight * input.budget - b.amount) / b.price - (a.targetWeight * input.budget - a.amount) / a.price)[0];
    if (!next) break;
    next.quantity += 1; next.amount = Number((next.quantity * next.price).toFixed(2)); spendable -= next.price;
  }
  holdings.splice(0, holdings.length, ...holdings.filter(h => h.quantity > 0));
  const invested = holdings.reduce((a, h) => a + h.amount, 0);
  holdings.forEach(h => { h.weight = h.amount / input.budget; });
  // Portfolio volatility under a constant-correlation assumption.
  const w = holdings.map(h => h.weight), s = holdings.map(h => h.forecastVolatility);
  let variance = 0;
  for (let i = 0; i < w.length; i++) for (let j = 0; j < w.length; j++) variance += w[i] * w[j] * s[i] * s[j] * (i === j ? 1 : ASSUMED_CORRELATION);
  const annualVol = Math.sqrt(variance), horizonVol = annualVol * Math.sqrt(Math.min(horizon.sessions, 252) / 252);
  const plan = {
    asOf: signals.asOf, generatedAt: new Date().toISOString(), input, horizon: horizon.label, profile: profile.label,
    holdings, invested: Number(invested.toFixed(2)), cash: Number((input.budget - invested).toFixed(2)),
    risk: { annualVolatility: annualVol, typicalRangeOverHorizon: horizonVol, badCaseOverHorizon: -2 * horizonVol, badCaseAmount: Number((-2 * horizonVol * invested).toFixed(0)),
      sectors: Object.keys(perSector).length, elevatedRiskNames: holdings.filter(h => h.riskTier === 'elevated').length },
    reviewSchedule: input.horizon === '1w' ? 'Check daily; the outlook refreshes after every market close' : 'Run the daily check-up; rebalance at least monthly as outlooks refresh',
    models: { ranking: signals.rankModel, risk: signals.riskModel },
    notes: ['Paper trading plan built from model estimates; not investment advice.',
      'Quantities use the latest saved close; paper orders fill at the live price when placed.',
      input.horizon === '3m' || input.horizon === '1y' ? 'Outlooks cover up to 20 trading sessions, so longer plans rely on regular check-ups and rebalancing.' : null].filter(Boolean),
  };
  if (record) await recordPlan(plan, dataDir, source);
  return plan;
}

// Daily check-up for held positions: buy more, hold, trim or sell, with reasons.
export async function reviewPortfolio(body, { dataDir = DATA_DIR } = {}) {
  const input = validateReview(body);
  const horizon = HORIZONS[input.horizon], profile = PROFILES[input.risk];
  const signals = await loadSignals(dataDir);
  const bySymbol = Object.fromEntries(signals.rank.filter(p => p.horizon === horizon.signal).map(p => [p.symbol, p]));
  const closes = await latestCloses(dataDir, signals.asOf, signals.symbols);
  const value = p => p.quantity * (p.currentPrice || closes[clean(p.symbol)]?.close || p.avgPrice);
  // Weights are measured against the planned amount (or the holdings, if they have grown past it),
  // not the whole paper account, so a fresh plan inside a larger account is not reported as under-weight.
  const heldValue = input.positions.reduce((a, p) => a + value(p), 0);
  const total = Math.max(input.budget, heldValue);
  const spare = Math.max(0, Math.min(input.cash ?? total - heldValue, total - heldValue));
  // Each holding's own risk-based target weight, computed exactly as the plan sizes positions.
  const covered = input.positions.map(x => clean(x.symbol)).filter(sym => bySymbol[sym] && signals.riskBy[sym]);
  const inverse = Object.fromEntries(covered.map(sym => [sym, 1 / forecastVol(signals.riskBy[sym])]));
  const inverseTotal = Object.values(inverse).reduce((a, b) => a + b, 0);
  const targetOf = sym => Math.min(profile.maxWeight, (inverse[sym] / inverseTotal) * (1 - profile.cash));
  const actions = input.positions.map(position => {
    const symbol = clean(position.symbol), p = bySymbol[symbol], r = signals.riskBy[symbol];
    const price = position.currentPrice || closes[symbol]?.close || position.avgPrice;
    const weight = total > 0 ? value(position) / total : 0;
    if (!p || !r) return { symbol, action: 'review', quantity: 0, weight, reasons: ['Outside the stocks Pulse AI covers; review it yourself'] };
    const vol = forecastVol(r);
    const floor = position.avgPrice * (1 - Math.min(.35, REVIEW_SIGMAS * vol * Math.sqrt(21 / 252)));
    const why = [];
    let action = 'hold', quantity = 0;
    if (price < floor) {
      action = 'sell'; quantity = position.quantity;
      why.push(`Down ${Math.round((1 - price / position.avgPrice) * 100)}% from your average price, beyond its normal range`);
    } else if (p.tier === 'bottom quintile' && (r.riskTier === 'elevated' || profile.elevated === 'exclude')) {
      action = 'sell'; quantity = position.quantity;
      why.push('Now ranked in the bottom fifth of covered stocks', r.riskTier === 'elevated' ? 'Volatility expected to be larger than usual' : 'Outlook no longer fits a conservative plan');
    } else if (weight > profile.maxWeight * 1.4 || (r.riskTier === 'elevated' && profile.elevated !== 'allow' && weight > profile.maxWeight * .6)) {
      action = 'trim';
      const target = r.riskTier === 'elevated' ? profile.maxWeight * .5 : profile.maxWeight;
      quantity = Math.max(1, Math.floor((weight - target) * total / price));
      why.push(weight > profile.maxWeight * 1.4 ? `Position is ${Math.round(weight * 100)}% of your portfolio; the plan limit is ${Math.round(profile.maxWeight * 100)}%` : 'Volatility expected to be larger than usual; reduce exposure');
    } else if (p.tier === 'top quintile' && r.riskTier !== 'elevated' && weight < targetOf(symbol) * .7 && spare > price) {
      action = 'add';
      quantity = Math.max(1, Math.floor(Math.min(targetOf(symbol) - weight, spare / total) * total / price));
      why.push('Still ranked in the top fifth of covered stocks', 'Position is below its planned size');
    } else {
      why.push(p.tier === 'top quintile' ? 'Outlook remains strong' : p.tier === 'bottom quintile' ? 'Outlook has weakened; watch closely' : 'Outlook neutral; no change needed');
    }
    return { symbol, action, quantity, price, weight, riskTier: r.riskTier, rankPercentile: p.peerRankPercentile, reasons: why };
  });
  const held = new Set(actions.map(a => a.symbol));
  const ideas = signals.rank.filter(p => p.horizon === horizon.signal && !held.has(p.symbol) && signals.riskBy[p.symbol]?.riskTier !== 'elevated' && closes[p.symbol])
    .sort((a, b) => b.probabilityOutperformPeers - a.probabilityOutperformPeers).slice(0, 5)
    .map(p => ({ symbol: p.symbol, sector: p.sector, price: closes[p.symbol].close, rankPercentile: p.peerRankPercentile, riskTier: signals.riskBy[p.symbol].riskTier }));
  return { asOf: signals.asOf, generatedAt: new Date().toISOString(), horizon: horizon.label, profile: profile.label, actions, ideas,
    notes: ['Check-up uses the latest model outlooks and your paper holdings; not investment advice.'] };
}

// ---------------------------------------------------------------- forward test ledger

const planId = plan => createHash('sha256').update(JSON.stringify([plan.asOf, plan.input, plan.holdings.map(h => [h.symbol, h.quantity])])).digest('hex').slice(0, 16);

// Write-once record so every plan can be scored after its horizon, without revision.
export async function recordPlan(plan, dataDir = DATA_DIR, source = 'user') {
  const id = planId(plan);
  const folder = path.join(dataDir, 'advisor', 'plans', plan.asOf);
  const prefix = `${source}-${plan.input.risk}-${plan.input.horizon}-`;
  const file = path.join(folder, `${prefix}${id}.json`);
  try { await fs.access(file); return id; } catch { /* new plan */ }
  if (source === 'model') {
    // One model portfolio per profile per data date, so a rerun never double-counts a day.
    const existing = (await fs.readdir(folder).catch(() => [])).find(name => name.startsWith(prefix));
    if (existing) return existing.slice(prefix.length, -5);
  }
  await atomicJson(file, { id, source, recordedAt: new Date().toISOString(), asOf: plan.asOf, input: plan.input, models: plan.models,
    holdings: plan.holdings.map(h => ({ symbol: h.symbol, quantity: h.quantity, price: h.price, weight: h.weight })), cash: plan.cash });
  return id;
}

// Model portfolios for every profile, recorded each evening by the pipeline (budget ₹10,00,000).
export async function recordModelPortfolios(dataDir = DATA_DIR) {
  const ids = [];
  for (const risk of Object.keys(PROFILES)) for (const horizon of Object.keys(HORIZONS)) {
    const plan = await buildPlan({ budget: 1000000, horizon, risk }, { dataDir });
    ids.push(await recordPlan(plan, dataDir, 'model'));
  }
  return ids;
}

// Score matured plans: entry at the next session's open after asOf, exit at the close
// `sessions` later, versus NIFTY 50 over the same window. Cash earns nothing.
export async function scorePlans(dataDir = DATA_DIR) {
  const root = path.join(dataDir, 'advisor', 'plans');
  let days = [];
  try { days = (await fs.readdir(root)).sort(); } catch { /* no plans yet */ }
  const series = new Map();
  const candles = async symbol => {
    if (!series.has(symbol)) series.set(symbol, (await readJson(path.join(dataDir, 'candles', `${symbol}.json`)))?.candles || []);
    return series.get(symbol);
  };
  const nifty = await candles('NIFTY_50');
  const dates = nifty.map(c => c[0].slice(0, 10));
  const results = [];
  for (const day of days) for (const name of await fs.readdir(path.join(root, day))) {
    const plan = await readJson(path.join(root, day, name));
    const sessions = HORIZONS[plan.input.horizon].sessions;
    const entry = dates.findIndex(d => d > plan.asOf), exit = entry + sessions - 1;
    if (entry < 0 || exit >= dates.length) { results.push({ id: plan.id, source: plan.source, ...plan.input, asOf: plan.asOf, status: 'open' }); continue; }
    let start = plan.cash, end = plan.cash;
    for (const h of plan.holdings) {
      const c = await candles(h.symbol);
      const o = c.find(x => x[0].slice(0, 10) === dates[entry]), e = c.find(x => x[0].slice(0, 10) === dates[exit]);
      if (!o || !e) continue;
      start += h.quantity * o[1]; end += h.quantity * e[4];
    }
    const portfolio = end / start - 1, benchmark = nifty[exit][4] / nifty[entry][1] - 1;
    results.push({ id: plan.id, source: plan.source, ...plan.input, asOf: plan.asOf, status: 'scored', entryDate: dates[entry], exitDate: dates[exit],
      portfolioReturn: portfolio, niftyReturn: benchmark, excessReturn: portfolio - benchmark, beatNifty: portfolio > benchmark });
  }
  const scored = results.filter(r => r.status === 'scored');
  const group = rows => rows.length ? { plans: rows.length, beatNiftyRate: rows.filter(r => r.beatNifty).length / rows.length,
    meanExcessReturn: rows.reduce((a, r) => a + r.excessReturn, 0) / rows.length } : { plans: 0 };
  const byProfile = {};
  for (const r of scored.filter(x => x.source === 'model')) (byProfile[`${r.risk}:${r.horizon}`] ||= []).push(r);
  const report = { generatedAt: new Date().toISOString(), plans: results.length, open: results.length - scored.length,
    model: group(scored.filter(r => r.source === 'model')), user: group(scored.filter(r => r.source === 'user')),
    byProfile: Object.fromEntries(Object.entries(byProfile).map(([k, v]) => [k, group(v)])) };
  await atomicJson(path.join(dataDir, 'reports', 'advisor-forward.json'), report);
  return report;
}

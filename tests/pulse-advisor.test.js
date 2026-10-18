import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildPlan, reviewPortfolio, recordPlan, scorePlans, validatePlan, PROFILES } from '../server/research/advisor.js';

const SECTORS = ['BANK', 'IT', 'ENERGY', 'AUTO', 'FMCG', 'HEALTH', 'METAL', 'INFRA'];
const dates = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10));

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pulse-advisor-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'candles'));
  const asOf = dates[9], rank = [], risk = [];
  for (let i = 0; i < 24; i++) {
    const symbol = `S${String(i).padStart(2, '0')}`, price = 100 + i * 37;
    const candles = dates.map((d, k) => [`${d}T00:00:00+05:30`, price * (1 + k * .001), price * 1.02, price * .98, price * (1 + k * .002), 1000, 0]);
    await writeFile(path.join(dir, 'candles', `${symbol}.json`), JSON.stringify({ symbol, candles }));
    for (const horizon of [5, 20]) rank.push({ symbol, sector: SECTORS[i % SECTORS.length], asOf, horizon, probabilityOutperformPeers: .6 - i * .004,
      peerRankPercentile: 1 - i / 24, tier: i < 5 ? 'top quintile' : i > 19 ? 'bottom quintile' : 'middle', drivers: [{ label: 'Momentum', direction: 'supports' }] });
    risk.push({ symbol, probabilityHighVolatility: i === 0 ? .8 : .4, riskTier: i === 0 ? 'elevated' : 'normal', currentVolatilityAnnualised: .2 + i * .01, normalVolatilityAnnualised: .25 });
  }
  const nifty = dates.map((d, k) => [`${d}T00:00:00+05:30`, 20000, 20100, 19900, 20000 * (1 + k * .001), 0, 0]);
  await writeFile(path.join(dir, 'candles', 'NIFTY_50.json'), JSON.stringify({ symbol: 'NIFTY_50', candles: nifty }));
  await writeFile(path.join(dir, 'predictions.json'), JSON.stringify({ asOf, modelVersion: 'rank-test', predictions: rank }));
  await writeFile(path.join(dir, 'risk-predictions.json'), JSON.stringify({ asOf, modelVersion: 'risk-test', predictions: risk }));
  return dir;
}

test('plan inputs are validated', () => {
  assert.throws(() => validatePlan({ budget: 500, horizon: '1m', risk: 'balanced' }));
  assert.throws(() => validatePlan({ budget: 100000, horizon: '5y', risk: 'balanced' }));
  assert.throws(() => validatePlan({ budget: 100000, horizon: '1m', risk: 'yolo' }));
});

test('plans respect budget, cash buffer, weight and sector caps', async t => {
  const dataDir = await fixture(t);
  for (const risk of Object.keys(PROFILES)) for (const budget of [10000, 200000, 5000000]) {
    const plan = await buildPlan({ budget, horizon: '1m', risk }, { dataDir });
    const profile = PROFILES[risk];
    assert.ok(plan.invested <= budget * (1 - profile.cash) + 1e-6, `${risk} ${budget} keeps the cash buffer`);
    assert.ok(plan.holdings.every(h => h.weight <= profile.maxWeight + 1e-9), `${risk} ${budget} weight cap`);
    assert.ok(plan.holdings.every(h => Number.isInteger(h.quantity) && h.quantity > 0));
    const sectors = {};
    plan.holdings.forEach(h => { sectors[h.sector] = (sectors[h.sector] || 0) + 1; });
    assert.ok(Object.values(sectors).every(n => n <= profile.perSector));
    assert.ok(plan.holdings.every(h => h.reviewBelow < h.price));
  }
});

test('conservative plans exclude elevated-risk stocks', async t => {
  const dataDir = await fixture(t);
  const plan = await buildPlan({ budget: 500000, horizon: '1w', risk: 'conservative' }, { dataDir });
  assert.equal(plan.holdings.some(h => h.symbol === 'S00'), false);
  const growth = await buildPlan({ budget: 500000, horizon: '1w', risk: 'growth' }, { dataDir });
  assert.equal(growth.holdings[0].symbol, 'S00');
});

test('check-up sells breaches, flags uncovered stocks and suggests ideas', async t => {
  const dataDir = await fixture(t);
  const review = await reviewPortfolio({ budget: 200000, horizon: '1m', risk: 'balanced', cash: 50000, positions: [
    { symbol: 'NSE:S03', quantity: 10, avgPrice: 400, currentPrice: 200 },
    { symbol: 'NSE:S02', quantity: 10, avgPrice: 170, currentPrice: 175 },
    { symbol: 'NSE:UNKNOWN', quantity: 5, avgPrice: 100 }] }, { dataDir });
  const by = Object.fromEntries(review.actions.map(a => [a.symbol, a]));
  assert.equal(by.S03.action, 'sell');
  assert.equal(by.S03.quantity, 10);
  assert.equal(by.S02.action, 'add');
  assert.equal(by.UNKNOWN.action, 'review');
  assert.ok(review.ideas.length > 0 && review.ideas.every(i => !['S02', 'S03'].includes(i.symbol)));
});

test('plans are recorded once and scored against NIFTY after the horizon', async t => {
  const dataDir = await fixture(t);
  const plan = await buildPlan({ budget: 200000, horizon: '1w', risk: 'balanced' }, { dataDir });
  const id = await recordPlan(plan, dataDir, 'model');
  assert.equal(await recordPlan(plan, dataDir, 'model'), id);
  assert.equal((await readdir(path.join(dataDir, 'advisor', 'plans', plan.asOf))).length, 1);
  const report = await scorePlans(dataDir);
  assert.equal(report.model.plans, 1);
  assert.ok(Number.isFinite(report.model.meanExcessReturn));
  const long = await buildPlan({ budget: 200000, horizon: '1y', risk: 'balanced' }, { dataDir });
  await recordPlan(long, dataDir, 'model');
  assert.equal((await scorePlans(dataDir)).open, 1);
});

test('a freshly placed plan inside a larger paper account needs no action', async t => {
  const dataDir = await fixture(t);
  const plan = await buildPlan({ budget: 200000, horizon: '1m', risk: 'balanced' }, { dataDir });
  const review = await reviewPortfolio({ budget: 200000, horizon: '1m', risk: 'balanced', cash: 800000,
    positions: plan.holdings.map(h => ({ symbol: `NSE:${h.symbol}`, quantity: h.quantity, avgPrice: h.price, currentPrice: h.price })) }, { dataDir });
  assert.deepEqual([...new Set(review.actions.map(a => a.action))], ['hold']);
});

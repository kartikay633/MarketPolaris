import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runBots, botSummaries, START_CASH, COST } from '../server/research/bots.js';

const SECTORS = ['BANK', 'IT', 'ENERGY', 'AUTO', 'FMCG', 'HEALTH', 'METAL', 'INFRA'];
const dates = Array.from({ length: 40 }, (_, i) => new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10));
const price = (i, k) => (100 + i * 37) * (i === 3 ? 1 - k * .02 : 1 + k * .002); // S03 falls steadily

async function fixture(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pulse-bots-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, 'candles'));
  for (let i = 0; i < 24; i++) {
    const symbol = `S${String(i).padStart(2, '0')}`;
    const candles = dates.map((d, k) => [`${d}T00:00:00+05:30`, price(i, k) * 1.001, price(i, k) * 1.02, price(i, k) * .97, price(i, k), 1000, 0]);
    await writeFile(path.join(dir, 'candles', `${symbol}.json`), JSON.stringify({ symbol, candles }));
  }
  await writeFile(path.join(dir, 'candles', 'NIFTY_50.json'), JSON.stringify({ symbol: 'NIFTY_50', candles: dates.map((d, k) => [`${d}T00:00:00+05:30`, 20000, 20100, 19900, 20000 + k, 0, 0]) }));
  return dir;
}
async function publish(dir, k, { v5 = false } = {}) {
  const asOf = dates[k], rank = [], risk = [];
  for (let i = 0; i < 24; i++) {
    const symbol = `S${String(i).padStart(2, '0')}`;
    for (const horizon of [5, 20]) rank.push({ symbol, sector: SECTORS[i % 8], asOf, horizon, probabilityOutperformPeers: .6 - i * .004,
      peerRankPercentile: 1 - i / 24, tier: i < 5 ? 'top quintile' : i > 19 ? 'bottom quintile' : 'middle', drivers: [] });
    risk.push({ symbol, probabilityHighVolatility: .4, riskTier: 'normal', currentVolatilityAnnualised: .2 + i * .01, normalVolatilityAnnualised: .25 });
  }
  await writeFile(path.join(dir, 'predictions.json'), JSON.stringify({ asOf, predictions: rank }));
  await writeFile(path.join(dir, 'risk-predictions.json'), JSON.stringify({ asOf, modelVersion: 'risk-test', predictions: risk }));
  if (v5) await writeFile(path.join(dir, 'risk-predictions-v5.json'), JSON.stringify({ asOf, modelVersion: 'risk-v5-test', predictions: risk }));
}

test('bots decide in the evening, fill at the next open, pay costs and never add money', async t => {
  const dir = await fixture(t);
  await publish(dir, 9);
  const first = await runBots(dir);
  assert.equal(first.bots.find(b => b.id === 'pulse-v4').status, 'ok');
  assert.equal(first.bots.find(b => b.id === 'pulse-v5').status, 'waiting for model forecasts');
  let state = JSON.parse(await readFile(path.join(dir, 'bots', 'pulse-v4.json'), 'utf8'));
  assert.equal(state.cash, START_CASH);
  assert.ok(state.pending.length > 0 && state.trades.length === 0, 'nothing fills on the decision day');
  assert.equal((await runBots(dir)).bots[0].status, 'already up to date');

  await publish(dir, 10);
  await runBots(dir);
  state = JSON.parse(await readFile(path.join(dir, 'bots', 'pulse-v4.json'), 'utf8'));
  const buys = state.trades.filter(t => t.side === 'BUY' && t.status === 'filled');
  assert.ok(buys.length > 0);
  assert.ok(buys.every(b => b.date === dates[10]), 'fills on the next session');
  assert.ok(buys.every(b => Math.abs(b.price - price(Number(b.symbol.slice(1)), 10) * 1.001) < 1e-6), 'fills at that session open');
  const spent = buys.reduce((a, b) => a + b.value * (1 + COST), 0);
  assert.ok(Math.abs(START_CASH - spent - state.cash) < 1, 'cash falls by exactly the cost of the buys');
  assert.ok(state.cash >= 0);
  const weights = Object.entries(state.positions).map(([s, p]) => p.quantity * price(Number(s.slice(1)), 10) / START_CASH);
  assert.ok(Math.max(...weights) <= .16, 'no single stock dominates the account');
});

test('a losing exit gets a post-mortem and the v5 bot starts only with v5 forecasts', async t => {
  const dir = await fixture(t);
  for (let k = 9; k <= 30; k++) await publish(dir, k, { v5: k >= 20 });
  // Replay evenings one at a time; S03 keeps falling until the check-up sells it.
  for (let k = 9; k <= 30; k++) { await publish(dir, k, { v5: k >= 20 }); await runBots(dir); }
  const v4 = JSON.parse(await readFile(path.join(dir, 'bots', 'pulse-v4.json'), 'utf8'));
  const sold = v4.trades.find(t => t.symbol === 'S03' && t.side === 'SELL' && t.status === 'filled');
  assert.ok(sold && sold.pnl < 0, 'the falling stock was sold at a loss');
  assert.ok(v4.learnings.some(l => l.symbol === 'S03' && l.category && l.lesson));
  const v5 = JSON.parse(await readFile(path.join(dir, 'bots', 'pulse-v5.json'), 'utf8'));
  assert.equal(v5.startAsOf, dates[20]);
  const summaries = await botSummaries(dir);
  assert.equal(summaries.length, 2);
  assert.ok(summaries.every(s => s.status === 'running' && Number.isFinite(s.returnPct)));
});

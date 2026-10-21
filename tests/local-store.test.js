import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Runs a snippet in a fresh Node process (a "server restart") with the app state in `file`.
function run(file, body) {
  const env = { ...process.env, APP_STATE_FILE: file, DATABASE_URL: 'postgresql://nobody@127.0.0.1:1/none', LOG_LEVEL: 'silent' };
  delete env.NODE_TEST_CONTEXT;
  const script = `${body}\nawait new Promise((r) => setTimeout(r, 400));\nprocess.exit(0);`;
  return execFileSync(process.execPath, ['--input-type=module', '-e', script], { env, cwd: process.cwd(), encoding: 'utf8' }).trim();
}

test('paper trades, watchlists and alerts survive a restart without a database', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'polaris-state-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'state.json');

  run(file, `
    const { tradeRepository } = await import('./server/repositories/tradeRepository.js');
    const { watchlistRepository } = await import('./server/repositories/watchlistRepository.js');
    const { alertRepository } = await import('./server/repositories/alertRepository.js');
    await tradeRepository.updateAccountBalance('u1', 750000);
    await tradeRepository.savePosition('u1', { symbol: 'NSE:TCS', quantity: 10, avgPrice: 2500 });
    await tradeRepository.createOrder('u1', { symbol: 'NSE:TCS', type: 'BUY', quantity: 10, price: 2500, totalValue: 25000 });
    await watchlistRepository.addItem('u1', 'NSE:SBIN');
    await alertRepository.createAlert('u1', { symbol: 'NSE:TCS', targetPrice: 2600, condition: 'ABOVE' });
  `);

  const out = JSON.parse(run(file, `
    const { tradeRepository } = await import('./server/repositories/tradeRepository.js');
    const { watchlistRepository } = await import('./server/repositories/watchlistRepository.js');
    const { alertRepository } = await import('./server/repositories/alertRepository.js');
    console.log(JSON.stringify({
      cash: (await tradeRepository.getAccount('u1')).cashBalance,
      positions: await tradeRepository.getPositions('u1'),
      orders: (await tradeRepository.getOrders('u1')).length,
      watchlist: await watchlistRepository.getItems('u1'),
      alerts: (await alertRepository.getAlerts('u1')).map((a) => a.symbol),
      otherUserAlerts: (await alertRepository.getAlerts('demo-trader')).length,
    }));
  `).split('\n').at(-1));

  assert.equal(out.cash, 750000);
  assert.deepEqual(out.positions, [{ symbol: 'NSE:TCS', quantity: 10, avgPrice: 2500 }]);
  assert.equal(out.orders, 1);
  assert.ok(out.watchlist.includes('NSE:SBIN'));
  assert.deepEqual(out.alerts, ['NSE:TCS']);
  assert.equal(out.otherUserAlerts, 0, 'no sample alerts are seeded');
});

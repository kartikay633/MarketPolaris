import test from 'node:test';
import assert from 'node:assert/strict';
import { TradeService } from '../server/services/tradeService.js';
import { marketDataService } from '../server/services/marketDataService.js';

function memoryRepository() {
  const positions = new Map();
  let cash = 1000000;
  return {
    getAccount: async () => ({ cashBalance: cash }),
    updateAccountBalance: async (_u, value) => { cash = value; },
    getPosition: async (_u, symbol) => positions.get(symbol) || null,
    getPositions: async () => [...positions.values()].filter(p => p.quantity > 0),
    savePosition: async (_u, p) => { positions.set(p.symbol, p); },
    createOrder: async (_u, o) => ({ id: 1, ...o }),
  };
}
function stubQuote(t, quote) {
  const original = marketDataService.getQuote;
  marketDataService.getQuote = async symbol => ({ symbol, ...quote });
  t.after(() => { marketDataService.getQuote = original; });
}

test('paper orders never fill at a fallback price', async t => {
  stubQuote(t, { ltp: 1250, source: 'fallback' });
  const service = new TradeService(memoryRepository());
  await assert.rejects(service.executeOrder('u', { symbol: 'NSE:ABC', type: 'BUY', quantity: 1 }), /Live price/);
});

test('paper orders fill at live prices and holdings are valued only at live prices', async t => {
  stubQuote(t, { ltp: 2060.1, change: 10, changePercent: .5, source: 'live' });
  const service = new TradeService(memoryRepository());
  const result = await service.executeOrder('u', { symbol: 'NSE:ABC', type: 'BUY', quantity: 2 });
  assert.equal(result.order.price, 2060.1);
  marketDataService.getQuote = async symbol => ({ symbol, ltp: 1250, source: 'fallback' });
  const portfolio = await service.getPortfolio('u');
  assert.equal(portfolio.positions[0].currentPrice, 2060.1); // cost, not the invented 1250
  assert.equal(portfolio.positions[0].priceLive, false);
});

// ROADMAP: Section 6, 11 & Phase 6 — Paper Trade Engine Implementation
import { tradeRepository } from '../repositories/tradeRepository.js';
import { marketDataService } from './marketDataService.js';
import { isMarketOpen } from '../utils/marketHours.js';
import logger from '../utils/logger.js';

export class TradeService {
  constructor(repository = tradeRepository, { isOpen = isMarketOpen } = {}) {
    this.repository = repository;
    this.isOpen = isOpen;
  }

  async executeOrder(userId, { symbol, type, quantity }) {
    const cleanSym = (symbol || '').toUpperCase();
    const orderType = (type || '').toUpperCase(); // 'BUY' | 'SELL'
    const qty = parseInt(quantity, 10);

    if (!cleanSym) {
      throw new Error('Valid stock symbol is required');
    }
    if (isNaN(qty) || qty <= 0) {
      throw new Error('Quantity must be a positive integer');
    }
    if (orderType !== 'BUY' && orderType !== 'SELL') {
      throw new Error('Order type must be either BUY or SELL');
    }
    // Outside trading hours the feed's last price is stale, so nothing fills until the market opens.
    if (!this.isOpen()) {
      throw new Error('The market is closed. Paper orders fill at the live price from 9:15 AM to 3:30 PM IST on trading days.');
    }

    // 1. Fetch live execution price (server-side determined)
    const quote = await marketDataService.getQuote(cleanSym);
    const ltp = quote.ltp;
    // Paper orders fill only at a price served by the live feed, never a built-in fallback.
    if (quote.source !== 'live') {
      throw new Error(`Live price for ${cleanSym} is unavailable right now, so the paper order was not placed. Try again shortly.`);
    }
    if (!ltp || isNaN(ltp) || ltp <= 0) {
      throw new Error(`Unable to fetch valid market price for ${cleanSym}`);
    }

    const totalValue = Number((qty * ltp).toFixed(2));
    const account = await this.repository.getAccount(userId);
    const existingPosition = await this.repository.getPosition(userId, cleanSym);

    // 2. Process BUY order
    if (orderType === 'BUY') {
      if (account.cashBalance < totalValue) {
        throw new Error(
          `Insufficient virtual cash balance. Required: ₹${totalValue.toLocaleString('en-IN')}, Available: ₹${account.cashBalance.toLocaleString('en-IN')}`
        );
      }

      const newBalance = Number((account.cashBalance - totalValue).toFixed(2));
      await this.repository.updateAccountBalance(userId, newBalance);

      let newQuantity = qty;
      let newAvg = ltp;

      if (existingPosition && existingPosition.quantity > 0) {
        newQuantity = existingPosition.quantity + qty;
        const totalCost = (existingPosition.quantity * existingPosition.avgPrice) + totalValue;
        newAvg = Number((totalCost / newQuantity).toFixed(2));
      }

      await this.repository.savePosition(userId, {
        symbol: cleanSym,
        quantity: newQuantity,
        avgPrice: newAvg,
      });

      const order = await this.repository.createOrder(userId, {
        symbol: cleanSym,
        type: 'BUY',
        quantity: qty,
        price: ltp,
        totalValue,
      });

      logger.info({ userId, symbol: cleanSym, qty, ltp, totalValue }, 'Executed simulated BUY order');
      return { order, newBalance, position: { symbol: cleanSym, quantity: newQuantity, avgPrice: newAvg } };
    }

    // 3. Process SELL order
    if (orderType === 'SELL') {
      if (!existingPosition || existingPosition.quantity < qty) {
        const available = existingPosition ? existingPosition.quantity : 0;
        throw new Error(
          `Insufficient shares to sell. Required: ${qty} shares, Available: ${available} shares`
        );
      }

      const newBalance = Number((account.cashBalance + totalValue).toFixed(2));
      await this.repository.updateAccountBalance(userId, newBalance);

      const remainingQty = existingPosition.quantity - qty;
      await this.repository.savePosition(userId, {
        symbol: cleanSym,
        quantity: remainingQty,
        avgPrice: existingPosition.avgPrice,
      });

      const order = await this.repository.createOrder(userId, {
        symbol: cleanSym,
        type: 'SELL',
        quantity: qty,
        price: ltp,
        totalValue,
      });

      logger.info({ userId, symbol: cleanSym, qty, ltp, totalValue }, 'Executed simulated SELL order');
      return { order, newBalance, position: { symbol: cleanSym, quantity: remainingQty, avgPrice: existingPosition.avgPrice } };
    }
  }

  async getPortfolio(userId) {
    const account = await this.repository.getAccount(userId);
    const rawPositions = await this.repository.getPositions(userId);

    let totalInvested = 0;
    let totalCurrentValue = 0;
    let dayTotalPL = 0;

    // Shares bought today count from their buy price, shares carried overnight from the previous close.
    const istDay = (t) => new Date(new Date(t).getTime() + 19800000).toISOString().slice(0, 10);
    const today = istDay(Date.now());
    const boughtToday = new Map(); // symbol -> { quantity, cost }
    for (const o of (await this.repository.getOrders?.(userId, 500)) || []) {
      if (o.type !== 'BUY' || !o.createdAt || istDay(o.createdAt) !== today) continue;
      const b = boughtToday.get(o.symbol) || { quantity: 0, cost: 0 };
      boughtToday.set(o.symbol, { quantity: b.quantity + o.quantity, cost: b.cost + o.quantity * o.price });
    }

    // Enrich holdings with real-time Upstox quotes
    const enrichedPositions = await Promise.all(
      rawPositions.map(async (pos) => {
        try {
          const quote = await marketDataService.getQuote(pos.symbol);
          // Value holdings only at live prices; otherwise at cost, flagged as not live.
          const priceLive = quote.source === 'live' && quote.ltp > 0;
          const currentPrice = priceLive ? quote.ltp : pos.avgPrice;
          const investedValue = Number((pos.quantity * pos.avgPrice).toFixed(2));
          const currentValue = Number((pos.quantity * currentPrice).toFixed(2));
          const unrealizedPL = Number((currentValue - investedValue).toFixed(2));
          const unrealizedPLPercent = investedValue > 0 ? Number(((unrealizedPL / investedValue) * 100).toFixed(2)) : 0;
          const bought = boughtToday.get(pos.symbol);
          const newShares = Math.min(pos.quantity, bought?.quantity || 0);
          const carried = pos.quantity - newShares;
          const previousClose = Number.isFinite(quote.previousClose) ? quote.previousClose : currentPrice - (quote.change || 0);
          const dayPL = priceLive
            ? Number((carried * (currentPrice - previousClose) + (newShares ? newShares * (currentPrice - bought.cost / bought.quantity) : 0)).toFixed(2))
            : 0;

          totalInvested += investedValue;
          totalCurrentValue += currentValue;
          dayTotalPL += dayPL;

          return {
            symbol: pos.symbol,
            name: quote.name || pos.symbol,
            quantity: pos.quantity,
            avgPrice: pos.avgPrice,
            currentPrice,
            priceLive,
            investedValue,
            currentValue,
            unrealizedPL,
            unrealizedPLPercent,
            dayPL,
            change: quote.change || 0,
            changePercent: quote.changePercent || 0,
            sector: quote.sector ?? null,
          };
        } catch (err) {
          const investedValue = Number((pos.quantity * pos.avgPrice).toFixed(2));
          totalInvested += investedValue;
          totalCurrentValue += investedValue;
          return {
            symbol: pos.symbol,
            name: pos.symbol,
            quantity: pos.quantity,
            avgPrice: pos.avgPrice,
            currentPrice: pos.avgPrice,
            investedValue,
            currentValue: investedValue,
            unrealizedPL: 0,
            unrealizedPLPercent: 0,
            dayPL: 0,
            change: 0,
            changePercent: 0,
          };
        }
      })
    );

    const totalPL = Number((totalCurrentValue - totalInvested).toFixed(2));
    const totalPLPercent = totalInvested > 0 ? Number(((totalPL / totalInvested) * 100).toFixed(2)) : 0;
    const portfolioTotalValue = Number((account.cashBalance + totalCurrentValue).toFixed(2));

    return {
      account: {
        cashBalance: account.cashBalance,
        totalInvested: Number(totalInvested.toFixed(2)),
        totalCurrentValue: Number(totalCurrentValue.toFixed(2)),
        portfolioTotalValue,
        totalPL,
        totalPLPercent,
        dayTotalPL: Number(dayTotalPL.toFixed(2)),
      },
      positions: enrichedPositions,
    };
  }

  async getOrders(userId, limit = 50) {
    return this.repository.getOrders(userId, limit);
  }

  async resetPortfolio(userId) {
    const res = await this.repository.resetAccount(userId);
    logger.info({ userId }, 'Reset simulated paper trading portfolio to ₹10,00,000');
    return {
      message: 'Paper trading account successfully reset to ₹10,00,000 virtual balance',
      account: {
        cashBalance: res.cashBalance,
        totalInvested: 0,
        totalCurrentValue: 0,
        portfolioTotalValue: res.cashBalance,
        totalPL: 0,
        totalPLPercent: 0,
        dayTotalPL: 0,
      },
      positions: [],
    };
  }

  async addFunds(userId, amount) {
    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0 || amt > 1e9) {
      throw new Error('Amount must be a positive number up to ₹100 crore');
    }
    const res = await this.repository.addFunds(userId, amt);
    logger.info({ userId, amt, newBalance: res.cashBalance }, 'Added simulated virtual funds to paper account');
    return {
      message: `Successfully added ₹${amt.toLocaleString('en-IN')} to virtual capital`,
      account: {
        cashBalance: res.cashBalance,
      },
    };
  }
}

export const tradeService = new TradeService();
export default tradeService;

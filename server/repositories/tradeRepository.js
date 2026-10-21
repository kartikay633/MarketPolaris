// ROADMAP: Section 6, 7, 11 & 17 — Trade Repository
import { query } from '../config/database.js';
import logger from '../utils/logger.js';
import { persistentMap, persist } from './localStore.js';

// In-memory fallback structures
const memoryAccounts = persistentMap('paperAccounts'); // userId -> { cashBalance }
const memoryPositions = persistentMap('paperPositions', { encode: (m) => Object.fromEntries(m), decode: (o) => new Map(Object.entries(o)) }); // userId -> Map(symbol -> position)
const memoryOrders = persistentMap('paperOrders'); // userId -> Array of orders

export class TradeRepository {
  async getAccount(userId) {
    try {
      const res = await query('SELECT user_id, cash_balance FROM paper_accounts WHERE user_id = $1', [userId]);
      if (res.rows.length > 0) {
        return {
          userId: res.rows[0].user_id,
          cashBalance: parseFloat(res.rows[0].cash_balance),
        };
      }
    } catch (err) {
      logger.debug({ err: err.message }, 'DB query failed for paper account, checking memory');
    }

    if (!memoryAccounts.has(userId)) {
      memoryAccounts.set(userId, { userId, cashBalance: 1000000.00 });
    }
    return memoryAccounts.get(userId);
  }

  async updateAccountBalance(userId, newBalance) {
    try {
      await query(
        `INSERT INTO paper_accounts (user_id, cash_balance, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id) DO UPDATE SET cash_balance = $2, updated_at = NOW()`,
        [userId, newBalance]
      );
    } catch (err) {
      logger.debug({ err: err.message }, 'DB update failed for paper account balance');
    }

    memoryAccounts.set(userId, { userId, cashBalance: newBalance });
    persist();
    return { userId, cashBalance: newBalance };
  }

  async getPositions(userId) {
    try {
      const res = await query(
        'SELECT symbol, quantity, average_price as "avgPrice" FROM paper_positions WHERE user_id = $1 AND quantity > 0',
        [userId]
      );
      if (res.rows.length > 0) {
        return res.rows.map((r) => ({
          symbol: r.symbol,
          quantity: parseInt(r.quantity, 10),
          avgPrice: parseFloat(r.avgPrice),
        }));
      }
    } catch (err) {
      logger.debug({ err: err.message }, 'DB query failed for paper positions, checking memory');
    }

    if (!memoryPositions.has(userId)) {
      memoryPositions.set(userId, new Map());
    }
    return Array.from(memoryPositions.get(userId).values());
  }

  async getPosition(userId, symbol) {
    const cleanSym = symbol.toUpperCase();
    try {
      const res = await query(
        'SELECT symbol, quantity, average_price as "avgPrice" FROM paper_positions WHERE user_id = $1 AND symbol = $2',
        [userId, cleanSym]
      );
      if (res.rows.length > 0) {
        return {
          symbol: res.rows[0].symbol,
          quantity: parseInt(res.rows[0].quantity, 10),
          avgPrice: parseFloat(res.rows[0].avgPrice),
        };
      }
    } catch (err) {
      logger.debug({ err: err.message }, 'DB query failed for position, checking memory');
    }

    if (memoryPositions.has(userId) && memoryPositions.get(userId).has(cleanSym)) {
      return memoryPositions.get(userId).get(cleanSym);
    }
    return null;
  }

  async savePosition(userId, position) {
    const { symbol, quantity, avgPrice } = position;
    const cleanSym = symbol.toUpperCase();

    try {
      if (quantity <= 0) {
        await query('DELETE FROM paper_positions WHERE user_id = $1 AND symbol = $2', [userId, cleanSym]);
      } else {
        await query(
          `INSERT INTO paper_positions (user_id, symbol, quantity, average_price, updated_at)
           VALUES ($1, $2, $3, $4, NOW())
           ON CONFLICT (user_id, symbol) DO UPDATE SET quantity = $3, average_price = $4, updated_at = NOW()`,
          [userId, cleanSym, quantity, avgPrice]
        );
      }
    } catch (err) {
      logger.debug({ err: err.message }, 'DB save failed for position');
    }

    if (!memoryPositions.has(userId)) {
      memoryPositions.set(userId, new Map());
    }
    const userPos = memoryPositions.get(userId);
    if (quantity <= 0) {
      userPos.delete(cleanSym);
    } else {
      userPos.set(cleanSym, { symbol: cleanSym, quantity, avgPrice });
    }
    persist();
  }

  async createOrder(userId, order) {
    const orderId = `ord-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const { symbol, type, quantity, price, totalValue } = order;
    const cleanSym = symbol.toUpperCase();

    const orderRecord = {
      id: orderId,
      userId,
      symbol: cleanSym,
      type, // 'BUY' | 'SELL'
      quantity,
      price,
      totalValue,
      status: 'EXECUTED',
      createdAt: new Date().toISOString(),
    };

    try {
      await query(
        `INSERT INTO paper_orders (id, user_id, symbol, order_type, side, quantity, price, status, executed_at)
         VALUES ($1, $2, $3, 'MARKET', $4, $5, $6, 'FILLED', NOW())`,
        [orderId, userId, cleanSym, type, quantity, price]
      );
    } catch (err) {
      logger.debug({ err: err.message }, 'DB insert failed for paper order, saving to memory');
    }

    if (!memoryOrders.has(userId)) {
      memoryOrders.set(userId, []);
    }
    memoryOrders.get(userId).unshift(orderRecord);
    persist();

    return orderRecord;
  }

  async getOrders(userId, limit = 50) {
    try {
      const res = await query(
        `SELECT id, symbol, side as "type", quantity, price, (quantity * price) as "totalValue", status, executed_at as "createdAt"
         FROM paper_orders
         WHERE user_id = $1
         ORDER BY executed_at DESC
         LIMIT $2`,
        [userId, limit]
      );
      if (res.rows.length > 0) {
        return res.rows.map((r) => ({
          id: r.id,
          symbol: r.symbol,
          type: r.type,
          quantity: parseInt(r.quantity, 10),
          price: parseFloat(r.price),
          totalValue: parseFloat(r.totalValue),
          status: 'EXECUTED',
          createdAt: r.createdAt,
        }));
      }
    } catch (err) {
      logger.debug({ err: err.message }, 'DB query failed for paper orders, checking memory');
    }

    if (!memoryOrders.has(userId)) {
      memoryOrders.set(userId, []);
    }
    return memoryOrders.get(userId).slice(0, limit);
  }

  async resetAccount(userId) {
    try {
      await query('UPDATE paper_accounts SET cash_balance = 1000000.00, updated_at = NOW() WHERE user_id = $1', [userId]);
      await query('DELETE FROM paper_positions WHERE user_id = $1', [userId]);
    } catch (err) {
      logger.debug({ err: err.message }, 'DB query failed for resetAccount');
    }
    memoryAccounts.set(userId, { userId, cashBalance: 1000000.00 });
    memoryPositions.delete(userId);
    persist();
    return { userId, cashBalance: 1000000.00 };
  }

  async addFunds(userId, amount) {
    const account = await this.getAccount(userId);
    const newBalance = Number((account.cashBalance + amount).toFixed(2));
    await this.updateAccountBalance(userId, newBalance);
    return { userId, cashBalance: newBalance };
  }
}

export const tradeRepository = new TradeRepository();
export default tradeRepository;

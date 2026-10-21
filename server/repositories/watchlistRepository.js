// ROADMAP: Section 6, 7 & 17 — Watchlist Repository
import { query } from '../config/database.js';
import logger from '../utils/logger.js';
import { persistentMap, persist } from './localStore.js';

// In-memory fallback map: userId -> Set of symbols
const memoryWatchlists = persistentMap('watchlists', { encode: (s) => [...s], decode: (a) => new Set(a) });

// Default seed symbols for new users
const DEFAULT_SYMBOLS = ['NSE:RELIANCE', 'NSE:TCS', 'NSE:HDFCBANK', 'NSE:INFY', 'NSE:TATAMOTORS'];

export class WatchlistRepository {
  async getItems(userId) {
    try {
      const sql = `
        SELECT wi.symbol, wi.added_at
        FROM watchlist_items wi
        JOIN watchlists w ON wi.watchlist_id = w.id
        WHERE w.user_id = $1
        ORDER BY wi.added_at DESC
      `;
      const result = await query(sql, [userId]);
      if (result.rows.length > 0) {
        return result.rows.map((r) => r.symbol);
      }
    } catch (err) {
      logger.debug({ err: err.message }, 'Database query failed, using in-memory watchlist');
    }

    if (!memoryWatchlists.has(userId)) {
      memoryWatchlists.set(userId, new Set(DEFAULT_SYMBOLS));
    }
    return Array.from(memoryWatchlists.get(userId));
  }

  async addItem(userId, symbol) {
    const cleanSym = symbol.toUpperCase();
    try {
      // Find or create default watchlist for user
      let wlRes = await query('SELECT id FROM watchlists WHERE user_id = $1 LIMIT 1', [userId]);
      let watchlistId;
      if (wlRes.rows.length === 0) {
        const createRes = await query(
          'INSERT INTO watchlists (user_id, name, position) VALUES ($1, $2, 0) RETURNING id',
          [userId, 'My Watchlist']
        );
        watchlistId = createRes.rows[0].id;
      } else {
        watchlistId = wlRes.rows[0].id;
      }

      await query(
        'INSERT INTO watchlist_items (watchlist_id, symbol) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [watchlistId, cleanSym]
      );
    } catch (err) {
      logger.debug({ err: err.message }, 'Database insert failed, adding to memory watchlist');
    }

    if (!memoryWatchlists.has(userId)) {
      memoryWatchlists.set(userId, new Set(DEFAULT_SYMBOLS));
    }
    memoryWatchlists.get(userId).add(cleanSym);
    persist();
    return Array.from(memoryWatchlists.get(userId));
  }

  async removeItem(userId, symbol) {
    const cleanSym = symbol.toUpperCase();
    try {
      const sql = `
        DELETE FROM watchlist_items
        WHERE symbol = $2 AND watchlist_id IN (SELECT id FROM watchlists WHERE user_id = $1)
      `;
      await query(sql, [userId, cleanSym]);
    } catch (err) {
      logger.debug({ err: err.message }, 'Database delete failed, removing from memory watchlist');
    }

    if (memoryWatchlists.has(userId)) {
      memoryWatchlists.get(userId).delete(cleanSym);
      persist();
      return Array.from(memoryWatchlists.get(userId));
    }
    return [];
  }
}

export const watchlistRepository = new WatchlistRepository();
export default watchlistRepository;

// ROADMAP: Section 6 & 11 — Watchlist Service with Live Price Enrichment
import { watchlistRepository } from '../repositories/watchlistRepository.js';
import { marketDataService } from './marketDataService.js';
import logger from '../utils/logger.js';

export class WatchlistService {
  constructor(repository = watchlistRepository) {
    this.repository = repository;
  }

  async getWatchlist(userId) {
    const symbols = await this.repository.getItems(userId);

    // Enrich each symbol with live quote data from Upstox
    const items = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const quote = await marketDataService.getQuote(symbol);
          return {
            symbol: quote.symbol,
            name: quote.name,
            exchange: quote.exchange,
            ltp: quote.ltp,
            change: quote.change,
            changePercent: quote.changePercent,
            high: quote.high,
            low: quote.low,
            volume: quote.volume,
            sector: quote.sector,
          };
        } catch (err) {
          // No price available: the row shows dashes, never a ₹0 price.
          return {
            symbol,
            name: symbol.replace('NSE:', '').replace('BSE:', ''),
            exchange: 'NSE',
            ltp: null,
            change: null,
            changePercent: null,
            volume: null,
          };
        }
      })
    );

    return { items };
  }

  async addItem(userId, symbol) {
    await this.repository.addItem(userId, symbol);
    return this.getWatchlist(userId);
  }

  async removeItem(userId, symbol) {
    await this.repository.removeItem(userId, symbol);
    return this.getWatchlist(userId);
  }
}

export const watchlistService = new WatchlistService();
export default watchlistService;

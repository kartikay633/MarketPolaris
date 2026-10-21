// ROADMAP: Section 6, 7 & 12 — Price Alerts Service
import { alertRepository } from '../repositories/alertRepository.js';
import { marketDataService } from './marketDataService.js';
import logger from '../utils/logger.js';

export class AlertService {
  constructor(repository = alertRepository) {
    this.repository = repository;
  }

  async getUserAlerts(userId) {
    const rawAlerts = await this.repository.getAlerts(userId);

    // Enrich each alert with current market quote from Upstox
    const enrichedAlerts = await Promise.all(
      rawAlerts.map(async (alert) => {
        try {
          const quote = await marketDataService.getQuote(alert.symbol);
          // Without a real price the alert is neither checked nor triggered.
          if (!(quote.ltp > 0) || quote.source === 'fallback') throw new Error(`No price for ${alert.symbol}`);
          const currentPrice = quote.ltp;
          const target = alert.targetPrice;

          // Calculate percentage distance to target
          const diff = target - currentPrice;
          const distancePercent = Number(((diff / currentPrice) * 100).toFixed(2));

          // Check if condition has triggered
          let isTriggered = alert.status === 'TRIGGERED';
          if (alert.status === 'ACTIVE') {
            if (alert.condition === 'ABOVE' && currentPrice >= target) {
              isTriggered = true;
              await this.repository.updateAlertStatus(userId, alert.id, 'TRIGGERED');
            } else if (alert.condition === 'BELOW' && currentPrice <= target) {
              isTriggered = true;
              await this.repository.updateAlertStatus(userId, alert.id, 'TRIGGERED');
            }
          }

          return {
            ...alert,
            status: isTriggered ? 'TRIGGERED' : alert.status,
            name: quote.name || alert.symbol,
            currentPrice,
            change: quote.change || 0,
            changePercent: quote.changePercent || 0,
            distancePercent,
            isTriggered,
          };
        } catch (err) {
          return {
            ...alert,
            name: alert.symbol,
            currentPrice: null,
            change: null,
            changePercent: null,
            distancePercent: null,
            isTriggered: alert.status === 'TRIGGERED',
          };
        }
      })
    );

    return enrichedAlerts;
  }

  async createAlert(userId, { symbol, targetPrice, condition, note }) {
    const cleanSym = (symbol || '').trim().toUpperCase();
    const price = parseFloat(targetPrice);
    const cond = (condition || '').toUpperCase();

    if (!cleanSym) {
      throw new Error('A valid stock symbol is required');
    }
    if (isNaN(price) || price <= 0) {
      throw new Error('Target price must be greater than zero');
    }
    if (cond !== 'ABOVE' && cond !== 'BELOW') {
      throw new Error('Trigger condition must be either ABOVE or BELOW');
    }
    // Only stocks the app can price: an unknown symbol would never be checked.
    try {
      await marketDataService.getQuote(cleanSym);
    } catch (err) {
      if (err.statusCode === 404) throw new Error(`${cleanSym.replace(/^(NSE|BSE):/, '')} is not one of the NSE stocks Market Polaris covers`);
    }

    const created = await this.repository.createAlert(userId, {
      symbol: cleanSym,
      targetPrice: price,
      condition: cond,
      note: note || '',
    });

    logger.info({ userId, symbol: cleanSym, targetPrice: price, condition: cond }, 'Created new price alert');
    return created;
  }

  async deleteAlert(userId, alertId) {
    if (!alertId) {
      throw new Error('Alert ID is required');
    }
    const result = await this.repository.deleteAlert(userId, alertId);
    logger.info({ userId, alertId }, 'Deleted price alert');
    return result;
  }
}

export const alertService = new AlertService();
export default alertService;

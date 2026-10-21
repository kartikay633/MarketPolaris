// The app's single news wire (data/news-wire), tagged against the NSE equity directory. One-word
// company names count for the well-known companies: the research universe and NIFTY Total Market.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NewsWire } from './wire.js';
import { nseClient } from '../providers/nseClient.js';
import { upstoxProvider } from '../providers/UpstoxProvider.js';
import { NSE_UNIVERSE } from '../research/universe.js';
import logger from '../utils/logger.js';

function notable() {
  try {
    const csv = readFileSync(path.resolve('data/pulse-wide/universe-niftytotalmarket-2026-10-21.csv'), 'utf8');
    return [...NSE_UNIVERSE, ...csv.trim().split(/\r?\n/).slice(1).map((line) => line.split(',')[2]?.trim()).filter(Boolean)];
  } catch {
    return NSE_UNIVERSE;
  }
}
const known = notable();

export const newsWire = new NewsWire({
  dataDir: path.resolve(process.env.NEWS_DATA_DIR || 'data'),
  nse: nseClient,
  equities: () => upstoxProvider.directory.equities,
  notable: () => known,
  logger,
});
export default newsWire;

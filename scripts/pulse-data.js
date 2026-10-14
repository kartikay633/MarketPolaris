import 'dotenv/config';
import { collectMarketData } from '../server/research/marketData.js';
const args = process.argv.slice(2);
const symbolsArg = args.find(x => x.startsWith('--symbols='));
try {
  const result = await collectMarketData({ full:args.includes('--full'), ...(symbolsArg ? {symbols:symbolsArg.slice(10).split(',')} : {}) });
  console.log(JSON.stringify({ status:result.status, stocks:result.instruments.length, completedAt:result.completedAt }));
  if (!['ready','ready-with-gaps'].includes(result.status)) process.exitCode = 1;
} catch(error) { console.error(error.message); process.exitCode = 1; }

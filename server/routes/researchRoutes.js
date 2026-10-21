import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { researchStatus, researchChat, validateChat } from '../research/service.js';
import { buildPlan, reviewPortfolio, validatePlan, validateReview } from '../research/advisor.js';
import { botSummaries } from '../research/bots.js';
import { DATA_DIR, readJson } from '../research/marketData.js';
import { getMarketStatus } from '../utils/marketHours.js';
import path from 'node:path';

const router=Router();
router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.get('/status',async(_req,res)=>{
  try {res.json(await researchStatus());}
  catch {res.status(503).json({error:'Research artifacts are unavailable or invalid. Run the local research pipeline and retry.'});}
});
// Matches existing public market-research access. No account data or model training mutations exposed.
router.post('/chat',rateLimit({windowMs:3600000,limit:20,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Research chat limit reached. Retry later.'}}),async(req,res)=>{
  try {validateChat(req.body);} catch {return res.status(400).json({error:'Provide a message up to 4,000 characters, a supported symbol and a 5- or 20-session horizon.'});}
  try {res.json(await researchChat(req.body));}
  catch {res.status(503).json({error:'Research evidence is unavailable. Refresh the research desk and try again.'});}
});
const advisorLimit=rateLimit({windowMs:3600000,limit:60,standardHeaders:'draft-7',legacyHeaders:false,message:{error:'Planner limit reached. Retry later.'}});
// Paper-trading planner. Plans are recorded write-once so their outcomes can be scored later.
router.post('/advisor/plan',advisorLimit,async(req,res)=>{
  try {validatePlan(req.body);} catch {return res.status(400).json({error:'Provide a budget between ₹10,000 and ₹10 crore, a horizon and a risk style.'});}
  try {res.json(await buildPlan(req.body,{record:true,source:'user'}));}
  catch {res.status(503).json({error:'Outlooks are being refreshed. Try again shortly.'});}
});
router.post('/advisor/review',advisorLimit,async(req,res)=>{
  try {validateReview(req.body);} catch {return res.status(400).json({error:'Portfolio details are invalid.'});}
  try {res.json(await reviewPortfolio(req.body));}
  catch {res.status(503).json({error:'Outlooks are being refreshed. Try again shortly.'});}
});
// Live prices from the shared market snapshot (one batched quote call, cached ~15 s while the market
// is open). Only on a trading day from 9:15 IST, and only from the live feed, so a holiday, saved
// candles or fallbacks never pass for today's prices. After the close they are today's closing prices.
async function livePrices(now = new Date()) {
  const market = getMarketStatus();
  const ist = new Date(now.getTime() + 19800000);
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  if (market.status === 'PRE_MARKET' || (market.status === 'CLOSED' && (market.reason !== 'Outside trading hours' || minutes < 9 * 60 + 15))) return null;
  try {
    const { upstoxProvider } = await import('../providers/UpstoxProvider.js');
    const snap = await upstoxProvider.getSnapshot();
    if (snap?.source !== 'live') return null;
    return { asOf: snap.asOf, session: ist.toISOString().slice(0, 10), open: market.status === 'OPEN',
      prices: new Map(snap.stocks.map(s => [s.symbol.replace(/^NSE:/, ''), s.ltp])),
      nifty: snap.indices.find(i => i.symbol === 'NIFTY_50')?.value ?? null };
  } catch { return null; }
}
// AI-managed paper accounts: read-only, public, no account data.
router.get('/bots',async(_req,res)=>{
  try {res.json({bots:await botSummaries(undefined,await livePrices())});}
  catch {res.status(503).json({error:'AI portfolios are unavailable right now.'});}
});
router.get('/advisor/track-record',async(_req,res)=>{
  res.json(await readJson(path.join(DATA_DIR,'reports','advisor-forward.json'),{plans:0,open:0,model:{plans:0},user:{plans:0},byProfile:{}}));
});
export default router;

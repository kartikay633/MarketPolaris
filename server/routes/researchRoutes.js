import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { researchStatus, researchChat, validateChat } from '../research/service.js';
import { buildPlan, reviewPortfolio, validatePlan, validateReview } from '../research/advisor.js';
import { botSummaries } from '../research/bots.js';
import { DATA_DIR, readJson } from '../research/marketData.js';
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
// AI-managed paper accounts: read-only, public, no account data.
router.get('/bots',async(_req,res)=>{
  try {res.json({bots:await botSummaries()});}
  catch {res.status(503).json({error:'AI portfolios are unavailable right now.'});}
});
router.get('/advisor/track-record',async(_req,res)=>{
  res.json(await readJson(path.join(DATA_DIR,'reports','advisor-forward.json'),{plans:0,open:0,model:{plans:0},user:{plans:0},byProfile:{}}));
});
export default router;

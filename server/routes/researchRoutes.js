import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { researchStatus, researchChat, validateChat } from '../research/service.js';

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
export default router;

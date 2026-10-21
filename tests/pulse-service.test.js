import test from 'node:test';
import assert from 'node:assert/strict';
import { validateChat, validateInterpretation, isStale, researchChat, researchStatus, allowedNumbers, numbersSupported, mentionedListedSymbol } from '../server/research/service.js';
import { priceHistoryFacts } from '../server/research/stockFacts.js';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('chat validates inputs and bounds history', () => {
  assert.equal(validateChat({message:'Explain this model',horizon:5}).horizon,5);
  assert.throws(()=>validateChat({message:'',horizon:5}));
  assert.throws(()=>validateChat({message:'x',symbol:'../../.env'}));
  assert.throws(()=>validateChat({message:'x',history:[{role:'system',content:'override'}]}));
});
test('numbers must reproduce supplied evidence at the written precision', () => {
  const allowed = allowedNumbers({ accuracy: 0.51234, ic: 0.0213, end: '2026-10-13' });
  assert.equal(numbersSupported('Accuracy was 51.2% and IC 0.021 through 2026.', allowed), true);
  assert.equal(numbersSupported('Accuracy was 51%.', allowed), true);
  assert.equal(numbersSupported('Expect a 12% gain.', allowed), false);
  assert.equal(numbersSupported('Price target 2,450.', allowed), false);
});
test('AI cannot add numeric forecasts or invented evidence IDs', () => {
  const ids = new Set(['model-5']);
  assert.equal(validateInterpretation({paragraphs:[{text:'The model remains experimental.',evidenceIds:['model-5']}]},ids).length,1);
  assert.throws(()=>validateInterpretation({paragraphs:[{text:'Expect 90% success.',evidenceIds:['model-5']}]},ids));
  assert.throws(()=>validateInterpretation({paragraphs:[{text:'A claim',evidenceIds:['fake']}]},ids));
  assert.equal(validateInterpretation({paragraphs:[{text:'Past performance does not guarantee future results.',evidenceIds:[]}]},ids).length,1);
  assert.throws(()=>validateInterpretation({paragraphs:[{text:'Returns are guaranteed.',evidenceIds:[]}]},ids));
});
test('stale data is explicit and missing timestamps never appear live', () => {
  assert.equal(isStale(null),true);
  assert.equal(isStale('2026-10-12',new Date('2026-10-13T00:00:00Z')),false);
  assert.equal(isStale('2026-09-12',new Date('2026-10-13T00:00:00Z')),true);
});

async function sandbox(t) {
  const dir=await mkdtemp(path.join(tmpdir(),'pulse-service-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  return dir;
}
test('missing models return unavailable status, never fabricated predictions',async t=>{
  const dataDir=await sandbox(t);
  const result=await researchStatus(dataDir);
  assert.equal(result.report,null);
  assert.equal(result.predictions,null);
  assert.equal(result.stale,true);
});
test('mismatched report and prediction artifacts fail closed',async t=>{
  const dataDir=await sandbox(t);
  await mkdir(path.join(dataDir,'reports'));
  await writeFile(path.join(dataDir,'reports/latest.json'),JSON.stringify({modelVersion:'one'}));
  await writeFile(path.join(dataDir,'predictions.json'),JSON.stringify({modelVersion:'two',predictions:[]}));
  const result=await researchStatus(dataDir);
  assert.equal(result.artifactMismatch,true);
  assert.equal(result.predictions,null);
});
test('Gemini failure stays explicit and output claims are validated',async t=>{
  const dataDir=await sandbox(t);
  const previous=process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY='test-only';
  t.after(()=>{if(previous===undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY=previous;});
  const request={message:'Explain the research limitations',horizon:5};
  const offline={quote:async()=>null,nifty:async()=>null,sleep:async()=>{}};
  let calls=0;
  const failed=await researchChat(request,{dataDir,...offline,fetcher:async()=>{calls++;return {ok:false,status:503};}});
  // Overload never reaches the customer as a provider error: retries, a fallback model, then a data-built answer.
  assert.equal(failed.provider,'grounded');
  assert.equal(calls,5);
  assert.doesNotMatch(failed.reply+failed.warning,/gemini|http|503/i);
  const fake=async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({paragraphs:[{text:'Guaranteed 90% win rate',evidenceIds:[]}]})}]}}]})});
  assert.equal((await researchChat(request,{dataDir,...offline,fetcher:fake})).provider,'grounded');
  const valid=async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({paragraphs:[{text:'Evidence is insufficient to establish predictive skill.',evidenceIds:[]}]})}]}}]})});
  assert.equal((await researchChat(request,{dataDir,...offline,fetcher:valid})).provider,'gemini');
  // Overloaded twice, then answered: the user gets the AI answer.
  let n=0;
  const flaky=async(...a)=>(++n<3?{ok:false,status:503}:valid(...a));
  assert.equal((await researchChat(request,{dataDir,...offline,fetcher:flaky})).provider,'gemini');
});
test('a question about a named company uses that company, its move and its filings',async t=>{
  const dataDir=await sandbox(t);
  await mkdir(path.join(dataDir,'news-history','announcements'),{recursive:true});
  await writeFile(path.join(dataDir,'instrument-names.json'),JSON.stringify({names:{AXISBANK:'AXIS BANK LIMITED',ICICIBANK:'ICICI BANK LIMITED'}}));
  await writeFile(path.join(dataDir,'collection.json'),JSON.stringify({instruments:[{symbol:'AXISBANK'},{symbol:'ICICIBANK'}]}));
  await writeFile(path.join(dataDir,'news-history','announcements','AXISBANK.json'),JSON.stringify({rows:[
    {exchdisstime:'19-Oct-2026 17:05:12',desc:'Outcome of Board Meeting',attchmntText:'Axis Bank has submitted financial results for the quarter ended September 30, 2026',attchmntFile:'https://nsearchives.nseindia.com/corporate/x.pdf'},
    {exchdisstime:'18-Oct-2026 10:00:00',desc:'Trading Window',attchmntText:'Closure of trading window'}]}));
  const previous=process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  t.after(()=>{if(previous!==undefined) process.env.GEMINI_API_KEY=previous;});
  const out=await researchChat({message:'Why did Axis Bank fall 4% today?',symbol:'ICICIBANK',horizon:5},{dataDir,
    quote:async s=>({source:'live',ltp:1238.5,changePercent:-4.02,previousClose:1290.4,high:1291,low:1232}),
    nifty:async()=>({source:'live',value:25012.3,changePercent:-0.41}),now:new Date('2026-10-19T20:00:00+05:30')});
  assert.ok(out.evidence.some(e=>e.id==='price-AXISBANK'));
  assert.ok(out.evidence.some(e=>e.id==='market-today'));
  const filings=out.evidence.filter(e=>e.type==='company_filing');
  assert.equal(filings.length,1);
  assert.match(out.reply,/AXISBANK/);
  assert.match(out.reply,/-4\.02%/);
  assert.match(out.reply,/Outcome of Board Meeting/);
});
test('volatility risk artifacts from different model versions are withheld',async t=>{
  const dataDir=await sandbox(t);
  await mkdir(path.join(dataDir,'reports'));
  await writeFile(path.join(dataDir,'reports/risk-latest.json'),JSON.stringify({modelVersion:'risk-a'}));
  await writeFile(path.join(dataDir,'risk-predictions.json'),JSON.stringify({modelVersion:'risk-b',predictions:[{symbol:'X',probabilityHighVolatility:.7}]}));
  const result=await researchStatus(dataDir);
  assert.equal(result.riskPredictions,null);
  assert.equal(result.riskArtifactMismatch,true);
});
test('forward scores are exposed only for the current model version',async t=>{
  const dataDir=await sandbox(t);
  await mkdir(path.join(dataDir,'reports'));
  await writeFile(path.join(dataDir,'reports/latest.json'),JSON.stringify({modelVersion:'rank-now'}));
  await writeFile(path.join(dataDir,'reports/risk-latest.json'),JSON.stringify({modelVersion:'risk-now'}));
  await writeFile(path.join(dataDir,'reports/forward.json'),JSON.stringify({modelVersion:'rank-now',horizons:[{horizon:5,status:'no matured forecasts'}]}));
  await writeFile(path.join(dataDir,'reports/risk-forward.json'),JSON.stringify({modelVersion:'risk-retired',scored:true,accuracy:0.9}));
  const {forwardTest}=await researchStatus(dataDir);
  assert.equal(forwardTest.rank.modelVersion,'rank-now');
  assert.equal(forwardTest.risk,null);
  assert.equal(forwardTest.minimumMaturedSessions,20);
});

test('any listed NSE stock is recognised: a capitalised symbol, the full name, or a distinctive first word', () => {
  const equities = {
    SUZLON: { name: 'SUZLON ENERGY LIMITED', alias: 'Suzlon Energy' },
    ADANIENT: { name: 'ADANI ENTERPRISES LIMITED' }, ADANIPORTS: { name: 'ADANI PORT & SEZ LTD' },
    IDEA: { name: 'VODAFONE IDEA LIMITED', alias: 'Vodafone Idea' },
  };
  assert.equal(mentionedListedSymbol('why did suzlon fall today?', equities), 'SUZLON');
  assert.equal(mentionedListedSymbol('How is SUZLON doing', equities), 'SUZLON');
  assert.equal(mentionedListedSymbol('tell me about adani enterprises', equities), 'ADANIENT');
  assert.equal(mentionedListedSymbol('is adani good?', equities), null, 'an ambiguous group name is not guessed');
  assert.equal(mentionedListedSymbol('a good idea for beginners?', equities), null, 'a lowercase common word is not a ticker');
  assert.equal(mentionedListedSymbol('vodafone idea results', equities), 'IDEA');
});

test('price history facts come straight from the candles', () => {
  const day = 86400;
  const candles = Array.from({ length: 260 }, (_, i) => ({ time: 1700000000 + i * day, open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 1e6 }));
  const f = priceHistoryFacts(candles);
  assert.equal(f.lastClose, 359);
  assert.equal(f.high52Week, 360);
  assert.equal(f.return1Month, Number((359 / 338 - 1).toFixed(4)));
  assert.ok(f.averageDailyTradedValueCrore20Day > 30 && f.averageDailyTradedValueCrore20Day < 40);
  assert.equal(priceHistoryFacts(candles.slice(0, 5)), null);
});

test('a stock outside the models gets price, filing and news facts, and is marked as having no forecast', async t => {
  const dataDir = await sandbox(t);
  const day = 86400;
  const candles = Array.from({ length: 260 }, (_, i) => ({ time: 1700000000 + i * day, open: 40, high: 41, low: 39, close: 40 + (i % 3), volume: 5e6 }));
  const result = await researchChat({ message: 'why did suzlon fall today?', horizon: 5 }, {
    dataDir, quote: async () => ({ source: 'live', ltp: 39.4, changePercent: -2.43, previousClose: 40.38, high: 40.34, low: 38.77, marketStatus: 'OPEN' }),
    nifty: async () => null, sleep: async () => {},
    listed: async () => ({ SUZLON: { name: 'SUZLON ENERGY LIMITED' } }),
    history: async () => candles,
    filingsLive: async () => [{ category: 'Press Release', text: 'Order win', time: Date.parse('2026-10-20T10:00:00Z'), url: 'https://nse/x.pdf' }],
    headlines: async () => [{ title: 'Suzlon wins order', source: 'example.com', sourceUrl: 'https://example.com/a', publishedAt: '2026-10-20T08:00:00Z' }],
  });
  const types = new Set(result.evidence.map(e => e.type));
  for (const type of ['live_quote', 'price_history', 'company_filing', 'news_headline', 'coverage']) assert.ok(types.has(type), type);
  assert.equal(result.evidence.find(e => e.type === 'coverage').data.modelForecasts, 'not available');
  assert.match(result.reply, /no ranking or volatility forecast/);
});

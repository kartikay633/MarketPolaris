import test from 'node:test';
import assert from 'node:assert/strict';
import { validateChat, validateInterpretation, isStale, researchChat, researchStatus, allowedNumbers, numbersSupported } from '../server/research/service.js';
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
  const failed=await researchChat(request,{dataDir,fetcher:async()=>({ok:false,status:503})});
  assert.equal(failed.provider,'unavailable');
  assert.match(failed.warning,/503/);
  const fake=async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({paragraphs:[{text:'Guaranteed 90% win rate',evidenceIds:[]}]})}]}}]})});
  assert.equal((await researchChat(request,{dataDir,fetcher:fake})).provider,'unavailable');
  const valid=async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({paragraphs:[{text:'Evidence is insufficient to establish predictive skill.',evidenceIds:[]}]})}]}}]})});
  assert.equal((await researchChat(request,{dataDir,fetcher:valid})).provider,'gemini');
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

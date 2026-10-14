import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import researchRoutes from '../server/routes/researchRoutes.js';

test('research API serves evidence, rejects malformed chat and exposes no training mutation', async t=>{
  const app=express();
  app.use(express.json({limit:'10kb'}));
  app.use('/api/research',researchRoutes);
  const server=await new Promise(resolve=>{const instance=app.listen(0,'127.0.0.1',()=>resolve(instance));});
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const status=await fetch(`${origin}/api/research/status`);
  assert.equal(status.status,200);
  assert.equal(status.headers.get('cache-control'),'no-store');
  const body=await status.text();
  for(const key of ['GEMINI_API_KEY','UPSTOX_ANALYTICS_TOKEN','DATABASE_URL']) {
    assert.equal(body.includes(key),false);
    if(process.env[key]) assert.equal(body.includes(process.env[key]),false);
  }
  const invalid=await fetch(`${origin}/api/research/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'',symbol:'../../secret'})});
  assert.equal(invalid.status,400);
  assert.equal((await fetch(`${origin}/api/research/train`,{method:'POST'})).status,404);
});

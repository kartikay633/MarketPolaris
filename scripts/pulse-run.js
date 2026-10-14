import 'dotenv/config';
import { spawn } from 'node:child_process';
import { access, mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR, collectMarketData, readJson } from '../server/research/marketData.js';

// Local operator command only. Training cannot be triggered by public HTTP requests.
const mode=process.argv[2]||'update';
if(!['train','update','infer','forward','test'].includes(mode)) throw new Error('Use train, update, infer, forward or test');
const python=process.env.PULSE_PYTHON||path.resolve(process.platform==='win32'?'.venv-pulse/Scripts/python.exe':'.venv-pulse/bin/python');
async function execute(program,args) {
  await new Promise((resolve,reject)=>{
    const child=spawn(program,args,{stdio:'inherit',shell:false,windowsHide:true});
    child.on('error',reject);
    child.on('close',code=>code===0?resolve():reject(new Error(`Research command failed with exit ${code}`)));
  });
}
await mkdir(DATA_DIR,{recursive:true});
const lockFile=path.join(DATA_DIR,'pipeline.lock');
let lock;
try {
  lock=await open(lockFile,'wx');
  await lock.writeFile(JSON.stringify({pid:process.pid,startedAt:new Date().toISOString(),mode}));
  await access(python);
  if(mode==='test') await execute(python,['-m','unittest','ml.test_pulse','ml.test_rank','ml.test_risk','-v']);
  else if(mode==='forward') {
    await execute(python,['-m','ml.rank','score-forward','--data-dir',DATA_DIR]);
    await execute(python,['-m','ml.risk','score-forward','--data-dir',DATA_DIR]);
  }
  else {
    if(mode!=='infer') {
      const result=await collectMarketData();
      if(!['ready','ready-with-gaps'].includes(result.status)) throw new Error('Incomplete collection: repair source errors before training or inference');
      try { await execute(process.execPath,['scripts/pulse-news.js','collect','--limit','20']); }
      catch { console.warn('News collection failed; the failure is recorded. Continuing the market-only pipeline.'); }
    }
    const report=await readJson(path.join(DATA_DIR,'reports/latest.json'));
    if(mode==='update'&&!report) throw new Error('No trained model. Run npm run research:train first.');
    await execute(python,['-m','ml.rank',mode==='train'?'train':'infer','--data-dir',DATA_DIR]);
    // Volatility risk is a separate evaluated study with its own report and ledger.
    await execute(python,['-m','ml.risk',mode==='train'?'train':'infer','--data-dir',DATA_DIR]);
  }
} catch(error) {
  console.error(error.code==='EEXIST'?'Another research command holds the pipeline lock. Check its process before removing a stale lock.':error.message);
  process.exitCode=1;
} finally {
  if(lock){await lock.close();await unlink(lockFile);}
}

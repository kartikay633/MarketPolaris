import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Scheduled after-market job: update, then score matured forward forecasts.
// Collection stops at the previous IST session, so a late or catch-up run never
// records a partial candle, and the write-once ledger ignores repeat runs.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dataDir=path.join(root,'data/pulse');
const logDir=path.join(dataDir,'logs');
await mkdir(logDir,{recursive:true});
const startedAt=new Date().toISOString();
const log=createWriteStream(path.join(logDir,`daily-${startedAt.slice(0,7)}.log`),{flags:'a'});
const write=line=>log.write(`[${new Date().toISOString()}] ${line}\n`);

function run(mode,script='scripts/pulse-run.js') {
  return new Promise(resolve=>{
    write(`> ${path.basename(script,'.js')} ${mode}`);
    const child=spawn(process.execPath,[script,mode],{cwd:root,windowsHide:true,shell:false});
    child.stdout.pipe(log,{end:false});
    child.stderr.pipe(log,{end:false});
    child.on('error',error=>{write(`spawn failed: ${error.message}`);resolve(1);});
    child.on('close',code=>{write(`< ${path.basename(script,'.js')} ${mode} exited ${code}`);resolve(code??1);});
  });
}

const steps={};
// A dropped provider connection should not cost a session: retry the update twice, 10 minutes apart.
for(let attempt=1;attempt<=3;attempt++) {
  steps.update=await run('update');
  if(steps.update===0||attempt===3) break;
  write(`update failed; retrying in 10 minutes (attempt ${attempt+1} of 3)`);
  await new Promise(resolve=>setTimeout(resolve,10*60*1000));
}
// Scoring only reads matured ledger entries, so it still runs if today's update failed.
steps.forward=await run('forward');
// Planner forward test: record today's model portfolios only from fresh outlooks; always score matured ones.
steps.advisor=await run(steps.update===0?'all':'score','scripts/pulse-advisor.js');
// AI paper accounts trade only on fresh outlooks.
if(steps.update===0) steps.bots=await run('step','scripts/pulse-bots.js');
const ok=steps.update===0&&steps.forward===0&&steps.advisor===0&&(steps.bots??0)===0;
// The v5 shadow account (ml/V5_PROTOCOL.md) runs after v4 and never affects v4's status.
if(steps.update===0) steps.v5=await run('nightly','scripts/pulse-v5.js');
const status={startedAt,finishedAt:new Date().toISOString(),status:ok?'ok':'failed',steps};
await mkdir(path.join(dataDir,'reports'),{recursive:true});
const target=path.join(dataDir,'reports/daily-run.json');
await writeFile(`${target}.tmp`,JSON.stringify(status,null,2));
await rename(`${target}.tmp`,target);
write(`daily run ${status.status}`);
await new Promise(resolve=>log.end(resolve));
process.exitCode=ok?0:1;

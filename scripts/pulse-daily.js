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

function run(mode) {
  return new Promise(resolve=>{
    write(`> pulse-run ${mode}`);
    const child=spawn(process.execPath,['scripts/pulse-run.js',mode],{cwd:root,windowsHide:true,shell:false});
    child.stdout.pipe(log,{end:false});
    child.stderr.pipe(log,{end:false});
    child.on('error',error=>{write(`spawn failed: ${error.message}`);resolve(1);});
    child.on('close',code=>{write(`< pulse-run ${mode} exited ${code}`);resolve(code??1);});
  });
}

const steps={};
steps.update=await run('update');
// Scoring only reads matured ledger entries, so it still runs if today's update failed.
steps.forward=await run('forward');
const ok=steps.update===0&&steps.forward===0;
const status={startedAt,finishedAt:new Date().toISOString(),status:ok?'ok':'failed',steps};
await mkdir(path.join(dataDir,'reports'),{recursive:true});
const target=path.join(dataDir,'reports/daily-run.json');
await writeFile(`${target}.tmp`,JSON.stringify(status,null,2));
await rename(`${target}.tmp`,target);
write(`daily run ${status.status}`);
await new Promise(resolve=>log.end(resolve));
process.exitCode=ok?0:1;

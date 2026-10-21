import 'dotenv/config';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicJson } from '../server/research/marketData.js';

// Nightly v5 shadow step (ml/V5_SHADOW_PROTOCOL.md), run by pulse-daily after v4's job: update the wide
// universe's candles and results calendar, refit monthly and forecast (python -m ml.v5 infer), then
// let the v5 paper account fill, mark and decide. v4's account is already up to date by then and is
// left alone. A failed step leaves v5 without fresh forecasts, so its account simply waits a day.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const python = process.env.PULSE_PYTHON || path.join(root, process.platform === 'win32' ? '.venv-pulse/Scripts/python.exe' : '.venv-pulse/bin/python');

function run(program, args) {
  return new Promise((resolve) => {
    console.log(`> ${path.basename(args[0] === '-m' ? args[1] : args[0])} ${args.slice(args[0] === '-m' ? 2 : 1).join(' ')}`);
    const child = spawn(program, args, { cwd: root, stdio: 'inherit', windowsHide: true, shell: false, env: { ...process.env, PYTHONUTF8: '1' } });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

const steps = {};
const started = new Date().toISOString();
steps.candles = await run(process.execPath, ['scripts/pulse-wide.js', 'update']);
// The results calendar only sharpens the volatility forecast; a failure here does not stop the run.
steps.boardMeetings = await run(process.execPath, ['scripts/pulse-wide.js', 'board-meetings']);
if (steps.candles === 0) steps.forecast = await run(python, ['-W', 'ignore', '-m', 'ml.v5', 'infer']);
if (steps.forecast === 0) steps.bots = await run(process.execPath, ['scripts/pulse-bots.js', 'step']);
const ok = steps.candles === 0 && steps.forecast === 0 && steps.bots === 0;
await atomicJson(path.join(root, 'data/pulse-wide/reports/v5-daily.json'), { startedAt: started, finishedAt: new Date().toISOString(), status: ok ? 'ok' : 'failed', steps });
console.log(`v5 nightly ${ok ? 'ok' : 'failed'} ${JSON.stringify(steps)}`);
process.exitCode = ok ? 0 : 1;

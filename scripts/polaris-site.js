// Keeps the local site running: API on :3001 and the web app on :5173 (http://localhost:5173).
// Started at Windows logon by the "Market Polaris Site" task through scripts/polaris-site.vbs.
// A process that exits (crash, or its port is busy) is restarted after a pause. Output goes to logs/polaris-site.log.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logFile = path.join(root, 'logs', 'polaris-site.log');
const RESTART_MS = 30_000;
const MAX_LOG = 5 * 1024 * 1024;

fs.mkdirSync(path.dirname(logFile), { recursive: true });
if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_LOG) fs.renameSync(logFile, `${logFile}.old`);
const log = fs.createWriteStream(logFile, { flags: 'a' });
const note = (msg) => log.write(`[${new Date().toISOString()}] ${msg}\n`);

const services = [
  { name: 'api', args: ['server/index.js'], env: { PORT: '3001', HOST: '127.0.0.1' } },
  // localhost only: vite.config.js sets host: true, which would also serve the site to the local network.
  { name: 'web', args: ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], env: { API_PROXY_TARGET: 'http://127.0.0.1:3001' } },
];

function start(svc) {
  note(`${svc.name}: starting`);
  const child = spawn(process.execPath, svc.args, {
    cwd: root, env: { ...process.env, ...svc.env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const prefix = (chunk) => log.write(chunk.toString().replace(/^(?=.)/gm, `${svc.name} | `));
  child.stdout.on('data', prefix);
  child.stderr.on('data', prefix);
  child.on('exit', (code) => {
    note(`${svc.name}: exited (${code}); restarting in ${RESTART_MS / 1000}s`);
    setTimeout(() => start(svc), RESTART_MS);
  });
}

services.forEach(start);

import { runBots } from '../server/research/bots.js';

// Pipeline step: AI paper accounts fill yesterday's orders at today's open, mark to
// today's close and decide tomorrow's orders. Safe to re-run for the same day.
try { console.log(JSON.stringify(await runBots())); }
catch (error) { console.error(error.message); process.exitCode = 1; }

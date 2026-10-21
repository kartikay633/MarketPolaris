// Keeps the repositories' in-memory fallbacks (used whenever PostgreSQL is not running) in
// data/app/state.json, so paper trades, watchlists, alerts and profiles survive a restart.
// Writes are batched (200 ms) and atomic (temp file + rename). Test runs stay in memory.
import fs from 'node:fs';
import path from 'node:path';
import logger from '../utils/logger.js';

const FILE = path.resolve(process.env.APP_STATE_FILE || 'data/app/state.json');
const ENABLED = !process.env.NODE_TEST_CONTEXT && process.env.APP_STATE_FILE !== 'off';

let saved = {};
if (ENABLED) {
  try {
    saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') logger.error({ err: err.message, file: FILE }, 'Saved app state is unreadable; starting empty');
  }
}

const encoders = new Map();
let timer = null;

// A Map restored from the saved state under `name`; values pass through encode/decode
// (for example a Set or a nested Map) on their way to and from JSON.
export function persistentMap(name, { encode = (v) => v, decode = (v) => v } = {}) {
  const map = new Map(Object.entries(saved[name] || {}).map(([key, value]) => [key, decode(value)]));
  encoders.set(name, () => Object.fromEntries([...map].map(([key, value]) => [key, encode(value)])));
  return map;
}

function flush() {
  timer = null;
  try {
    const state = Object.fromEntries([...encoders].map(([name, encode]) => [name, encode()]));
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(`${FILE}.tmp`, JSON.stringify(state));
    fs.renameSync(`${FILE}.tmp`, FILE);
  } catch (err) {
    logger.error({ err: err.message, file: FILE }, 'Could not save app state');
  }
}

// Call after any change to a persistent map (including in-place changes to its values).
export function persist() {
  if (!ENABLED || timer) return;
  timer = setTimeout(flush, 200);
}

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { importNews, readNews, collectOfficialNews } from '../server/research/news.js';

const args = process.argv.slice(2);
const command = args[0];
const option = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const dataDir = resolve(option('--data-dir') || 'data/pulse');
try {
  let result;
  if (command === 'collect') result = await collectOfficialNews({ dataDir, limit: Number(option('--limit') || 20) });
  else if (command === 'status') { const { events, ...status } = await readNews(dataDir); result = status; }
  else if (command === 'import') {
    const file = option('--file');
    if (!file) throw new Error('import requires --file containing a JSON array');
    const contents = await readFile(resolve(file), 'utf8');
    if (contents.length > 2_000_000) throw new Error('Import file exceeds 2 MB');
    result = await importNews(JSON.parse(contents), { dataDir });
  } else throw new Error('Usage: node scripts/pulse-news.js collect [--limit 20] | status | import --file events.json [--data-dir data/pulse]');
  console.log(JSON.stringify(result, null, 2));
  if (result.results?.some(r => r.status !== 'collected')) process.exitCode = 2;
} catch (error) { console.error(error.message); process.exitCode = 1; }

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, open, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const DEFAULT_DIR = resolve('data/pulse');
const LIMITATIONS = [
  'Five-year point-in-time historical news coverage has not been established. Current imports cannot be used before their actual first observation.',
  'News ablation, source predictive value, reporter reliability and event impact are unavailable until sufficient eligible observations and subsequent market outcomes exist.',
  'Source identity is verified by approved domain only; factual accuracy, originality and predictive reliability are not scored or guaranteed.',
  'Gemini interpretations are excluded from historical features. Classification is deterministic and does not assert sentiment or eventual outcomes.',
];
export const NEWS_SOURCES = [
  { id: 'nse', name: 'NSE corporate announcements', type: 'exchange-disclosure', domains: ['nseindia.com', 'www.nseindia.com', 'archives.nseindia.com', 'nsearchives.nseindia.com'], feed: 'https://archives.nseindia.com/content/RSS/Online_announcements.xml', archive: 'https://www.nseindia.com/companies-listing/corporate-filings-announcements' },
  { id: 'bse', name: 'BSE corporate announcements', type: 'exchange-disclosure', domains: ['www.bseindia.com', 'bseindia.com'], archive: 'https://www.bseindia.com/corporates/ann.html' },
  { id: 'rbi', name: 'Reserve Bank of India', type: 'regulator', domains: ['www.rbi.org.in', 'rbi.org.in', 'rbidocs.rbi.org.in'], feed: 'https://www.rbi.org.in/pressreleases_rss.xml', archive: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx' },
  { id: 'sebi', name: 'SEBI', type: 'regulator', domains: ['www.sebi.gov.in', 'sebi.gov.in'], archive: 'https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=6&ssid=2&smid=0' },
  { id: 'infosys', name: 'Infosys investor relations', type: 'company-disclosure', domains: ['www.infosys.com', 'infosys.com'], archive: 'https://www.infosys.com/investors/reports-filings.html' },
].map(s => ({ ...s, reliability: 'not-scored', historicalCoverage: 'not-verified' }));

function iso(value, field) {
  if (typeof value !== 'string' || !/T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`${field} must be a timestamp with explicit timezone`);
  return new Date(value).toISOString();
}
function plain(value, field, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /<\/?[a-z!][^>]*>|[\u0000-\u0008]/i.test(value)) throw new Error(`${field} must be bounded plain text, not HTML`);
  return value.trim();
}
function sourceFor(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) throw new Error('sourceUrl must be a public approved HTTPS URL without credentials, port or fragment');
  const source = NEWS_SOURCES.find(s => s.domains.includes(url.hostname));
  if (!source) throw new Error('sourceUrl domain has not been approved');
  return { source, sourceUrl: url.href };
}
const hash = value => createHash('sha256').update(value).digest('hex');
export function classifyNews(event) {
  const text = `${event.title} ${event.excerpt}`.toLowerCase();
  const rules = [['correction', /corrigendum|correction|clarification/], ['earnings', /financial results|quarterly results|earnings|profit/], ['capital-action', /dividend|buyback|bonus|split|rights issue/], ['regulatory', /penalty|seizure|regulat|sebi|court|litigation/], ['monetary-policy', /repo|liquidity|monetary|policy rate/], ['business-event', /contract|order win|acquisition|merger/], ['governance', /director|board meeting|resign|auditor/]];
  return { topic: rules.find(([, re]) => re.test(text))?.[0] || 'other', method: 'rules-v1', sentiment: null };
}
export function eligibility(event, predictionISO) {
  try {
    const prediction = Date.parse(iso(predictionISO, 'prediction'));
    // Never trust supplied availableAt or an archiveVerified boolean to backdate evidence.
    const available = Math.max(Date.parse(iso(event.publishedAt, 'publishedAt')), Date.parse(iso(event.firstSeenAt, 'firstSeenAt')));
    return available <= prediction;
  } catch { return false; }
}
async function load(dataDir) {
  try {
    const file = JSON.parse(await readFile(join(dataDir, 'news.json'), 'utf8'));
    if (file.schemaVersion !== 1 || !Array.isArray(file.events)) throw new Error('Unsupported news store schema');
    return file;
  } catch (error) {
    if (error.code === 'ENOENT') return { schemaVersion: 1, events: [], collections: [] };
    throw error;
  }
}
export async function readNews(dataDir = DEFAULT_DIR) {
  const file = await load(dataDir);
  const times = file.events.map(e => e.firstSeenAt).sort();
  return {
    events: file.events, sources: NEWS_SOURCES, collections: file.collections || [], limitations: LIMITATIONS,
    coverage: { eventCount: file.events.length, observedFrom: times[0] || null, observedThrough: times.at(-1) || null, earliestEligibleAt: times[0] || null, historicalArchiveVerified: false, newsAblation: 'unavailable', sourceImpact: 'unavailable', reporterReliability: 'unavailable' },
  };
}
async function mutate(dataDir, fn) {
  await mkdir(dataDir, { recursive: true });
  const lockPath = join(dataDir, 'news.lock');
  const lock = await open(lockPath, 'wx');
  const temp = join(dataDir, `news-${randomUUID()}.tmp`);
  try {
    const file = await load(dataDir);
    const result = fn(file);
    await writeFile(temp, JSON.stringify(file, null, 2), { mode: 0o600 });
    await rename(temp, join(dataDir, 'news.json'));
    return result;
  } finally {
    await lock.close();
    await unlink(lockPath);
    await unlink(temp).catch(() => {});
  }
}
export async function importNews(records, { dataDir = DEFAULT_DIR, now = new Date().toISOString() } = {}) {
  const firstSeenAt = iso(now, 'now');
  if (!Array.isArray(records) || records.length > 1000) throw new Error('Import must be an array of at most 1000 records');
  return mutate(dataDir, file => {
    let added = 0;
    for (const input of records) {
      const { source, sourceUrl } = sourceFor(input.sourceUrl);
      const title = plain(input.title, 'title', 500);
      const excerpt = input.excerpt ? plain(input.excerpt, 'excerpt', 1000) : '';
      const publishedAt = iso(input.publishedAt, 'publishedAt');
      if (publishedAt > firstSeenAt) throw new Error('Future publication timestamps are not accepted');
      const author = input.author == null ? null : plain(input.author, 'author', 200);
      const symbols = input.symbols || [];
      if (!Array.isArray(symbols) || symbols.length > 30 || symbols.some(s => typeof s !== 'string' || !/^[A-Z0-9&.-]{1,30}$/.test(s))) throw new Error('Invalid symbols');
      const contentHash = hash(JSON.stringify({ title, excerpt }));
      const previous = file.events.filter(e => e.sourceUrl === sourceUrl);
      const correctionOf = input.correctionOf || null;
      if (correctionOf && !file.events.some(e => e.id === correctionOf)) throw new Error('correctionOf must reference an observed event');
      const recordHash = hash(JSON.stringify({ contentHash, publishedAt, author, symbols, correctionOf }));
      if (previous.some(e => e.recordHash === recordHash)) continue;
      // Inputs cannot supply observation time, model outputs, novelty, reliability, or archival approval.
      const earlier = file.events.find(e => e.contentHash === contentHash && e.firstSeenAt <= firstSeenAt);
      const event = { id: hash(`${sourceUrl}|${previous.length + 1}|${recordHash}`).slice(0, 24), sourceId: source.id, sourceType: source.type, sourceUrl, title, excerpt, author, symbols, publishedAt, firstSeenAt, availableAt: firstSeenAt, archiveVerified: false, provenance: 'observed-import', contentHash, recordHash, version: previous.length + 1, previousVersionId: previous.at(-1)?.id || null, correctionOf, novelty: { kind: earlier ? 'previously-observed-text' : 'first-observed-text', previousEventId: earlier?.id || null }, classification: classifyNews({ title, excerpt }) };
      file.events.push(event);
      added++;
    }
    return { added, duplicates: records.length - added, total: file.events.length };
  });
}

function decodeXml(value) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ').replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => { const c = n[0].toLowerCase() === 'x' ? parseInt(n.slice(1), 16) : Number(n); return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : ''; }).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
export function parseOfficialFeed(xml, sourceId, limit = 100) {
  if (xml.length > 5_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml) || !/<rss[\s>]/i.test(xml)) throw new Error('Expected bounded RSS without DTD/entities');
  if (!['nse', 'rbi'].includes(sourceId)) throw new Error('Unknown feed');
  const get = (item, tag) => decodeXml(item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || '');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return [...xml.matchAll(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi)].slice(0, limit).map(([item]) => {
    const rawDate = get(item, 'pubDate');
    const nse = rawDate.match(/^(\d{2})-([A-Za-z]{3})-(\d{4}) (\d{2}:\d{2}:\d{2})$/);
    const rbi = rawDate.match(/^(?:[A-Za-z]{3}, )?(\d{1,2}) ([A-Za-z]{3}) (\d{4}) (\d{2}:\d{2}:\d{2})$/);
    const parts = nse || rbi;
    let dated = rawDate;
    if (parts) { const month = months.indexOf(parts[2]) + 1; if (!month) throw new Error('Invalid feed month'); dated = `${parts[3]}-${String(month).padStart(2, '0')}-${parts[1].padStart(2, '0')}T${parts[4]}+05:30`; }
    else if (!/(?:Z|[+-]\d{2}:?\d{2}|GMT|UTC)$/.test(rawDate)) throw new Error('Feed timestamp has unknown timezone');
    const publishedAt = new Date(dated).toISOString();
    const sourceUrl = get(item, 'link');
    const symbol = sourceId === 'nse' ? new URL(sourceUrl).pathname.match(/\/corporate\/([A-Z0-9&.-]+)_/)?.[1] : null;
    return { sourceUrl, title: get(item, 'title'), excerpt: sourceId === 'nse' ? get(item, 'description').slice(0, 240) : '', publishedAt, author: get(item, 'author') || null, symbols: symbol ? [symbol] : [] };
  });
}
export async function collectOfficialNews({ dataDir = DEFAULT_DIR, limit = 20 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit must be between 1 and 100');
  const results = [];
  for (const source of NEWS_SOURCES.filter(s => s.feed)) {
    const result = { sourceId: source.id, sourceUrl: source.feed, attemptedAt: new Date().toISOString() };
    try {
      // Fixed official URLs only; no redirect following, arbitrary URL fetching or access-control bypass.
      const response = await fetch(source.feed, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Accept: 'application/rss+xml, application/xml, text/xml' } });
      result.httpStatus = response.status;
      if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}`);
      let xml = '';
      const decoder = new TextDecoder('utf-8', { fatal: true });
      for await (const chunk of response.body) { xml += decoder.decode(chunk, { stream: true }); if (xml.length > 5_000_000) throw new Error('Feed exceeds size limit'); }
      xml += decoder.decode();
      result.feedContentHash = hash(xml);
      result.timestampPolicy = 'Official feed local timestamps without offset interpreted as Asia/Kolkata; eligibility still starts at observation.';
      const records = parseOfficialFeed(xml, source.id, limit);
      if (!records.length) throw new Error('Feed contained no items');
      Object.assign(result, await importNews(records, { dataDir }));
      result.status = 'collected';
    } catch (error) { result.status = 'unavailable'; result.error = error.message; }
    results.push(result);
  }
  await mutate(dataDir, file => { file.collections ||= []; file.collections.push(...results); });
  return { results, coverage: (await readNews(dataDir)).coverage };
}

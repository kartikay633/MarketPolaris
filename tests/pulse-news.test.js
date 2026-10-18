import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importNews, readNews, eligibility, parseOfficialFeed } from '../server/research/news.js';

const now = '2026-10-13T18:00:00.000Z';
const record = { sourceUrl: 'https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=123', title: 'Policy rate decision', publishedAt: '2026-10-12T10:00:00+05:30', excerpt: 'The policy rate was held.', author: null, symbols: [] };
async function sandbox(t) { const dir = await mkdtemp(join(tmpdir(), 'pulse-news-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; }
test('old articles cannot be retroactively available; imported archival assertions ignored', async t => {
  const dataDir = await sandbox(t);
  await importNews([{ ...record, firstSeenAt: '2020-01-01T00:00:00Z', archiveVerified: true, availableAt: record.publishedAt }], { dataDir, now });
  const { events } = await readNews(dataDir);
  assert.equal(events[0].firstSeenAt, now);
  assert.equal(eligibility(events[0], '2026-10-12T23:00:00Z'), false);
  assert.equal(eligibility(events[0], now), true);
  assert.equal(events[0].archiveVerified, false);
});
test('duplicates are idempotent; changed text appends a version and preserves original', async t => {
  const dataDir = await sandbox(t);
  await importNews([record], { dataDir, now });
  const first = (await readNews(dataDir)).events[0];
  assert.equal((await importNews([record], { dataDir, now })).added, 0);
  await importNews([{ ...record, excerpt: 'The earlier rate was corrected.', correctionOf: first.id }], { dataDir, now: '2026-10-14T18:00:00Z' });
  const { events } = await readNews(dataDir);
  assert.deepEqual(events[0], first);
  assert.equal(events[1].version, 2);
  assert.equal(events[1].correctionOf, first.id);
  assert.equal(eligibility(events[1], now), false);
});
test('reject future or ambiguous timestamps, untrusted URLs, HTML and unknown correction links', async t => {
  const dataDir = await sandbox(t);
  for (const bad of [
    { publishedAt: '2027-01-01T00:00:00Z' }, { publishedAt: '2026-01-01' },
    { sourceUrl: 'http://www.rbi.org.in/a' }, { sourceUrl: 'https://rbi.org.in.evil.test/a' },
    { sourceUrl: 'https://user:pass@www.rbi.org.in/a' }, { sourceUrl: 'https://127.0.0.1/a' },
    { excerpt: '<script>alert(1)</script>' }, { correctionOf: 'missing' },
  ]) await assert.rejects(importNews([{ ...record, ...bad }], { dataDir, now }));
  assert.equal((await readNews(dataDir)).events.length, 0);
});
test('novelty only uses already observed content and duplicates across sources are identified', async t => {
  const dataDir = await sandbox(t);
  await importNews([record], { dataDir, now });
  await importNews([{ ...record, sourceUrl: 'https://www.nseindia.com/news/one' }], { dataDir, now: '2026-10-14T18:00:00Z' });
  const { events } = await readNews(dataDir);
  assert.equal(events[0].novelty.kind, 'first-observed-text');
  assert.equal(events[1].novelty.kind, 'previously-observed-text');
  assert.equal(events[1].novelty.previousEventId, events[0].id);
});
test('NSE timestamps explicitly use India offset and retain text only', () => {
  const xml = '<rss><channel><item><title>Example</title><link>https://nsearchives.nseindia.com/corporate/ABC_123.pdf</link><description><![CDATA[Quarterly <b>results</b>]]></description><pubDate>13-Oct-2026 22:33:14</pubDate></item></channel></rss>';
  const events = parseOfficialFeed(xml, 'nse');
  assert.equal(events[0].publishedAt, '2026-10-13T17:03:14.000Z');
  assert.equal(events[0].excerpt, 'Quarterly results');
  assert.deepEqual(events[0].symbols, ['ABC']);
  assert.throws(() => parseOfficialFeed('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss/>', 'nse'));
});
test('NSE items without a source link are skipped instead of failing the feed', () => {
  const linkless = '<item><title>SBI-ETF Gold</title><link/><description>Declaration of NAV</description><pubDate>18-Oct-2026 14:32:00</pubDate></item>';
  const linked = '<item><title>Example</title><link>https://nsearchives.nseindia.com/corporate/ABC_123.pdf</link><description>Results</description><pubDate>18-Oct-2026 15:00:00</pubDate></item>';
  const events = parseOfficialFeed(`<rss><channel>${linkless}${linked}</channel></rss>`, 'nse');
  assert.equal(events.length, 1);
  assert.equal(events[0].title, 'Example');
});
test('eligibility distrusts a forged availableAt earlier than observation', () => {
  assert.equal(eligibility({ publishedAt: record.publishedAt, firstSeenAt: now, availableAt: record.publishedAt }, '2026-10-12T23:00:00Z'), false);
});
test('failed mixed import preserves the entire existing store', async t => {
  const dataDir = await sandbox(t);
  await importNews([record], { dataDir, now });
  await assert.rejects(importNews([{ ...record, title: 'New valid event' }, { ...record, title: '<script>bad</script>' }], { dataDir, now }));
  assert.equal((await readNews(dataDir)).events.length, 1);
});
test('a malformed item outside the requested RSS batch does not break a bounded collection', () => {
  const item = '<item><title>Announcement</title><link>https://nsearchives.nseindia.com/corporate/ABC_123.pdf</link><description>Results</description><pubDate>13-Oct-2026 22:33:14</pubDate></item>';
  const xml = `<rss><channel>${item}<item><link/></item></channel></rss>`;
  assert.equal(parseOfficialFeed(xml, 'nse', 1).length, 1);
  assert.equal(parseOfficialFeed(xml, 'nse', 2).length, 1); // the linkless item is skipped
  const badDate = '<item><title>X</title><link>https://nsearchives.nseindia.com/corporate/XYZ_1.pdf</link><pubDate>sometime</pubDate></item>';
  assert.throws(() => parseOfficialFeed(`<rss><channel>${item}${badDate}</channel></rss>`, 'nse', 2));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CompanyTagger } from '../server/news/tagger.js';
import { storyEventType, filingMateriality, filingEventType, isMarketCommentary } from '../server/news/classify.js';
import { NewsWire, filingItem, parseFeed, storyItem, nseTime } from '../server/news/wire.js';

const EQUITIES = {
  HDFCBANK: { name: 'HDFC BANK LTD', alias: 'HDFC Bank' }, HDFCLIFE: { name: 'HDFC LIFE INS CO LTD', alias: 'HDFC Life' },
  ETERNAL: { name: 'ETERNAL LIMITED', alias: 'Zomato' }, SWIGGY: { name: 'SWIGGY LIMITED', alias: 'Swiggy' },
  INFY: { name: 'INFOSYS LIMITED', alias: 'Infosys' }, LT: { name: 'LARSEN & TOUBRO LTD.', alias: 'Larsen & Toubro' },
  LTTS: { name: 'L&T TECHNOLOGY SER. LTD.', alias: 'L&T Technology Services' }, SOUTHBANK: { name: 'SOUTH INDIAN BANK LTD' },
  INDIANB: { name: 'INDIAN BANK' }, NOIDATOLL: { name: 'NOIDA TOLL BRIDGE CO LTD' }, WORTHPERI: { name: 'WORTH PERIPHERALS LIMITED' },
  RELIANCE: { name: 'RELIANCE INDUSTRIES LTD' }, RPOWER: { name: 'RELIANCE POWER LTD.' }, BSE: { name: 'BSE LIMITED' }, TCS: { name: 'TATA CONSULTANCY SERV LT' },
  TRANSRAILL: { name: 'TRANSRAIL LIGHTING LTD' },
};
const tagger = new CompanyTagger(EQUITIES, { notable: ['HDFCBANK', 'ETERNAL', 'SWIGGY', 'INFY', 'LT', 'LTTS', 'SOUTHBANK', 'INDIANB', 'RELIANCE', 'TCS', 'TRANSRAILL'] });

test('headlines are tagged with the companies they name, and ordinary words are not companies', () => {
  assert.deepEqual(tagger.tag('HDFC Bank probe finds senior executives leaked secrets'), ['HDFCBANK']);
  assert.deepEqual(tagger.tag('Flipkart to challenge Zomato and Swiggy with a new app').sort(), ['ETERNAL', 'SWIGGY']);
  assert.deepEqual(tagger.tag('Infosys Q2 results preview'), ['INFY']);
  assert.deepEqual(tagger.tag('Why L&T Technology shares jumped 11%'), ['LTTS']);
  assert.deepEqual(tagger.tag('L&T wins large orders for Amaravati towers'), ['LT']);
  assert.deepEqual(tagger.tag('South Indian Bank shares hit a 52-week high'), ['SOUTHBANK']);
  assert.deepEqual(tagger.tag('Renewable expo to bring 1,080 exhibitors to Greater Noida'), []);
  assert.deepEqual(tagger.tag('Transrail bags new orders worth Rs 927 crore'), ['TRANSRAILL']);
  assert.deepEqual(tagger.tag('Reliance Power shares rally'), ['RPOWER']);
  assert.deepEqual(tagger.tag('SFC Environmental IPO to list on BSE and NSE'), []);
  assert.deepEqual(tagger.tag('TCS turns to mid-market clients'), ['TCS']);
});

test('company events are classified from the headline; market commentary is dropped', () => {
  assert.equal(storyEventType('Eternal Q2 net profit up 92%, revenue up 77%'), 'results');
  assert.equal(storyEventType('Kalpataru Projects secures orders worth ₹2,349 crore'), 'orders');
  assert.equal(storyEventType('FSSAI issues notice to Nestle India over a label claim'), 'legal');
  assert.equal(storyEventType('Zomato parent Eternal to swap Adonmo stake for Mygate shares'), 'deals');
  assert.equal(storyEventType('Harish Bhat resigns as director of Trent'), 'management');
  assert.equal(storyEventType('ICICI Sec sees 51% upside in this bank stock'), 'views');
  assert.equal(isMarketCommentary('Sensex ends 300 points higher; Nifty above 25,000'), true);
  assert.equal(isMarketCommentary('Sky Gold among 5 stocks that hit 52-week highs'), true);
  assert.equal(isMarketCommentary('TCS Share Price Highlights: TCS Stock Price History'), true);
  assert.equal(isMarketCommentary('Eternal Q2 profit jumps 92%'), false);
});

test('NSE filings keep material categories, drop routine notices, and read the dissemination time in IST', () => {
  assert.equal(filingMateriality('Trading Window'), null);
  assert.equal(filingMateriality('Copy of Newspaper Publication'), null);
  assert.equal(filingMateriality('Bagging/Receiving of orders/contracts'), 'high');
  assert.equal(filingMateriality('Outcome of Board Meeting', 'financial results for the quarter'), 'high');
  assert.equal(filingEventType('Credit Rating'), 'ratings');
  assert.equal(nseTime('21-Oct-2026 19:15:55'), '2026-10-21T13:45:55.000Z');
  const item = filingItem({ symbol: 'TBOTEK', seq_id: '1', desc: 'Action(s) taken or orders passed', sm_name: 'TBO Tek Limited',
    attchmntText: 'TBO Tek Limited has informed the Exchange about Action(s) taken or orders passed', exchdisstime: '21-Oct-2026 19:15:55',
    attchmntFile: 'https://nsearchives.nseindia.com/x.pdf' });
  assert.equal(item.title, 'Action(s) taken or orders passed');
  assert.equal(item.eventType, 'legal');
  assert.equal(filingItem({ symbol: 'X', seq_id: '2', desc: 'Trading Window', exchdisstime: '21-Oct-2026 10:00:00' }), null);
});

const FEED = `<rss><channel>
<item><title><![CDATA[Eternal Q2 net profit up 92%]]></title><link><![CDATA[https://example.com/a]]></link><description><![CDATA[Quick commerce grew.]]></description><pubDate><![CDATA[Wed, 21 Oct 2026 19:43:38 +0530]]></pubDate></item>
<item><title>Sensex ends higher as banks gain</title><link>https://example.com/b</link><pubDate>Wed, 21 Oct 2026 16:00:00 +0530</pubDate></item>
<item><title>Monsoon covers the country early</title><link>https://example.com/c</link><pubDate>Wed, 21 Oct 2026 12:00:00 +0530</pubDate></item>
</channel></rss>`;

test('publisher feeds keep company stories only', () => {
  const raw = parseFeed(FEED);
  assert.equal(raw.length, 3);
  const kept = raw.map((r) => storyItem(r, 'Example', tagger)).filter(Boolean);
  assert.equal(kept.length, 1);
  assert.deepEqual(kept[0].symbols, ['ETERNAL']);
  assert.equal(kept[0].eventType, 'results');
});

test('the wire stores the day, serves filters and builds the trader panels from deals and ratings', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'polaris-wire-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const now = new Date('2026-10-21T14:00:00Z');
  const nse = {
    getJson: async (p) => {
      if (p.includes('corporate-announcements')) return [
        { symbol: 'TRANSRAILL', seq_id: '10', desc: 'Bagging/Receiving of orders/contracts', sm_name: 'Transrail Lighting Ltd', attchmntText: 'Transrail Lighting Limited has informed the Exchange about orders worth Rs 927 crore', exchdisstime: '21-Oct-2026 18:00:00' },
        { symbol: 'TRANSRAILL', seq_id: '11', desc: 'Trading Window', sm_name: 'Transrail Lighting Ltd', exchdisstime: '21-Oct-2026 18:05:00' },
      ];
      if (p.includes('largedeal')) return { as_on_date: '21-Oct-2026', BLOCK_DEALS_DATA: [{ symbol: 'ETERNAL', name: 'Eternal Ltd', clientName: 'A FUND', buySell: 'BUY', qty: '1000000', watp: '300', date: '21-Oct-2026' }], BULK_DEALS_DATA: [] };
      if (p.includes('credit-rating')) return [{ CompanyName: 'HDFC Bank Limited', Symbol: 'NOTLISTED', RatingAction: 'Upgrade', DateofCR: '15-10-2026', NameOfCRAgency: 'CRISIL', CreditRating: 'AAA', CreditRatingEarlier: 'AA+' }];
      throw new Error(`unexpected ${p}`);
    },
  };
  const wire = new NewsWire({ dataDir: dir, nse, equities: () => EQUITIES, notable: () => Object.keys(EQUITIES), now: () => now,
    fetcher: async () => ({ ok: true, text: async () => FEED }) });
  await wire.refresh();
  const all = await wire.query({});
  assert.deepEqual(all.map((x) => x.kind).sort(), ['filing', 'story']);
  assert.equal((await wire.query({ type: 'orders' }))[0].symbols[0], 'TRANSRAILL');
  assert.equal((await wire.query({ symbol: 'NSE:ETERNAL' })).length, 1);
  const pulse = await wire.pulse();
  assert.equal(pulse.activity.byType.orders, 1);
  assert.equal(pulse.deals.block[0].valueCr, 30);
  assert.equal(pulse.ratings.upgrades[0].symbol, 'HDFCBANK');
  assert.equal(pulse.ratings.upgrades[0].previous, 'AA+');
  const saved = JSON.parse(await readFile(path.join(dir, 'news-wire', '2026-10-21.json'), 'utf8'));
  assert.equal(saved.items.length, 2);
});

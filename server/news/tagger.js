// Finds the NSE-listed companies a headline is about, using the NSE equity directory:
// * tickers written in capitals ("TCS", "BHEL") and common market shorthand ("SBI", "L&T");
// * full company names and distinctive two-word name prefixes ("HDFC Bank", "Adani Green");
// * well-known brand names ("Zomato", "Paytm", "IndiGo");
// * a distinctive one-word name ("Infosys", "Suzlon") only for well-known companies (the research
//   universes), written with a capital letter, and never an ordinary word ("Worth", "Travel").
const GENERIC = /\b(?:the|limited|ltd|corporation|corp|company|co|inc|and|of|pvt|private)\b/g;
const light = (s) => ` ${String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/['’]s\b/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
const clean = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(GENERIC, ' ').replace(/\s+/g, ' ').trim();

// Ordinary headline words that also start company names.
const STOP = new Set(('about after again against agri air alpha among apex asian bank banks best big board brand bright capital cash cement '
  + 'central century china city clean coal coastal crore credit cyber deal deals delta digital dynamic eagle east eastern elite energy '
  + 'excel express first focus future gains garden gateway general global gold golden grand green group growth gujarat health heads '
  + 'healthcare heritage home house housing ideal ideas impact india indian infra insurance invest investment jump kerala land life '
  + 'light lower lucky major market markets mega metro media metal metals modern money motors music national nature new north '
  + 'nova ocean oil omega orient order orders pacific paras pearl pioneer planet power premier price prices prime profit punjab '
  + 'quality rally rate record relief retail rise rises royal safe sangam share shares shift silver smart solar south southern speed '
  + 'sports standard star state steel sterling stock stocks strong sugar summit sun super supreme swan take tech today tokyo top '
  + 'total trade travel trust union united universal urban value vibrant view vision water wealth west western world worth '
  + 'madhya pradesh maharashtra tamil andhra uttar bengal karnataka rajasthan delhi mumbai bombay chennai kolkata bengaluru bangalore '
  + 'hyderabad noida greater pune assam odisha bihar goa jammu kashmir haryana telangana kerala gujarat india indian industries services '
  + 'solutions technologies technology holdings enterprises campus college multi oracle neo').split(' '));

// Shorthand used by traders and newsrooms.
const SHORTHAND = { SBI: 'SBIN', HUL: 'HINDUNILVR', 'L&T': 'LT', RIL: 'RELIANCE', BAJFIN: 'BAJFINANCE', HPCL: 'HINDPETRO', LIC: 'LICI',
  IHCL: 'INDHOTEL', 'M&M': 'M&M', 'L&T': null, BSE: null, NSE: null, HDFC: null, ICICI: null, IOCL: 'IOC', GAIL: 'GAIL', NHAI: null, RBI: null, SEBI: null, IPO: null };
// Brand names that differ from the listed company's name.
const BRANDS = { zomato: 'ETERNAL', blinkit: 'ETERNAL', paytm: 'PAYTM', ixigo: 'IXIGO', nykaa: 'NYKAA', swiggy: 'SWIGGY', indigo: 'INDIGO',
  'ola electric': 'OLAELEC', policybazaar: 'POLICYBZR', delhivery: 'DELHIVERY', mamaearth: 'HONASA', 'jio financial': 'JIOFIN',
  airtel: 'BHARTIARTL', 'bharti airtel': 'BHARTIARTL', 'tata steel': 'TATASTEEL', 'tata power': 'TATAPOWER', 'tata consumer': 'TATACONSUM',
  'tata elxsi': 'TATAELXSI', 'tata chemicals': 'TATACHEM', tcs: 'TCS', 'dmart': 'DMART', 'avenue supermarts': 'DMART', 'm and m': 'M&M',
  'mahindra and mahindra': 'M&M', 'larsen and toubro': 'LT', 'larsen': 'LT', 'maruti suzuki': 'MARUTI', 'maruti': 'MARUTI', 'hero motocorp': 'HEROMOTOCO',
  'bajaj auto': 'BAJAJ-AUTO', 'eicher': 'EICHERMOT', 'royal enfield': 'EICHERMOT', 'asian paints': 'ASIANPAINT', 'sun pharma': 'SUNPHARMA',
  'dr reddy': 'DRREDDY', "dr reddy's": 'DRREDDY', 'kotak mahindra bank': 'KOTAKBANK', 'kotak bank': 'KOTAKBANK', 'axis bank': 'AXISBANK',
  'yes bank': 'YESBANK', 'indusind bank': 'INDUSINDBK', 'bank of baroda': 'BANKBARODA', 'punjab national bank': 'PNB', 'canara bank': 'CANBK',
  'adani ports': 'ADANIPORTS', 'adani enterprises': 'ADANIENT', 'adani green': 'ADANIGREEN', 'adani power': 'ADANIPOWER', 'adani energy': 'ADANIENSOL',
  'adani total gas': 'ATGL', 'hindustan unilever': 'HINDUNILVR', 'hindustan aeronautics': 'HAL', 'bharat electronics': 'BEL', 'coal india': 'COALINDIA',
  'zee entertainment': 'ZEEL', 'vodafone idea': 'IDEA', 'reliance industries': 'RELIANCE', 'reliance': 'RELIANCE', 'wipro': 'WIPRO', 'infosys': 'INFY',
  'hcltech': 'HCLTECH', 'hcl tech': 'HCLTECH', 'tech mahindra': 'TECHM', 'ultratech': 'ULTRACEMCO', 'jsw steel': 'JSWSTEEL', 'hindalco': 'HINDALCO',
  'vedanta': 'VEDL', 'kotak mahindra': 'KOTAKBANK', 'l and t': 'LT', 'l and t technology': 'LTTS', 'l and t finance': 'LTF', ltimindtree: 'LTIM', 'south indian bank': 'SOUTHBANK', 'indian oil': 'IOC', 'oil india': 'OIL', 'indian bank': 'INDIANB', 'indian hotels': 'INDHOTEL', 'taj hotels': 'INDHOTEL',
  'bharat petroleum': 'BPCL', 'hindustan petroleum': 'HINDPETRO', 'state bank of india': 'SBIN', 'life insurance corporation': 'LICI', 'interglobe': 'INDIGO',
  'jindal steel': 'JINDALSTEL', 'bse ltd': 'BSE', 'bse shares': 'BSE', 'hdfc bank': 'HDFCBANK', 'icici bank': 'ICICIBANK', 'hdfc life': 'HDFCLIFE', 'icici prudential': 'ICICIPRULI',
  'hdfc amc': 'HDFCAMC', 'tata motors passenger': 'TMPV', 'tata motors commercial': 'TMCV', 'titan': 'TITAN', 'trent': 'TRENT', 'nestle india': 'NESTLEIND', 'nestle': 'NESTLEIND', 'britannia': 'BRITANNIA', 'itc': 'ITC' };

// A brand does not count when the words after it (or before it) name a different company.
const BRAND_GUARD = { reliance: /^ (?:power|infra|infrastructure|capital|communications|home|retail|nippon|general|jio)\b/, 'l and t': /^ (?:technology|finance|mindtree|infotech)\b/,
  'kotak mahindra': /^ (?:amc|asset|life|general|securities|mutual)\b/ };
const BRAND_BEFORE = { 'indian bank': / (?:south|karur vysya)$/ };

export class CompanyTagger {
  constructor(equities = {}, { notable = [] } = {}) {
    this.equities = equities;
    const known = new Set(notable);
    const owners = {};
    const entries = [];
    for (const [symbol, e] of Object.entries(equities)) {
      for (const name of [e.name, e.alias]) {
        const words = clean(name).split(' ').filter(Boolean);
        if (!words.length) continue;
        if (words.length > 1) entries.push({ symbol, phrase: words.join(' '), strength: 3 });
        if (words.length > 2) entries.push({ symbol, phrase: words.slice(0, 2).join(' '), strength: 2 });
        entries.push({ symbol, phrase: words[0], strength: 1 });
      }
    }
    for (const { phrase, symbol } of entries) (owners[phrase] ||= new Set()).add(symbol);
    this.phrases = new Map();
    for (const { symbol, phrase, strength } of entries) {
      if (owners[phrase].size !== 1) continue; // a phrase two companies share identifies neither
      if (strength === 1 && (!known.has(symbol) || phrase.length < 5 || STOP.has(phrase))) continue;
      if (strength === 2 && phrase.split(' ').every((w) => STOP.has(w) || w.length < 3)) continue;
      const prev = this.phrases.get(phrase);
      if (!prev || prev.strength < strength) this.phrases.set(phrase, { symbol, strength, single: strength === 1 });
    }
    this.brands = Object.entries(BRANDS).filter(([, symbol]) => equities[symbol]).map(([brand, symbol]) => ({ key: light(brand), symbol, guard: BRAND_GUARD[brand], before: BRAND_BEFORE[brand] }));
    this.maxWords = Math.max(1, ...[...this.phrases.keys()].map((p) => p.split(' ').length));
  }

  // Up to `limit` symbols, strongest matches first; minScore 3 keeps only names, brands and tickers.
  tag(text, limit = 3, minScore = 0) {
    const found = new Map();
    const add = (symbol, score) => { if (symbol && this.equities[symbol] && (found.get(symbol) || 0) < score) found.set(symbol, score); };
    const raw = String(text || '');
    for (const token of raw.match(/(?<![A-Za-z0-9])[A-Z][A-Z0-9&-]{1,}(?![A-Za-z0-9])/g) || []) {
      if (token in SHORTHAND) add(SHORTHAND[token], 5);
      else if (token.length >= 3 && this.equities[token] && !STOP.has(token.toLowerCase())) add(token, 4);
    }
    const lowered = light(raw);
    for (const b of this.brands) {
      let at = lowered.indexOf(b.key);
      while (at >= 0) {
        const after = lowered.slice(at + b.key.length - 1), before = lowered.slice(0, at + 1);
        if ((!b.guard || !b.guard.test(after)) && (!b.before || !b.before.test(before.trimEnd()))) { add(b.symbol, 3); break; }
        at = lowered.indexOf(b.key, at + 1);
      }
    }
    // Words as written, so a one-word name only counts when capitalised in the headline.
    const original = raw.replace(/&/g, ' and ').replace(/[^A-Za-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
    const words = original.map((w) => clean(w)).map((w, i) => ({ w, cap: /^[A-Z]/.test(original[i]) })).filter((x) => x.w);
    // Longest names first; words inside a longer matched name ("South Indian Bank") cannot match again.
    const covered = new Array(words.length).fill(false);
    for (let n = this.maxWords; n >= 1; n -= 1) {
      for (let i = 0; i + n <= words.length; i += 1) {
        if (covered.slice(i, i + n).some(Boolean)) continue;
        const hit = this.phrases.get(words.slice(i, i + n).map((x) => x.w).join(' '));
        if (!hit || (hit.single && !words[i].cap)) continue;
        add(hit.symbol, hit.strength);
        covered.fill(true, i, i + n);
      }
    }
    return [...found.entries()].filter(([, score]) => score >= minScore).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([symbol]) => symbol);
  }
}

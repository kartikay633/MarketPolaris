// Event types for company news, the materiality of exchange filings, and the filter that keeps
// market commentary ("Sensex ends higher", "stocks to watch") out of the company wire.

export const EVENT_TYPES = {
  results: 'Results',
  orders: 'Orders & contracts',
  deals: 'M&A & stakes',
  management: 'Management',
  legal: 'Regulatory & legal',
  capital: 'Fund raising & IPOs',
  ratings: 'Credit ratings',
  corporate: 'Dividends & corporate actions',
  operations: 'Business & operations',
  exchange: 'Exchange queries',
  views: 'Brokerage & analyst views',
  price: 'Price moves',
  other: 'Other',
};

const RULES = [
  ['results', /\b(?:q[1-4]\b|q[1-4] ?fy|quarter(?:ly)? (?:results?|earnings|profit|net)|results?\b|earnings|net profit|net loss|profit (?:rises|falls|jumps|drops|surges|declines|up|down)|revenue (?:rises|falls|jumps|grows)|ebitda|financial results?)/i],
  ['legal', /\b(?:sebi|cci|fssai|cdsco notice|enforcement directorate|cbi|income[- ]tax|gst|raid|search(?:es)? at|probe|penalt|fined?\b|show[- ]cause|notice (?:to|over|from)|\bcourt\b|high court|supreme court|tribunal|nclt|nclat|\bsat\b|insolvency|ibc|fraud|default|tax demand|lawsuit|litigation|arbitration|banned|suspend|attachment|regulator|data breach|breach|leak(?:ed|s)?|hack(?:ed)?|cyber ?attack|dark web)/i],
  ['ratings', /\b(?:credit rating|rating (?:upgrade|downgrade|action|outlook)|upgrade[sd]? .*rating|downgrade[sd]?|crisil|icra|care ratings|india ratings|moody'?s|fitch|s&p global ratings)\b/i],
  ['deals', /\b(?:acqui|merger|amalgamat|demerg|takeover|buyout|stake\b|open offer|joint venture|\bjv\b|divest|strategic investment|swap)/i],
  ['capital', /\b(?:ipo|qip|fund ?rais|raises? (?:rs|₹|\$)|rights issue|preferential|ncds?\b|bonds?\b|ofs\b|offer for sale|block deal|bulk deal|private placement|listing|allotment of (?:equity|shares|securities))/i],
  ['orders', /\b(?:orders?|contracts?|bags?|bagging|wins? (?:bid|deal|project)|secures?|letter of (?:award|intent)|loa|tender)\b/i],
  ['management', /\b(?:ceo|cfo|coo|\bmd\b|managing director|chairman|chairperson|director|resign|steps? down|appoint|elevat|succession|kmp|auditor)/i],
  ['corporate', /\b(?:dividend|buyback|bonus (?:issue|shares)|stock split|split|record date|delist)/i],
  ['operations', /\b(?:plant|capacity|capex|expansion|launch|unveil|usfda|approval|commission|production|sales (?:rise|fall|grow)|volumes?|partnership|tie[- ]up|agreement|mou|deal with|supply)/i],
];

const VIEWS = /\b(?:target price|price target|jefferies|nomura|morgan stanley|goldman|clsa|macquarie|motilal oswal|kotak institutional|icici sec(?:urities)?|brokerages?|analysts? (?:say|see|stay|expect)|upside|downside|buy rating|sell rating|overweight|underweight|should you (?:buy|sell)|buy, sell or hold|experts? (?:see|say|weigh)|re-?rating)\b/i;
const PRICE = /\b(?:shares? (?:jump|jumps|rise|rises|fall|falls|slip|slips|sink|sinks|surge|surges|rally|rallies|soar|soars|tank|tanks|gain|gains|drop|drops|plunge|plunges|climb|climbs|crash|crashes|hit)|share price (?:jumps|falls|rises|surges|slips)|stock (?:jumps|falls|rises|surges)|upper circuit|lower circuits?|52-week (?:high|low))\b/i;

export function eventType(text) {
  for (const [type, re] of RULES) if (re.test(text)) return type;
  if (VIEWS.test(text)) return 'views';
  if (PRICE.test(text)) return 'price';
  return 'other';
}

// The headline decides; the summary only when the headline alone says nothing specific.
export function storyEventType(title, summary = '') {
  const fromTitle = eventType(title);
  return fromTitle === 'other' ? eventType(`${title} ${summary}`) : fromTitle;
}

// Market commentary and lists; the wire is about companies, not the index.
const MARKET_WRAP = /\b(?:share price (?:highlights|today|live)|stock price history|(?:among|top|these) \d+ stocks|\d+ stocks (?:that|to|which|with|in)|stocks (?:that|which) (?:hit|rallied)|midcap(?: 100)?|smallcap(?: 100)?|(?:it|bank|psu|auto|pharma|metal|realty|fmcg) stocks|stocks on fire|vwap|sensex|nifty(?: 50| bank)?|stock market (?:today|live|crash|rally)|market (?:live|outlook|wrap|today|close|update|highlights)|stocks? to (?:buy|watch|sell)|top (?:gainers|losers)|closing bell|opening bell|trade setup|technical (?:view|picks|outlook)|f&o|options? (?:strategy|data)|gift nifty|share price today|stock picks|buy or sell|market strategy|week ahead|multibagger|penny stocks?|horoscope|cricket|football)\b/i;
export function isMarketCommentary(title) {
  return MARKET_WRAP.test(title);
}

// NSE filing categories: routine notices are dropped; the rest carry a materiality used for ranking.
const ROUTINE = /trading window|newspaper|certificate under|structural digital database|analysts?\/institutional investor meet|investor meet|con\.? ?call|shareholders meeting|monitoring agency|loss of share|duplicate|record date|esop|esos|esps|compliance certificate|statement of investor complaints|reg\. 74|regulation 74|change in registered office|book closure|annual report|notice of|postal ballot|e-voting|scrutinizer|voting results|clarification sought|trading plan|closure of trading/i;
const HIGH = /financial result|bagging|receiving of orders|orders\/contracts|acquisition|amalgamation|merger|scheme of arrangement|credit rating|insolvency|default|fraud|action\(s\) taken|orders passed|resignation of (?:director\/)?(?:kmp|md|ceo|cfo)|buyback|issue of securities|qip|preferential|rights issue|open offer|substantial acquisition|pledge|delisting|winding/i;
const MEDIUM = /outcome of board meeting|press release|change in management|resignation|appointment|pendency of litigation|litigation|allotment|dividend|price movement|clarification|news verification|spurt in volume|investor presentation|disclosure under sebi takeover/i;
// 'Updates' and 'General Updates' carry no detail in the listing; they stay low (shown with 'all' materiality).

export function filingMateriality(category, text = '') {
  const c = `${category || ''}`;
  if (ROUTINE.test(c)) return null;
  if (HIGH.test(c) || (/outcome of board meeting/i.test(c) && /result|dividend|fund|buyback|bonus|split/i.test(text))) return 'high';
  if (MEDIUM.test(c)) return 'medium';
  return 'low';
}

export function filingEventType(category, text = '') {
  const c = `${category} ${text}`;
  if (/financial result|outcome of board meeting.*result/i.test(c) || /result/i.test(text) && /board meeting/i.test(category)) return 'results';
  if (/bagging|orders\/contracts/i.test(c)) return 'orders';
  if (/credit rating/i.test(c)) return 'ratings';
  if (/acquisition|amalgamation|merger|scheme of arrangement|open offer|substantial acquisition|takeover/i.test(c)) return 'deals';
  if (/insolvency|default|fraud|action\(s\)|orders passed|litigation|penalt|winding/i.test(c)) return 'legal';
  if (/resignation|appointment|change in management|cessation|director|kmp/i.test(c)) return 'management';
  if (/issue of securities|qip|preferential|rights issue|allotment|fund|ncd|debenture/i.test(c)) return 'capital';
  if (/dividend|buyback|bonus|split|delisting/i.test(c)) return 'corporate';
  if (/price movement|clarification|news verification|spurt/i.test(c)) return 'exchange';
  return eventType(text) === 'other' ? 'operations' : eventType(text);
}

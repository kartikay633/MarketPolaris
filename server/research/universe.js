// Research universe: liquid NSE equities chosen from today's large/mid-cap lists.
// Choosing by current membership is survivorship-biased; reports state this.
// Sector labels are coarse and used for peer-relative features and diagnostics.
export const SECTORS = {
  BANK: ['HDFCBANK', 'ICICIBANK', 'SBIN', 'KOTAKBANK', 'AXISBANK', 'INDUSINDBK', 'BANKBARODA', 'PNB', 'CANBK', 'UNIONBANK', 'IDFCFIRSTB', 'FEDERALBNK', 'AUBANK', 'BANDHANBNK', 'INDIANB'],
  FINANCE: ['BAJFINANCE', 'BAJAJFINSV', 'SHRIRAMFIN', 'CHOLAFIN', 'MUTHOOTFIN', 'SBILIFE', 'HDFCLIFE', 'ICICIPRULI', 'ICICIGI', 'SBICARD', 'PFC', 'RECLTD', 'LICHSGFIN', 'M&MFIN', 'HDFCAMC', 'BSE', 'MCX', 'CDSL', 'MANAPPURAM', 'POONAWALLA'],
  IT: ['TCS', 'INFY', 'HCLTECH', 'WIPRO', 'TECHM', 'PERSISTENT', 'COFORGE', 'MPHASIS', 'OFSS', 'LTTS', 'KPITTECH', 'TATAELXSI', 'NAUKRI'],
  ENERGY: ['RELIANCE', 'ONGC', 'IOC', 'BPCL', 'HINDPETRO', 'GAIL', 'PETRONET', 'OIL', 'NTPC', 'POWERGRID', 'TATAPOWER', 'ADANIGREEN', 'ADANIPOWER', 'NHPC', 'TORNTPOWER', 'COALINDIA', 'IGL', 'ADANIENSOL'],
  AUTO: ['MARUTI', 'M&M', 'BAJAJ-AUTO', 'EICHERMOT', 'HEROMOTOCO', 'TVSMOTOR', 'ASHOKLEY', 'BHARATFORG', 'MOTHERSON', 'BOSCHLTD', 'MRF', 'BALKRISIND', 'APOLLOTYRE', 'EXIDEIND', 'TIINDIA'],
  FMCG: ['HINDUNILVR', 'ITC', 'NESTLEIND', 'BRITANNIA', 'DABUR', 'MARICO', 'GODREJCP', 'COLPAL', 'TATACONSUM', 'UNITDSPR', 'VBL', 'PGHH', 'EMAMILTD'],
  HEALTH: ['SUNPHARMA', 'DRREDDY', 'CIPLA', 'DIVISLAB', 'LUPIN', 'AUROPHARMA', 'TORNTPHARM', 'ZYDUSLIFE', 'ALKEM', 'BIOCON', 'GLENMARK', 'APOLLOHOSP', 'MAXHEALTH', 'LAURUSLABS', 'IPCALAB'],
  METAL: ['TATASTEEL', 'JSWSTEEL', 'HINDALCO', 'VEDL', 'SAIL', 'JINDALSTEL', 'NMDC', 'NATIONALUM', 'HINDZINC', 'APLAPOLLO'],
  INDUSTRIAL: ['LT', 'ULTRACEMCO', 'GRASIM', 'SHREECEM', 'AMBUJACEM', 'ACC', 'DALBHARAT', 'SIEMENS', 'ABB', 'BHEL', 'BEL', 'HAL', 'CUMMINSIND', 'POLYCAB', 'HAVELLS', 'CGPOWER', 'ADANIPORTS', 'ADANIENT', 'GMRAIRPORT', 'CONCOR', 'BHARTIARTL', 'INDUSTOWER'],
  REALTY: ['DLF', 'GODREJPROP', 'OBEROIRLTY', 'PRESTIGE', 'PHOENIXLTD', 'LODHA'],
  CONSUMER: ['TITAN', 'ASIANPAINT', 'BERGEPAINT', 'PIDILITIND', 'TRENT', 'DMART', 'PAGEIND', 'VOLTAS', 'DIXON', 'JUBLFOOD', 'INDHOTEL', 'ETERNAL', 'NYKAA', 'BATAINDIA', 'CROMPTON', 'IRCTC'],
  CHEMICAL: ['SRF', 'UPL', 'PIIND', 'DEEPAKNTR', 'AARTIIND', 'NAVINFLUOR', 'COROMANDEL', 'TATACHEM', 'SOLARINDS'],
  MEDIA: ['ZEEL', 'SUNTV', 'PVRINOX'],
};

export const SECTOR_OF = Object.fromEntries(Object.entries(SECTORS).flatMap(([sector, symbols]) => symbols.map(s => [s, sector])));
export const NSE_UNIVERSE = Object.values(SECTORS).flat();

// Benchmarks. NIFTY_50 defines the trading calendar and the relative-return target.
export const BENCHMARKS = [
  { symbol: 'NIFTY_50', instrumentKey: 'NSE_INDEX|Nifty 50' },
  { symbol: 'NIFTY_NEXT_50', instrumentKey: 'NSE_INDEX|Nifty Next 50' },
  { symbol: 'NIFTY_MIDCAP_100', instrumentKey: 'NSE_INDEX|NIFTY MIDCAP 100' },
  { symbol: 'NIFTY_BANK', instrumentKey: 'NSE_INDEX|Nifty Bank', sector: 'BANK' },
  { symbol: 'NIFTY_FIN_SERVICE', instrumentKey: 'NSE_INDEX|Nifty Fin Service', sector: 'FINANCE' },
  { symbol: 'NIFTY_IT', instrumentKey: 'NSE_INDEX|Nifty IT', sector: 'IT' },
  { symbol: 'NIFTY_ENERGY', instrumentKey: 'NSE_INDEX|Nifty Energy', sector: 'ENERGY' },
  // NIFTY_AUTO omitted: the provider returned a duplicated 2018-11-30 session.
  { symbol: 'NIFTY_FMCG', instrumentKey: 'NSE_INDEX|Nifty FMCG', sector: 'FMCG' },
  { symbol: 'NIFTY_HEALTHCARE', instrumentKey: 'NSE_INDEX|NIFTY HEALTHCARE', sector: 'HEALTH' },
  { symbol: 'NIFTY_METAL', instrumentKey: 'NSE_INDEX|Nifty Metal', sector: 'METAL' },
  { symbol: 'NIFTY_INFRA', instrumentKey: 'NSE_INDEX|Nifty Infra', sector: 'INDUSTRIAL' },
  { symbol: 'NIFTY_REALTY', instrumentKey: 'NSE_INDEX|Nifty Realty', sector: 'REALTY' },
  { symbol: 'NIFTY_MEDIA', instrumentKey: 'NSE_INDEX|Nifty Media', sector: 'MEDIA' },
];

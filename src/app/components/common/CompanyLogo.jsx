// Flagship CompanyLogo — Institutional Stock Brand Logo Component
// Official local artwork → resolution-checked remote icons → branded initials.
import React, { useState } from 'react';

// Institutional Indian Stock Symbol → Domain Mapping
const STOCK_DOMAINS = {
  RELIANCE:    ['ril.com', 'relianceindustries.com'],
  TCS:         ['tcs.com', 'tata.com', 'tataconsultancyservices.com'],
  INFY:        ['infosys.com'],
  HDFCBANK:    ['hdfcbank.com'],
  ICICIBANK:   ['icicibank.com'],
  TATAMOTORS:  ['tatamotors.com', 'tata.com'],
  SBIN:        ['sbi.bank', 'statebankofindia.com', 'sbi.co.in'],
  WIPRO:       ['wipro.com'],
  MARUTI:      ['marutisuzuki.com'],
  ITC:         ['itcportal.com'],
  BHARTIARTL:  ['airtel.in', 'bharti.com'],
  AXISBANK:    ['axisbank.com'],
  KOTAKBANK:   ['kotak.com'],
  HINDUNILVR:  ['hul.co.in'],
  LT:          ['larsentoubro.com'],
  SUNPHARMA:   ['sunpharma.com'],
  TITAN:       ['titanworld.com'],
  BAJFINANCE:  ['bajajfinserv.in', 'bajajfinance.in'],
  BAJAJFINSV:  ['bajajfinserv.in'],
  ONGC:        ['ongcindia.com'],
  POWERGRID:   ['powergridindia.com'],
  NTPC:        ['ntpc.co.in'],
  ADANIPORTS:  ['adaniports.com', 'adani.com'],
  ADANIENT:    ['adanienterprises.com', 'adani.com'],
  TECHM:       ['techmahindra.com', 'mahindra.com'],
  'TECH-M':    ['techmahindra.com', 'mahindra.com'],
  DRREDDY:     ['drreddys.com'],
  CIPLA:       ['cipla.com'],
  DIVISLAB:    ['divislabs.com', 'divi.co.in'],
  EICHERMOT:   ['eicher.in', 'royalenfield.com'],
  BRITANNIA:   ['britannia.co.in'],
  HEROMOTOCO:  ['heromotocorp.com'],
  HINDALCO:    ['hindalco.com', 'adityabirla.com'],
  GRASIM:      ['grasim.com', 'adityabirla.com'],
  NESTLEIND:   ['nestle.in', 'nestle.com'],
  JSWSTEEL:    ['jsw.in'],
  TATASTEEL:   ['tatasteel.com', 'tata.com'],
  COALINDIA:   ['coalindia.in'],
  BPCL:        ['bharatpetroleum.in', 'bharatpetroleum.com'],
  HCLTECH:     ['hcltech.com'],
  'M&M':       ['mahindra.com'],
  ASIANPAINT:  ['asianpaints.com'],
  ULTRACEMCO:  ['ultratechcement.com', 'adityabirla.com'],
  INDUSINDBK:  ['indusind.com'],
  APOLLOHOSP:  ['apollohospitals.com'],
  TATACONSUM:  ['tataconsumer.com', 'tata.com'],
  SBILIFE:     ['sbilife.co.in'],
  HDFCLIFE:    ['hdfclife.com'],
  LTIM:        ['ltimindtree.com'],
  ZOMATO:      ['zomato.com'],
  PAYTM:       ['paytm.com'],
  NYKAA:       ['nykaa.com'],
  JIOFIN:      ['jio.com'],
  BEL:         ['bel-india.in'],
  HAL:         ['hal-india.co.in'],
  BOSCHLTD:    ['bosch.in'],
  SIEMENS:     ['siemens.com'],
  VEDL:        ['vedantalimited.com'],
  IOC:         ['iocl.com'],
  GAIL:        ['gailonline.com'],
  DLF:         ['dlf.in'],
  SHREECEM:    ['shreecement.com'],
  PIDILITIND:  ['pidilite.com'],
  HAVELLS:     ['havells.com'],
  DABUR:       ['dabur.com'],
  GODREJCP:    ['godrejcp.com'],
  TRENT:       ['trentlimited.com', 'tata.com'],
};

// Original company artwork is bundled so common badges do not depend on tiny favicons.
// Asset provenance and viewport adaptations are recorded in public/company-logos/SOURCES.md.
const LOCAL_LOGOS = {
  TATAMOTORS: '/company-logos/tata.png',
  TATASTEEL: '/company-logos/tata.png',
  TCS: '/company-logos/tcs.png',
  RELIANCE: '/company-logos/reliance.png',
  HDFCBANK: '/company-logos/hdfcbank.svg',
  ICICIBANK: '/company-logos/icicibank.ico',
  ITC: '/company-logos/itc.png',
};

// Brand colors for polished fallback avatars
const BRAND_PALETTES = {
  RELIANCE:    { bg: 'linear-gradient(135deg, #0b1f5c 0%, #1e3a8a 100%)', text: '#93c5fd', border: 'rgba(59, 130, 246, 0.4)' },
  TCS:         { bg: 'linear-gradient(135deg, #0c2d6b 0%, #1d4ed8 100%)', text: '#bfdbfe', border: 'rgba(37, 99, 235, 0.4)' },
  INFY:        { bg: 'linear-gradient(135deg, #003e6b 0%, #0284c7 100%)', text: '#7dd3fc', border: 'rgba(2, 132, 199, 0.4)' },
  HDFCBANK:    { bg: 'linear-gradient(135deg, #002868 0%, #1e40af 100%)', text: '#93c5fd', border: 'rgba(30, 64, 175, 0.4)' },
  ICICIBANK:   { bg: 'linear-gradient(135deg, #6b1414 0%, #b91c1c 100%)', text: '#fca5a5', border: 'rgba(185, 28, 28, 0.4)' },
  TATAMOTORS:  { bg: 'linear-gradient(135deg, #0d1e57 0%, #1e3a8a 100%)', text: '#93c5fd', border: 'rgba(37, 99, 235, 0.4)' },
  SBIN:        { bg: 'linear-gradient(135deg, #002b49 0%, #0369a1 100%)', text: '#7dd3fc', border: 'rgba(3, 105, 161, 0.4)' },
  WIPRO:       { bg: 'linear-gradient(135deg, #102a5c 0%, #2563eb 100%)', text: '#bfdbfe', border: 'rgba(37, 99, 235, 0.4)' },
  MARUTI:      { bg: 'linear-gradient(135deg, #5c0f1e 0%, #991b1b 100%)', text: '#fca5a5', border: 'rgba(153, 27, 27, 0.4)' },
  ITC:         { bg: 'linear-gradient(135deg, #083318 0%, #047857 100%)', text: '#6ee7b7', border: 'rgba(4, 120, 87, 0.4)' },
  BHARTIARTL:  { bg: 'linear-gradient(135deg, #5c0c16 0%, #be123c 100%)', text: '#fda4af', border: 'rgba(190, 18, 60, 0.4)' },
  AXISBANK:    { bg: 'linear-gradient(135deg, #540c1e 0%, #9f1239 100%)', text: '#fecdd3', border: 'rgba(159, 18, 57, 0.4)' },
  KOTAKBANK:   { bg: 'linear-gradient(135deg, #5c3a00 0%, #b45309 100%)', text: '#fde68a', border: 'rgba(180, 83, 9, 0.4)' },
  HINDUNILVR:  { bg: 'linear-gradient(135deg, #023859 0%, #0284c7 100%)', text: '#7dd3fc', border: 'rgba(2, 132, 199, 0.4)' },
  LT:          { bg: 'linear-gradient(135deg, #1e293b 0%, #475569 100%)', text: '#e2e8f0', border: 'rgba(71, 85, 105, 0.4)' },
  TITAN:       { bg: 'linear-gradient(135deg, #4d3300 0%, #a16207 100%)', text: '#fef08a', border: 'rgba(161, 98, 7, 0.4)' },
  ZOMATO:      { bg: 'linear-gradient(135deg, #6c1212 0%, #e11d48 100%)', text: '#fecdd3', border: 'rgba(225, 29, 72, 0.4)' },
  PAYTM:       { bg: 'linear-gradient(135deg, #002f6c 0%, #0284c7 100%)', text: '#7dd3fc', border: 'rgba(2, 132, 199, 0.4)' },
};

const DEFAULT_PALETTE = {
  bg: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
  text: '#60a5fa',
  border: 'rgba(59, 130, 246, 0.35)',
};

/**
 * Build candidate logo URLs in order of preference
 */
function buildCandidateUrls(symbol) {
  const clean = symbol.replace(/^(NSE:|BSE:)/, '').toUpperCase().trim();
  const domains = STOCK_DOMAINS[clean] || [];
  
  const urls = LOCAL_LOGOS[clean] ? [LOCAL_LOGOS[clean]] : [];
  for (const domain of domains) {
    // Requested size is only a hint: successful responses can still be 16px.
    urls.push(`https://www.google.com/s2/favicons?domain=${domain}&sz=256`);
    // 2. Unavatar Service
    urls.push(`https://unavatar.io/${domain}`);
    // 3. DuckDuckGo Icon Service
    urls.push(`https://icons.duckduckgo.com/ip3/${domain}.ico`);
  }
  return urls;
}

/**
 * CompanyLogo Component
 * Renders authentic company logos with multi-provider fallbacks and smooth loaded transition
 */
export function CompanyLogo({ symbol = '', size = 32, className = '', style = {} }) {
  const cleanSym = symbol.replace(/^(NSE:|BSE:)/, '').toUpperCase().trim();
  const candidateUrls = React.useMemo(() => buildCandidateUrls(cleanSym), [cleanSym]);
  const [candidateIdx, setCandidateIdx] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [imageDimensions, setImageDimensions] = useState(null);

  React.useEffect(() => {
    setCandidateIdx(0);
    setLoaded(false);
    setImageDimensions(null);
  }, [cleanSym]);

  const palette = BRAND_PALETTES[cleanSym] || DEFAULT_PALETTE;
  const initials = cleanSym.slice(0, 2);
  const fontSize = Math.max(10, Math.round(size * 0.34));
  const padding = Math.max(2, Math.round(size * 0.1));

  const hasMoreCandidates = candidateIdx < candidateUrls.length;
  const currentUrl = hasMoreCandidates ? candidateUrls[candidateIdx] : null;
  const isVector = currentUrl?.endsWith('.svg');
  const pixelRatio = typeof window === 'undefined' ? 1 : Math.max(1, window.devicePixelRatio || 1);

  const handleImageError = () => {
    setLoaded(false);
    setImageDimensions(null);
    setCandidateIdx((prev) => prev + 1);
  };

  const handleImageLoad = (event) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    // An HTTP success does not guarantee a usable badge image.
    if (!isVector && Math.max(naturalWidth, naturalHeight) < 32) {
      handleImageError();
      return;
    }
    setImageDimensions({ width: naturalWidth, height: naturalHeight });
    setLoaded(true);
  };

  const containerStyle = {
    width: `${size}px`,
    height: `${size}px`,
    minWidth: `${size}px`,
    minHeight: `${size}px`,
    borderRadius: size <= 24 ? '4px' : size <= 40 ? '8px' : '10px',
    overflow: 'hidden',
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    userSelect: 'none',
    ...style,
  };

  if (currentUrl) {
    return (
      <div
        className={`company-logo-badge ${className}`}
        style={{
          ...containerStyle,
          backgroundColor: '#FFFFFF',
          padding: `${padding}px`,
          border: '1px solid rgba(255, 255, 255, 0.18)',
          boxShadow: 'none',
          transition: 'transform 0.15s ease, box-shadow 0.15s ease',
        }}
        title={`${cleanSym} (NSE)`}
      >
        <img
          key={`${cleanSym}:${currentUrl}`}
          src={currentUrl}
          alt={cleanSym}
          onError={handleImageError}
          onLoad={handleImageLoad}
          decoding="async"
          style={{
            width: '100%',
            height: '100%',
            maxWidth: !isVector && imageDimensions ? `${imageDimensions.width / pixelRatio}px` : undefined,
            maxHeight: !isVector && imageDimensions ? `${imageDimensions.height / pixelRatio}px` : undefined,
            objectFit: 'contain',
            opacity: loaded ? 1 : 0.7,
            transition: 'opacity 0.2s ease',
            imageRendering: 'auto',
          }}
          loading="lazy"
        />
      </div>
    );
  }

  // Fallback: Institutional Branded Initials
  return (
    <div
      className={`company-logo-badge ${className}`}
      style={{
        ...containerStyle,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        boxShadow: 'none',
      }}
      title={`${cleanSym} (NSE)`}
    >
      <span
        style={{
          fontSize: `${fontSize}px`,
          fontWeight: 800,
          color: palette.text,
          letterSpacing: '0.04em',
          fontFamily: 'Inter, system-ui, sans-serif',
          lineHeight: 1,
        }}
      >
        {initials}
      </span>
    </div>
  );
}

export default CompanyLogo;

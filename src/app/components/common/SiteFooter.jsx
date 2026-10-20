// Site footer: brand, product links, company pages and the regulatory notice.
import React from 'react';
import { Link } from 'react-router-dom';

const PRODUCT = [['/markets', 'Markets'], ['/ai', 'Polaris AI'], ['/ai?tab=brief', 'Market brief'], ['/trade', 'Paper trading'], ['/news', 'News']];
const COMPANY = [['/info/about', 'About'], ['/info/how-it-works', 'How Polaris AI works'], ['/info/contact', 'Contact']];
const LEGAL = [['/info/disclaimer', 'Disclaimer'], ['/info/privacy', 'Privacy'], ['/info/terms', 'Terms of use']];

function Column({ title, links }) {
  return (
    <div className="site-footer-col">
      <h3 className="fd-lbl">{title}</h3>
      <ul>{links.map(([to, label]) => <li key={to}><Link to={to}>{label}</Link></li>)}</ul>
    </div>
  );
}

export default function SiteFooter() {
  return (
    <footer className="site-footer" aria-label="Site footer">
      <div className="site-footer-grid">
        <div className="site-footer-brand">
          <strong>MARKET POLARIS</strong>
          <p>Research and paper trading for NSE equities, with models tested on data they never saw.</p>
        </div>
        <Column title="Product" links={PRODUCT} />
        <Column title="Company" links={COMPANY} />
        <Column title="Legal" links={LEGAL} />
      </div>
      <div className="site-footer-notice">
        <p>Market Polaris is for research, education and paper trading only. It is not investment advice, and Market Polaris is not registered with SEBI as a Research Analyst or Investment Adviser. Investments in securities are subject to market risks.</p>
        <p>Quotes and NIFTY options via Upstox · Turnover and FII/DII via NSE · News via Marketaux · Charts by <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">TradingView</a> Lightweight Charts · © {new Date().getFullYear()} Market Polaris</p>
      </div>
    </footer>
  );
}

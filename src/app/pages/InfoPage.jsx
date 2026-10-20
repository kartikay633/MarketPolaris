// About, methodology, disclaimer, privacy, terms and contact pages linked from the site footer.
import React from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';

const CONTACT_EMAIL = import.meta.env.VITE_CONTACT_EMAIL || '';

export const INFO_PAGES = [
  ['about', 'About'],
  ['how-it-works', 'How Pulse AI works'],
  ['disclaimer', 'Disclaimer'],
  ['privacy', 'Privacy'],
  ['terms', 'Terms of use'],
  ['contact', 'Contact'],
];

const CONTENT = {
  about: {
    title: 'About Market Pulse',
    body: [
      'Market Pulse is a research and paper-trading platform for Indian equities listed on the NSE. It combines live market data, official exchange disclosures and machine-learning research in one place, so investors can study the market and practise with virtual money before risking their own.',
      'Every model we publish is tested on market data it never saw during development, and we keep testing it on live data after release. When an idea does not beat what we already have, we say so and do not ship it.',
    ],
  },
  'how-it-works': {
    title: 'How Pulse AI works',
    body: [
      'Pulse AI has two parts. A risk model estimates whether a stock’s price swings over the next 20 trading sessions will be larger or smaller than its normal level. It uses price ranges, India VIX, upcoming results dates from NSE board-meeting notices and option implied volatility. A ranking model estimates which stocks are more likely to outperform their peers; its edge is small, and we present it as a probability, never a certainty.',
      'The portfolio planner and the AI paper portfolios use both: they spread money across several stocks, give less weight to stocks with elevated risk, and rebalance on a fixed schedule rather than trading every day. Each AI portfolio is tracked against the NIFTY 50 from its first day.',
      'Models are refreshed after every market close. New ideas are tested against the live model on unseen data under rules written down before the test, and they replace it only if they do better.',
    ],
  },
  disclaimer: {
    title: 'Disclaimer',
    body: [
      'Market Pulse is for research, education and paper trading only. Nothing on this site is investment advice or a recommendation to buy, sell or hold any security. Market Pulse is not registered with SEBI as a Research Analyst or an Investment Adviser.',
      'Model outputs are statistical estimates that can be wrong. Past and simulated performance, including the AI paper portfolios, does not guarantee future results. Market data and news come from third parties and may be delayed, incomplete or inaccurate.',
      'Investing in securities carries risk, including the loss of capital. Consult a SEBI-registered adviser before making investment decisions.',
    ],
  },
  privacy: {
    title: 'Privacy',
    body: [
      'If you sign in, we store your account email and display name with our authentication provider, and your paper portfolio, watchlist and alerts on our server. Paper trades use virtual money; we never ask for bank, card or broker credentials.',
      'Questions you send to the Pulse AI research chat are passed, with the relevant market data, to Google’s Gemini service to write the answer. Do not include personal or sensitive information in your questions.',
      'Your theme and similar display preferences are kept in your browser. We do not sell personal data.',
    ],
  },
  terms: {
    title: 'Terms of use',
    body: [
      'Market Pulse is provided as is, for research and paper trading. Paper orders are simulated and never reach an exchange or a broker. You are responsible for any real investment decisions you make.',
      'Market data, exchange disclosures and news are the property of their respective sources and are shown for information only. Do not copy, resell or redistribute them from this site.',
      'We may change or discontinue features at any time. These terms will be updated before Market Pulse offers any service involving real money.',
    ],
  },
  contact: {
    title: 'Contact',
    body: [
      'Questions, feedback or a problem with the site? We would like to hear from you.',
    ],
  },
};

export default function InfoPage() {
  const { topic } = useParams();
  const page = CONTENT[topic];
  if (!page) return <Navigate to="/info/about" replace />;
  return (
    <div className="info-page page-container">
      <nav className="info-nav" aria-label="About Market Pulse">
        {INFO_PAGES.map(([id, label]) => <Link key={id} to={`/info/${id}`} className={id === topic ? 'is-active' : ''} aria-current={id === topic ? 'page' : undefined}>{label}</Link>)}
      </nav>
      <article className="info-article">
        <h1>{page.title}</h1>
        {page.body.map((p) => <p key={p.slice(0, 24)}>{p}</p>)}
        {topic === 'contact' && (CONTACT_EMAIL
          ? <p>Email us at <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We usually reply within two working days.</p>
          : <p>A contact address will be published here shortly.</p>)}
      </article>
    </div>
  );
}

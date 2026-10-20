// Primary navigation — rendered as the brand + route row of the top flight-deck bar.
import React from 'react';
import { NavLink, Link } from 'react-router-dom';
import BrandMark from '../components/common/BrandMark';

const NAV_ITEMS = [
  { name: 'Overview', path: '/dashboard' },
  { name: 'Markets', path: '/markets' },
  { name: 'Watchlist', path: '/watchlist' },
  { name: 'Portfolio', path: '/portfolio' },
  { name: 'Trade', path: '/trade' },
  { name: 'News', path: '/news' },
  { name: 'Polaris AI', path: '/ai', tag: 'AI' },
  { name: 'Alerts', path: '/alerts' },
  { name: 'Settings', path: '/settings' },
];

export function Sidebar() {
  return (
    <>
      <Link to="/dashboard" className="fd-brand" aria-label="Market Polaris overview">
        <BrandMark className="fd-brand-mark" />
        <span className="fd-brand-word">MARKET POLARIS</span>
      </Link>

      <nav className="fd-nav" aria-label="Main navigation">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => `fd-nav-link${isActive ? ' fd-nav-link--active' : ''}`}
          >
            {item.name}
            {item.tag && <span className="fd-nav-tag">{item.tag}</span>}
          </NavLink>
        ))}
      </nav>
    </>
  );
}

export default Sidebar;

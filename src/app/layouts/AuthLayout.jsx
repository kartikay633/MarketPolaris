// Auth layout — the intro's deep-space horizon behind a single terminal access panel.
import React from 'react';
import { Outlet, Link } from 'react-router-dom';
import BrandMark from '../components/common/BrandMark';

export default function AuthLayout() {
  return (
    <div className="auth-layout fd-auth">
      <div className="fd-hero-world" aria-hidden="true">
        <div className="fd-stars" />
        <div className="fd-floor" />
      </div>

      <div className="auth-brand">
        <Link to="/" className="auth-brand-link fd-brand" aria-label="Market Polaris home">
          <BrandMark className="fd-brand-mark" />
          <span className="fd-brand-word">MARKET POLARIS</span>
        </Link>
        <p className="auth-subtitle fd-lbl">Indian equities analytics &amp; intelligence</p>
      </div>

      <div className="auth-card">
        <Outlet />
      </div>

      <div className="auth-footer fd-lbl">
        Simulated execution · NSE / BSE live data
      </div>
    </div>
  );
}

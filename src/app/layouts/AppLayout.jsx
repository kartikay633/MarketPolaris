import React, { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import MarketTickerTape from '../components/market/MarketTickerTape';
import FloatingAIWidget from '../components/ai/FloatingAIWidget';

export default function AppLayout() {
  return (
    <div className="app-layout">
      <div className="app-main-wrapper">
        {/* Sticky flight-deck bar: brand, routes, terminal controls, live feed */}
        <div className="app-header-area">
          <div className="fd-bar">
            <Sidebar />
            <TopBar />
          </div>
          <MarketTickerTape />
        </div>
        <main className="app-main-content">
          <Suspense fallback={<div className="app-page-loading" aria-busy="true" />}>
            <Outlet />
          </Suspense>
        </main>
      </div>

      {/* Flagship Floating Pulse AI Assistant */}
      <FloatingAIWidget />
    </div>
  );
}

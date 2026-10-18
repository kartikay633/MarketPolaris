// ROADMAP: Section 3, 5 & 16 — Master App Router
import React, { lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';

import IntroPage from './app/pages/IntroPage';
import IntroLayout from './app/layouts/IntroLayout';
import AuthLayout from './app/layouts/AuthLayout';
import AppLayout from './app/layouts/AppLayout';
import LoginPage from './app/pages/LoginPage';
import SignupPage from './app/pages/SignupPage';
import OnboardingPage from './app/pages/OnboardingPage';
import AuthCallbackPage from './app/pages/AuthCallbackPage';
import ProtectedRoute from './app/components/common/ProtectedRoute';
import { useThemeStore } from './app/stores/themeStore';
import { useAuthStore } from './app/stores/authStore';

// Terminal pages load as separate chunks, then all are prefetched while the browser is idle,
// so the first screen arrives sooner and later page switches never wait on a download.
const pageLoaders = {
  DashboardPage: () => import('./app/pages/DashboardPage'),
  MarketsPage: () => import('./app/pages/MarketsPage'),
  StockDetailPage: () => import('./app/pages/StockDetailPage'),
  NewsPage: () => import('./app/pages/NewsPage'),
  AIPage: () => import('./app/pages/AIPage'),
  WatchlistPage: () => import('./app/pages/WatchlistPage'),
  PortfolioPage: () => import('./app/pages/PortfolioPage'),
  TradePage: () => import('./app/pages/TradePage'),
  AlertsPage: () => import('./app/pages/AlertsPage'),
  SettingsPage: () => import('./app/pages/SettingsPage'),
};
const DashboardPage = lazy(pageLoaders.DashboardPage);
const MarketsPage = lazy(pageLoaders.MarketsPage);
const StockDetailPage = lazy(pageLoaders.StockDetailPage);
const NewsPage = lazy(pageLoaders.NewsPage);
const AIPage = lazy(pageLoaders.AIPage);
const WatchlistPage = lazy(pageLoaders.WatchlistPage);
const PortfolioPage = lazy(pageLoaders.PortfolioPage);
const TradePage = lazy(pageLoaders.TradePage);
const AlertsPage = lazy(pageLoaders.AlertsPage);
const SettingsPage = lazy(pageLoaders.SettingsPage);
function prefetchPages() {
  const run = () => Object.values(pageLoaders).forEach((load) => load().catch(() => {}));
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 3000 });
  else setTimeout(run, 1500);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15 * 1000,
      retry: 2,
      refetchOnWindowFocus: true,
    },
  },
});

export default function App() {
  const theme = useThemeStore((state) => state.theme);
  useEffect(() => {
    useAuthStore.getState().initialize();
    prefetchPages();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* Intro Animation (Root Route) */}
          <Route element={<IntroLayout />}>
            <Route path="/" element={<IntroPage />} />
          </Route>

          {/* Authentication Routes */}
          <Route element={<AuthLayout />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
          </Route>

          {/* OAuth Callback Route */}
          <Route path="/auth/callback" element={<AuthCallbackPage />} />

          {/* Onboarding Flow (Protected) */}
          <Route
            path="/onboarding"
            element={
              <ProtectedRoute>
                <OnboardingPage />
              </ProtectedRoute>
            }
          />

          {/* Protected Application Terminal (AppLayout with Sidebar & TopBar) */}
          <Route
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/markets" element={<MarketsPage />} />
            <Route path="/stocks/:symbol" element={<StockDetailPage />} />

            {/* Phase 6 Watchlist, Portfolio & Paper Trading */}
            <Route path="/watchlist" element={<WatchlistPage />} />
            <Route path="/portfolio" element={<PortfolioPage />} />
            <Route path="/trade" element={<TradePage />} />
            <Route path="/news" element={<NewsPage />} />
            <Route path="/ai" element={<AIPage />} />
            {/* Phase 7 Alerts, Settings & Heatmap */}
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster theme={theme} position="top-right" richColors />
    </QueryClientProvider>
  );
}

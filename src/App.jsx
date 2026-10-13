// ROADMAP: Section 3, 5 & 16 — Master App Router
import React, { useEffect } from 'react';
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
import DashboardPage from './app/pages/DashboardPage';
import MarketsPage from './app/pages/MarketsPage';
import StockDetailPage from './app/pages/StockDetailPage';
import NewsPage from './app/pages/NewsPage';
import AIPage from './app/pages/AIPage';
import WatchlistPage from './app/pages/WatchlistPage';
import PortfolioPage from './app/pages/PortfolioPage';
import TradePage from './app/pages/TradePage';
import AlertsPage from './app/pages/AlertsPage';
import SettingsPage from './app/pages/SettingsPage';
import AuthCallbackPage from './app/pages/AuthCallbackPage';
import ProtectedRoute from './app/components/common/ProtectedRoute';
import { useThemeStore } from './app/stores/themeStore';
import { useAuthStore } from './app/stores/authStore';

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

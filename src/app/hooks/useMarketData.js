// ROADMAP: Section 5 & Phase 2 — Market Data React Query Hooks
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

export function useMarketOverview() {
  return useQuery({
    queryKey: ['market', 'overview'],
    queryFn: async () => {
      const res = await api.get('/market/overview');
      return res.data;
    },
    refetchInterval: (query) => {
      // 15 seconds if market open, 60 seconds if closed
      const isLive = query.state.data?.status === 'OPEN';
      return isLive ? 15000 : 60000;
    },
    staleTime: 10000,
  });
}

export function useIndices() {
  return useQuery({
    queryKey: ['market', 'indices'],
    queryFn: async () => {
      const res = await api.get('/market/indices');
      return res.data?.indices || [];
    },
    refetchInterval: 15000,
    staleTime: 10000,
  });
}

export function useGainers(limit = 10) {
  return useQuery({
    queryKey: ['market', 'gainers', limit],
    queryFn: async () => {
      const res = await api.get(`/market/gainers?limit=${limit}`);
      return res.data?.gainers || [];
    },
    refetchInterval: 30000,
    staleTime: 15000,
  });
}

export function useLosers(limit = 10) {
  return useQuery({
    queryKey: ['market', 'losers', limit],
    queryFn: async () => {
      const res = await api.get(`/market/losers?limit=${limit}`);
      return res.data?.losers || [];
    },
    refetchInterval: 30000,
    staleTime: 15000,
  });
}

export function useActive(limit = 10) {
  return useQuery({
    queryKey: ['market', 'active', limit],
    queryFn: async () => {
      const res = await api.get(`/market/active?limit=${limit}`);
      return res.data?.active || [];
    },
    refetchInterval: 30000,
    staleTime: 15000,
  });
}

// Every covered stock from the market snapshot: { source, asOf, session, stocks }
export function useMarketStocks() {
  return useQuery({
    queryKey: ['market', 'stocks'],
    queryFn: async () => {
      const res = await api.get('/market/stocks');
      return res.data;
    },
    refetchInterval: 30000,
    staleTime: 15000,
  });
}

// Shared query options so useQueries callers reuse the ['stock', symbol] cache
export function stockQuoteQuery(symbol) {
  return {
    queryKey: ['stock', symbol],
    queryFn: async () => {
      if (!symbol) return null;
      const res = await api.get(`/stocks/${encodeURIComponent(symbol)}`);
      return res.data;
    },
    enabled: Boolean(symbol),
    staleTime: 15000,
  };
}

export function useStockQuote(symbol) {
  return useQuery(stockQuoteQuery(symbol));
}

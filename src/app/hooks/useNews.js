// News hooks: the company news wire (NSE filings + publisher stories), its trader panels, and per-stock news.
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

// category: 'all' or an event type (results, orders, deals, management, legal, capital, ratings, corporate, operations, exchange, views).
export function useMarketNews(category = 'all', limit = 30, { kind, materiality, days, q } = {}) {
  return useQuery({
    queryKey: ['news', 'wire', category, limit, kind || '', materiality || '', days || 2, q || ''],
    queryFn: async () => {
      const res = await api.get('/news', { params: { category, limit, kind, materiality, days, q: q || undefined } });
      return res.data?.articles || [];
    },
    staleTime: 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
    placeholderData: (previous) => previous,
  });
}

export function useNewsPulse() {
  return useQuery({
    queryKey: ['news', 'pulse'],
    queryFn: async () => (await api.get('/news/pulse')).data,
    staleTime: 60 * 1000,
    refetchInterval: 3 * 60 * 1000,
  });
}

export function useStockNews(symbol, limit = 6) {
  return useQuery({
    queryKey: ['news', 'stock', symbol, limit],
    queryFn: async () => {
      if (!symbol) return [];
      const res = await api.get(`/stocks/${encodeURIComponent(symbol)}/news?limit=${limit}`);
      return res.data?.articles || [];
    },
    enabled: Boolean(symbol),
    staleTime: 5 * 60 * 1000,
  });
}

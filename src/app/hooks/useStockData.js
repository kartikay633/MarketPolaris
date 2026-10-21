// ROADMAP: Section 5 & Phase 3 — Stock Data React Query Hooks
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../services/api';

export function useStockQuote(symbol) {
  return useQuery({
    queryKey: ['stock', 'quote', symbol],
    queryFn: async () => {
      if (!symbol) return null;
      const res = await api.get(`/stocks/${encodeURIComponent(symbol)}`);
      return res.data;
    },
    enabled: Boolean(symbol),
    staleTime: 15000,
    refetchInterval: 15000,
  });
}

export function useStockHistory(symbol, interval = '1D') {
  return useQuery({
    queryKey: ['stock', 'history', symbol, interval],
    queryFn: async () => {
      if (!symbol) return [];
      const res = await api.get(`/stocks/${encodeURIComponent(symbol)}/history?interval=${interval}`);
      return res.data?.candles || [];
    },
    enabled: Boolean(symbol),
    staleTime: 30000,
    refetchOnWindowFocus: false,
    // The one-day chart is today's session, so it keeps drawing new minutes (the server caches it for 60 s while open).
    refetchInterval: interval === '1D' ? 60000 : false,
  });
}

// Calendar days fetched per older page when a chart is zoomed or scrolled back past its data.
const OLDER_PAGE_DAYS = { '1D': 4, '1W': 14, '1M': 120, '6M': 365, '1Y': 730, '5Y': 1825 };
const MAX_CANDLES = 25000;
const istDate = (unixSeconds, shiftDays = 0) =>
  new Date((unixSeconds + 19800) * 1000 + shiftDays * 86400000).toISOString().slice(0, 10);

// The latest window of candles plus older pages loaded on demand (zooming out or scrolling left).
// Empty pages are skipped up to three times (weekends, holidays) before history counts as exhausted.
export function useCandleHistory(symbol, interval = '1D') {
  const latest = useStockHistory(symbol, interval);
  const [older, setOlder] = useState([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const busy = useRef(false);
  const key = `${symbol}|${interval}`;
  const keyRef = useRef(key);

  useEffect(() => {
    keyRef.current = key;
    setOlder([]);
    setExhausted(false);
    busy.current = false;
    setLoadingOlder(false);
  }, [key]);

  const candles = useMemo(() => {
    const base = latest.data || [];
    if (!older.length) return base;
    const seen = new Set(base.map((c) => c.time));
    return [...older.filter((c) => !seen.has(c.time)), ...base].sort((a, b) => a.time - b.time);
  }, [latest.data, older]);

  const loadOlder = useCallback(async () => {
    if (busy.current || exhausted || !symbol || !candles.length || candles.length >= MAX_CANDLES) return;
    busy.current = true;
    setLoadingOlder(true);
    const requestKey = keyRef.current;
    const span = OLDER_PAGE_DAYS[interval] || 120;
    let end = candles[0].time;
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const to = istDate(end, -1);
        const from = istDate(end, -span);
        const res = await api.get(`/stocks/${encodeURIComponent(symbol)}/history`, { params: { interval, from, to } });
        if (keyRef.current !== requestKey) return;
        const page = (res.data?.candles || []).filter((c) => c.time < candles[0].time);
        if (page.length) {
          setOlder((prev) => [...page, ...prev]);
          return;
        }
        end -= span * 86400;
      }
      setExhausted(true);
    } catch {
      setExhausted(true);
    } finally {
      if (keyRef.current === requestKey) {
        busy.current = false;
        setLoadingOlder(false);
      }
    }
  }, [symbol, interval, candles, exhausted]);

  return { candles, isLoading: latest.isLoading, loadOlder, loadingOlder, exhausted };
}

export function useStockSearch(query, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['stock', 'search', query],
    queryFn: async () => {
      const res = await api.get(`/search?q=${encodeURIComponent(query || '')}`);
      return res.data?.results || [];
    },
    enabled,
    staleTime: 60000,
    placeholderData: (previous) => previous,
  });
}

// ROADMAP: Section 5 & 12 — Price Alerts React Query Hooks
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../services/api';
import { toast } from 'sonner';

export function useAlerts() {
  return useQuery({
    queryKey: ['alerts'],
    queryFn: async () => {
      const res = await api.get('/alerts');
      return res.data?.alerts || [];
    },
    staleTime: 10000,
    refetchInterval: 30000, // shared by the top bar's alert bell on every page
  });
}

export function useCreateAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ symbol, targetPrice, condition, note }) => {
      const res = await api.post('/alerts', { symbol, targetPrice, condition, note });
      return res.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      toast.success(`Alert set for ${variables.symbol} when price goes ${variables.condition} ₹${variables.targetPrice}`);
    },
    onError: (err) => {
      toast.error(err.response?.data?.error || 'Failed to create price alert');
    },
  });
}

export function useDeleteAlert() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (alertId) => {
      const res = await api.delete(`/alerts/${alertId}`);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
      toast.info('Price alert deleted');
    },
    onError: (err) => {
      toast.error(err.response?.data?.error || 'Failed to delete alert');
    },
  });
}

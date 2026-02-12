/**
 * Panel state management hook.
 *
 * Combines data fetching with panel-specific state (refresh, loading, error, timeframe).
 */
import { useState, useCallback } from 'react';
import { useApi } from './useApi';
import type { PanelStatus } from '../../types';

interface UsePanelOptions {
  endpoint: string;
  refreshInterval?: number;
  defaultTimeframe?: string;
  params?: Record<string, any>;
}

interface UsePanelResult<T = any> {
  data: T | null;
  status: PanelStatus;
  error: string | null;
  lastFetched: string | null;
  isStale: boolean;
  loading: boolean;
  refetch: () => Promise<void>;
  timeframe: string;
  setTimeframe: (tf: string) => void;
}

export function usePanel<T = any>(options: UsePanelOptions): UsePanelResult<T> {
  const [timeframe, setTimeframe] = useState(options.defaultTimeframe || '1y');

  const { data, loading, error, lastFetched, isStale, refetch } = useApi<T>(
    options.endpoint,
    {
      refreshInterval: options.refreshInterval,
      params: { ...options.params, period: timeframe },
    }
  );

  const status: PanelStatus = error
    ? 'error'
    : loading
    ? 'loading'
    : isStale
    ? 'stale'
    : 'connected';

  return {
    data,
    status,
    error,
    lastFetched,
    isStale,
    loading,
    refetch,
    timeframe,
    setTimeframe,
  };
}

export default usePanel;

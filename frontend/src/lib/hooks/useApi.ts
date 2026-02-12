/**
 * Data fetching hook — migrated from original useApi.js with TypeScript types.
 *
 * Provides automatic polling, WebSocket real-time updates, stale detection,
 * and manual refetch capabilities.
 */
import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
});

interface UseApiOptions {
  refreshInterval?: number | null;
  enabled?: boolean;
  params?: Record<string, any>;
  onSuccess?: (data: any) => void;
  onError?: (err: any) => void;
}

interface UseApiResult<T = any> {
  data: T | null;
  loading: boolean;
  error: string | null;
  lastFetched: string | null;
  isStale: boolean;
  refetch: () => Promise<void>;
}

export function useApi<T = any>(endpoint: string, options: UseApiOptions = {}): UseApiResult<T> {
  const {
    refreshInterval = null,
    enabled = true,
    params = {},
    onSuccess = null,
    onError = null,
  } = options;

  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetched, setLastFetched] = useState<string | null>(null);
  const [isStale, setIsStale] = useState(false);

  const fetchData = useCallback(async () => {
    if (!enabled) return;

    try {
      setLoading(true);
      const response = await api.get(endpoint, { params });
      setData(response.data);
      setLastFetched(response.data.fetchedAt || new Date().toISOString());
      setIsStale(response.data.stale || false);
      setError(null);
      if (onSuccess) onSuccess(response.data);
    } catch (err: any) {
      console.error(`API Error (${endpoint}):`, err);
      setError(err.response?.data?.error || err.message);
      if (onError) onError(err);
    } finally {
      setLoading(false);
    }
  }, [endpoint, enabled, JSON.stringify(params)]);

  useEffect(() => {
    fetchData();

    if (refreshInterval) {
      const interval = setInterval(fetchData, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [fetchData, refreshInterval]);

  // Listen for WebSocket updates
  useEffect(() => {
    const handleWsUpdate = (event: CustomEvent) => {
      const { type, data: wsData } = event.detail;
      if (type === endpoint.replace(/\//g, '-')) {
        setData(wsData);
        setLastFetched(new Date().toISOString());
      }
    };

    window.addEventListener('ws-update', handleWsUpdate as EventListener);
    return () => window.removeEventListener('ws-update', handleWsUpdate as EventListener);
  }, [endpoint]);

  return {
    data,
    loading,
    error,
    lastFetched,
    isStale,
    refetch: fetchData,
  };
}

export async function postApi(endpoint: string, data: any) {
  const response = await api.post(endpoint, data);
  return response.data;
}

export async function putApi(endpoint: string, data: any) {
  const response = await api.put(endpoint, data);
  return response.data;
}

export async function deleteApi(endpoint: string) {
  const response = await api.delete(endpoint);
  return response.data;
}

export default api;

import { useState, useEffect, useCallback } from 'react';

// Re-use the single shared axios instance so auth interceptors work everywhere.
// AuthContext sets up Bearer-token interceptors on this instance at login time.
import api from '../lib/hooks/useApi';

export function useApi(endpoint, options = {}) {
  const {
    refreshInterval = null,
    enabled = true,
    params = {},
    onSuccess = null,
    onError = null
  } = options;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);
  const [isStale, setIsStale] = useState(false);

  const fetchData = useCallback(async () => {
    if (!enabled || !endpoint) return;

    try {
      setLoading(true);
      const response = await api.get(endpoint, { params });
      setData(response.data);
      setLastFetched(response.data.fetchedAt || new Date().toISOString());
      setIsStale(response.data.stale || false);
      setError(null);
      if (onSuccess) onSuccess(response.data);
    } catch (err) {
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
    if (!endpoint) return;

    const handleWsUpdate = (event) => {
      const { type, data: wsData } = event.detail;
      if (type === endpoint.replace(/\//g, '-')) {
        setData(wsData);
        setLastFetched(new Date().toISOString());
      }
    };

    window.addEventListener('ws-update', handleWsUpdate);
    return () => window.removeEventListener('ws-update', handleWsUpdate);
  }, [endpoint]);

  return {
    data,
    loading,
    error,
    lastFetched,
    isStale,
    refetch: fetchData
  };
}

export async function postApi(endpoint, data) {
  const response = await api.post(endpoint, data);
  return response.data;
}

export async function putApi(endpoint, data) {
  const response = await api.put(endpoint, data);
  return response.data;
}

export async function deleteApi(endpoint) {
  const response = await api.delete(endpoint);
  return response.data;
}

export default api;

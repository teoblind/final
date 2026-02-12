import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

// In production, use the same origin. In dev, Vite proxy handles /api
const API_BASE = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000
});

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
    if (!enabled) return;

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

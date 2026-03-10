import { useApi } from './useApi';

const BASE = '/v1/ercot/lmp';

export function useCurrentLmp(node = 'HB_NORTH') {
  return useApi(`${BASE}/current`, {
    params: { node },
    refreshInterval: 30000,
  });
}

export function useIntradayLmp(node = 'HB_NORTH', date = null, days = 0) {
  const params = { node };
  if (date) params.date = date;
  if (days > 1) params.days = days;
  return useApi(`${BASE}/intraday`, { params, refreshInterval: 300000 });
}

export function useHeatmapLmp(node = 'HB_NORTH', days = 7) {
  return useApi(`${BASE}/heatmap`, {
    params: { node, days },
    refreshInterval: 3600000,
  });
}

export function useLmpStats(node = 'HB_NORTH', days = 30) {
  return useApi(`${BASE}/stats`, {
    params: { node, days },
    refreshInterval: 3600000,
  });
}

export function useLmpNodes(filter = null) {
  const params = {};
  if (filter) params.filter = filter;
  return useApi(`${BASE}/nodes`, {
    params,
    refreshInterval: 30000,
  });
}

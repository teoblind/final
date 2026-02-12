/**
 * Data Connector Registry
 *
 * Each external data source gets a connector with a consistent interface.
 * All connectors proxy through the backend API — the frontend never calls
 * external APIs directly.
 */

import type { DataConnector, ConnectorStatus } from '../types';
import api from '../../hooks/useApi';

// Connector implementations that proxy through the backend
function createApiConnector(config: {
  id: string;
  name: string;
  endpoint: string;
  refreshInterval: number;
  healthEndpoint?: string;
}): DataConnector {
  return {
    id: config.id,
    name: config.name,
    refreshInterval: config.refreshInterval,

    async fetch(params?: Record<string, any>) {
      const response = await api.get(config.endpoint, { params });
      return {
        data: response.data,
        fetchedAt: response.data.fetchedAt || new Date().toISOString(),
        stale: response.data.stale || false,
        cached: response.data.cached || false,
        source: config.name,
      };
    },

    async healthCheck() {
      try {
        const endpoint = config.healthEndpoint || config.endpoint;
        await api.get(endpoint, { timeout: 5000 });
        return true;
      } catch {
        return false;
      }
    },
  };
}

// Register all connectors (matching existing backend API routes)
export const connectors: Record<string, DataConnector> = {
  hashprice: createApiConnector({
    id: 'hashprice',
    name: 'CoinGecko + Blockchain.info',
    endpoint: '/hashprice',
    refreshInterval: 15 * 60 * 1000,
  }),

  yahooFinance: createApiConnector({
    id: 'yahoo-finance',
    name: 'Yahoo Finance',
    endpoint: '/yahoo/eu-us-ratio',
    refreshInterval: 5 * 60 * 1000,
  }),

  bitcoinReserve: createApiConnector({
    id: 'bitcoin-reserve',
    name: 'Blockchain.info + DOJ/Treasury',
    endpoint: '/bitcoin/reserve',
    refreshInterval: 30 * 60 * 1000,
  }),

  japan: createApiConnector({
    id: 'japan',
    name: 'FRED + Bank of Japan',
    endpoint: '/japan',
    refreshInterval: 30 * 60 * 1000,
  }),

  uranium: createApiConnector({
    id: 'uranium',
    name: 'Manual Entry',
    endpoint: '/uranium',
    refreshInterval: 60 * 60 * 1000,
  }),

  pmi: createApiConnector({
    id: 'pmi',
    name: 'Trading Economics + Manual',
    endpoint: '/pmi',
    refreshInterval: 60 * 60 * 1000,
  }),

  rareEarth: createApiConnector({
    id: 'rare-earth',
    name: 'Asian Metal + Manual',
    endpoint: '/rareearth',
    refreshInterval: 60 * 60 * 1000,
  }),

  correlation: createApiConnector({
    id: 'correlation',
    name: 'Calculated',
    endpoint: '/correlation',
    refreshInterval: 24 * 60 * 60 * 1000,
  }),

  liquidity: createApiConnector({
    id: 'liquidity',
    name: 'FRED + Yahoo + CoinGecko',
    endpoint: '/liquidity',
    refreshInterval: 5 * 60 * 1000,
  }),

  brazil: createApiConnector({
    id: 'brazil',
    name: 'Yahoo Finance + FRED',
    endpoint: '/brazil',
    refreshInterval: 30 * 60 * 1000,
  }),

  iran: createApiConnector({
    id: 'iran',
    name: 'Blockchain.info + Manual',
    endpoint: '/iran',
    refreshInterval: 60 * 60 * 1000,
  }),

  trade: createApiConnector({
    id: 'trade',
    name: 'Manual Entry',
    endpoint: '/trade',
    refreshInterval: 60 * 60 * 1000,
  }),

  datacenter: createApiConnector({
    id: 'datacenter',
    name: 'Company Announcements',
    endpoint: '/datacenter',
    refreshInterval: 60 * 60 * 1000,
  }),

  // Phase 2: Energy Market connectors
  energyRealtime: createApiConnector({
    id: 'energy-realtime',
    name: 'ERCOT Real-Time',
    endpoint: '/energy/realtime',
    refreshInterval: 5 * 60 * 1000,
  }),

  energyDayAhead: createApiConnector({
    id: 'energy-dayahead',
    name: 'ERCOT Day-Ahead',
    endpoint: '/energy/dayahead',
    refreshInterval: 15 * 60 * 1000,
  }),

  energyHistory: createApiConnector({
    id: 'energy-history',
    name: 'ERCOT Historical',
    endpoint: '/energy/history',
    refreshInterval: 15 * 60 * 1000,
  }),

  energyLoad: createApiConnector({
    id: 'energy-load',
    name: 'ERCOT System Load',
    endpoint: '/energy/load',
    refreshInterval: 5 * 60 * 1000,
  }),

  energyFuelmix: createApiConnector({
    id: 'energy-fuelmix',
    name: 'EIA / ERCOT Fuel Mix',
    endpoint: '/energy/fuelmix',
    refreshInterval: 15 * 60 * 1000,
  }),
};

/**
 * Check health of all connectors
 */
export async function checkAllConnectors(): Promise<ConnectorStatus[]> {
  const results = await Promise.allSettled(
    Object.values(connectors).map(async (connector) => {
      const healthy = await connector.healthCheck();
      return {
        id: connector.id,
        name: connector.name,
        healthy,
        lastCheck: Date.now(),
      };
    })
  );

  return results.map((r, i) => {
    const connector = Object.values(connectors)[i];
    if (r.status === 'fulfilled') return r.value;
    return {
      id: connector.id,
      name: connector.name,
      healthy: false,
      lastCheck: Date.now(),
      lastError: r.reason?.message,
    };
  });
}

export default connectors;

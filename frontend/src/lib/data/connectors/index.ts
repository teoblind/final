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

  // Phase 3: Fleet Hashprice connectors
  fleetProfitability: createApiConnector({
    id: 'fleet-profitability',
    name: 'Fleet Hashprice Engine',
    endpoint: '/fleet/profitability',
    refreshInterval: 5 * 60 * 1000,
  }),

  fleetNetwork: createApiConnector({
    id: 'fleet-network',
    name: 'Blockchain.info + CoinGecko + Mempool',
    endpoint: '/fleet/network',
    refreshInterval: 10 * 60 * 1000,
  }),

  fleetBreakeven: createApiConnector({
    id: 'fleet-breakeven',
    name: 'Fleet Breakeven Calculator',
    endpoint: '/fleet/breakeven',
    refreshInterval: 5 * 60 * 1000,
  }),

  fleetDifficulty: createApiConnector({
    id: 'fleet-difficulty',
    name: 'Blockchain.info Difficulty',
    endpoint: '/fleet/difficulty',
    refreshInterval: 10 * 60 * 1000,
  }),

  fleetHistory: createApiConnector({
    id: 'fleet-history',
    name: 'Hashprice History',
    endpoint: '/fleet/history',
    refreshInterval: 30 * 60 * 1000,
  }),

  // Phase 4: Curtailment connectors
  curtailmentRecommendation: createApiConnector({
    id: 'curtailment-recommendation',
    name: 'Curtailment Engine',
    endpoint: '/curtailment/recommendation',
    refreshInterval: 60 * 1000,
  }),

  curtailmentSchedule: createApiConnector({
    id: 'curtailment-schedule',
    name: 'DAM + Curtailment Engine',
    endpoint: '/curtailment/schedule',
    refreshInterval: 15 * 60 * 1000,
  }),

  curtailmentSavings: createApiConnector({
    id: 'curtailment-savings',
    name: 'Curtailment Event Log',
    endpoint: '/curtailment/savings',
    refreshInterval: 5 * 60 * 1000,
  }),

  curtailmentEfficiency: createApiConnector({
    id: 'curtailment-efficiency',
    name: 'Fleet Merit Order',
    endpoint: '/curtailment/efficiency',
    refreshInterval: 60 * 1000,
  }),

  // Phase 5: Pool & On-Chain connectors
  poolUnified: createApiConnector({
    id: 'pool-unified',
    name: 'Mining Pool Aggregator',
    endpoint: '/pools/unified',
    refreshInterval: 60 * 1000,
  }),

  poolEarnings: createApiConnector({
    id: 'pool-earnings',
    name: 'Pool Earnings',
    endpoint: '/pools/earnings',
    refreshInterval: 5 * 60 * 1000,
  }),

  poolWorkers: createApiConnector({
    id: 'pool-workers',
    name: 'Worker Fleet',
    endpoint: '/pools/workers',
    refreshInterval: 60 * 1000,
  }),

  poolComparison: createApiConnector({
    id: 'pool-comparison',
    name: 'Pool Comparison',
    endpoint: '/pools/comparison',
    refreshInterval: 10 * 60 * 1000,
  }),

  chainMempool: createApiConnector({
    id: 'chain-mempool',
    name: 'Mempool.space',
    endpoint: '/chain/mempool',
    refreshInterval: 30 * 1000,
  }),

  chainFees: createApiConnector({
    id: 'chain-fees',
    name: 'Fee Estimates',
    endpoint: '/chain/fees',
    refreshInterval: 30 * 1000,
  }),

  chainBlocks: createApiConnector({
    id: 'chain-blocks',
    name: 'Recent Blocks',
    endpoint: '/chain/blocks',
    refreshInterval: 60 * 1000,
  }),

  diagnostics: createApiConnector({
    id: 'diagnostics',
    name: 'Fleet Diagnostics',
    endpoint: '/diagnostics/summary',
    refreshInterval: 5 * 60 * 1000,
  }),

  // Phase 6: Agent Framework
  agentList: createApiConnector({
    id: 'agentList',
    name: 'Agent List',
    endpoint: '/agents',
    refreshInterval: 10 * 1000,
  }),

  agentSystemStatus: createApiConnector({
    id: 'agentSystemStatus',
    name: 'Agent System Status',
    endpoint: '/agents/system-status',
    refreshInterval: 10 * 1000,
  }),

  agentApprovals: createApiConnector({
    id: 'agentApprovals',
    name: 'Agent Approvals',
    endpoint: '/agents/approvals',
    refreshInterval: 10 * 1000,
  }),

  agentActivity: createApiConnector({
    id: 'agentActivity',
    name: 'Agent Activity Feed',
    endpoint: '/agents/activity',
    refreshInterval: 10 * 1000,
  }),

  agentPerformance: createApiConnector({
    id: 'agentPerformance',
    name: 'Agent Performance',
    endpoint: '/agents/performance',
    refreshInterval: 60 * 1000,
  }),

  notifications: createApiConnector({
    id: 'notifications',
    name: 'Notifications',
    endpoint: '/notifications',
    refreshInterval: 10 * 1000,
  }),

  // Phase 7: HPC / AI Compute connectors
  workloadSiteOverview: createApiConnector({
    id: 'workload-site-overview',
    name: 'Site Overview',
    endpoint: '/workloads/site-overview',
    refreshInterval: 30 * 1000,
  }),

  workloadComparison: createApiConnector({
    id: 'workload-comparison',
    name: 'Workload Economics',
    endpoint: '/workloads/comparison',
    refreshInterval: 60 * 1000,
  }),

  hpcContracts: createApiConnector({
    id: 'hpc-contracts',
    name: 'HPC Contracts',
    endpoint: '/hpc/contracts',
    refreshInterval: 60 * 1000,
  }),

  gpuModels: createApiConnector({
    id: 'gpu-models',
    name: 'GPU Model Database',
    endpoint: '/gpu/models',
    refreshInterval: 3600 * 1000,
  }),

  gpuFleet: createApiConnector({
    id: 'gpu-fleet',
    name: 'GPU Fleet Config',
    endpoint: '/gpu/fleet',
    refreshInterval: 60 * 1000,
  }),

  hpcSlaSummary: createApiConnector({
    id: 'hpc-sla-summary',
    name: 'HPC SLA Summary',
    endpoint: '/hpc/sla/summary',
    refreshInterval: 60 * 1000,
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

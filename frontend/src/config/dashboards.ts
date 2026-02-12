import type { DashboardView } from '../types';

/**
 * Dashboard Layout Configuration
 *
 * Defines which panels appear in each dashboard view and their arrangement.
 * Panel IDs reference entries in the panel registry (config/panels.ts).
 */

export interface DashboardConfig {
  id: DashboardView;
  label: string;
  shortLabel: string;
  icon: string;
  description: string;
  panels: string[];
}

export const dashboards: DashboardConfig[] = [
  {
    id: 'operations',
    label: 'Operations',
    shortLabel: 'Ops',
    icon: 'Activity',
    description: 'Mining operations control center',
    panels: [
      'energy-market',
      'fleet-hashprice',
      'curtailment-optimizer',
      'pool-monitor',
      'agent-status',
    ],
  },
  {
    id: 'macro',
    label: 'Macro Intelligence',
    shortLabel: 'Macro',
    icon: 'TrendingUp',
    description: 'Macro thesis tracking and analysis',
    panels: [
      'hashprice',
      'eu-us-ratio',
      'btc-reserve',
      'fiber',
      'japan',
      'uranium',
      'brazil',
      'pmi',
      'rare-earth',
      'iran-hashrate',
      'trade-routes',
      'datacenter',
    ],
  },
];

export function getDashboard(id: DashboardView): DashboardConfig | undefined {
  return dashboards.find(d => d.id === id);
}

export default dashboards;

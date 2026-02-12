import { lazy } from 'react';
import type { PanelRegistryEntry } from '../types';

/**
 * Panel Registry — Single source of truth for all panels in Sangha MineOS.
 *
 * To add a new panel:
 * 1. Create the panel component in src/components/panels/<category>/
 * 2. Add a registry entry here
 * 3. Add the panel ID to a dashboard layout in dashboards.ts
 */

// Phase 1: Existing macro panels (migrated from original dashboard)
const MacroPanels: PanelRegistryEntry[] = [
  {
    id: 'hashprice',
    title: 'Bitcoin Hashprice',
    subtitle: '$/TH/s/day mining profitability',
    category: 'macro',
    component: lazy(() => import('../components/panels/macro/HashpricePanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 1,
    status: 'active',
    icon: '⛏',
  },
  {
    id: 'eu-us-ratio',
    title: 'EU vs US Tech Relative Strength',
    subtitle: 'STOXX 600 Tech / NDX ratio',
    category: 'macro',
    component: lazy(() => import('../components/panels/macro/EuUsRatioPanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 1,
    status: 'active',
    icon: '📊',
  },
  {
    id: 'btc-reserve',
    title: 'US Strategic Bitcoin Reserve',
    subtitle: 'Government wallet tracking',
    category: 'macro',
    component: lazy(() => import('../components/panels/macro/BtcReservePanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 1,
    status: 'active',
    icon: '🏛',
  },
  {
    id: 'fiber',
    title: 'Optical Fiber & AI Infrastructure',
    subtitle: 'GLW/QQQ ratio + fiber basket',
    category: 'macro',
    component: lazy(() => import('../components/panels/macro/FiberPanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 1,
    status: 'active',
    icon: '🔌',
  },
  {
    id: 'japan',
    title: 'Japan Macro',
    subtitle: 'JGB yield curve + NIIP',
    category: 'macro',
    component: lazy(() => import('../components/panels/macro/JapanPanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 1,
    status: 'active',
    icon: '🇯🇵',
  },
  {
    id: 'uranium',
    title: 'Uranium Spot & Term',
    subtitle: 'U3O8 price tracking',
    category: 'macro',
    component: lazy(() => import('../components/panels/macro/UraniumPanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 1,
    status: 'active',
    icon: '☢',
  },
  {
    id: 'brazil',
    title: 'Brazil Green Compute',
    subtitle: 'EWZ/SPY + energy surplus',
    category: 'macro',
    component: lazy(() => import('../components/panels/macro/BrazilPanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 1,
    status: 'active',
    icon: '🇧🇷',
  },
  {
    id: 'pmi',
    title: 'Global Manufacturing PMI',
    subtitle: 'Regional PMI heatmap',
    category: 'macro',
    component: lazy(() => import('../components/panels/macro/PmiPanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 1,
    status: 'active',
    icon: '🏭',
  },
  {
    id: 'rare-earth',
    title: 'Rare Earth Oxide Prices',
    subtitle: 'NdPr, Dy, Tb, Ce tracking',
    category: 'macro',
    component: lazy(() => import('../components/panels/macro/RareEarthPanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 1,
    status: 'active',
    icon: '⚗',
  },
  {
    id: 'iran-hashrate',
    title: 'Iran Hashrate Share',
    subtitle: 'Geographic hashrate distribution',
    category: 'macro',
    component: lazy(() => import('../components/panels/macro/IranHashratePanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 1,
    status: 'active',
    icon: '🌍',
  },
  {
    id: 'trade-routes',
    title: 'Trade Routes & Chokepoints',
    subtitle: 'Suez Canal + IMEC tracking',
    category: 'macro',
    component: lazy(() => import('../components/panels/macro/TradeRoutesPanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 1,
    status: 'active',
    icon: '🚢',
  },
  {
    id: 'datacenter',
    title: 'Data Center Power & Infrastructure',
    subtitle: 'Regional capacity + deals',
    category: 'macro',
    component: lazy(() => import('../components/panels/macro/DatacenterPanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 1,
    status: 'active',
    icon: '🏗',
  },
];

// Phase 2: Energy Market panels (active)
const EnergyPanels: PanelRegistryEntry[] = [
  {
    id: 'energy-price',
    title: 'Energy Price',
    subtitle: 'Real-time ERCOT LMP + grid status',
    category: 'energy',
    component: lazy(() => import('../components/panels/energy/EnergyPricePanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 2,
    status: 'active',
    icon: '⚡',
  },
  {
    id: 'day-ahead',
    title: 'Day-Ahead Prices',
    subtitle: 'Hourly DAM curve with mining windows',
    category: 'energy',
    component: lazy(() => import('../components/panels/energy/DayAheadPanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 2,
    status: 'active',
    icon: '📈',
  },
  {
    id: 'price-heatmap',
    title: 'Price Heatmap',
    subtitle: 'Hour × day LMP patterns',
    category: 'energy',
    component: lazy(() => import('../components/panels/energy/PriceHeatmapPanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 2,
    status: 'active',
    icon: '🗺',
  },
  {
    id: 'price-history',
    title: 'Price History',
    subtitle: 'LMP time series with volatility bands',
    category: 'energy',
    component: lazy(() => import('../components/panels/energy/PriceHistoryPanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 2,
    status: 'active',
    icon: '📊',
  },
  {
    id: 'generation-mix',
    title: 'Generation Mix',
    subtitle: 'ERCOT fuel type breakdown',
    category: 'energy',
    component: lazy(() => import('../components/panels/energy/GenerationMixPanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 2,
    status: 'active',
    icon: '🔋',
  },
];

// Phase 3: Fleet Hashprice panels (active)
const HashpricePanels: PanelRegistryEntry[] = [
  {
    id: 'fleet-profitability',
    title: 'Fleet Profitability',
    subtitle: 'Fleet P&L at a glance',
    category: 'hashprice',
    component: lazy(() => import('../components/panels/hashprice/FleetProfitabilityPanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 3,
    status: 'active',
    icon: '⛏',
  },
  {
    id: 'machine-breakdown',
    title: 'Machine Class Profitability',
    subtitle: 'Per-model revenue breakdown',
    category: 'hashprice',
    component: lazy(() => import('../components/panels/hashprice/MachineBreakdownPanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 3,
    status: 'active',
    icon: '📋',
  },
  {
    id: 'breakeven-chart',
    title: 'Breakeven Electricity',
    subtitle: 'Max tolerable $/kWh per model',
    category: 'hashprice',
    component: lazy(() => import('../components/panels/hashprice/BreakevenChartPanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 3,
    status: 'active',
    icon: '📊',
  },
  {
    id: 'hashprice-trend',
    title: 'Hashprice Trend',
    subtitle: 'Historical + projections',
    category: 'hashprice',
    component: lazy(() => import('../components/panels/hashprice/HashpriceTrendPanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 3,
    status: 'active',
    icon: '📈',
  },
  {
    id: 'difficulty-tracker',
    title: 'Difficulty Adjustment',
    subtitle: 'Next adjustment countdown + impact',
    category: 'hashprice',
    component: lazy(() => import('../components/panels/hashprice/DifficultyPanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 3,
    status: 'active',
    icon: '🎯',
  },
  {
    id: 'scenario-simulator',
    title: 'Scenario Simulator',
    subtitle: 'What-if analysis',
    category: 'hashprice',
    component: lazy(() => import('../components/panels/hashprice/ScenarioSimulator')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 3,
    status: 'active',
    icon: '🔮',
  },
];

// Phase 4-6: Placeholder panels for Operations dashboard
const OperationsPlaceholders: PanelRegistryEntry[] = [
  {
    id: 'curtailment-optimizer',
    title: 'Curtailment Optimizer',
    subtitle: 'Automated curtailment decisions',
    category: 'curtailment',
    component: lazy(() => import('../components/panels/curtailment/CurtailmentPlaceholder')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 4,
    status: 'placeholder',
    requiredConfig: ['energySource', 'fleetConfig'],
    description: 'Autonomous curtailment engine that cross-references energy prices, hashprice, and demand response signals. Shows optimal on/off schedules, revenue from curtailment credits, and historical performance.',
    icon: '🔋',
  },
  {
    id: 'pool-monitor',
    title: 'Pool Monitor',
    subtitle: 'Mining pool performance tracking',
    category: 'pools',
    component: lazy(() => import('../components/panels/pools/PoolPlaceholder')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 5,
    status: 'placeholder',
    requiredConfig: ['poolApiKeys'],
    description: 'Unified view across all your mining pools. Track hashrate, shares, luck, earnings, and payout schedules. Compare pool performance and detect anomalies like hashrate drops or rejected shares.',
    icon: '🏊',
  },
  {
    id: 'agent-status',
    title: 'Agent Status',
    subtitle: 'Autonomous agent control panel',
    category: 'agents',
    component: lazy(() => import('../components/panels/agents/AgentPlaceholder')),
    defaultSize: { cols: 2, rows: 1 },
    phase: 6,
    status: 'placeholder',
    description: 'Monitor and control autonomous agents handling curtailment decisions, pool switching, firmware updates, and anomaly response. View agent logs, decision history, and override controls.',
    icon: '🤖',
  },
];

// Full registry
export const panelRegistry: PanelRegistryEntry[] = [
  ...MacroPanels,
  ...EnergyPanels,
  ...HashpricePanels,
  ...OperationsPlaceholders,
];

/**
 * Get a panel by ID
 */
export function getPanel(id: string): PanelRegistryEntry | undefined {
  return panelRegistry.find(p => p.id === id);
}

/**
 * Get panels by category
 */
export function getPanelsByCategory(category: string): PanelRegistryEntry[] {
  return panelRegistry.filter(p => p.category === category);
}

/**
 * Get panels by status
 */
export function getPanelsByStatus(status: string): PanelRegistryEntry[] {
  return panelRegistry.filter(p => p.status === status);
}

/**
 * Get panels by phase
 */
export function getPanelsByPhase(phase: number): PanelRegistryEntry[] {
  return panelRegistry.filter(p => p.phase === phase);
}

export default panelRegistry;

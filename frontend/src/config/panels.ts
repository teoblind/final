import { lazy } from 'react';
import type { PanelRegistryEntry } from '../types';

/**
 * Panel Registry — Single source of truth for all panels in Ampera.
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

// Phase 4: Curtailment panels (active)
const CurtailmentPanels: PanelRegistryEntry[] = [
  {
    id: 'operating-status',
    title: 'Operating Status',
    subtitle: 'Real-time fleet mining/curtailment state',
    category: 'curtailment',
    component: lazy(() => import('../components/panels/curtailment/OperatingStatusPanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 4,
    status: 'active',
    icon: '🔋',
  },
  {
    id: 'curtailment-schedule',
    title: '24h Operating Schedule',
    subtitle: 'Day-ahead mining/curtailment timeline',
    category: 'curtailment',
    component: lazy(() => import('../components/panels/curtailment/SchedulePanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 4,
    status: 'active',
    icon: '📅',
  },
  {
    id: 'curtailment-savings',
    title: 'Curtailment Savings',
    subtitle: 'Cumulative savings from curtailment',
    category: 'curtailment',
    component: lazy(() => import('../components/panels/curtailment/SavingsTrackerPanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 4,
    status: 'active',
    icon: '💰',
  },
  {
    id: 'efficiency-waterfall',
    title: 'Fleet Efficiency Waterfall',
    subtitle: 'Merit-order curtailment visualization',
    category: 'curtailment',
    component: lazy(() => import('../components/panels/curtailment/EfficiencyWaterfallPanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 4,
    status: 'active',
    icon: '📊',
  },
  {
    id: 'curtailment-backtest',
    title: 'Strategy Backtest',
    subtitle: 'Historical curtailment strategy analysis',
    category: 'curtailment',
    component: lazy(() => import('../components/panels/curtailment/BacktestPanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 4,
    status: 'active',
    icon: '🧪',
  },
];

// Phase 5: Mining Pool & On-Chain panels (active)
const PoolPanels: PanelRegistryEntry[] = [
  {
    id: 'pool-hashrate',
    title: 'Pool Hashrate',
    subtitle: 'Reported vs expected hashrate overview',
    category: 'pools',
    component: lazy(() => import('../components/panels/pools/PoolHashratePanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 5,
    status: 'active',
    icon: '⛏',
  },
  {
    id: 'pool-earnings',
    title: 'Earnings Tracker',
    subtitle: 'BTC earnings, luck, payouts',
    category: 'pools',
    component: lazy(() => import('../components/panels/pools/PoolEarningsPanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 5,
    status: 'active',
    icon: '₿',
  },
  {
    id: 'worker-fleet',
    title: 'Worker Fleet',
    subtitle: 'Worker-level status and diagnostics',
    category: 'pools',
    component: lazy(() => import('../components/panels/pools/WorkerFleetPanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 5,
    status: 'active',
    icon: '🖥',
  },
  {
    id: 'mempool-fees',
    title: 'Mempool & Fees',
    subtitle: 'On-chain mempool, fee estimates, blocks',
    category: 'pools',
    component: lazy(() => import('../components/panels/pools/MempoolFeesPanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 5,
    status: 'active',
    icon: '📦',
  },
  {
    id: 'pool-comparison',
    title: 'Pool Comparison',
    subtitle: 'Side-by-side pool performance',
    category: 'pools',
    component: lazy(() => import('../components/panels/pools/PoolComparisonPanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 5,
    status: 'active',
    icon: '📊',
  },
];

// Phase 6: Clawbot Agent panels (active)
const AgentPanels: PanelRegistryEntry[] = [
  {
    id: 'agent-command-center',
    title: 'Agent Command Center',
    subtitle: 'Overview of all agents and their current state',
    category: 'agents',
    component: lazy(() => import('../components/panels/agents/AgentCommandCenter')),
    defaultSize: { cols: 2, rows: 1 },
    phase: 6,
    status: 'active',
    icon: '🤖',
  },
  {
    id: 'agent-approvals',
    title: 'Approval Queue',
    subtitle: 'Actions waiting for human confirmation',
    category: 'agents',
    component: lazy(() => import('../components/panels/agents/ApprovalQueuePanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 6,
    status: 'active',
    icon: '✅',
  },
  {
    id: 'agent-activity',
    title: 'Agent Activity',
    subtitle: 'Chronological log of all agent events',
    category: 'agents',
    component: lazy(() => import('../components/panels/agents/AgentActivityFeed')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 6,
    status: 'active',
    icon: '📋',
  },
  {
    id: 'agent-performance',
    title: 'Agent Performance',
    subtitle: 'Value generated and action metrics',
    category: 'agents',
    component: lazy(() => import('../components/panels/agents/AgentPerformancePanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 6,
    status: 'active',
    icon: '📊',
  },
];

// Phase 7: HPC / AI Compute panels (active)
const HpcPanels: PanelRegistryEntry[] = [
  {
    id: 'site-overview',
    title: 'Site Overview',
    subtitle: 'Unified BTC + HPC capacity, revenue, curtailment',
    category: 'hpc',
    component: lazy(() => import('../components/panels/hpc/SiteOverviewPanel')),
    defaultSize: { cols: 2, rows: 1 },
    phase: 7,
    status: 'active',
    icon: '🏭',
  },
  {
    id: 'workload-economics',
    title: 'Workload Economics',
    subtitle: '$/MW/day comparison across BTC and HPC',
    category: 'hpc',
    component: lazy(() => import('../components/panels/hpc/WorkloadEconomicsPanel')),
    defaultSize: { cols: 2, rows: 1 },
    phase: 7,
    status: 'active',
    icon: '📊',
  },
  {
    id: 'hpc-contracts',
    title: 'HPC Contracts',
    subtitle: 'Contract management with SLA tracking',
    category: 'hpc',
    component: lazy(() => import('../components/panels/hpc/HpcContractsPanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 7,
    status: 'active',
    icon: '🖥',
  },
];

// Phase 9: Insurance panels (active)
const InsurancePanels: PanelRegistryEntry[] = [
  {
    id: 'insurance-risk-profile',
    title: 'Risk Profile',
    subtitle: 'Composite risk score and fleet assessment',
    category: 'insurance' as PanelCategory,
    component: lazy(() => import('../components/panels/insurance/RiskProfilePanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 9,
    status: 'active',
    icon: '🛡',
  },
  {
    id: 'insurance-projections',
    title: 'Revenue Projections',
    subtitle: 'P10-P90 revenue fan chart',
    category: 'insurance' as PanelCategory,
    component: lazy(() => import('../components/panels/insurance/RevenueProjectionPanel')),
    defaultSize: { cols: 2, rows: 1 },
    phase: 9,
    status: 'active',
    icon: '📈',
  },
  {
    id: 'insurance-instruments',
    title: 'Financial Instruments',
    subtitle: 'Energy market derivative analogies',
    category: 'insurance' as PanelCategory,
    component: lazy(() => import('../components/panels/insurance/FinancialInstrumentsPanel')),
    defaultSize: { cols: 3, rows: 2 },
    phase: 9,
    status: 'active',
    icon: '📊',
  },
  {
    id: 'insurance-explorer',
    title: 'Coverage Explorer',
    subtitle: 'Interactive coverage configuration',
    category: 'insurance' as PanelCategory,
    component: lazy(() => import('../components/panels/insurance/CoverageExplorerPanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 9,
    status: 'active',
    icon: '🎛',
  },
  {
    id: 'insurance-status',
    title: 'Coverage Status',
    subtitle: 'Active policies and claims',
    category: 'insurance' as PanelCategory,
    component: lazy(() => import('../components/panels/insurance/CoverageStatusPanel')),
    defaultSize: { cols: 1, rows: 1 },
    phase: 9,
    status: 'active',
    icon: '✅',
  },
];

// Full registry
export const panelRegistry: PanelRegistryEntry[] = [
  ...MacroPanels,
  ...EnergyPanels,
  ...HashpricePanels,
  ...CurtailmentPanels,
  ...PoolPanels,
  ...AgentPanels,
  ...HpcPanels,
  ...InsurancePanels,
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

/**
 * Global TypeScript types for Ampera
 */

// Panel system types
export type PanelStatus = 'connected' | 'stale' | 'error' | 'loading';
export type PanelCategory = 'macro' | 'energy' | 'hashprice' | 'curtailment' | 'pools' | 'agents';
export type PanelPhaseStatus = 'active' | 'placeholder' | 'coming-soon';

export interface PanelAction {
  id: string;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}

export interface PanelSource {
  name: string;
  updatedAt: Date | string | null;
}

export interface PanelRegistryEntry {
  id: string;
  title: string;
  subtitle?: string;
  category: PanelCategory;
  component: React.LazyExoticComponent<React.ComponentType<any>>;
  defaultSize: { cols: number; rows: number };
  phase: number;
  status: PanelPhaseStatus;
  requiredConfig?: string[];
  description?: string;
  icon?: string;
}

// Dashboard layout types
export type DashboardView = 'operations' | 'macro' | 'correlations' | 'alerts' | 'notes' | 'liquidity' | 'settings';

export interface DashboardLayoutConfig {
  id: DashboardView;
  label: string;
  panels: string[]; // panel IDs from registry
}

// Data layer types
export interface DataResult<T = any> {
  data: T;
  fetchedAt: string;
  stale: boolean;
  cached: boolean;
  source: string;
}

export interface DataConnectorConfig {
  id: string;
  name: string;
  refreshInterval: number;
}

export interface ConnectorHealth {
  id: string;
  name: string;
  healthy: boolean;
  lastCheck: string | null;
  error?: string;
}

// Navigation types
export interface NavItem {
  id: DashboardView;
  label: string;
  shortLabel?: string;
  icon: string;
}

// Settings types
export interface FleetConfig {
  asicModels: AsicModel[];
  totalHashrate?: number;
  averageEfficiency?: number;
}

export interface AsicModel {
  model: string;
  quantity: number;
  hashrate: number; // TH/s
  efficiency: number; // W/TH
}

export interface EnergyConfig {
  provider?: string;
  contractType?: string;
  baseRate?: number;
  currency?: string;
}

export interface PoolConfig {
  poolName: string;
  apiKey?: string;
  apiSecret?: string;
  workerPrefix?: string;
}

// Liquidity scoring types (preserved from original)
export interface LiquidityInputs {
  moveIndex: number | null;
  us10y: number | null;
  dxy: number | null;
  fedBS: number | null;
  btcPrice: number | null;
  btc200dma: number | null;
  btcMvrv: number | null;
  btcFundingRate: number | null;
  btcEtfFlowWeekly: number | null;
  goldPrice: number | null;
  silverPrice: number | null;
  goldSilverRatio: number | null;
  cpiYoy: number | null;
  coreYoy: number | null;
  us2y: number | null;
  us30y: number | null;
  fedFundsRate: string | null;
  unemployment: number | null;
  nfp: number | null;
  initialClaims: number | null;
  tga: number | null;
  rrp: number | null;
  spx: number | null;
  vix: number | null;
  hyOAS: number | null;
}

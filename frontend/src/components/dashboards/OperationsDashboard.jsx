import React, { Suspense, lazy } from 'react';

// Phase 2: Live energy panels
const EnergyPricePanel = lazy(() => import('../panels/energy/EnergyPricePanel'));
const DayAheadPanel = lazy(() => import('../panels/energy/DayAheadPanel'));
const PriceHeatmapPanel = lazy(() => import('../panels/energy/PriceHeatmapPanel'));
const PriceHistoryPanel = lazy(() => import('../panels/energy/PriceHistoryPanel'));
const GenerationMixPanel = lazy(() => import('../panels/energy/GenerationMixPanel'));

// Phase 3: Live hashprice panels
const FleetProfitabilityPanel = lazy(() => import('../panels/hashprice/FleetProfitabilityPanel'));
const MachineBreakdownPanel = lazy(() => import('../panels/hashprice/MachineBreakdownPanel'));
const BreakevenChartPanel = lazy(() => import('../panels/hashprice/BreakevenChartPanel'));
const HashpriceTrendPanel = lazy(() => import('../panels/hashprice/HashpriceTrendPanel'));
const DifficultyPanel = lazy(() => import('../panels/hashprice/DifficultyPanel'));
const ScenarioSimulator = lazy(() => import('../panels/hashprice/ScenarioSimulator'));

// Phase 4: Live curtailment panels
const OperatingStatusPanel = lazy(() => import('../panels/curtailment/OperatingStatusPanel'));
const SchedulePanel = lazy(() => import('../panels/curtailment/SchedulePanel'));
const SavingsTrackerPanel = lazy(() => import('../panels/curtailment/SavingsTrackerPanel'));
const EfficiencyWaterfallPanel = lazy(() => import('../panels/curtailment/EfficiencyWaterfallPanel'));
const BacktestPanel = lazy(() => import('../panels/curtailment/BacktestPanel'));

// Phase 5: Pool & On-Chain panels
const PoolHashratePanel = lazy(() => import('../panels/pools/PoolHashratePanel'));
const PoolEarningsPanel = lazy(() => import('../panels/pools/PoolEarningsPanel'));
const WorkerFleetPanel = lazy(() => import('../panels/pools/WorkerFleetPanel'));
const MempoolFeesPanel = lazy(() => import('../panels/pools/MempoolFeesPanel'));
const PoolComparisonPanel = lazy(() => import('../panels/pools/PoolComparisonPanel'));

// Phase 6 removed — Clawbot Agent panels were demo placeholders

function PanelSkeleton() {
  return (
    <div className="bg-terminal-panel border border-terminal-border rounded-lg p-8 animate-pulse">
      <div className="h-4 bg-terminal-border rounded w-1/3 mb-4" />
      <div className="h-32 bg-terminal-border/50 rounded" />
    </div>
  );
}

/**
 * Operations Dashboard
 *
 * The primary mining operations control center. Phases 2-9 are live.
 */
export default function OperationsDashboard({ onNavigate }) {

  return (
    <div className="p-6">
      {/* Mining Pools & On-Chain */}
      <div className="mb-8">
        <h3 className="text-sm font-semibold text-terminal-text mb-3">Mining Pools & On-Chain</h3>
        <Suspense fallback={<PanelSkeleton />}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Hero: Pool Hashrate */}
            <PoolHashratePanel />
            {/* Earnings */}
            <PoolEarningsPanel />
            {/* Mempool & Fees */}
            <MempoolFeesPanel />
            {/* Worker Fleet spans 2 cols */}
            <div className="md:col-span-2">
              <WorkerFleetPanel />
            </div>
            {/* Pool Comparison */}
            <PoolComparisonPanel />
          </div>
        </Suspense>
      </div>

      {/* Curtailment Optimizer */}
      <div className="mb-8">
        <h3 className="text-sm font-semibold text-terminal-text mb-3">Curtailment Optimizer</h3>
        <Suspense fallback={<PanelSkeleton />}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <OperatingStatusPanel />
            <div className="md:col-span-2">
              <SchedulePanel />
            </div>
            <EfficiencyWaterfallPanel />
            <SavingsTrackerPanel />
            <BacktestPanel />
          </div>
        </Suspense>
      </div>

      {/* Fleet Hashprice */}
      <div className="mb-8">
        <h3 className="text-sm font-semibold text-terminal-text mb-3">Fleet Hashprice</h3>
        <Suspense fallback={<PanelSkeleton />}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <FleetProfitabilityPanel />
            <DifficultyPanel />
            <ScenarioSimulator />
            <div className="md:col-span-2">
              <MachineBreakdownPanel />
            </div>
            <BreakevenChartPanel />
            <div className="lg:col-span-3 md:col-span-2">
              <HashpriceTrendPanel />
            </div>
          </div>
        </Suspense>
      </div>

      {/* Energy Market */}
      <div className="mb-8">
        <h3 className="text-sm font-semibold text-terminal-text mb-3">Energy Market</h3>
        <Suspense fallback={<PanelSkeleton />}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <EnergyPricePanel />
            <DayAheadPanel />
            <GenerationMixPanel />
            <div className="md:col-span-2">
              <PriceHistoryPanel />
            </div>
            <PriceHeatmapPanel />
          </div>
        </Suspense>
      </div>

    </div>
  );
}

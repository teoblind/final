import React, { Suspense, lazy, useState, useEffect } from 'react';

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

// Phase 6: Clawbot Agent panels (Command Center + Performance only; Approvals & Activity live on Command)
const AgentCommandCenter = lazy(() => import('../panels/agents/AgentCommandCenter'));
const AgentPerformancePanel = lazy(() => import('../panels/agents/AgentPerformancePanel'));

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
const API_BASE = import.meta.env.VITE_API_URL || '/api';

export default function OperationsDashboard({ onNavigate }) {
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/v1/approvals?status=pending`);
        if (res.ok) {
          const data = await res.json();
          setPendingCount(data.items?.length || 0);
        }
      } catch {}
    })();
  }, []);

  return (
    <div className="p-6">
      {/* Clawbot Agents */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-semibold text-terminal-text">Clawbot Agents</h3>
          {pendingCount > 0 && (
            <button
              onClick={() => onNavigate?.('command')}
              className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#fdf6e8] text-[#b8860b] border border-[#f0e0b0] hover:bg-[#f8eed0] transition-colors"
            >
              <span className="w-[5px] h-[5px] rounded-full bg-[#b8860b] animate-pulse" />
              {pendingCount} pending approval{pendingCount !== 1 ? 's' : ''}
            </button>
          )}
        </div>
        <Suspense fallback={<PanelSkeleton />}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <AgentCommandCenter />
            </div>
            <div className="md:col-span-2">
              <AgentPerformancePanel />
            </div>
          </div>
        </Suspense>
      </div>

      {/* HPC / AI Compute - hidden until tenant has HPC sites configured */}

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

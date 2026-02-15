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

// Phase 6: Clawbot Agent panels
const AgentCommandCenter = lazy(() => import('../panels/agents/AgentCommandCenter'));
const ApprovalQueuePanel = lazy(() => import('../panels/agents/ApprovalQueuePanel'));
const AgentActivityFeed = lazy(() => import('../panels/agents/AgentActivityFeed'));
const AgentPerformancePanel = lazy(() => import('../panels/agents/AgentPerformancePanel'));

// Phase 7: HPC / AI Compute panels
const SiteOverviewPanel = lazy(() => import('../panels/hpc/SiteOverviewPanel'));
const WorkloadEconomicsPanel = lazy(() => import('../panels/hpc/WorkloadEconomicsPanel'));
const HpcContractsPanel = lazy(() => import('../panels/hpc/HpcContractsPanel'));

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
 * The primary mining operations control center. Phases 2-6 are live.
 */
export default function OperationsDashboard({ onNavigate }) {
  return (
    <div className="p-4">
      {/* Dashboard header */}
      <div className="mb-6">
        <h2 className="text-lg font-bold text-terminal-green">Operations Control Center</h2>
        <p className="text-xs text-terminal-muted mt-1">
          Unified mining operations dashboard — energy, hashprice, curtailment, pool, and agent data are live.
          Visit <button
            onClick={() => onNavigate?.('macro')}
            className="text-terminal-cyan hover:underline"
          >
            Macro Intelligence
          </button> for the full macro thesis dashboard.
        </p>
      </div>

      {/* Phase Roadmap Summary */}
      <div className="mb-6 bg-terminal-panel border border-terminal-border rounded-lg p-4">
        <h3 className="text-sm font-semibold text-terminal-text mb-3">Build Roadmap</h3>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {[
            { phase: 2, label: 'Energy Market', status: 'active', color: 'terminal-green' },
            { phase: 3, label: 'Fleet Hashprice', status: 'active', color: 'terminal-green' },
            { phase: 4, label: 'Curtailment', status: 'active', color: 'terminal-green' },
            { phase: 5, label: 'Pool & Chain', status: 'active', color: 'terminal-green' },
            { phase: 6, label: 'Clawbot Agents', status: 'active', color: 'terminal-green' },
            { phase: 7, label: 'HPC / AI Compute', status: 'active', color: 'terminal-green' },
          ].map(item => (
            <div
              key={item.phase}
              className={`text-center py-2 px-3 rounded border ${
                item.status === 'active'
                  ? 'border-terminal-green/30 bg-terminal-green/5'
                  : item.status === 'next'
                    ? 'border-terminal-amber/30 bg-terminal-amber/5'
                    : 'border-terminal-border'
              }`}
            >
              <p className={`text-xs text-${item.color}`}>Phase {item.phase}</p>
              <p className="text-sm font-medium text-terminal-text">{item.label}</p>
              {item.status === 'active' && (
                <p className="text-[10px] text-terminal-green mt-0.5">LIVE</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Clawbot Agents — Phase 6 LIVE */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-terminal-green mb-3 flex items-center gap-2">
          <span>🤖</span> Clawbot Agents
          <span className="px-1.5 py-0.5 text-[10px] bg-terminal-green/20 text-terminal-green rounded">LIVE</span>
        </h3>
        <Suspense fallback={<PanelSkeleton />}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <AgentCommandCenter />
            </div>
            <ApprovalQueuePanel />
            <AgentPerformancePanel />
            <div className="md:col-span-2">
              <AgentActivityFeed />
            </div>
          </div>
        </Suspense>
      </div>

      {/* HPC / AI Compute — Phase 7 LIVE */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-terminal-cyan mb-3 flex items-center gap-2">
          <span>🖥</span> HPC / AI Compute
          <span className="px-1.5 py-0.5 text-[10px] bg-terminal-green/20 text-terminal-green rounded">LIVE</span>
        </h3>
        <Suspense fallback={<PanelSkeleton />}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Site Overview spans full width */}
            <div className="lg:col-span-3 md:col-span-2">
              <SiteOverviewPanel />
            </div>
            {/* Workload Economics spans 2 cols */}
            <div className="md:col-span-2">
              <WorkloadEconomicsPanel />
            </div>
            {/* HPC Contracts */}
            <HpcContractsPanel />
          </div>
        </Suspense>
      </div>

      {/* Pool & On-Chain section — Phase 5 LIVE */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-terminal-cyan mb-3 flex items-center gap-2">
          <span>⛏</span> Mining Pools & On-Chain
          <span className="px-1.5 py-0.5 text-[10px] bg-terminal-green/20 text-terminal-green rounded">LIVE</span>
        </h3>
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

      {/* Curtailment section — Phase 4 LIVE */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-terminal-cyan mb-3 flex items-center gap-2">
          <span>🔋</span> Curtailment Optimizer
          <span className="px-1.5 py-0.5 text-[10px] bg-terminal-green/20 text-terminal-green rounded">LIVE</span>
        </h3>
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

      {/* Fleet Hashprice section — Phase 3 LIVE */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-terminal-green mb-3 flex items-center gap-2">
          <span>⛏</span> Fleet Hashprice
          <span className="px-1.5 py-0.5 text-[10px] bg-terminal-green/20 text-terminal-green rounded">LIVE</span>
        </h3>
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

      {/* Energy Market section — Phase 2 LIVE */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-terminal-amber mb-3 flex items-center gap-2">
          <span>⚡</span> Energy Market
          <span className="px-1.5 py-0.5 text-[10px] bg-terminal-green/20 text-terminal-green rounded">LIVE</span>
        </h3>
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

      {/* Future phases note */}
      <div className="text-center py-4">
        <p className="text-xs text-terminal-muted">
          Phases 2–7 live. Phase 8 (External Integrations) and Phase 9 (IPP Visibility) coming next.
        </p>
      </div>
    </div>
  );
}

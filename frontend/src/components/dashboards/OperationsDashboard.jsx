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

// Phase 5-6: Placeholder panels
const PoolPlaceholder = lazy(() => import('../panels/pools/PoolPlaceholder'));
const AgentPlaceholder = lazy(() => import('../panels/agents/AgentPlaceholder'));

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
 * The primary mining operations control center. Phase 2 energy panels,
 * Phase 3 hashprice panels, and Phase 4 curtailment panels are live.
 * Phases 5-6 remain as placeholders.
 */
export default function OperationsDashboard({ onNavigate }) {
  return (
    <div className="p-4">
      {/* Dashboard header */}
      <div className="mb-6">
        <h2 className="text-lg font-bold text-terminal-green">Operations Control Center</h2>
        <p className="text-xs text-terminal-muted mt-1">
          Unified mining operations dashboard — energy, hashprice, and curtailment data are live.
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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { phase: 2, label: 'Energy Market', status: 'active', color: 'terminal-green' },
            { phase: 3, label: 'Fleet Hashprice', status: 'active', color: 'terminal-green' },
            { phase: 4, label: 'Curtailment', status: 'active', color: 'terminal-green' },
            { phase: 5, label: 'Pool Monitor', status: 'next', color: 'terminal-amber' },
            { phase: 6, label: 'Agents', status: 'planned', color: 'terminal-muted' },
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

      {/* Curtailment section — Phase 4 LIVE */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-terminal-cyan mb-3 flex items-center gap-2">
          <span>🔋</span> Curtailment Optimizer
          <span className="px-1.5 py-0.5 text-[10px] bg-terminal-green/20 text-terminal-green rounded">LIVE</span>
        </h3>
        <Suspense fallback={<PanelSkeleton />}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Hero: Operating Status */}
            <OperatingStatusPanel />
            {/* 24h Schedule spans 2 cols */}
            <div className="md:col-span-2">
              <SchedulePanel />
            </div>
            {/* Efficiency Waterfall */}
            <EfficiencyWaterfallPanel />
            {/* Savings Tracker */}
            <SavingsTrackerPanel />
            {/* Backtest */}
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
            {/* Hero: Fleet Profitability */}
            <FleetProfitabilityPanel />
            {/* Difficulty tracker */}
            <DifficultyPanel />
            {/* Scenario simulator */}
            <ScenarioSimulator />
            {/* Machine breakdown spans 2 cols */}
            <div className="md:col-span-2">
              <MachineBreakdownPanel />
            </div>
            {/* Breakeven chart */}
            <BreakevenChartPanel />
            {/* Hashprice trend spans full width */}
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

      {/* Future phases — Placeholder panels */}
      <div>
        <h3 className="text-sm font-semibold text-terminal-muted mb-3">Coming Soon</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Suspense fallback={<PanelSkeleton />}>
            <PoolPlaceholder />
            <div className="md:col-span-2">
              <AgentPlaceholder />
            </div>
          </Suspense>
        </div>
      </div>
    </div>
  );
}

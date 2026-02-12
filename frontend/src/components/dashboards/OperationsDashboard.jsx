import React, { Suspense, lazy } from 'react';

// Lazy-load placeholder panels
const EnergyPlaceholder = lazy(() => import('../panels/energy/EnergyPlaceholder'));
const HashpricePlaceholder = lazy(() => import('../panels/hashprice/HashpricePlaceholder'));
const CurtailmentPlaceholder = lazy(() => import('../panels/curtailment/CurtailmentPlaceholder'));
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
 * The primary mining operations control center. Currently shows placeholder panels
 * for features coming in Phases 2-6. As each phase is built, the placeholders
 * will be replaced with live operational panels.
 */
export default function OperationsDashboard({ onNavigate }) {
  return (
    <div className="p-4">
      {/* Dashboard header */}
      <div className="mb-6">
        <h2 className="text-lg font-bold text-terminal-green">Operations Control Center</h2>
        <p className="text-xs text-terminal-muted mt-1">
          Unified mining operations dashboard. Panels below will activate as each phase is implemented.
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
            { phase: 2, label: 'Energy Market', status: 'next', color: 'terminal-amber' },
            { phase: 3, label: 'Fleet Hashprice', status: 'planned', color: 'terminal-muted' },
            { phase: 4, label: 'Curtailment', status: 'planned', color: 'terminal-muted' },
            { phase: 5, label: 'Pool Monitor', status: 'planned', color: 'terminal-muted' },
            { phase: 6, label: 'Agents', status: 'planned', color: 'terminal-muted' },
          ].map(item => (
            <div
              key={item.phase}
              className={`text-center py-2 px-3 rounded border ${
                item.status === 'next'
                  ? 'border-terminal-amber/30 bg-terminal-amber/5'
                  : 'border-terminal-border'
              }`}
            >
              <p className={`text-xs text-${item.color}`}>Phase {item.phase}</p>
              <p className="text-sm font-medium text-terminal-text">{item.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Operations panels grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Suspense fallback={<PanelSkeleton />}>
          {/* Energy Market spans full width on md+ */}
          <div className="md:col-span-2">
            <EnergyPlaceholder />
          </div>

          <HashpricePlaceholder />
          <CurtailmentPlaceholder />
          <PoolPlaceholder />

          {/* Agent Status spans full width on md+ */}
          <div className="md:col-span-2">
            <AgentPlaceholder />
          </div>
        </Suspense>
      </div>
    </div>
  );
}

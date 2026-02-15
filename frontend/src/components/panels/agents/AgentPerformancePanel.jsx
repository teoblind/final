import React, { useState } from 'react';
import Panel from '../../Panel';
import { useApi } from '../../../hooks/useApi';

const AGENT_NAMES = {
  'curtailment-optimizer': 'Curtailment',
  'pool-optimizer': 'Pool Optim.',
  'alert-synthesizer': 'Alert Synth',
  'reporting-engine': 'Reporting',
};

const AGENT_COLORS = {
  'curtailment-optimizer': '#ffb800',
  'pool-optimizer': '#00d4ff',
  'alert-synthesizer': '#00d26a',
  'reporting-engine': '#6366f1',
};

export default function AgentPerformancePanel() {
  const [period, setPeriod] = useState(30);
  const { data, loading, error, lastFetched, refetch } = useApi(
    `/agents/performance?days=${period}`,
    { refreshInterval: 60000 }
  );

  const perf = data || {};
  const byAgent = perf.byAgent || [];
  const totalValue = perf.totalValueGenerated || 0;
  const totalActions = perf.totalActionsExecuted || 0;
  const totalApproved = perf.totalActionsApproved || 0;
  const totalRejected = perf.totalActionsRejected || 0;
  const totalSkipped = perf.totalActionsSkipped || 0;
  const allActions = totalActions + totalApproved + totalRejected + totalSkipped;
  const accuracyRate = allActions > 0 ? ((totalActions + totalApproved) / allActions * 100) : 100;

  // Find the max value for bar scaling
  const maxAgentValue = Math.max(...byAgent.map(a => a.valueGenerated || 0), 1);

  const periods = [
    { value: 7, label: '7D' },
    { value: 30, label: '1M' },
    { value: 90, label: '3M' },
  ];

  return (
    <Panel
      title="Agent Performance"
      source="agents/performance"
      lastUpdated={lastFetched}
      loading={loading}
      error={error}
      onRefresh={refetch}
      headerRight={
        <div className="flex gap-1">
          {periods.map(p => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                period === p.value
                  ? 'bg-terminal-green/20 text-terminal-green'
                  : 'text-terminal-muted hover:text-terminal-text'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      }
    >
      <div className="space-y-4">
        {/* Hero Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-terminal-bg rounded p-3 text-center">
            <p className="text-[10px] text-terminal-muted uppercase">Value Generated</p>
            <p className="text-xl font-bold text-terminal-green">
              ${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </p>
          </div>
          <div className="bg-terminal-bg rounded p-3 text-center">
            <p className="text-[10px] text-terminal-muted uppercase">Actions</p>
            <p className="text-xl font-bold text-terminal-text">
              {allActions.toLocaleString()}
            </p>
          </div>
          <div className="bg-terminal-bg rounded p-3 text-center">
            <p className="text-[10px] text-terminal-muted uppercase">Accuracy</p>
            <p className={`text-xl font-bold ${accuracyRate >= 90 ? 'text-terminal-green' : accuracyRate >= 70 ? 'text-terminal-amber' : 'text-terminal-red'}`}>
              {accuracyRate.toFixed(1)}%
            </p>
          </div>
        </div>

        {/* Value by Agent */}
        <div>
          <p className="text-xs text-terminal-muted mb-2">Value by Agent</p>
          <div className="space-y-2">
            {byAgent.map((agent) => {
              const name = AGENT_NAMES[agent.agentId] || agent.agentId;
              const color = AGENT_COLORS[agent.agentId] || '#888';
              const pct = maxAgentValue > 0 ? (agent.valueGenerated / maxAgentValue) * 100 : 0;

              return (
                <div key={agent.agentId} className="flex items-center gap-3">
                  <span className="text-xs text-terminal-text w-24 shrink-0">{name}</span>
                  <div className="flex-1 bg-terminal-bg rounded-full h-4 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: color }}
                    />
                  </div>
                  <span className="text-xs text-terminal-text w-20 text-right">
                    ${(agent.valueGenerated || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Action Breakdown */}
        <div>
          <p className="text-xs text-terminal-muted mb-2">Actions Breakdown</p>
          <div className="space-y-1.5">
            {[
              { label: 'Executed autonomously', count: totalActions, pct: allActions > 0 ? (totalActions / allActions * 100) : 0, color: 'text-terminal-green' },
              { label: 'Approved by operator', count: totalApproved, pct: allActions > 0 ? (totalApproved / allActions * 100) : 0, color: 'text-terminal-cyan' },
              { label: 'Rejected by operator', count: totalRejected, pct: allActions > 0 ? (totalRejected / allActions * 100) : 0, color: 'text-terminal-red' },
              { label: 'Skipped (guardrails)', count: totalSkipped, pct: allActions > 0 ? (totalSkipped / allActions * 100) : 0, color: 'text-terminal-muted' },
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between text-xs">
                <span className="text-terminal-muted">{row.label}</span>
                <span className={row.color}>
                  {row.count} ({row.pct.toFixed(0)}%)
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Observations count */}
        <div className="flex items-center justify-between pt-2 border-t border-terminal-border/30 text-xs">
          <span className="text-terminal-muted">Total Observations</span>
          <span className="text-terminal-text">{perf.totalObservations?.toLocaleString() || 0}</span>
        </div>
      </div>
    </Panel>
  );
}

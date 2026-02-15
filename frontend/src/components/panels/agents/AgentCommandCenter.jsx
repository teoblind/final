import React, { useState } from 'react';
import Panel from '../../Panel';
import { useApi, postApi } from '../../../hooks/useApi';

const AGENT_ICONS = {
  'curtailment-optimizer': '\u26A1',
  'pool-optimizer': '\u26CF',
  'alert-synthesizer': '\uD83D\uDD14',
  'reporting-engine': '\uD83D\uDCCA',
};

const MODE_COLORS = {
  observe: 'text-terminal-muted',
  recommend: 'text-terminal-amber',
  approve: 'text-terminal-cyan',
  autonomous: 'text-terminal-green',
};

const STATE_COLORS = {
  idle: 'bg-terminal-green',
  observing: 'bg-terminal-green',
  analyzing: 'bg-terminal-green',
  deciding: 'bg-terminal-amber',
  acting: 'bg-terminal-cyan',
  waiting_approval: 'bg-terminal-amber',
  error: 'bg-terminal-red',
  stopped: 'bg-terminal-muted',
};

function getStateLabel(state) {
  if (state === 'waiting_approval') return 'Awaiting';
  return state ? state.charAt(0).toUpperCase() + state.slice(1) : 'Stopped';
}

export default function AgentCommandCenter() {
  const { data, loading, error, lastFetched, refetch } = useApi('/agents', { refreshInterval: 10000 });
  const { data: systemData, refetch: refetchSystem } = useApi('/agents/system-status', { refreshInterval: 10000 });
  const { data: approvalData } = useApi('/agents/approvals', { refreshInterval: 10000 });
  const [pausing, setPausing] = useState(false);

  const agents = data?.agents || [];
  const system = systemData || {};
  const pendingCount = approvalData?.approvals?.length || 0;

  const handlePauseAll = async () => {
    setPausing(true);
    try {
      if (system.paused) {
        await postApi('/agents/resume-all');
      } else {
        await postApi('/agents/pause-all');
      }
      refetch();
      refetchSystem();
    } finally {
      setPausing(false);
    }
  };

  const handleToggleAgent = async (agentId, currentState) => {
    try {
      if (currentState === 'stopped') {
        await postApi(`/agents/${agentId}/start`);
      } else {
        await postApi(`/agents/${agentId}/stop`);
      }
      refetch();
    } catch (err) {
      console.error('Failed to toggle agent:', err);
    }
  };

  const totalValueToday = agents.reduce((sum, a) => sum + (a.metrics?.valueToday || 0), 0);

  const headerRight = (
    <button
      onClick={handlePauseAll}
      disabled={pausing}
      className={`px-3 py-1 text-xs font-bold rounded border transition-colors ${
        system.paused
          ? 'bg-terminal-green/20 text-terminal-green border-terminal-green/50 hover:bg-terminal-green/30'
          : 'bg-terminal-red/20 text-terminal-red border-terminal-red/50 hover:bg-terminal-red/30'
      } disabled:opacity-50`}
    >
      {pausing ? '...' : system.paused ? 'RESUME ALL' : 'PAUSE ALL'}
    </button>
  );

  return (
    <Panel
      title="Agent Command Center"
      source="agents"
      lastUpdated={lastFetched}
      loading={loading}
      error={error}
      onRefresh={refetch}
      headerRight={headerRight}
    >
      <div className="space-y-3">
        {system.paused && (
          <div className="bg-terminal-red/10 border border-terminal-red/30 rounded p-2 text-center">
            <p className="text-xs text-terminal-red font-bold">ALL AGENTS PAUSED — Emergency stop active</p>
          </div>
        )}

        {/* Agent Grid Header */}
        <div className="grid grid-cols-12 gap-2 px-2 text-[10px] text-terminal-muted uppercase tracking-wider">
          <div className="col-span-4">Agent</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2">Mode</div>
          <div className="col-span-2 text-right">Actions Today</div>
          <div className="col-span-2 text-right">Control</div>
        </div>

        {/* Agent Rows */}
        {agents.map((agent) => {
          const state = agent.status?.state || 'stopped';
          const mode = agent.config?.mode || 'recommend';
          const icon = AGENT_ICONS[agent.id] || '\uD83E\uDD16';
          const actionsToday = agent.status?.actionsToday || 0;
          const lastEvent = agent.lastEvent;

          return (
            <div key={agent.id} className="bg-terminal-bg/50 rounded p-3 border border-terminal-border/30">
              <div className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-4 flex items-center gap-2">
                  <span className="text-base">{icon}</span>
                  <div>
                    <p className="text-sm text-terminal-text font-medium">{agent.name}</p>
                  </div>
                </div>
                <div className="col-span-2 flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${STATE_COLORS[state] || 'bg-terminal-muted'} ${
                    state === 'observing' || state === 'analyzing' ? 'animate-pulse' : ''
                  }`} />
                  <span className="text-xs text-terminal-text">{getStateLabel(state)}</span>
                </div>
                <div className="col-span-2">
                  <span className={`text-xs capitalize ${MODE_COLORS[mode] || 'text-terminal-muted'}`}>
                    {mode}
                  </span>
                </div>
                <div className="col-span-2 text-right">
                  <span className="text-sm text-terminal-text">{actionsToday}</span>
                  <span className="text-xs text-terminal-muted ml-1">
                    {state === 'waiting_approval' ? 'pending' : 'executed'}
                  </span>
                </div>
                <div className="col-span-2 text-right">
                  <button
                    onClick={() => handleToggleAgent(agent.id, state)}
                    className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
                      state === 'stopped'
                        ? 'border-terminal-green/50 text-terminal-green hover:bg-terminal-green/10'
                        : 'border-terminal-red/50 text-terminal-red hover:bg-terminal-red/10'
                    }`}
                  >
                    {state === 'stopped' ? 'Start' : 'Stop'}
                  </button>
                </div>
              </div>
              {lastEvent && (
                <p className="text-[10px] text-terminal-muted mt-1.5 pl-7 truncate">
                  Last: {lastEvent.summary}
                </p>
              )}
            </div>
          );
        })}

        {agents.length === 0 && !loading && (
          <div className="text-center py-6">
            <p className="text-sm text-terminal-muted">No agents registered</p>
            <p className="text-xs text-terminal-muted mt-1">Agents will appear here when the backend starts</p>
          </div>
        )}

        {/* Summary Bar */}
        <div className="flex items-center justify-between pt-2 border-t border-terminal-border/30">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-[10px] text-terminal-muted">Value Today</p>
              <p className="text-sm font-bold text-terminal-green">
                +${totalValueToday.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </div>
          </div>
          {pendingCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-terminal-amber/10 border border-terminal-amber/30 rounded">
              <span className="text-xs text-terminal-amber font-medium">
                {pendingCount} Pending Approval{pendingCount > 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

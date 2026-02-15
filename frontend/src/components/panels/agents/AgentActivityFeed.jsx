import React, { useState } from 'react';
import Panel from '../../Panel';
import { useApi } from '../../../hooks/useApi';

const AGENT_ICONS = {
  'curtailment-optimizer': '\u26A1',
  'pool-optimizer': '\u26CF',
  'alert-synthesizer': '\uD83D\uDD14',
  'reporting-engine': '\uD83D\uDCCA',
};

const AGENT_COLORS = {
  'curtailment-optimizer': 'text-terminal-amber',
  'pool-optimizer': 'text-terminal-cyan',
  'alert-synthesizer': 'text-terminal-green',
  'reporting-engine': 'text-blue-400',
};

const TYPE_BADGES = {
  observation: { label: 'Observed', color: 'text-terminal-muted' },
  recommendation: { label: 'Recommends', color: 'text-terminal-amber' },
  approval_requested: { label: 'Needs Approval', color: 'text-terminal-cyan' },
  action_executed: { label: 'Executed', color: 'text-terminal-green' },
  action_approved: { label: 'Approved', color: 'text-terminal-green' },
  action_rejected: { label: 'Rejected', color: 'text-terminal-red' },
  action_skipped: { label: 'Skipped', color: 'text-terminal-muted' },
  error: { label: 'Error', color: 'text-terminal-red' },
  state_change: { label: 'State Change', color: 'text-terminal-cyan' },
};

function formatTime(timestamp) {
  const d = new Date(timestamp);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDate(timestamp) {
  const d = new Date(timestamp);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function AgentActivityFeed() {
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(50);
  const agentParam = filter !== 'all' ? `&agent=${filter}` : '';
  const { data, loading, error, lastFetched, refetch } = useApi(
    `/agents/activity?limit=${limit}${agentParam}`,
    { refreshInterval: 10000 }
  );

  const events = data?.events || [];

  // Group events by date
  const grouped = {};
  for (const event of events) {
    const dateKey = formatDate(event.timestamp);
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(event);
  }

  const filterOptions = [
    { value: 'all', label: 'All Agents' },
    { value: 'curtailment-optimizer', label: '\u26A1 Curtailment' },
    { value: 'pool-optimizer', label: '\u26CF Pool' },
    { value: 'alert-synthesizer', label: '\uD83D\uDD14 Alerts' },
    { value: 'reporting-engine', label: '\uD83D\uDCCA Reports' },
  ];

  return (
    <Panel
      title="Agent Activity"
      source="agents/activity"
      lastUpdated={lastFetched}
      loading={loading}
      error={error}
      onRefresh={refetch}
      headerRight={
        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-[10px] text-terminal-text"
        >
          {filterOptions.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      }
    >
      <div className="space-y-4">
        {Object.entries(grouped).map(([date, dayEvents]) => (
          <div key={date}>
            <p className="text-[10px] text-terminal-muted uppercase tracking-wider mb-2">{date}</p>
            <div className="space-y-1">
              {dayEvents.map((event) => {
                const icon = AGENT_ICONS[event.agent_id] || '\uD83E\uDD16';
                const agentColor = AGENT_COLORS[event.agent_id] || 'text-terminal-muted';
                const badge = TYPE_BADGES[event.event_type] || { label: event.event_type, color: 'text-terminal-muted' };

                return (
                  <div key={event.id} className="flex items-start gap-2 py-1.5 border-b border-terminal-border/20 last:border-0">
                    <span className="text-[10px] text-terminal-muted w-10 shrink-0 pt-0.5 font-mono">
                      {formatTime(event.timestamp)}
                    </span>
                    <span className="text-xs shrink-0">{icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-medium ${agentColor}`}>
                          {event.agent_id?.split('-')[0]}
                        </span>
                        <span className={`text-[10px] ${badge.color}`}>
                          {badge.label}
                        </span>
                      </div>
                      <p className="text-xs text-terminal-text mt-0.5 truncate">
                        {event.summary}
                      </p>
                      {event.financial_impact != null && event.financial_impact !== 0 && (
                        <p className={`text-[10px] mt-0.5 ${event.financial_impact >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
                          {event.financial_impact >= 0 ? '+' : ''}${Math.abs(event.financial_impact).toFixed(2)}/hr
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {events.length === 0 && !loading && (
          <div className="text-center py-8">
            <p className="text-sm text-terminal-muted">No agent activity yet</p>
            <p className="text-xs text-terminal-muted mt-1">Start agents to see their activity here</p>
          </div>
        )}

        {events.length >= limit && (
          <button
            onClick={() => setLimit(prev => prev + 50)}
            className="w-full py-2 text-xs text-terminal-muted hover:text-terminal-text border-t border-terminal-border/30 transition-colors"
          >
            Load More
          </button>
        )}
      </div>
    </Panel>
  );
}

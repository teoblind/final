import React from 'react';
import Panel from '../../Panel';
import { useApi } from '../../../hooks/useApi';

const STATUS_COLORS = {
  active: 'bg-green-500',
  idle: 'bg-yellow-500',
  offline: 'bg-terminal-red',
  unknown: 'bg-terminal-muted',
};

const STATUS_LABELS = {
  active: 'Running',
  idle: 'Idle',
  offline: 'Offline',
  unknown: 'Unknown',
};

const ICON_MAP = {
  zap: '\u26A1',
  mic: '\uD83C\uDFA4',
  video: '\uD83D\uDCF9',
};

function timeAgo(timestamp) {
  if (!timestamp) return 'Never';
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

export default function BotStatusPanel() {
  const { data, loading, error, lastFetched, refetch } = useApi(
    '/bots/status',
    { refreshInterval: 30000 }
  );

  const bots = data?.bots || [];

  return (
    <Panel
      title="Bot Status"
      source="bots/status"
      lastUpdated={lastFetched}
      loading={loading}
      error={error}
      onRefresh={refetch}
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {bots.map(bot => (
          <div
            key={bot.id}
            className="bg-terminal-bg/50 border border-terminal-border/50 rounded-lg p-3"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm">{ICON_MAP[bot.icon] || '\uD83E\uDD16'}</span>
                <span className="text-xs font-medium text-terminal-text">{bot.name}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[bot.status] || STATUS_COLORS.unknown}`} />
                <span className="text-[10px] text-terminal-muted">
                  {STATUS_LABELS[bot.status] || bot.status}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-terminal-muted">
                Last active: {timeAgo(bot.lastActivity)}
              </p>
              {bot.ownerName && (
                <div className="flex items-center gap-1">
                  <div className="w-4 h-4 rounded-full bg-terminal-border flex items-center justify-center">
                    <span className="text-[7px] text-terminal-text font-medium">{getInitials(bot.ownerName)}</span>
                  </div>
                  <span className="text-[9px] text-terminal-muted">{bot.ownerName.split(' ')[0]}</span>
                </div>
              )}
            </div>
          </div>
        ))}

        {bots.length === 0 && !loading && (
          <div className="col-span-3 text-center py-4">
            <p className="text-xs text-terminal-muted">No bots detected</p>
          </div>
        )}
      </div>
    </Panel>
  );
}

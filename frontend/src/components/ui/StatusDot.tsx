import React from 'react';
import type { PanelStatus } from '../../types';

interface StatusDotProps {
  status: PanelStatus;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

const statusColors: Record<PanelStatus, string> = {
  connected: 'bg-terminal-green',
  stale: 'bg-terminal-amber',
  error: 'bg-terminal-red',
  loading: 'bg-terminal-blue animate-pulse',
};

const statusLabels: Record<PanelStatus, string> = {
  connected: 'Connected',
  stale: 'Stale',
  error: 'Error',
  loading: 'Loading',
};

export default function StatusDot({ status, size = 'sm', showLabel = false }: StatusDotProps) {
  const sizeClass = size === 'sm' ? 'w-2 h-2' : 'w-3 h-3';

  return (
    <div className="flex items-center gap-1.5" title={statusLabels[status]}>
      <div className={`${sizeClass} rounded-full ${statusColors[status]}`} />
      {showLabel && (
        <span className="text-xs text-terminal-muted">{statusLabels[status]}</span>
      )}
    </div>
  );
}

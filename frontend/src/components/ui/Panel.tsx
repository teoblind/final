import React, { useRef } from 'react';
import { RefreshCw, Download, AlertTriangle, Camera } from 'lucide-react';
import html2canvas from 'html2canvas';
import type { PanelAction, PanelSource, PanelStatus } from '../../types';
import { formatTimeAgo } from '../../lib/utils/formatters';
import StatusDot from './StatusDot';

export interface PanelProps {
  title: string;
  subtitle?: string;
  source?: PanelSource;
  /** @deprecated Use source prop instead. Kept for backward compat with existing panels. */
  sourceName?: string;
  /** @deprecated Use source prop instead. */
  lastUpdated?: string | Date | null;
  timeframes?: string[];
  selectedTimeframe?: string;
  onTimeframeChange?: (tf: string) => void;
  onRefresh?: () => void;
  onExport?: () => void;
  actions?: PanelAction[];
  status?: PanelStatus;
  /** @deprecated Use status prop instead. */
  isStale?: boolean;
  /** @deprecated Use status prop instead. */
  loading?: boolean;
  /** @deprecated Use status prop instead. */
  error?: string | null;
  headerRight?: React.ReactNode;
  compact?: boolean;
  className?: string;
  children: React.ReactNode;
}

export default function Panel({
  title,
  subtitle,
  source,
  sourceName,
  lastUpdated,
  timeframes,
  selectedTimeframe,
  onTimeframeChange,
  onRefresh,
  onExport,
  actions,
  status,
  isStale,
  loading,
  error,
  headerRight,
  compact = false,
  className = '',
  children,
}: PanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Resolve status from legacy props if not explicitly set
  const resolvedStatus: PanelStatus | undefined =
    status ?? (error ? 'error' : loading ? 'loading' : isStale ? 'stale' : undefined);

  const resolvedSourceName = source?.name ?? sourceName;
  const resolvedUpdatedAt = source?.updatedAt ?? lastUpdated;

  const handleScreenshot = async () => {
    if (!panelRef.current) return;
    try {
      const canvas = await html2canvas(panelRef.current, {
        backgroundColor: '#111111',
        scale: 2,
      });
      const link = document.createElement('a');
      link.download = `${title.replace(/\s+/g, '_').toLowerCase()}_${new Date().toISOString().split('T')[0]}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error('Screenshot failed:', err);
    }
  };

  return (
    <div
      ref={panelRef}
      className={`bg-terminal-panel border border-terminal-border rounded-lg overflow-hidden ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-terminal-border bg-terminal-bg/50">
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <h3 className="font-semibold text-terminal-text truncate">{title}</h3>
            {subtitle && (
              <p className="text-xs text-terminal-muted truncate">{subtitle}</p>
            )}
          </div>
          {resolvedStatus === 'stale' && (
            <span className="flex items-center gap-1 text-terminal-amber text-xs whitespace-nowrap">
              <AlertTriangle size={12} />
              stale
            </span>
          )}
          {resolvedStatus && (
            <StatusDot status={resolvedStatus} />
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Timeframe selector */}
          {timeframes && onTimeframeChange && (
            <div className="flex gap-1">
              {timeframes.map(tf => (
                <button
                  key={tf}
                  onClick={() => onTimeframeChange(tf.toLowerCase())}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    selectedTimeframe === tf.toLowerCase()
                      ? 'bg-terminal-green/20 text-terminal-green border border-terminal-green/30'
                      : 'text-terminal-muted hover:text-terminal-text hover:bg-terminal-border'
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
          )}

          {headerRight}

          {/* Custom actions */}
          {actions?.map(action => (
            <button
              key={action.id}
              onClick={action.onClick}
              className="p-1.5 hover:bg-terminal-border rounded transition-colors"
              title={action.label}
            >
              {action.icon}
            </button>
          ))}

          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={resolvedStatus === 'loading'}
              className="p-1.5 hover:bg-terminal-border rounded transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw size={14} className={resolvedStatus === 'loading' ? 'animate-spin' : ''} />
            </button>
          )}

          <button
            onClick={handleScreenshot}
            className="p-1.5 hover:bg-terminal-border rounded transition-colors"
            title="Screenshot"
          >
            <Camera size={14} />
          </button>

          {onExport && (
            <button
              onClick={onExport}
              className="p-1.5 hover:bg-terminal-border rounded transition-colors"
              title="Export CSV"
            >
              <Download size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Source attribution */}
      {(resolvedSourceName || resolvedUpdatedAt) && (
        <DataSourceBar source={resolvedSourceName} updatedAt={resolvedUpdatedAt} />
      )}

      {/* Content */}
      <div className={compact ? 'p-2' : 'p-4'}>
        {resolvedStatus === 'loading' && !children ? (
          <div className="flex items-center justify-center py-12">
            <div className="spinner w-8 h-8" />
          </div>
        ) : resolvedStatus === 'error' && error ? (
          <div className="flex flex-col items-center justify-center py-8 text-terminal-red">
            <AlertTriangle size={24} className="mb-2" />
            <p className="text-sm">{error}</p>
            {onRefresh && (
              <button
                onClick={onRefresh}
                className="mt-3 px-3 py-1 text-xs border border-terminal-red rounded hover:bg-terminal-red/10"
              >
                Retry
              </button>
            )}
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}

// Sub-components co-located with Panel for convenience

function DataSourceBar({ source, updatedAt }: { source?: string; updatedAt?: Date | string | null }) {
  return (
    <div className="px-4 py-1.5 text-xs text-terminal-muted border-b border-terminal-border flex justify-between">
      {source && <span>Source: {source}</span>}
      {updatedAt && <span>Updated: {formatTimeAgo(updatedAt)}</span>}
    </div>
  );
}

export { DataSourceBar };

import React from 'react';
import { RefreshCw, Download, AlertTriangle, Camera } from 'lucide-react';
import { formatTimeAgo } from '../utils/formatters';
import html2canvas from 'html2canvas';

export default function Panel({
  title,
  source,
  lastUpdated,
  isStale,
  loading,
  error,
  children,
  onRefresh,
  onExport,
  className = '',
  headerRight,
  compact = false
}) {
  const panelRef = React.useRef(null);

  const handleScreenshot = async () => {
    if (!panelRef.current) return;

    try {
      const canvas = await html2canvas(panelRef.current, {
        backgroundColor: '#111111',
        scale: 2
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
          <h3 className="font-semibold text-terminal-text truncate">{title}</h3>
          {isStale && (
            <span className="flex items-center gap-1 text-terminal-amber text-xs">
              <AlertTriangle size={12} />
              stale
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {headerRight}

          {onRefresh && (
            <button
              onClick={onRefresh}
              disabled={loading}
              className="p-1.5 hover:bg-terminal-border rounded transition-colors disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
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

      {/* Meta info */}
      <div className="px-4 py-1.5 text-xs text-terminal-muted border-b border-terminal-border flex justify-between">
        <span>Source: {source}</span>
        {lastUpdated && (
          <span>Updated: {formatTimeAgo(lastUpdated)}</span>
        )}
      </div>

      {/* Content */}
      <div className={`${compact ? 'p-2' : 'p-4'}`}>
        {loading && !children ? (
          <div className="flex items-center justify-center py-12">
            <div className="spinner w-8 h-8" />
          </div>
        ) : error ? (
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

// Stat display component
export function Stat({ label, value, change, changeLabel, size = 'default' }) {
  const isPositive = change > 0;
  const changeColor = change > 0 ? 'text-terminal-green' : change < 0 ? 'text-terminal-red' : 'text-terminal-muted';

  return (
    <div className={size === 'large' ? 'text-center' : ''}>
      <p className="text-terminal-muted text-xs uppercase tracking-wider">{label}</p>
      <p className={`font-bold ${size === 'large' ? 'text-3xl text-terminal-green' : 'text-xl'}`}>
        {value}
      </p>
      {change !== undefined && (
        <p className={`text-xs ${changeColor}`}>
          {isPositive ? '+' : ''}{typeof change === 'number' ? change.toFixed(2) : change}
          {changeLabel ? ` ${changeLabel}` : ''}
        </p>
      )}
    </div>
  );
}

// Mini chart for stats
export function MiniChart({ data, color = 'green', height = 40 }) {
  if (!data || data.length < 2) return null;

  const values = data.map(d => typeof d === 'number' ? d : d.value || d.y);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * 100;
    const y = ((max - v) / range) * height;
    return `${x},${y}`;
  }).join(' ');

  const colorMap = {
    green: '#00d26a',
    red: '#ff3b30',
    amber: '#ffb800',
    blue: '#007aff',
    cyan: '#00d4ff'
  };

  return (
    <svg width="100%" height={height} className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke={colorMap[color] || color}
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// Period selector
export function PeriodSelector({ value, onChange, options = ['1D', '1W', '1M', '3M', '1Y'] }) {
  return (
    <div className="flex gap-1">
      {options.map(period => (
        <button
          key={period}
          onClick={() => onChange(period.toLowerCase())}
          className={`px-2 py-1 text-xs rounded transition-colors ${
            value === period.toLowerCase()
              ? 'bg-terminal-green/20 text-terminal-green border border-terminal-green/30'
              : 'text-terminal-muted hover:text-terminal-text hover:bg-terminal-border'
          }`}
        >
          {period}
        </button>
      ))}
    </div>
  );
}

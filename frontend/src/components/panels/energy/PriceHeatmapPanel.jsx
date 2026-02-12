import React, { useState, useMemo } from 'react';
import { Info } from 'lucide-react';
import Panel from '../../Panel';
import { useApi } from '../../../hooks/useApi';
import { formatNumber } from '../../../utils/formatters';

/**
 * Panel 3c: Price Heatmap
 * Shows price patterns over time (hour of day vs date) with color intensity.
 * Helps miners identify systematic curtailment windows.
 */
export default function PriceHeatmapPanel() {
  const [node, setNode] = useState('HB_NORTH');
  const [days, setDays] = useState(14);

  const { data, loading, error, lastFetched, isStale, refetch } = useApi(
    '/energy/heatmap',
    { params: { node, iso: 'ERCOT', days }, refreshInterval: 30 * 60 * 1000 }
  );

  // Build heatmap grid: rows = dates, cols = hours (0-23)
  const { grid, dates, priceRange } = useMemo(() => {
    if (!data?.data?.length) return { grid: [], dates: [], priceRange: { min: 0, max: 100 } };

    const allPrices = [];
    const grid = [];
    const dates = [];

    data.data.forEach(dayData => {
      dates.push(dayData.date);
      const row = new Array(24).fill(null);
      dayData.hours.forEach(h => {
        row[h.hour] = h.avgPrice;
        allPrices.push(h.avgPrice);
      });
      grid.push(row);
    });

    const min = Math.min(...allPrices);
    const max = Math.max(...allPrices);
    return { grid, dates, priceRange: { min, max } };
  }, [data]);

  // Color mapping: green (cheap) -> yellow -> red (expensive), cyan for negative
  function getCellColor(price) {
    if (price === null) return '#1e1e1e';
    if (price < 0) return '#00d4ff';

    const { min, max } = priceRange;
    const range = Math.max(max - Math.max(min, 0), 1);
    const normalized = Math.max(0, Math.min(1, (price - Math.max(min, 0)) / range));

    if (normalized < 0.25) return `rgba(0, 210, 106, ${0.3 + normalized * 2.8})`;
    if (normalized < 0.5) return `rgba(255, 184, 0, ${0.3 + (normalized - 0.25) * 2.8})`;
    return `rgba(255, 59, 48, ${0.3 + (normalized - 0.5) * 1.4})`;
  }

  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <Panel
      title="Price Heatmap"
      source={data?.source || 'ERCOT'}
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
      headerRight={
        <div className="flex gap-1">
          {[7, 14, 30].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                days === d
                  ? 'bg-terminal-green/20 text-terminal-green border border-terminal-green/30'
                  : 'text-terminal-muted hover:text-terminal-text hover:bg-terminal-border'
              }`}
            >
              {d}D
            </button>
          ))}
        </div>
      }
    >
      {/* Legend */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-terminal-muted">{node} — Last {days} days</span>
        <div className="flex items-center gap-1 text-xs text-terminal-muted">
          <span>Cheap</span>
          <div className="flex">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(0, 210, 106, 0.7)' }} />
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(255, 184, 0, 0.7)' }} />
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(255, 59, 48, 0.7)' }} />
          </div>
          <span>Expensive</span>
        </div>
      </div>

      {/* Heatmap grid */}
      <div className="overflow-x-auto">
        <div style={{ minWidth: 500 }}>
          {/* Hour labels */}
          <div className="flex mb-1">
            <div className="w-16 flex-shrink-0" />
            {hours.map(h => (
              <div key={h} className="flex-1 text-center text-[9px] text-terminal-muted">
                {h % 3 === 0 ? `${String(h).padStart(2, '0')}` : ''}
              </div>
            ))}
          </div>

          {/* Rows */}
          {grid.map((row, ri) => (
            <div key={dates[ri]} className="flex mb-px">
              <div className="w-16 flex-shrink-0 text-[10px] text-terminal-muted pr-1 text-right leading-4">
                {dates[ri]?.slice(5)}
              </div>
              {row.map((price, ci) => (
                <div
                  key={ci}
                  className="flex-1 h-4 mx-px rounded-sm cursor-crosshair"
                  style={{ backgroundColor: getCellColor(price) }}
                  title={price != null ? `${dates[ri]} ${String(ci).padStart(2, '0')}:00 — $${formatNumber(price, 2)}/MWh` : 'No data'}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Summary insights */}
      {grid.length > 0 && (
        <div className="mt-3 pt-3 border-t border-terminal-border text-xs text-terminal-muted">
          <p>
            Price range: <span className="text-terminal-green">${formatNumber(priceRange.min, 2)}</span>
            {' — '}
            <span className="text-terminal-red">${formatNumber(priceRange.max, 2)}</span>/MWh
          </p>
        </div>
      )}
    </Panel>
  );
}

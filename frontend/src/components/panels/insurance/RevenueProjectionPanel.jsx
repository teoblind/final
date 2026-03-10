import React, { useState, useMemo } from 'react';
import { TrendingUp, BarChart3, Info } from 'lucide-react';
import Panel from '../../Panel';
import GlossaryTerm from '../../GlossaryTerm';
import { useApi } from '../../../hooks/useApi';
import { formatNumber, formatCurrency } from '../../../utils/formatters';

const HORIZONS = [
  { key: '12m', label: '12M', months: 12 },
  { key: '24m', label: '24M', months: 24 },
  { key: '36m', label: '36M', months: 36 },
];

const PERCENTILE_BANDS = [
  { key: 'p90', label: 'P90 (Optimistic)', color: '#00d26a', opacity: 0.15 },
  { key: 'p75', label: 'P75', color: '#00d26a', opacity: 0.25 },
  { key: 'p50', label: 'P50 (Median)', color: '#00d4ff', opacity: 0.35 },
  { key: 'p25', label: 'P25', color: '#ffb800', opacity: 0.25 },
  { key: 'p10', label: 'P10 (Pessimistic)', color: '#ff3b30', opacity: 0.15 },
];

/**
 * Panel 9b: Revenue Projection Fan Chart
 * Visualizes p10/p25/p50/p75/p90 revenue bands over 12/24/36 month horizons
 * with breakeven overlay and monthly projected revenue table.
 */
export default function RevenueProjectionPanel() {
  const [horizon, setHorizon] = useState('12m');

  const { data, loading, error, lastFetched, isStale, refetch } = useApi(
    '/v1/insurance/risk-profile',
    { refreshInterval: 5 * 60 * 1000 }
  );

  const assessment = data?.assessment;
  const projections = assessment?.revenueProjections;
  const breakeven = assessment?.breakevenHashprice;

  const horizonConfig = HORIZONS.find(h => h.key === horizon);
  const monthCount = horizonConfig?.months || 12;

  // Build projection data for the selected horizon
  const projectionData = useMemo(() => {
    if (!projections) return [];
    const months = projections[horizon] || projections.default || [];
    return months.slice(0, monthCount);
  }, [projections, horizon, monthCount]);

  const hasData = projectionData.length > 0;

  // Compute chart SVG dimensions
  const chartWidth = 560;
  const chartHeight = 200;
  const paddingLeft = 50;
  const paddingRight = 20;
  const paddingTop = 10;
  const paddingBottom = 30;
  const plotWidth = chartWidth - paddingLeft - paddingRight;
  const plotHeight = chartHeight - paddingTop - paddingBottom;

  // Compute min/max across all percentiles for scaling
  const { minVal, maxVal } = useMemo(() => {
    if (!hasData) return { minVal: 0, maxVal: 100 };
    let min = Infinity;
    let max = -Infinity;
    projectionData.forEach(m => {
      ['p10', 'p25', 'p50', 'p75', 'p90'].forEach(p => {
        const v = m[p];
        if (v != null) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      });
    });
    if (breakeven != null) {
      if (breakeven < min) min = breakeven * 0.9;
      if (breakeven > max) max = breakeven * 1.1;
    }
    const padding = (max - min) * 0.1 || 10;
    return { minVal: min - padding, maxVal: max + padding };
  }, [projectionData, breakeven, hasData]);

  const scaleX = (i) => paddingLeft + (i / Math.max(projectionData.length - 1, 1)) * plotWidth;
  const scaleY = (v) => paddingTop + plotHeight - ((v - minVal) / (maxVal - minVal || 1)) * plotHeight;

  // Build SVG path for a given percentile key
  const buildLine = (key) => {
    return projectionData.map((m, i) => {
      const x = scaleX(i);
      const y = scaleY(m[key] || 0);
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).join(' ');
  };

  // Build fill area between two percentile lines (upper, lower)
  const buildArea = (upperKey, lowerKey) => {
    const upper = projectionData.map((m, i) => `${scaleX(i)},${scaleY(m[upperKey] || 0)}`).join(' ');
    const lower = projectionData.map((m, i) => `${scaleX(i)},${scaleY(m[lowerKey] || 0)}`).reverse().join(' ');
    return `${upper} ${lower}`;
  };

  return (
    <Panel
      title="Revenue Projections"
      source={data?.source || 'SanghaModel'}
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
      headerRight={
        <div className="flex items-center gap-2">
          <TrendingUp size={14} className="text-terminal-cyan" />
        </div>
      }
    >
      {!assessment && !loading ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <BarChart3 size={40} className="text-terminal-muted mb-3" />
          <p className="text-sm text-terminal-muted mb-1">No projection data available</p>
          <p className="text-xs text-terminal-muted">
            Run a risk assessment to view revenue projections.
          </p>
        </div>
      ) : hasData ? (
        <div className="space-y-4">
          {/* Horizon Tabs */}
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              {HORIZONS.map(h => (
                <button
                  key={h.key}
                  onClick={() => setHorizon(h.key)}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    horizon === h.key
                      ? 'bg-terminal-cyan/20 text-terminal-cyan border border-terminal-cyan/30'
                      : 'text-terminal-muted hover:text-terminal-text hover:bg-terminal-border'
                  }`}
                >
                  {h.label}
                </button>
              ))}
            </div>
            <span className="text-[10px] text-terminal-muted">
              {projectionData.length} months projected
            </span>
          </div>

          {/* Fan Chart SVG */}
          <div className="bg-terminal-bg/50 rounded border border-terminal-border p-2 overflow-x-auto">
            <svg
              width="100%"
              height={chartHeight}
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              preserveAspectRatio="xMidYMid meet"
              className="w-full"
            >
              {/* Fan bands */}
              <polygon
                points={buildArea('p90', 'p75')}
                fill="#00d26a"
                opacity="0.1"
              />
              <polygon
                points={buildArea('p75', 'p50')}
                fill="#00d4ff"
                opacity="0.15"
              />
              <polygon
                points={buildArea('p50', 'p25')}
                fill="#ffb800"
                opacity="0.15"
              />
              <polygon
                points={buildArea('p25', 'p10')}
                fill="#ff3b30"
                opacity="0.1"
              />

              {/* Percentile lines */}
              <path d={buildLine('p90')} fill="none" stroke="#00d26a" strokeWidth="1" opacity="0.5" />
              <path d={buildLine('p75')} fill="none" stroke="#00d26a" strokeWidth="1" opacity="0.7" />
              <path d={buildLine('p50')} fill="none" stroke="#00d4ff" strokeWidth="2" />
              <path d={buildLine('p25')} fill="none" stroke="#ffb800" strokeWidth="1" opacity="0.7" />
              <path d={buildLine('p10')} fill="none" stroke="#ff3b30" strokeWidth="1" opacity="0.5" />

              {/* Breakeven line */}
              {breakeven != null && (
                <line
                  x1={paddingLeft}
                  y1={scaleY(breakeven)}
                  x2={chartWidth - paddingRight}
                  y2={scaleY(breakeven)}
                  stroke="#ff3b30"
                  strokeWidth="1"
                  strokeDasharray="6,3"
                  opacity="0.6"
                />
              )}
              {breakeven != null && (
                <text
                  x={chartWidth - paddingRight + 2}
                  y={scaleY(breakeven) - 4}
                  fill="#ff3b30"
                  style={{ fontSize: '9px' }}
                  opacity="0.8"
                >
                  BE
                </text>
              )}

              {/* Y-axis labels */}
              {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
                const val = minVal + frac * (maxVal - minVal);
                const y = scaleY(val);
                return (
                  <g key={frac}>
                    <line
                      x1={paddingLeft}
                      y1={y}
                      x2={chartWidth - paddingRight}
                      y2={y}
                      stroke="#333"
                      strokeWidth="0.5"
                    />
                    <text
                      x={paddingLeft - 5}
                      y={y + 3}
                      textAnchor="end"
                      fill="#666"
                      style={{ fontSize: '9px' }}
                    >
                      ${formatNumber(val, 0)}
                    </text>
                  </g>
                );
              })}

              {/* X-axis labels (every 3 months) */}
              {projectionData.map((m, i) => {
                if (i % 3 !== 0 && i !== projectionData.length - 1) return null;
                return (
                  <text
                    key={i}
                    x={scaleX(i)}
                    y={chartHeight - 5}
                    textAnchor="middle"
                    fill="#666"
                    style={{ fontSize: '9px' }}
                  >
                    {m.label || `M${i + 1}`}
                  </text>
                );
              })}
            </svg>
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-3 justify-center">
            {PERCENTILE_BANDS.map(band => (
              <div key={band.key} className="flex items-center gap-1.5 text-[10px] text-terminal-muted">
                <span
                  className="w-3 h-0.5 inline-block rounded"
                  style={{ backgroundColor: band.color }}
                />
                {band.label}
              </div>
            ))}
            <div className="flex items-center gap-1.5 text-[10px] text-terminal-muted">
              <span className="w-3 h-0 inline-block border-t border-dashed border-terminal-red" />
              Breakeven
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-terminal-muted">
              <span className="w-3 h-0 inline-block border-t border-dashed border-terminal-cyan" />
              <GlossaryTerm id="revenue_floor">Revenue Floor</GlossaryTerm>
            </div>
          </div>

          {/* Monthly Revenue Table (condensed) */}
          <div className="border-t border-terminal-border pt-3">
            <p className="text-xs font-semibold text-terminal-text mb-2">Monthly Revenue by Percentile</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-terminal-border">
                    <th className="text-left py-1 text-terminal-muted font-normal">Month</th>
                    <th className="text-right py-1 text-terminal-red/70 font-normal">P10</th>
                    <th className="text-right py-1 text-terminal-amber font-normal">P25</th>
                    <th className="text-right py-1 text-terminal-cyan font-normal">P50</th>
                    <th className="text-right py-1 text-terminal-green/70 font-normal">P75</th>
                    <th className="text-right py-1 text-terminal-green font-normal">P90</th>
                  </tr>
                </thead>
                <tbody>
                  {projectionData.filter((_, i) => i % 3 === 0 || i === projectionData.length - 1).map((m, i) => (
                    <tr key={i} className="border-b border-terminal-border/30">
                      <td className="py-1 text-terminal-muted">{m.label || `M${(projectionData.indexOf(m)) + 1}`}</td>
                      <td className="text-right py-1 font-sans text-terminal-red/70">{formatCurrency(m.p10, 'USD', 0)}</td>
                      <td className="text-right py-1 font-sans text-terminal-amber">{formatCurrency(m.p25, 'USD', 0)}</td>
                      <td className="text-right py-1 font-sans text-terminal-cyan">{formatCurrency(m.p50, 'USD', 0)}</td>
                      <td className="text-right py-1 font-sans text-terminal-green/70">{formatCurrency(m.p75, 'USD', 0)}</td>
                      <td className="text-right py-1 font-sans text-terminal-green">{formatCurrency(m.p90, 'USD', 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Info note */}
          <div className="flex items-start gap-2 text-[10px] text-terminal-muted pt-2">
            <Info size={10} className="mt-0.5 flex-shrink-0" />
            <span>Projections based on <GlossaryTerm id="hashprice">hashprice</GlossaryTerm> distribution models. Actual revenue depends on network conditions, energy costs, and operational factors.</span>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

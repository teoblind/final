import React from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Info } from 'lucide-react';
import Panel from '../../Panel';
import { useApi } from '../../../hooks/useApi';
import { formatNumber, formatCompact } from '../../../utils/formatters';

const FUEL_COLORS = {
  'Natural Gas': '#ffb800',
  'Wind': '#00d4ff',
  'Solar': '#ffdd00',
  'Nuclear': '#af52de',
  'Coal': '#666666',
  'Other': '#333333',
  'Hydro': '#007aff',
};

/**
 * Panel 3e: Generation Mix
 * Shows current ERCOT generation breakdown by fuel type.
 * Useful context: negative pricing often correlates with high wind/solar periods.
 */
export default function GenerationMixPanel() {
  const { data, loading, error, lastFetched, isStale, refetch } = useApi(
    '/energy/fuelmix',
    { refreshInterval: 15 * 60 * 1000 }
  );

  const isMock = data?.isMock;
  const breakdown = data?.breakdown || [];
  const total = data?.total;

  const chartData = breakdown.map(b => ({
    name: b.fuel,
    value: b.mw,
    pct: b.pct,
    color: FUEL_COLORS[b.fuel] || '#333',
  }));

  return (
    <Panel
      title="Generation Mix"
      source={data?.source || 'EIA / ERCOT'}
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
    >
      {isMock && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-terminal-amber/10 border border-terminal-amber/20 rounded text-xs text-terminal-amber">
          <Info size={14} />
          <span>Simulated — configure EIA_API_KEY for live data</span>
        </div>
      )}

      {/* Total generation */}
      {total && (
        <div className="text-center mb-3">
          <p className="text-xs text-terminal-muted">Total Generation</p>
          <p className="text-2xl font-bold">{formatCompact(total)} <span className="text-sm text-terminal-muted">MW</span></p>
        </div>
      )}

      {/* Donut chart */}
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={40}
              outerRadius={65}
              dataKey="value"
              stroke="#0a0a0a"
              strokeWidth={2}
            >
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '4px' }}
              formatter={(value, name) => [`${formatCompact(value)} MW (${chartData.find(d => d.name === name)?.pct}%)`, name]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Legend table */}
      <div className="space-y-1 mt-2">
        {breakdown.map(b => (
          <div key={b.fuel} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: FUEL_COLORS[b.fuel] || '#333' }} />
              <span className="text-terminal-text">{b.fuel}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-terminal-muted">{formatCompact(b.mw)} MW</span>
              <span className="font-sans w-8 text-right">{b.pct}%</span>
            </div>
          </div>
        ))}
      </div>

      {/* Context note */}
      <p className="text-xs text-terminal-muted mt-3 pt-3 border-t border-terminal-border">
        High wind/solar output often drives negative pricing — ideal for mining operations.
      </p>
    </Panel>
  );
}

import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import { Info } from 'lucide-react';
import Panel from '../../Panel';
import { useApi } from '../../../hooks/useApi';
import { formatNumber } from '../../../utils/formatters';

/**
 * Panel 3b: Day-Ahead Price Curve
 * Shows tomorrow's (or today's) hourly DAM prices with threshold highlighting.
 */
export default function DayAheadPanel() {
  const [node, setNode] = useState('HB_NORTH');
  const [view, setView] = useState('tomorrow');

  const datePicker = view === 'today'
    ? new Date().toISOString().split('T')[0]
    : view === 'tomorrow'
      ? new Date(Date.now() + 86400000).toISOString().split('T')[0]
      : undefined;

  const { data, loading, error, lastFetched, isStale, refetch } = useApi(
    '/energy/dayahead',
    { params: { node, iso: 'ERCOT', date: datePicker }, refreshInterval: 30 * 60 * 1000 }
  );

  const isMock = data?.isMock;
  const prices = data?.dayAheadPrices || [];
  const dailyAvg = data?.dailyAvg;

  // Configurable thresholds (from settings eventually)
  const highThreshold = 50;
  const lowThreshold = 15;

  const chartData = prices.map(p => ({
    hour: `${String(p.hour).padStart(2, '0')}:00`,
    lmp: p.lmp,
    hourNum: p.hour,
  }));

  const getBarColor = (lmp) => {
    if (lmp < 0) return '#00d4ff';       // Negative = cyan (bonus!)
    if (lmp <= lowThreshold) return '#00d26a'; // Cheap = green (mine!)
    if (lmp >= highThreshold) return '#ff3b30'; // Expensive = red (curtail!)
    if (lmp >= highThreshold * 0.7) return '#ffb800'; // Getting pricey = amber
    return '#666666';                    // Normal = muted
  };

  return (
    <Panel
      title="Day-Ahead Prices"
      source={data?.source || 'ERCOT DAM'}
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
      headerRight={
        <div className="flex gap-1">
          {['today', 'tomorrow'].map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-2 py-1 text-xs rounded transition-colors capitalize ${
                view === v
                  ? 'bg-terminal-green/20 text-terminal-green border border-terminal-green/30'
                  : 'text-terminal-muted hover:text-terminal-text hover:bg-terminal-border'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      }
    >
      {isMock && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-terminal-amber/10 border border-terminal-amber/20 rounded text-xs text-terminal-amber">
          <Info size={14} />
          <span>Simulated data</span>
        </div>
      )}

      {/* Summary */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="text-xs text-terminal-muted">Daily Avg: </span>
          <span className="font-sans text-sm">${dailyAvg != null ? formatNumber(dailyAvg, 2) : '-'}/MWh</span>
        </div>
        <div className="flex gap-3 text-xs">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-terminal-green" /> &lt;${lowThreshold}</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-terminal-muted" /> Normal</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-terminal-red" /> &gt;${highThreshold}</span>
        </div>
      </div>

      {/* Bar chart */}
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <XAxis
              dataKey="hour"
              stroke="#666"
              fontSize={9}
              tickLine={false}
              interval={2}
            />
            <YAxis
              stroke="#666"
              fontSize={10}
              tickLine={false}
              tickFormatter={v => `$${v}`}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '4px' }}
              formatter={(value) => [`$${formatNumber(value, 2)}/MWh`, 'LMP']}
              labelFormatter={(label) => `Hour: ${label}`}
            />
            {dailyAvg != null && (
              <ReferenceLine
                y={dailyAvg}
                stroke="#00d4ff"
                strokeDasharray="3 3"
                label={{ value: 'Avg', fill: '#00d4ff', fontSize: 10, position: 'right' }}
              />
            )}
            <Bar dataKey="lmp" radius={[2, 2, 0, 0]}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={getBarColor(entry.lmp)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Mining recommendation */}
      {prices.length > 0 && (
        <div className="mt-3 pt-3 border-t border-terminal-border">
          <p className="text-xs text-terminal-muted mb-1">Optimal mining hours (below ${lowThreshold}/MWh):</p>
          <div className="flex flex-wrap gap-1">
            {prices.filter(p => p.lmp <= lowThreshold).map(p => (
              <span key={p.hour} className="px-2 py-0.5 bg-terminal-green/20 text-terminal-green text-xs rounded">
                {String(p.hour).padStart(2, '0')}:00
              </span>
            ))}
            {prices.filter(p => p.lmp <= lowThreshold).length === 0 && (
              <span className="text-xs text-terminal-muted italic">None - consider curtailing all day</span>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

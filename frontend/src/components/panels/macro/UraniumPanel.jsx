import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import Panel from '../../Panel';
import { useApi } from '../../../hooks/useApi';
import { formatNumber, formatDate, formatPercent, exportToCSV } from '../../../utils/formatters';

export default function UraniumPanel() {
  const { data, loading, error, lastFetched, isStale, refetch } = useApi(
    '/uranium',
    { refreshInterval: 24 * 60 * 60 * 1000 } // 24 hours (weekly data)
  );

  const spot = data?.spot || {};
  const term = data?.term || {};
  const spread = data?.spread;
  const keyEvents = data?.keyEvents || [];

  // Combine spot and term history for chart
  const chartData = [];
  const spotMap = new Map((spot.history || []).map(d => [d.date, d.value]));
  const termMap = new Map((term.history || []).map(d => [d.date, d.value]));
  const allDates = [...new Set([...spotMap.keys(), ...termMap.keys()])].sort();

  allDates.forEach(date => {
    chartData.push({
      date,
      spot: spotMap.get(date) || null,
      term: termMap.get(date) || null
    });
  });

  const handleExport = () => {
    if (chartData.length) {
      exportToCSV(chartData, 'uranium_prices');
    }
  };

  return (
    <Panel
      title="Uranium Spot & Term Prices"
      source={data?.sources?.primary?.join(', ') || 'UxC, TradeTech'}
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
      onExport={handleExport}
    >
      {/* Current Prices */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-terminal-green/10 border border-terminal-green/30 rounded p-3">
          <p className="text-xs text-terminal-muted">Spot Price (U3O8)</p>
          <p className="text-2xl font-bold text-terminal-green">
            {spot.current ? `$${formatNumber(spot.current, 2)}/lb` : 'No data'}
          </p>
        </div>
        <div className="bg-terminal-blue/10 border border-terminal-blue/30 rounded p-3">
          <p className="text-xs text-terminal-muted">Term Price</p>
          <p className="text-2xl font-bold text-terminal-blue">
            {term.current ? `$${formatNumber(term.current, 2)}/lb` : 'No data'}
          </p>
        </div>
      </div>

      {/* Spread */}
      {spread && (
        <div className="bg-terminal-bg/50 rounded p-2 mb-4 text-center">
          <p className="text-xs text-terminal-muted">Term-Spot Spread</p>
          <p className="font-sans">
            ${formatNumber(spread.absolute, 2)} ({formatPercent(spread.percentage)})
          </p>
        </div>
      )}

      {/* Price Chart */}
      {chartData.length > 0 ? (
        <div className="h-40 mb-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <XAxis
                dataKey="date"
                tickFormatter={(d) => formatDate(d, 'MM/dd')}
                stroke="#666"
                fontSize={10}
                tickLine={false}
              />
              <YAxis
                domain={['auto', 'auto']}
                stroke="#666"
                fontSize={10}
                tickFormatter={(v) => `$${v}`}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#111',
                  border: '1px solid #333',
                  borderRadius: '4px'
                }}
                formatter={(value) => value ? [`$${formatNumber(value, 2)}/lb`] : ['-']}
                labelFormatter={(label) => formatDate(label)}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="spot"
                name="Spot"
                stroke="#00d26a"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey="term"
                name="Term"
                stroke="#007aff"
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-40 flex items-center justify-center text-terminal-muted">
          <p>No price data available.</p>
        </div>
      )}

      {/* Key Events */}
      <div className="border-t border-terminal-border pt-3">
        <p className="text-xs text-terminal-muted uppercase mb-2">Key Events</p>
        <div className="space-y-1 max-h-24 overflow-y-auto">
          {keyEvents.map((event, i) => (
            <div key={i} className="flex justify-between text-xs">
              <span>{formatDate(event.date, 'MMM yyyy')}</span>
              <span className="text-terminal-muted flex-1 mx-2 truncate">{event.event}</span>
              <span className="text-terminal-amber">{event.impact}</span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

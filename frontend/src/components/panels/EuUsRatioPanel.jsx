import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import Panel, { Stat, PeriodSelector } from '../Panel';
import { useApi } from '../../hooks/useApi';
import { formatNumber, formatDate, exportToCSV, getTrendColor } from '../../utils/formatters';

export default function EuUsRatioPanel() {
  const [period, setPeriod] = useState('1y');

  const { data, loading, error, lastFetched, isStale, refetch } = useApi(
    '/yahoo/eu-us-ratio',
    {
      params: { period },
      refreshInterval: 5 * 60 * 1000 // 5 minutes
    }
  );

  const chartData = data?.data?.slice(-365) || [];
  const current = data?.current;
  const ma50 = data?.ma50;
  const ma200 = data?.ma200;
  const trend = data?.trend;

  const handleExport = () => {
    if (data?.data) {
      exportToCSV(data.data, 'eu_us_ratio');
    }
  };

  const trendColor = trend === 'rising' ? 'text-terminal-green' : 'text-terminal-red';
  const lineColor = trend === 'rising' ? '#00d26a' : '#ff3b30';

  return (
    <Panel
      title="EU vs US Tech Relative Strength"
      source={data?.source || 'Yahoo Finance'}
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
      onExport={handleExport}
      headerRight={
        <PeriodSelector
          value={period}
          onChange={setPeriod}
          options={['1D', '1W', '1M', '3M', '1Y']}
        />
      }
    >
      {/* Current Value */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-xs text-terminal-muted uppercase">STOXX 600 Tech / NDX Ratio</p>
          <p className={`text-3xl font-bold ${trendColor}`}>
            {formatNumber(current, 3)}
          </p>
          <p className={`text-sm ${trendColor}`}>
            {trend === 'rising' ? '↑ EU Outperforming' : '↓ US Outperforming'}
          </p>
        </div>
        <div className="text-right">
          <div className="mb-2">
            <p className="text-xs text-terminal-muted">50D MA</p>
            <p className="font-sans">{formatNumber(ma50, 3)}</p>
          </div>
          <div>
            <p className="text-xs text-terminal-muted">200D MA</p>
            <p className="font-sans">{formatNumber(ma200, 3)}</p>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="h-48 mt-4">
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
              tickFormatter={(v) => v.toFixed(2)}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#111',
                border: '1px solid #333',
                borderRadius: '4px'
              }}
              formatter={(value) => [formatNumber(value, 3), 'Ratio']}
              labelFormatter={(label) => formatDate(label)}
            />

            {/* Moving average lines */}
            {ma50 && (
              <ReferenceLine
                y={ma50}
                stroke="#00d4ff"
                strokeDasharray="3 3"
                label={{ value: '50D', fill: '#00d4ff', fontSize: 10, position: 'right' }}
              />
            )}
            {ma200 && (
              <ReferenceLine
                y={ma200}
                stroke="#af52de"
                strokeDasharray="3 3"
                label={{ value: '200D', fill: '#af52de', fontSize: 10, position: 'right' }}
              />
            )}

            <Line
              type="monotone"
              dataKey="ratio"
              stroke={lineColor}
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Thesis context */}
      <div className="mt-4 pt-3 border-t border-terminal-border">
        <p className="text-xs text-terminal-muted">
          <span className="text-terminal-green">Rising ratio</span> = European tech outperforming US tech.
          Thesis: Capital rotating from asset-light software toward energy-intensive industries.
        </p>
      </div>
    </Panel>
  );
}

import React, { useState, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import Panel, { PeriodSelector } from '../../Panel';
import { useApi } from '../../../hooks/useApi';
import { formatNumber, exportToCSV } from '../../../utils/formatters';

/**
 * Panel 4d: Hashprice Trend & Projections
 * Time-series chart with fleet breakeven reference line.
 */
export default function HashpriceTrendPanel() {
  const [period, setPeriod] = useState('3m');
  const { data, loading, error, lastFetched, isStale, refetch } = useApi('/fleet/history', {
    refreshInterval: 30 * 60 * 1000,
  });
  const { data: profData } = useApi('/fleet/profitability', { refreshInterval: 5 * 60 * 1000 });
  const { data: diffData } = useApi('/fleet/difficulty', { refreshInterval: 10 * 60 * 1000 });

  const fleetBreakeven = profData?.fleetBreakevenHashprice || 0;

  // Filter by period
  const chartData = useMemo(() => {
    if (!data?.history) return [];
    const now = Date.now();
    const periodMs = {
      '1d': 86400000,
      '1w': 7 * 86400000,
      '1m': 30 * 86400000,
      '3m': 90 * 86400000,
      '1y': 365 * 86400000,
    };
    const cutoff = now - (periodMs[period] || periodMs['3m']);
    const filtered = data.history.filter(d => new Date(d.date).getTime() >= cutoff);

    // Downsample for performance
    if (filtered.length > 300) {
      const step = Math.ceil(filtered.length / 300);
      return filtered.filter((_, i) => i % step === 0);
    }
    return filtered;
  }, [data, period]);

  const handleExport = () => {
    if (!chartData.length) return;
    exportToCSV(chartData.map(d => ({
      Date: d.date,
      'Hashprice ($/TH/s/day)': d.hashprice.toFixed(6),
      'Network Hashrate (EH/s)': d.hashrate.toFixed(1),
      'BTC Price ($)': d.btcPrice.toFixed(2),
    })), 'hashprice-trend');
  };

  // Current hashprice for annotation
  const currentHP = chartData.length > 0 ? chartData[chartData.length - 1]?.hashprice : null;

  return (
    <Panel
      title="Hashprice Trend"
      source={data?.source || 'CoinGecko + Blockchain.info'}
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
      {chartData.length > 0 && (
        <div className="space-y-3">
          {/* Stats bar */}
          <div className="flex items-center gap-4 text-xs">
            {currentHP && (
              <span className="text-terminal-green font-medium">
                Current: ${formatNumber(currentHP, 4)}/TH/s/day
              </span>
            )}
            {fleetBreakeven > 0 && (
              <span className="text-terminal-amber">
                Fleet Breakeven: ${formatNumber(fleetBreakeven, 4)}
              </span>
            )}
            {diffData && (
              <span className="text-terminal-muted">
                Next Diff: {diffData.estimatedAdjustmentPercent > 0 ? '+' : ''}{formatNumber(diffData.estimatedAdjustmentPercent, 1)}%
                in ~{formatNumber(diffData.estimatedDaysUntilAdjustment, 1)}d
              </span>
            )}
          </div>

          {/* Chart */}
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
                <defs>
                  <linearGradient id="hpGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#00d26a" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#00d26a" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="date"
                  stroke="#666"
                  fontSize={9}
                  tickLine={false}
                  tickFormatter={d => {
                    const date = new Date(d);
                    return `${date.getMonth() + 1}/${date.getDate()}`;
                  }}
                />
                <YAxis
                  stroke="#666"
                  fontSize={10}
                  tickLine={false}
                  tickFormatter={v => `$${v.toFixed(3)}`}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  contentStyle={{ backgroundColor: '#111', border: '1px solid #333', fontSize: 11 }}
                  formatter={(v) => [`$${Number(v).toFixed(5)}/TH/s/day`, 'Hashprice']}
                  labelFormatter={l => new Date(l).toLocaleDateString()}
                />
                {/* Fleet breakeven reference line */}
                {fleetBreakeven > 0 && (
                  <ReferenceLine
                    y={fleetBreakeven}
                    stroke="#ffb800"
                    strokeDasharray="4 4"
                    label={{ value: 'Fleet BE', fill: '#ffb800', fontSize: 9, position: 'right' }}
                  />
                )}
                {/* Projected hashprice after difficulty adjustment */}
                {diffData && diffData.projectedHashprice && (
                  <ReferenceLine
                    y={diffData.projectedHashprice}
                    stroke="#666"
                    strokeDasharray="2 2"
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="hashprice"
                  stroke="#00d26a"
                  fill="url(#hpGradient)"
                  strokeWidth={1.5}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Warning if projection dips below breakeven */}
          {diffData && fleetBreakeven > 0 && diffData.projectedHashprice < fleetBreakeven && (
            <div className="bg-terminal-red/10 border border-terminal-red/20 rounded px-3 py-2 text-xs text-terminal-red">
              Projected hashprice after difficulty adjustment ($
              {formatNumber(diffData.projectedHashprice, 4)}) is below fleet breakeven ($
              {formatNumber(fleetBreakeven, 4)})
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

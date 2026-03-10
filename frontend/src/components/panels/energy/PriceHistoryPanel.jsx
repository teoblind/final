import React, { useState, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { Info } from 'lucide-react';
import Panel, { PeriodSelector } from '../../Panel';
import { useApi } from '../../../hooks/useApi';
import { formatNumber, formatDate, exportToCSV } from '../../../utils/formatters';

const PERIOD_DAYS = { '1d': 1, '1w': 7, '1m': 30, '3m': 90, '1y': 365 };

/**
 * Panel 3d: Price History & Volatility
 * Time-series chart of LMP with moving averages and volatility indicators.
 */
export default function PriceHistoryPanel() {
  const [node, setNode] = useState('HB_NORTH');
  const [period, setPeriod] = useState('1m');

  const days = PERIOD_DAYS[period] || 30;

  const { data, loading, error, lastFetched, isStale, refetch } = useApi(
    '/energy/history',
    { params: { node, iso: 'ERCOT', days, market: 'realtime' }, refreshInterval: 15 * 60 * 1000 }
  );

  const { chartData, stats } = useMemo(() => {
    if (!data?.data?.length) return { chartData: [], stats: {} };

    const raw = data.data;
    const prices = raw.map(r => r.lmp);

    // Calculate moving averages
    const maWindow = Math.min(24, Math.floor(raw.length / 4));
    const withMA = raw.map((r, i) => {
      const slice = prices.slice(Math.max(0, i - maWindow + 1), i + 1);
      const ma = slice.reduce((s, v) => s + v, 0) / slice.length;

      // Simple Bollinger-style bands (2 std dev over window)
      const variance = slice.reduce((s, v) => s + (v - ma) ** 2, 0) / slice.length;
      const stdDev = Math.sqrt(variance);

      return {
        time: r.timestamp,
        lmp: r.lmp,
        ma: Math.round(ma * 100) / 100,
        upper: Math.round((ma + 2 * stdDev) * 100) / 100,
        lower: Math.round((ma - 2 * stdDev) * 100) / 100,
      };
    });

    // Downsample for display (max ~500 points)
    const step = Math.max(1, Math.floor(withMA.length / 500));
    const sampled = withMA.filter((_, i) => i % step === 0 || i === withMA.length - 1);

    const mean = prices.reduce((s, v) => s + v, 0) / prices.length;
    const max = Math.max(...prices);
    const min = Math.min(...prices);
    const spikes = prices.filter(p => p > 100).length;
    const negatives = prices.filter(p => p < 0).length;

    return {
      chartData: sampled,
      stats: {
        mean: Math.round(mean * 100) / 100,
        max: Math.round(max * 100) / 100,
        min: Math.round(min * 100) / 100,
        spikes,
        negatives,
        count: raw.length
      }
    };
  }, [data]);

  const handleExport = () => {
    if (data?.data) exportToCSV(data.data, `energy_${node}_${period}`);
  };

  return (
    <Panel
      title="Price History"
      source="ERCOT"
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
      {/* Stats bar */}
      <div className="grid grid-cols-5 gap-2 mb-3">
        {[
          { label: 'Avg', value: stats.mean, color: '' },
          { label: 'Min', value: stats.min, color: 'text-terminal-green' },
          { label: 'Max', value: stats.max, color: 'text-terminal-red' },
          { label: 'Spikes >$100', value: stats.spikes, color: 'text-terminal-red', noPrefix: true },
          { label: 'Negative', value: stats.negatives, color: 'text-terminal-cyan', noPrefix: true },
        ].map(({ label, value, color, noPrefix }) => (
          <div key={label} className="bg-terminal-bg/50 rounded p-2 text-center">
            <p className="text-[10px] text-terminal-muted">{label}</p>
            <p className={`font-sans text-xs ${color}`}>
              {value != null ? (noPrefix ? value : `$${formatNumber(value, 2)}`) : '—'}
            </p>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
            <defs>
              <linearGradient id="lmpGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#00d26a" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#00d26a" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="time"
              tickFormatter={t => {
                const d = new Date(t);
                return days <= 1 ? `${d.getHours()}:00` : formatDate(t, 'MM/dd');
              }}
              stroke="#666"
              fontSize={9}
              tickLine={false}
              minTickGap={30}
            />
            <YAxis
              stroke="#666"
              fontSize={10}
              tickLine={false}
              tickFormatter={v => `$${v}`}
            />
            <Tooltip
              contentStyle={{ backgroundColor: '#111', border: '1px solid #333', borderRadius: '4px' }}
              formatter={(value, name) => [
                `$${formatNumber(value, 2)}/MWh`,
                name === 'lmp' ? 'LMP' : name === 'ma' ? 'MA' : name
              ]}
              labelFormatter={label => new Date(label).toLocaleString()}
            />

            {/* Bollinger bands */}
            <Area type="monotone" dataKey="upper" stroke="none" fill="#666" fillOpacity={0.1} />
            <Area type="monotone" dataKey="lower" stroke="none" fill="#0a0a0a" fillOpacity={1} />

            {/* Moving average */}
            <Area type="monotone" dataKey="ma" stroke="#00d4ff" strokeWidth={1} strokeDasharray="3 3" fill="none" />

            {/* LMP line */}
            <Area type="monotone" dataKey="lmp" stroke="#00d26a" strokeWidth={1.5} fill="url(#lmpGradient)" />

            {/* $100 spike threshold */}
            <ReferenceLine y={100} stroke="#ff3b30" strokeDasharray="4 4" label={{ value: '$100', fill: '#ff3b30', fontSize: 9, position: 'right' }} />
            <ReferenceLine y={0} stroke="#666" strokeDasharray="2 2" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Data count */}
      <p className="text-xs text-terminal-muted mt-2">
        {node} — {stats.count || 0} data points over {days} day{days > 1 ? 's' : ''}
      </p>
    </Panel>
  );
}

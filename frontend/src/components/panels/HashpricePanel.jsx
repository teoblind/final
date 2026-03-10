import React, { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Line, ComposedChart } from 'recharts';
import Panel, { Stat, PeriodSelector } from '../Panel';
import { useApi } from '../../hooks/useApi';
import { formatCurrency, formatNumber, formatDate, exportToCSV } from '../../utils/formatters';

export default function HashpricePanel() {
  const [showBtc, setShowBtc] = useState(false);

  const { data, loading, error, lastFetched, isStale, refetch } = useApi(
    showBtc ? '/hashprice/with-btc' : '/hashprice',
    { refreshInterval: 15 * 60 * 1000 } // 15 minutes
  );

  const chartData = (showBtc ? data?.data : data?.history)?.slice(-90) || [];
  const current = showBtc ? data?.current?.hashprice : data?.current;
  const btcPrice = showBtc ? data?.current?.btcPrice : data?.btcPrice;
  const ma30 = data?.ma30;
  const ma90 = data?.ma90;
  const breakeven = data?.minerBreakeven;

  const handleExport = () => {
    if (data?.history) {
      exportToCSV(data.history, 'hashprice');
    }
  };

  return (
    <Panel
      title="Bitcoin Hashprice"
      source={data?.source || 'CoinGecko + Blockchain.info'}
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
      onExport={handleExport}
      headerRight={
        <button
          onClick={() => setShowBtc(!showBtc)}
          className={`px-2 py-1 text-xs rounded transition-colors ${
            showBtc
              ? 'bg-terminal-amber/20 text-terminal-amber'
              : 'text-terminal-muted hover:text-terminal-text'
          }`}
        >
          BTC Overlay
        </button>
      }
    >
      {/* Current Value */}
      <div className="flex items-start justify-between mb-4">
        <Stat
          label="Current Hashprice"
          value={`$${formatNumber(current, 4)}/TH/s/day`}
          size="large"
        />
        <div className="text-right">
          <p className="text-xs text-terminal-muted">BTC Price</p>
          <p className="text-lg font-bold">{formatCurrency(btcPrice, 'USD', 0)}</p>
        </div>
      </div>

      {/* Moving Averages */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-terminal-bg/50 rounded p-2">
          <p className="text-xs text-terminal-muted">30D MA</p>
          <p className="font-sans">${formatNumber(ma30, 4)}</p>
        </div>
        <div className="bg-terminal-bg/50 rounded p-2">
          <p className="text-xs text-terminal-muted">90D MA</p>
          <p className="font-sans">${formatNumber(ma90, 4)}</p>
        </div>
      </div>

      {/* Chart */}
      <div className="h-48 mt-4">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData}>
            <defs>
              <linearGradient id="hashpriceGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#00d26a" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#00d26a" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              tickFormatter={(d) => formatDate(d, 'MM/dd')}
              stroke="#666"
              fontSize={10}
              tickLine={false}
            />
            <YAxis
              yAxisId="left"
              domain={['auto', 'auto']}
              stroke="#666"
              fontSize={10}
              tickFormatter={(v) => `$${v.toFixed(2)}`}
              tickLine={false}
            />
            {showBtc && (
              <YAxis
                yAxisId="right"
                orientation="right"
                domain={['auto', 'auto']}
                stroke="#ffb800"
                fontSize={10}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                tickLine={false}
              />
            )}
            <Tooltip
              contentStyle={{
                backgroundColor: '#111',
                border: '1px solid #333',
                borderRadius: '4px'
              }}
              formatter={(value, name) => [
                name === 'btcPrice' ? formatCurrency(value) : `$${formatNumber(value, 4)}`,
                name === 'btcPrice' ? 'BTC Price' : 'Hashprice'
              ]}
              labelFormatter={(label) => formatDate(label)}
            />

            {/* Miner breakeven zone */}
            {breakeven && (
              <>
                <ReferenceLine
                  y={breakeven.low}
                  yAxisId="left"
                  stroke="#ff3b30"
                  strokeDasharray="3 3"
                  label={{ value: 'BE Low', fill: '#ff3b30', fontSize: 10 }}
                />
                <ReferenceLine
                  y={breakeven.high}
                  yAxisId="left"
                  stroke="#ffb800"
                  strokeDasharray="3 3"
                  label={{ value: 'BE High', fill: '#ffb800', fontSize: 10 }}
                />
              </>
            )}

            <Area
              yAxisId="left"
              type="monotone"
              dataKey="hashprice"
              stroke="#00d26a"
              fill="url(#hashpriceGradient)"
              strokeWidth={2}
            />

            {showBtc && (
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="btcPrice"
                stroke="#ffb800"
                strokeWidth={1.5}
                dot={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Halvings */}
      {data?.halvings && (
        <div className="mt-4 pt-3 border-t border-terminal-border">
          <p className="text-xs text-terminal-muted mb-2">Halving Events</p>
          <div className="flex gap-2 flex-wrap">
            {data.halvings.map((h, i) => (
              <span
                key={i}
                className="px-2 py-1 bg-terminal-bg rounded text-xs"
              >
                {formatDate(h.date, 'MMM yyyy')} ({h.reward} BTC)
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Methodology note */}
      <p className="text-xs text-terminal-muted mt-3">
        {data?.methodology}
      </p>
    </Panel>
  );
}

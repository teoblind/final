import React from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import Panel, { Stat } from '../Panel';
import { useApi } from '../../hooks/useApi';
import { formatBTC, formatCurrency, formatCompact, formatDate, exportToCSV } from '../../utils/formatters';

export default function BtcReservePanel() {
  const { data, loading, error, lastFetched, isStale, refetch } = useApi(
    '/bitcoin/reserve',
    { refreshInterval: 30 * 60 * 1000 } // 30 minutes
  );

  const wallets = data?.wallets || [];
  const history = data?.history || [];
  const totalBTC = data?.totalBTC;
  const totalUSD = data?.totalUSD;
  const btcPrice = data?.btcPrice;

  const handleExport = () => {
    if (data?.wallets) {
      exportToCSV(data.wallets, 'us_btc_reserve');
    }
  };

  return (
    <Panel
      title="US Strategic Bitcoin Reserve"
      source="Blockchain.info + DOJ/Treasury"
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
      onExport={handleExport}
    >
      {/* Total Holdings */}
      <div className="bg-terminal-green/10 border border-terminal-green/30 rounded-lg p-4 mb-4">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-xs text-terminal-muted uppercase">Total Holdings</p>
            <p className="text-3xl font-bold text-terminal-green">
              {formatCompact(totalBTC)} BTC
            </p>
            <p className="text-lg text-terminal-text">
              {formatCurrency(totalUSD, 'USD', 0)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-terminal-muted">BTC Price</p>
            <p className="font-mono">{formatCurrency(btcPrice)}</p>
          </div>
        </div>
      </div>

      {/* Wallet Breakdown */}
      <div className="space-y-2 mb-4">
        <p className="text-xs text-terminal-muted uppercase">Known Wallets</p>
        {wallets.map((wallet, i) => (
          <div
            key={i}
            className="flex justify-between items-center py-2 px-3 bg-terminal-bg/50 rounded"
          >
            <div className="min-w-0 flex-1">
              <p className="font-medium truncate">{wallet.label}</p>
              <p className="text-xs text-terminal-muted truncate">
                {wallet.seizure || wallet.address?.slice(0, 16)}...
              </p>
            </div>
            <div className="text-right ml-4">
              <p className="font-mono">{formatCompact(wallet.balance)} BTC</p>
              <p className="text-xs text-terminal-muted">
                {formatCurrency(wallet.balanceUSD, 'USD', 0)}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Historical Chart */}
      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={history.slice(-24)}>
            <defs>
              <linearGradient id="btcGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#00d26a" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#00d26a" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="date"
              tickFormatter={(d) => formatDate(d, 'MMM')}
              stroke="#666"
              fontSize={10}
              tickLine={false}
            />
            <YAxis
              domain={['auto', 'auto']}
              stroke="#666"
              fontSize={10}
              tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#111',
                border: '1px solid #333',
                borderRadius: '4px'
              }}
              formatter={(value) => [formatCompact(value), 'BTC']}
              labelFormatter={(label) => formatDate(label)}
            />
            <Area
              type="stepAfter"
              dataKey="btc"
              stroke="#00d26a"
              fill="url(#btcGradient)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Disclaimer */}
      <p className="text-xs text-terminal-muted mt-3">
        {data?.disclaimer}
      </p>
    </Panel>
  );
}

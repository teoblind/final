import React, { useState, useMemo } from 'react';
import Panel, { PeriodSelector } from '../../Panel';
import { useApi } from '../../../hooks/useApi';
import { formatNumber } from '../../../utils/formatters';

/**
 * Panel 6b: Pool Earnings Tracker
 * Daily/weekly/monthly earnings with BTC and USD values,
 * subsidy vs fee breakdown, payout history, luck indicator.
 */
export default function PoolEarningsPanel() {
  const [period, setPeriod] = useState('1m');
  const daysMap = { '1d': 1, '1w': 7, '1m': 30, '3m': 90 };
  const days = daysMap[period] || 30;

  const { data, loading, error, lastFetched, isStale, refetch } = useApi(`/pools/earnings?days=${days}`, {
    refreshInterval: 5 * 60 * 1000,
  });

  const earnings = data?.earnings;
  const dailyEarnings = data?.dailyEarnings || [];
  const payouts = data?.recentPayouts || [];

  // Chart scaling
  const maxDaily = useMemo(() => {
    if (dailyEarnings.length === 0) return 1;
    return Math.max(...dailyEarnings.map(d => d.earnedBtc || 0)) * 1.1;
  }, [dailyEarnings]);

  if (data && !data.configured) {
    return (
      <Panel title="Earnings" source="—" loading={false}>
        <div className="flex flex-col items-center justify-center py-6 text-terminal-muted text-sm">
          <p>Connect your pool to track earnings.</p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Earnings"
      source={data?.pool || 'Mining Pools'}
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
      headerRight={
        <PeriodSelector
          value={period}
          onChange={setPeriod}
          options={['1D', '1W', '1M', '3M']}
        />
      }
    >
      <div className="space-y-4">
        {data?.isMock && (
          <div className="bg-terminal-amber/10 border border-terminal-amber/20 rounded px-3 py-2 text-xs text-terminal-amber">
            Demo data — connect pool for real earnings
          </div>
        )}

        {/* Hero Earnings */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-terminal-bg/50 rounded p-3 text-center">
            <p className="text-xs text-terminal-muted">Earned ({period.toUpperCase()})</p>
            <p className="text-lg font-bold text-terminal-cyan">
              {formatNumber(earnings?.totalEarned, 4)} BTC
            </p>
            <p className="text-[10px] text-terminal-muted">
              ${formatNumber(earnings?.totalEarnedUSD, 0)}
            </p>
          </div>
          <div className="bg-terminal-bg/50 rounded p-3 text-center">
            <p className="text-xs text-terminal-muted">Avg Daily</p>
            <p className="text-sm font-bold text-terminal-text">
              {formatNumber(earnings?.avgDailyEarning, 4)} BTC
            </p>
            <p className="text-[10px] text-terminal-muted">
              ${formatNumber(earnings?.avgDailyEarningUSD, 0)}/day
            </p>
          </div>
          <div className="bg-terminal-bg/50 rounded p-3 text-center">
            <p className="text-xs text-terminal-muted">vs Expected</p>
            <p className={`text-sm font-bold ${
              (earnings?.luckPercent || 100) >= 100 ? 'text-terminal-green' : 'text-terminal-red'
            }`}>
              {(earnings?.luckPercent || 100) >= 100 ? '+' : ''}{formatNumber((earnings?.luckPercent || 100) - 100, 1)}%
            </p>
            <p className="text-[10px] text-terminal-muted">
              {(earnings?.luckPercent || 100) >= 100 ? 'lucky' : 'unlucky'}
            </p>
          </div>
        </div>

        {/* Daily Earnings Bar Chart */}
        {dailyEarnings.length > 0 && (
          <div>
            <p className="text-xs text-terminal-muted mb-2">Daily Earnings (BTC)</p>
            <div className="flex items-end gap-px h-16">
              {dailyEarnings.map((d, i) => {
                const height = Math.max(2, ((d.earnedBtc || 0) / maxDaily) * 100);
                const isCurtailed = d.curtailmentDay;
                return (
                  <div
                    key={i}
                    className="flex-1 flex items-end justify-center"
                    style={{ height: '100%' }}
                    title={`${d.date}: ${d.earnedBtc?.toFixed(4)} BTC ($${d.earnedUsd?.toFixed(0) || 0})`}
                  >
                    <div
                      className={`w-full rounded-t ${
                        isCurtailed ? 'bg-terminal-amber/60' : 'bg-terminal-cyan/60'
                      }`}
                      style={{ height: `${height}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] text-terminal-muted mt-1">
              <span>{dailyEarnings[0]?.date}</span>
              <span>{dailyEarnings[dailyEarnings.length - 1]?.date}</span>
            </div>
          </div>
        )}

        {/* Subsidy vs Fees Breakdown */}
        {earnings && (
          <div>
            <p className="text-xs text-terminal-muted mb-2">Revenue Split</p>
            <div className="flex h-3 rounded overflow-hidden">
              <div
                className="bg-terminal-green/60"
                style={{ width: `${earnings.subsidyPercent || 85}%` }}
                title={`Subsidy: ${formatNumber(earnings.subsidyComponent, 4)} BTC`}
              />
              <div
                className="bg-terminal-cyan/60"
                style={{ width: `${earnings.feePercent || 15}%` }}
                title={`Fees: ${formatNumber(earnings.feeComponent, 4)} BTC`}
              />
            </div>
            <div className="flex justify-between text-[10px] text-terminal-muted mt-1">
              <span>Subsidy: {formatNumber(earnings.subsidyComponent, 4)} BTC ({formatNumber(earnings.subsidyPercent, 0)}%)</span>
              <span>Fees: {formatNumber(earnings.feeComponent, 4)} BTC ({formatNumber(earnings.feePercent, 0)}%)</span>
            </div>
          </div>
        )}

        {/* Recent Payouts */}
        {payouts.length > 0 && (
          <div className="border-t border-terminal-border pt-2">
            <p className="text-xs text-terminal-muted mb-1">Recent Payouts</p>
            <div className="space-y-1">
              {payouts.slice(0, 5).map((p, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-terminal-text">{formatNumber(p.amount, 4)} BTC</span>
                  <span className={`${
                    p.status === 'confirmed' ? 'text-terminal-green' :
                    p.status === 'pending' ? 'text-terminal-amber' : 'text-terminal-red'
                  }`}>
                    {p.status}
                  </span>
                  <span className="text-terminal-muted">{p.timestamp?.split('T')[0]}</span>
                </div>
              ))}
            </div>
            {data?.pendingBalance > 0 && (
              <p className="text-[10px] text-terminal-muted mt-1">
                Pending: {formatNumber(data.pendingBalance, 4)} BTC
              </p>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

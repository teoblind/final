import React, { useState } from 'react';
import Panel, { PeriodSelector } from '../../Panel';
import { useApi } from '../../../hooks/useApi';
import { formatNumber } from '../../../utils/formatters';

/**
 * Panel 6e: Pool Performance Comparison
 * Side-by-side comparison when 2+ pools are connected.
 * Normalizes to $/TH/s/day after fees for apples-to-apples comparison.
 */
export default function PoolComparisonPanel() {
  const [period, setPeriod] = useState('1m');
  const daysMap = { '1w': 7, '1m': 30, '3m': 90 };
  const days = daysMap[period] || 30;

  const { data, loading, error, lastFetched, isStale, refetch } = useApi(`/pools/comparison?days=${days}`, {
    refreshInterval: 10 * 60 * 1000,
  });

  const pools = data?.pools || [];
  const recommendation = data?.recommendation;

  if (data && pools.length < 2) {
    return (
      <Panel title="Pool Comparison" source="-" loading={false}>
        <div className="flex flex-col items-center justify-center py-6 text-terminal-muted text-sm">
          <p>Connect 2+ mining pools to compare performance.</p>
          <p className="text-xs mt-1">Configure pools in Settings &gt; Pool Configuration.</p>
        </div>
      </Panel>
    );
  }

  // Find best performing pool
  const bestPool = pools.reduce((best, p) => {
    return (p.effectivePerThDay || 0) > (best?.effectivePerThDay || 0) ? p : best;
  }, null);

  return (
    <Panel
      title="Pool Comparison"
      source={`${pools.length} pools`}
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
      headerRight={
        <PeriodSelector
          value={period}
          onChange={setPeriod}
          options={['1W', '1M', '3M']}
        />
      }
    >
      <div className="space-y-4">
        {data?.isMock && (
          <div className="bg-terminal-amber/10 border border-terminal-amber/20 rounded px-3 py-2 text-xs text-terminal-amber">
            Demo data - connect pools for real comparison
          </div>
        )}

        {/* Comparison Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-terminal-border text-terminal-muted">
                <th className="text-left py-2 pr-3">Metric</th>
                {pools.map((p, i) => (
                  <th key={i} className="text-right py-2 px-2">{p.pool}</th>
                ))}
                <th className="text-right py-2 pl-2">Expected</th>
              </tr>
            </thead>
            <tbody>
              <MetricRow
                label="Hashrate Alloc"
                values={pools.map(p => `${formatNumber(p.hashrateShare, 0)}% (${formatNumber((p.hashrate || 0) / 1e6, 1)}E)`)}
                expected={`${formatNumber((data?.totalHashrate || 0) / 1e6, 1)} EH/s`}
              />
              <MetricRow
                label={`Earnings (BTC)`}
                values={pools.map(p => formatNumber(p.totalEarnings, 3))}
                expected={formatNumber(data?.expectedTotalEarnings, 3)}
              />
              <MetricRow
                label="$/TH/day"
                values={pools.map(p => `$${formatNumber(p.earningsPerThDay, 4)}`)}
                expected={`$${formatNumber(data?.expectedPerThDay, 4)}`}
                highlight={bestPool?.pool}
                pools={pools}
              />
              <MetricRow
                label="Reject Rate"
                values={pools.map(p => `${formatNumber(p.rejectRate, 1)}%`)}
                expected="-"
              />
              <MetricRow
                label={`Luck (${period})`}
                values={pools.map(p => `${formatNumber(p.luck, 1)}%`)}
                expected="100%"
              />
              <MetricRow
                label="Pool Fee"
                values={pools.map(p => `${formatNumber(p.fee, 1)}%`)}
                expected="-"
              />
              <MetricRow
                label="Net $/TH/day"
                values={pools.map(p => `$${formatNumber(p.effectivePerThDay, 4)}`)}
                expected="-"
                highlight={bestPool?.pool}
                pools={pools}
              />
              <MetricRow
                label="Payout"
                values={pools.map(p => p.payoutFrequency || 'Daily')}
                expected="-"
              />
            </tbody>
          </table>
        </div>

        {/* Recommendation */}
        {recommendation && (
          <div className="bg-terminal-cyan/5 border border-terminal-cyan/20 rounded p-3 text-xs">
            <p className="text-terminal-cyan font-medium mb-1">Recommendation</p>
            <p className="text-terminal-text">{recommendation.message}</p>
            {recommendation.potentialGainPerMonth > 0 && (
              <p className="text-terminal-green mt-1">
                Potential gain: +${formatNumber(recommendation.potentialGainPerMonth, 0)}/month
              </p>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

function MetricRow({ label, values, expected, highlight, pools }) {
  return (
    <tr className="border-b border-terminal-border/30">
      <td className="text-terminal-muted py-1.5 pr-3">{label}</td>
      {values.map((v, i) => {
        const isHighlight = highlight && pools?.[i]?.pool === highlight;
        return (
          <td
            key={i}
            className={`text-right py-1.5 px-2 ${isHighlight ? 'text-terminal-green font-medium' : 'text-terminal-text'}`}
          >
            {v}
          </td>
        );
      })}
      <td className="text-right py-1.5 pl-2 text-terminal-muted">{expected}</td>
    </tr>
  );
}

import React, { useMemo } from 'react';
import Panel, { Stat } from '../../Panel';
import { useApi } from '../../../hooks/useApi';
import { formatNumber } from '../../../utils/formatters';

/**
 * Panel 6a: Pool Hashrate Overview
 * Hero panel showing mining output — reported vs expected hashrate,
 * worker health summary, reject/stale rates, 24h hashrate chart.
 */
export default function PoolHashratePanel() {
  const { data, loading, error, lastFetched, isStale, refetch } = useApi('/pools/unified', {
    refreshInterval: 60 * 1000,
  });

  const { data: diagData } = useApi('/diagnostics/reconciliation', {
    refreshInterval: 5 * 60 * 1000,
  });

  const { data: histData } = useApi('/pools/hashrate/history?hours=24', {
    refreshInterval: 5 * 60 * 1000,
  });

  const reconciliation = diagData?.hashrateReconciliation;
  const hashHistory = Array.isArray(histData?.history) ? histData.history : [];

  // Chart scaling
  const maxHash = useMemo(() => {
    if (hashHistory.length === 0) return 1;
    return Math.max(...hashHistory.map(h => h.hashrate || 0)) * 1.1;
  }, [hashHistory]);

  if (data && !data.configured) {
    return (
      <Panel title="Pool Hashrate" source="—" loading={false}>
        <div className="flex flex-col items-center justify-center py-8 text-terminal-muted text-sm space-y-2">
          <p className="text-lg">Connect Your Pool</p>
          <p className="text-xs text-center">
            Add your mining pool API credentials in Settings to see real-time hashrate,
            worker status, and earnings data.
          </p>
          <p className="text-xs text-terminal-cyan">Settings &gt; Pool Configuration</p>
        </div>
      </Panel>
    );
  }

  const pools = data?.pools || [];
  const poolNames = pools.map(p => p.pool).join(' + ') || 'Mining Pools';

  return (
    <Panel
      title="Pool Hashrate"
      source={poolNames}
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
    >
      <div className="space-y-4">
        {data?.isMock && (
          <div className="bg-terminal-amber/10 border border-terminal-amber/20 rounded px-3 py-2 text-xs text-terminal-amber">
            Demo mode — connect pool API keys for live data
          </div>
        )}

        {/* Hero Hashrate Stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-terminal-bg/50 rounded p-3 text-center">
            <p className="text-xs text-terminal-muted">Reported</p>
            <p className="text-lg font-bold text-terminal-text">
              {formatNumber((data?.totalReportedHashrate || 0) / 1e6, 2)}
            </p>
            <p className="text-[10px] text-terminal-muted">EH/s</p>
          </div>
          <div className="bg-terminal-bg/50 rounded p-3 text-center">
            <p className="text-xs text-terminal-muted">24h Average</p>
            <p className="text-lg font-bold text-terminal-text">
              {formatNumber((data?.totalAvg24hHashrate || 0) / 1e6, 2)}
            </p>
            <p className="text-[10px] text-terminal-muted">EH/s</p>
          </div>
          <div className="bg-terminal-bg/50 rounded p-3 text-center">
            <p className="text-xs text-terminal-muted">7d Average</p>
            <p className="text-lg font-bold text-terminal-text">
              {formatNumber((data?.totalAvg7dHashrate || 0) / 1e6, 2)}
            </p>
            <p className="text-[10px] text-terminal-muted">EH/s</p>
          </div>
        </div>

        {/* Reconciliation: Reported vs Expected */}
        {reconciliation && (
          <div className={`rounded p-3 border text-xs ${
            reconciliation.status === 'healthy' ? 'border-terminal-green/20 bg-terminal-green/5' :
            reconciliation.status === 'degraded' ? 'border-terminal-amber/20 bg-terminal-amber/5' :
            'border-terminal-red/20 bg-terminal-red/5'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-terminal-muted">
                vs. Expected: {formatNumber((reconciliation.expected || 0) / 1e6, 2)} EH/s (fleet config)
              </span>
              <span className={`font-medium ${
                reconciliation.status === 'healthy' ? 'text-terminal-green' :
                reconciliation.status === 'degraded' ? 'text-terminal-amber' :
                'text-terminal-red'
              }`}>
                {reconciliation.deltaPercent >= 0 ? '+' : ''}{formatNumber(reconciliation.deltaPercent, 1)}% {reconciliation.status === 'healthy' ? 'Healthy' : reconciliation.status === 'degraded' ? 'Degraded' : 'Critical'}
              </span>
            </div>
            {reconciliation.possibleCauses?.length > 0 && (
              <p className="text-terminal-amber mt-1">{reconciliation.possibleCauses[0]}</p>
            )}
          </div>
        )}

        {/* Worker Health Summary */}
        <div className="flex items-center gap-4 text-xs">
          <span className="text-terminal-muted">Workers:</span>
          <span className="text-terminal-green">{data?.activeWorkers || 0} active</span>
          <span className="text-terminal-amber">{data?.inactiveWorkers || 0} inactive</span>
          <span className="text-terminal-red">{data?.deadWorkers || 0} dead</span>
        </div>

        {/* Reject & Stale Rates */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-terminal-bg/50 rounded p-2 text-center">
            <p className="text-[10px] text-terminal-muted">Reject Rate</p>
            <p className={`text-sm font-bold ${(data?.overallRejectRate || 0) > 2 ? 'text-terminal-red' : 'text-terminal-text'}`}>
              {formatNumber(data?.overallRejectRate, 1)}%
            </p>
          </div>
          <div className="bg-terminal-bg/50 rounded p-2 text-center">
            <p className="text-[10px] text-terminal-muted">Stale Rate</p>
            <p className={`text-sm font-bold ${(data?.overallStaleRate || 0) > 1 ? 'text-terminal-amber' : 'text-terminal-text'}`}>
              {formatNumber(data?.overallStaleRate, 1)}%
            </p>
          </div>
        </div>

        {/* 24h Hashrate Chart */}
        {hashHistory.length > 0 && (
          <div>
            <p className="text-xs text-terminal-muted mb-2">Hashrate (24h)</p>
            <div className="relative h-20 bg-terminal-bg/30 rounded overflow-hidden">
              <svg width="100%" height="100%" preserveAspectRatio="none" viewBox={`0 0 ${hashHistory.length} 100`}>
                <path
                  d={`M0,100 ${hashHistory.map((h, i) =>
                    `L${i},${100 - ((h.hashrate || 0) / maxHash) * 95}`
                  ).join(' ')} L${hashHistory.length - 1},100 Z`}
                  fill="rgba(0, 210, 106, 0.1)"
                />
                <polyline
                  points={hashHistory.map((h, i) =>
                    `${i},${100 - ((h.hashrate || 0) / maxHash) * 95}`
                  ).join(' ')}
                  fill="none"
                  stroke="#00d26a"
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </div>
          </div>
        )}

        {/* Per-Pool Breakdown */}
        {pools.length > 1 && (
          <div className="border-t border-terminal-border pt-2">
            <p className="text-xs text-terminal-muted mb-1">Pool Breakdown</p>
            {pools.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-xs py-1">
                <span className="text-terminal-text">{p.pool}</span>
                <span className="text-terminal-muted">
                  {formatNumber((p.hashrate || 0) / 1e6, 2)} EH/s ({formatNumber(p.hashrateShare, 0)}%)
                </span>
                <span className={`${
                  p.status === 'connected' ? 'text-terminal-green' :
                  p.status === 'degraded' ? 'text-terminal-amber' : 'text-terminal-red'
                }`}>
                  {p.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

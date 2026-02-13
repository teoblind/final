import React, { useMemo } from 'react';
import Panel from '../../Panel';
import { useApi } from '../../../hooks/useApi';
import { formatNumber } from '../../../utils/formatters';

/**
 * Panel 6d: Mempool & Fee Monitor
 * On-chain data: mempool size, fee estimates, fee revenue trend, recent blocks.
 */
export default function MempoolFeesPanel() {
  const { data, loading, error, lastFetched, isStale, refetch } = useApi('/chain/mempool', {
    refreshInterval: 30 * 1000,
  });

  const { data: feeData } = useApi('/chain/fees', {
    refreshInterval: 30 * 1000,
  });

  const { data: blocksData } = useApi('/chain/blocks?count=5', {
    refreshInterval: 60 * 1000,
  });

  const { data: feeHistory } = useApi('/chain/fees/history?days=7', {
    refreshInterval: 30 * 60 * 1000,
  });

  const mempool = data?.mempool;
  const fees = feeData?.fees;
  const blocks = blocksData?.blocks || [];
  const feeTrend = feeHistory?.history || [];

  // Fee trend chart scaling
  const maxFee = useMemo(() => {
    if (feeTrend.length === 0) return 1;
    return Math.max(...feeTrend.map(f => f.feeRevenuePercent || 0)) * 1.2;
  }, [feeTrend]);

  return (
    <Panel
      title="Mempool & Fees"
      source="Mempool.space"
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
    >
      <div className="space-y-4">
        {/* Mempool Stats */}
        {mempool && (
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-terminal-bg/50 rounded p-2 text-center">
              <p className="text-[10px] text-terminal-muted">Mempool</p>
              <p className="text-sm font-bold text-terminal-text">
                {formatNumber(mempool.sizeMB, 0)} MB
              </p>
              <p className="text-[10px] text-terminal-muted">{formatNumber(mempool.txCount, 0)} tx</p>
            </div>
            <div className="bg-terminal-bg/50 rounded p-2 text-center">
              <p className="text-[10px] text-terminal-muted">Clearing Rate</p>
              <p className="text-sm font-bold text-terminal-text">
                {formatNumber(mempool.clearingRate, 1)} tx/s
              </p>
            </div>
            <div className="bg-terminal-bg/50 rounded p-2 text-center">
              <p className="text-[10px] text-terminal-muted">Incoming</p>
              <p className="text-sm font-bold text-terminal-text">
                {formatNumber(mempool.incomingRate, 1)} tx/s
              </p>
            </div>
          </div>
        )}

        {/* Fee Estimates */}
        {fees && (
          <div>
            <p className="text-xs text-terminal-muted mb-2">Fee Estimates (sat/vB)</p>
            <div className="flex items-end gap-2">
              {[
                { label: 'Next Block', value: fees.nextBlock, color: 'bg-terminal-red/60' },
                { label: '30min', value: fees.halfHour, color: 'bg-terminal-amber/60' },
                { label: '1hr', value: fees.hour, color: 'bg-terminal-green/60' },
                { label: 'Day', value: fees.day, color: 'bg-terminal-cyan/40' },
              ].map((f, i) => {
                const maxFeeVal = Math.max(fees.nextBlock, 1);
                const height = Math.max(10, (f.value / maxFeeVal) * 100);
                return (
                  <div key={i} className="flex-1 text-center">
                    <div className="flex items-end justify-center h-12">
                      <div
                        className={`w-full rounded-t ${f.color}`}
                        style={{ height: `${height}%` }}
                      />
                    </div>
                    <p className="text-xs font-bold text-terminal-text mt-1">{formatNumber(f.value, 0)}</p>
                    <p className="text-[9px] text-terminal-muted">{f.label}</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Fee Revenue as % of Block Reward */}
        {fees?.feeRevenuePercent !== undefined && (
          <div className={`rounded p-3 border text-xs ${
            fees.feeRevenuePercent > 20 ? 'border-terminal-green/20 bg-terminal-green/5' :
            'border-terminal-border bg-terminal-bg/50'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-terminal-muted">Fees as % of Block Reward</span>
              <span className={`font-bold ${fees.feeRevenuePercent > 15 ? 'text-terminal-green' : 'text-terminal-text'}`}>
                {formatNumber(fees.feeRevenuePercent, 1)}%
                {fees.feeRevenueTrend && (
                  <span className="text-terminal-muted ml-1">
                    ({fees.feeRevenueTrend === 'rising' ? 'rising' : fees.feeRevenueTrend === 'falling' ? 'falling' : 'stable'})
                  </span>
                )}
              </span>
            </div>
          </div>
        )}

        {/* Fee Revenue Trend (7d) */}
        {feeTrend.length > 0 && (
          <div>
            <p className="text-xs text-terminal-muted mb-2">Fee Revenue Trend (7d)</p>
            <div className="relative h-14 bg-terminal-bg/30 rounded overflow-hidden">
              <svg width="100%" height="100%" preserveAspectRatio="none" viewBox={`0 0 ${feeTrend.length} 100`}>
                <path
                  d={`M0,100 ${feeTrend.map((f, i) =>
                    `L${i},${100 - ((f.feeRevenuePercent || 0) / maxFee) * 95}`
                  ).join(' ')} L${feeTrend.length - 1},100 Z`}
                  fill="rgba(0, 212, 255, 0.1)"
                />
                <polyline
                  points={feeTrend.map((f, i) =>
                    `${i},${100 - ((f.feeRevenuePercent || 0) / maxFee) * 95}`
                  ).join(' ')}
                  fill="none"
                  stroke="#00d4ff"
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
            </div>
          </div>
        )}

        {/* Recent Blocks */}
        {blocks.length > 0 && (
          <div className="border-t border-terminal-border pt-2">
            <p className="text-xs text-terminal-muted mb-1">Recent Blocks</p>
            <div className="space-y-1">
              {blocks.map((b, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="text-terminal-text font-mono">#{formatNumber(b.height, 0)}</span>
                  <span className="text-terminal-muted">{b.miner || 'Unknown'}</span>
                  <span className="text-terminal-cyan">{formatNumber(b.totalReward, 2)} BTC</span>
                  <span className="text-terminal-muted">{getTimeSince(b.timestamp)}</span>
                  <span className="text-terminal-muted">{formatNumber(b.txCount, 0)} tx</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

function getTimeSince(isoDate) {
  const diff = Date.now() - new Date(isoDate).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  return `${Math.floor(min / 60)}h ago`;
}

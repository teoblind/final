import React from 'react';
import Panel from '../../Panel';
import { useApi } from '../../../hooks/useApi';
import { formatNumber, formatCompact } from '../../../utils/formatters';

/**
 * Panel 4e: Difficulty Adjustment Tracker
 * Focused panel on the upcoming difficulty adjustment with fleet impact.
 */
export default function DifficultyPanel() {
  const { data, loading, error, lastFetched, isStale, refetch } = useApi('/fleet/difficulty', {
    refreshInterval: 10 * 60 * 1000,
  });

  const isMock = data?.isMock;
  const impact = data?.fleetImpact;
  const estPct = data?.estimatedAdjustmentPercent || 0;
  const isIncrease = estPct > 0;

  return (
    <Panel
      title="Next Difficulty Adjustment"
      source={data?.source || 'Blockchain.info'}
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
    >
      {data && (
        <div className="space-y-4">
          {isMock && (
            <div className="bg-terminal-amber/10 border border-terminal-amber/20 rounded px-3 py-2 text-xs text-terminal-amber">
              Using mock data - live API unavailable
            </div>
          )}

          {/* Hero metrics */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-terminal-muted uppercase tracking-wider">Estimated Change</p>
              <p className={`text-2xl font-bold ${isIncrease ? 'text-terminal-red' : 'text-terminal-green'}`}>
                {isIncrease ? '+' : ''}{formatNumber(estPct, 1)}%
              </p>
            </div>
            <div>
              <p className="text-xs text-terminal-muted uppercase tracking-wider">Blocks Remaining</p>
              <p className="text-2xl font-bold text-terminal-text">
                {data.blocksUntilAdjustment?.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-xs text-terminal-muted uppercase tracking-wider">ETA</p>
              <p className="text-2xl font-bold text-terminal-text">
                ~{formatNumber(data.estimatedDaysUntilAdjustment, 1)} <span className="text-sm font-normal text-terminal-muted">days</span>
              </p>
            </div>
          </div>

          {/* Difficulty values */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-terminal-bg/50 rounded p-3">
              <p className="text-xs text-terminal-muted">Current Difficulty</p>
              <p className="text-sm font-bold text-terminal-text">{formatCompact(data.currentDifficulty)}</p>
            </div>
            <div className="bg-terminal-bg/50 rounded p-3">
              <p className="text-xs text-terminal-muted">Projected Difficulty</p>
              <p className="text-sm font-bold text-terminal-text">{formatCompact(data.estimatedNextDifficulty)}</p>
            </div>
          </div>

          {/* Hashprice impact */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-terminal-bg/50 rounded p-3">
              <p className="text-xs text-terminal-muted">Current Hashprice</p>
              <p className="text-sm font-bold text-terminal-green">${formatNumber(data.currentHashprice, 4)}/TH/s/day</p>
            </div>
            <div className="bg-terminal-bg/50 rounded p-3">
              <p className="text-xs text-terminal-muted">Projected Hashprice</p>
              <p className={`text-sm font-bold ${data.hashpriceChange < 0 ? 'text-terminal-red' : 'text-terminal-green'}`}>
                ${formatNumber(data.projectedHashprice, 4)}/TH/s/day
              </p>
            </div>
          </div>

          {/* Fleet Impact */}
          {impact && (
            <div className="border-t border-terminal-border pt-3 space-y-2">
              <p className="text-xs font-semibold text-terminal-text">Impact on Fleet</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <p className="text-xs text-terminal-muted">Current Net Revenue</p>
                  <p className="text-sm font-bold text-terminal-green">
                    ${formatNumber(impact.currentNetRevenue, 0)}/day
                  </p>
                </div>
                <div>
                  <p className="text-xs text-terminal-muted">Post-Adjustment Est.</p>
                  <p className={`text-sm font-bold ${impact.revenueChange < 0 ? 'text-terminal-red' : 'text-terminal-green'}`}>
                    ${formatNumber(impact.projectedNetRevenue, 0)}/day
                  </p>
                </div>
                <div>
                  <p className="text-xs text-terminal-muted">Change</p>
                  <p className={`text-sm font-bold ${impact.revenueChange < 0 ? 'text-terminal-red' : 'text-terminal-green'}`}>
                    {impact.revenueChange < 0 ? '' : '+'}${formatNumber(impact.revenueChange, 0)}
                    <span className="text-terminal-muted font-normal"> ({formatNumber(impact.revenueChangePct, 1)}%)</span>
                  </p>
                </div>
              </div>

              {/* At-risk machines */}
              {impact.atRiskModels && impact.atRiskModels.length > 0 && (
                <div className="bg-terminal-red/10 border border-terminal-red/20 rounded px-3 py-2 text-xs text-terminal-red">
                  <p className="font-medium mb-1">Machines at risk of becoming unprofitable:</p>
                  {impact.atRiskModels.map((m, i) => (
                    <p key={i}>{m.model} ({m.quantity} units) - current: ${formatNumber(m.currentNet, 2)}/unit/day</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

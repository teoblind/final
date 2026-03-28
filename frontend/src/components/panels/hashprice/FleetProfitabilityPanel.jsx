import React from 'react';
import Panel from '../../Panel';
import { useApi } from '../../../hooks/useApi';
import { formatNumber, formatCurrency } from '../../../utils/formatters';

/**
 * Panel 4a: Fleet Profitability Overview
 * Hero panel - a miner's P&L at a glance.
 */
export default function FleetProfitabilityPanel() {
  const { data, loading, error, lastFetched, isStale, refetch } = useApi('/fleet/profitability', {
    refreshInterval: 5 * 60 * 1000,
  });

  if (data && !data.hasFleet) {
    return (
      <Panel
        title="Fleet Profitability"
        source="Not Configured"
        loading={false}
        onRefresh={refetch}
      >
        <div className="flex flex-col items-center justify-center py-8 text-terminal-muted">
          <p className="text-sm mb-2">No fleet configured</p>
          <p className="text-xs">Go to Settings &gt; Fleet Configuration to add your machines.</p>
        </div>
      </Panel>
    );
  }

  const fleet = data?.fleet;
  const hp = data?.networkHashprice;
  const isMock = data?.isMock;

  const isNegative = fleet && fleet.totalNetRevenue < 0;
  const revenueColor = isNegative ? 'text-terminal-red' : 'text-terminal-green';

  return (
    <Panel
      title="Fleet Profitability"
      source={data?.source || 'Blockchain.info + ERCOT'}
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
    >
      {fleet && hp && (
        <div className="space-y-4">
          {isMock && (
            <div className="bg-terminal-amber/10 border border-terminal-amber/20 rounded px-3 py-2 text-xs text-terminal-amber">
              Using mock network data - live API unavailable
            </div>
          )}

          {/* Hero metrics */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-terminal-muted uppercase tracking-wider">Fleet Net Revenue</p>
              <p className={`text-2xl font-bold ${revenueColor}`}>
                {isNegative ? '-' : ''}${formatNumber(Math.abs(fleet.totalNetRevenue), 0)}<span className="text-sm font-normal text-terminal-muted">/day</span>
              </p>
            </div>
            <div>
              <p className="text-xs text-terminal-muted uppercase tracking-wider">Hashprice</p>
              <p className="text-2xl font-bold text-terminal-text">
                ${formatNumber(hp.hashprice, 4)}<span className="text-sm font-normal text-terminal-muted">/TH/s</span>
              </p>
            </div>
            <div>
              <p className="text-xs text-terminal-muted uppercase tracking-wider">BTC Price</p>
              <p className="text-2xl font-bold text-terminal-text">
                ${formatNumber(hp.btcPrice, 0)}
              </p>
            </div>
          </div>

          {/* Breakdown */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-terminal-bg/50 rounded p-3">
              <p className="text-xs text-terminal-muted">Gross Revenue</p>
              <p className="text-sm font-bold text-terminal-green">
                ${formatNumber(fleet.totalGrossRevenue, 0)}/day
              </p>
            </div>
            <div className="bg-terminal-bg/50 rounded p-3">
              <p className="text-xs text-terminal-muted">Electricity Cost</p>
              <p className="text-sm font-bold text-terminal-red">
                -${formatNumber(fleet.totalElectricityCost, 0)}/day
              </p>
            </div>
            <div className="bg-terminal-bg/50 rounded p-3">
              <p className="text-xs text-terminal-muted">Profit Margin</p>
              <p className={`text-sm font-bold ${fleet.profitMargin >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
                {formatNumber(fleet.profitMargin, 1)}%
              </p>
            </div>
          </div>

          {/* Machine status */}
          <div className="flex items-center justify-between text-xs border-t border-terminal-border pt-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-terminal-green" />
              <span className="text-terminal-text">
                {fleet.profitableMachines.toLocaleString()} machines profitable
              </span>
              <span className="text-terminal-muted">
                ({(fleet.profitableHashrate / 1e3).toFixed(1)} PH/s)
              </span>
            </div>
            {fleet.unprofitableMachines > 0 && (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-terminal-red" />
                <span className="text-terminal-red">
                  {fleet.unprofitableMachines.toLocaleString()} unprofitable
                </span>
                <span className="text-terminal-muted">
                  ({((fleet.totalHashrate - fleet.profitableHashrate) / 1e3).toFixed(1)} PH/s)
                </span>
              </div>
            )}
          </div>

          {/* Fleet totals */}
          <div className="flex items-center gap-4 text-xs text-terminal-muted">
            <span>Total: {(fleet.totalHashrate / 1e3).toFixed(1)} PH/s</span>
            <span>{fleet.totalPowerMW.toFixed(2)} MW</span>
            <span>{fleet.weightedEfficiency.toFixed(1)} J/TH avg</span>
          </div>
        </div>
      )}
    </Panel>
  );
}

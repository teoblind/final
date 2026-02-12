import React from 'react';
import Panel from '../../Panel';
import { useApi } from '../../../hooks/useApi';
import { formatNumber } from '../../../utils/formatters';

/**
 * Panel 5d: Energy Price vs Fleet Efficiency Waterfall
 * Merit-order chart showing machine classes ranked by efficiency,
 * with the current energy price line indicating the curtailment threshold.
 */
export default function EfficiencyWaterfallPanel() {
  const { data, loading, error, lastFetched, isStale, refetch } = useApi('/curtailment/efficiency', {
    refreshInterval: 60 * 1000,
  });

  const waterfall = data?.waterfall || [];
  const currentPriceMWh = data?.currentPriceMWh || 0;
  const fleetState = data?.fleetState;

  // Calculate max breakeven for chart scaling
  const maxBreakeven = waterfall.length > 0
    ? Math.max(...waterfall.map(w => w.breakevenMWh), currentPriceMWh) * 1.1
    : 100;

  const barHeightPct = (breakevenMWh) => {
    return Math.min(100, (breakevenMWh / maxBreakeven) * 100);
  };

  const priceLinePct = (maxBreakeven > 0)
    ? Math.min(100, (currentPriceMWh / maxBreakeven) * 100)
    : 50;

  if (data && !data.hasFleet) {
    return (
      <Panel title="Fleet Efficiency" source="Curtailment Engine" loading={false}>
        <div className="flex flex-col items-center justify-center py-6 text-terminal-muted text-sm">
          <p>Configure your fleet to see the efficiency waterfall.</p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Fleet Efficiency Waterfall"
      source={data ? 'Curtailment Engine' : '—'}
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
    >
      {waterfall.length > 0 && (
        <div className="space-y-4">
          {/* Description */}
          <p className="text-xs text-terminal-muted">
            Machine classes ranked by efficiency. Bars show breakeven energy price.
            The horizontal line is the current energy price — machines below it should curtail.
          </p>

          {/* Waterfall Chart */}
          <div className="relative">
            {/* Current price line */}
            <div
              className="absolute left-0 right-0 border-t-2 border-terminal-amber border-dashed z-10"
              style={{ bottom: `${priceLinePct}%` }}
            >
              <span className="absolute right-0 -top-4 text-[10px] text-terminal-amber bg-terminal-panel px-1 rounded">
                ${formatNumber(currentPriceMWh, 1)}/MWh
              </span>
            </div>

            {/* Bars */}
            <div className="flex items-end gap-1 h-40">
              {waterfall.map((item, i) => {
                const height = barHeightPct(item.breakevenMWh);
                const isMining = item.action === 'MINE';
                const barColor = isMining
                  ? 'bg-terminal-green/60 hover:bg-terminal-green/80'
                  : 'bg-terminal-red/40 hover:bg-terminal-red/60';

                return (
                  <div
                    key={i}
                    className="flex-1 flex flex-col items-center justify-end group relative"
                    style={{ height: '100%' }}
                  >
                    {/* Bar */}
                    <div
                      className={`w-full rounded-t transition-colors ${barColor} cursor-default`}
                      style={{ height: `${height}%` }}
                    >
                      {/* Tooltip */}
                      <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-terminal-panel border border-terminal-border rounded px-2 py-1 text-[10px] text-terminal-text whitespace-nowrap z-20 hidden group-hover:block">
                        <p className="font-medium">{item.model}</p>
                        <p>Efficiency: {formatNumber(item.efficiency, 1)} J/TH</p>
                        <p>Breakeven: ${formatNumber(item.breakevenMWh, 1)}/MWh</p>
                        <p>Margin: ${formatNumber(item.margin, 1)}/MWh</p>
                        <p>Units: {item.quantity} ({formatNumber(item.powerMW, 2)} MW)</p>
                        <p className={isMining ? 'text-terminal-green' : 'text-terminal-red'}>
                          {item.action}
                        </p>
                      </div>
                    </div>

                    {/* Label */}
                    <div className="mt-1 text-center w-full overflow-hidden">
                      <p className="text-[9px] text-terminal-muted truncate">{item.model?.split(' ').pop()}</p>
                      <p className="text-[9px] text-terminal-muted">{item.quantity}x</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Merit Order Table */}
          <div className="border-t border-terminal-border pt-3">
            <p className="text-xs font-semibold text-terminal-text mb-2">Merit Order (Most → Least Efficient)</p>
            <div className="space-y-1">
              {waterfall.map((item, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between text-xs px-2 py-1.5 rounded ${
                    item.action === 'MINE'
                      ? 'bg-terminal-green/5'
                      : 'bg-terminal-red/5 opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${
                      item.action === 'MINE' ? 'bg-terminal-green' : 'bg-terminal-red'
                    }`} />
                    <span className="text-terminal-text font-medium">{item.model}</span>
                    <span className="text-terminal-muted">{item.quantity}x</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-terminal-muted">{formatNumber(item.efficiency, 1)} J/TH</span>
                    <span className="text-terminal-muted">BE: ${formatNumber(item.breakevenMWh, 0)}/MWh</span>
                    <span className={`font-medium w-14 text-right ${
                      item.margin >= 0 ? 'text-terminal-green' : 'text-terminal-red'
                    }`}>
                      {item.margin >= 0 ? '+' : ''}${formatNumber(item.margin, 0)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 text-[10px] text-terminal-muted">
            <span className="flex items-center gap-1">
              <span className="w-3 h-2 bg-terminal-green/60 rounded-sm inline-block" /> Profitable (Mine)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-2 bg-terminal-red/40 rounded-sm inline-block" /> Unprofitable (Curtail)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-6 border-t-2 border-terminal-amber border-dashed inline-block" /> Current Price
            </span>
          </div>
        </div>
      )}
    </Panel>
  );
}

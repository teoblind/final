import React from 'react';
import Panel from '../../Panel';
import { useApi } from '../../../hooks/useApi';
import { formatNumber } from '../../../utils/formatters';

/**
 * Panel 4c: Breakeven Electricity Chart
 * Horizontal bar chart showing max electricity price each machine class can tolerate.
 */
export default function BreakevenChartPanel() {
  const { data, loading, error, lastFetched, isStale, refetch } = useApi('/fleet/breakeven', {
    refreshInterval: 5 * 60 * 1000,
  });

  const breakevens = data?.breakevens || [];
  const currentCost = data?.currentEnergyCostKWh || 0.05;
  const maxBE = breakevens.length > 0 ? Math.max(...breakevens.map(b => b.breakEvenElectricity)) : 0.15;

  return (
    <Panel
      title="Breakeven Electricity by Machine Class"
      source={data?.source || 'Blockchain.info'}
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
    >
      {breakevens.length > 0 && (
        <div className="space-y-3">
          {/* Bar chart */}
          <div className="space-y-2">
            {breakevens.map((item, idx) => {
              const pct = maxBE > 0 ? (item.breakEvenElectricity / (maxBE * 1.1)) * 100 : 0;
              const currentPct = maxBE > 0 ? (currentCost / (maxBE * 1.1)) * 100 : 0;
              const isProfitable = item.breakEvenElectricity > currentCost;

              return (
                <div key={idx} className="flex items-center gap-3 text-xs">
                  <div className="w-28 text-right truncate text-terminal-text" title={item.model.model}>
                    {item.model.model.replace('Antminer ', '').replace('WhatsMiner ', '').replace('Avalon ', '')}
                  </div>
                  <div className="flex-1 relative h-5">
                    {/* Background */}
                    <div className="absolute inset-0 bg-terminal-bg/50 rounded" />
                    {/* Bar */}
                    <div
                      className={`absolute inset-y-0 left-0 rounded transition-all ${
                        isProfitable ? 'bg-terminal-green/30' : 'bg-terminal-red/30'
                      }`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                    {/* Current cost marker */}
                    <div
                      className="absolute inset-y-0 w-0.5 bg-terminal-amber z-10"
                      style={{ left: `${Math.min(currentPct, 100)}%` }}
                    />
                    {/* Label */}
                    <span className={`absolute right-2 top-0.5 text-[10px] font-medium ${
                      isProfitable ? 'text-terminal-green' : 'text-terminal-red'
                    }`}>
                      ${item.breakEvenElectricity.toFixed(3)}/kWh
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center justify-between text-xs pt-2 border-t border-terminal-border">
            <div className="flex items-center gap-2">
              <div className="w-3 h-0.5 bg-terminal-amber" />
              <span className="text-terminal-amber">Current: ${currentCost.toFixed(3)}/kWh</span>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 bg-terminal-green/30 rounded" />
                <span className="text-terminal-muted">Profitable</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-3 h-3 bg-terminal-red/30 rounded" />
                <span className="text-terminal-muted">Unprofitable</span>
              </div>
            </div>
          </div>

          {/* Summary */}
          <div className="text-xs text-terminal-muted">
            {breakevens.filter(b => b.isProfitableAtCurrentCost).length} of {breakevens.length} machine
            classes profitable at ${currentCost.toFixed(3)}/kWh
          </div>
        </div>
      )}
    </Panel>
  );
}

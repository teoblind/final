import React from 'react';
import Panel from '../../Panel';
import { useApi } from '../../../hooks/useApi';
import { formatNumber } from '../../../utils/formatters';

/**
 * Panel 5a: Current Operating Status
 * Command-center view showing real-time fleet state (MINING / PARTIAL / CURTAILED)
 * with per-machine-class breakdown, fleet %, hashrate split, $/hr, and next state change.
 */
export default function OperatingStatusPanel() {
  const { data, loading, error, lastFetched, isStale, refetch } = useApi('/curtailment/recommendation', {
    refreshInterval: 60 * 1000, // 1 minute
  });

  const isMock = data?.isMock;
  const fleetState = data?.fleetState;
  const summary = data?.summary;
  const decisions = data?.decisions || [];
  const nextStateChange = data?.nextStateChange;
  const demandResponse = data?.demandResponse;

  const stateConfig = {
    MINING: { label: 'ALL MINING', color: 'text-terminal-green', bg: 'bg-terminal-green/20', border: 'border-terminal-green/30', icon: '⛏' },
    PARTIAL: { label: 'PARTIAL CURTAILMENT', color: 'text-terminal-amber', bg: 'bg-terminal-amber/20', border: 'border-terminal-amber/30', icon: '⚠' },
    CURTAILED: { label: 'FULL CURTAILMENT', color: 'text-terminal-red', bg: 'bg-terminal-red/20', border: 'border-terminal-red/30', icon: '🛑' },
  };

  const stateInfo = stateConfig[fleetState] || stateConfig.MINING;

  if (data && !data.hasFleet) {
    return (
      <Panel title="Operating Status" source="Curtailment Engine" loading={false}>
        <div className="flex flex-col items-center justify-center py-6 text-terminal-muted text-sm">
          <p>Configure your fleet in Settings to use the curtailment optimizer.</p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="Operating Status"
      source={data?.source || 'Curtailment Engine'}
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
    >
      {data && data.hasFleet && (
        <div className="space-y-4">
          {isMock && (
            <div className="bg-terminal-amber/10 border border-terminal-amber/20 rounded px-3 py-2 text-xs text-terminal-amber">
              Using mock data — live API unavailable
            </div>
          )}

          {/* Hero Status Badge with Fleet Online % */}
          <div className={`${stateInfo.bg} border ${stateInfo.border} rounded-lg p-4 text-center`}>
            <p className="text-2xl mb-1">{stateInfo.icon}</p>
            <p className={`text-xl font-bold ${stateInfo.color}`}>{stateInfo.label}</p>
            <p className={`text-lg font-sans ${stateInfo.color} mt-1`}>
              {formatNumber(summary?.fleetOnlinePercent, 0)}% online
            </p>
            <p className="text-xs text-terminal-muted mt-1">
              Copilot mode — recommendations only
            </p>
          </div>

          {/* Demand Response Alert */}
          {demandResponse?.active && (
            <div className="bg-terminal-cyan/10 border border-terminal-cyan/20 rounded px-3 py-2 text-xs text-terminal-cyan flex items-center gap-2">
              <span className="text-base">⚡</span>
              Grid stress event — Demand response active (+${formatNumber(demandResponse.premiumMWh, 0)}/MWh curtailment premium)
            </div>
          )}

          {/* Key Metrics — $/hr focus */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-terminal-bg/50 rounded p-3">
              <p className="text-xs text-terminal-muted">Net Revenue</p>
              <p className={`text-lg font-bold ${(summary?.netRevenuePerHr || 0) >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
                ${formatNumber(summary?.netRevenuePerHr, 2)}<span className="text-xs font-normal text-terminal-muted">/hr</span>
              </p>
              <p className="text-[10px] text-terminal-muted">
                ${formatNumber(summary?.netRevenuePerDay, 0)}/day projected
              </p>
            </div>
            <div className="bg-terminal-bg/50 rounded p-3">
              <p className="text-xs text-terminal-muted">Curtailment Savings</p>
              <p className="text-lg font-bold text-terminal-cyan">
                ${formatNumber(summary?.curtailmentSavingsPerHr, 2)}<span className="text-xs font-normal text-terminal-muted">/hr</span>
              </p>
              <p className="text-[10px] text-terminal-muted">
                ${formatNumber(summary?.curtailmentSavingsPerDay, 0)}/day projected
              </p>
            </div>
          </div>

          {/* Hashrate Split + Energy Price + Machines */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-terminal-bg/50 rounded p-3 text-center">
              <p className="text-xs text-terminal-muted">Mining</p>
              <p className="text-sm font-bold text-terminal-green">
                {formatNumber((summary?.miningHashrateTH || 0) / 1000, 1)} PH/s
              </p>
              <p className="text-[10px] text-terminal-muted">{summary?.miningMachines || 0} machines</p>
            </div>
            <div className="bg-terminal-bg/50 rounded p-3 text-center">
              <p className="text-xs text-terminal-muted">Curtailed</p>
              <p className="text-sm font-bold text-terminal-red">
                {formatNumber((summary?.curtailedHashrateTH || 0) / 1000, 1)} PH/s
              </p>
              <p className="text-[10px] text-terminal-muted">{summary?.curtailedMachines || 0} machines</p>
            </div>
            <div className="bg-terminal-bg/50 rounded p-3 text-center">
              <p className="text-xs text-terminal-muted">Energy</p>
              <p className="text-sm font-bold text-terminal-text">
                ${formatNumber(data.energyPrice?.current, 1)}
              </p>
              <p className="text-[10px] text-terminal-muted">$/MWh</p>
            </div>
          </div>

          {/* Next State Change Prediction */}
          {nextStateChange && (
            <div className="bg-terminal-panel border border-terminal-border rounded px-3 py-2">
              <p className="text-xs text-terminal-muted mb-1">Next State Change</p>
              <p className="text-xs text-terminal-text">
                <span className="text-terminal-amber font-medium">{nextStateChange.estimatedHour}:00</span>
                {' — '}{nextStateChange.trigger}
              </p>
            </div>
          )}

          {/* Per-Class Decisions with Machine Dots */}
          {decisions.length > 0 && (
            <div className="border-t border-terminal-border pt-3">
              <p className="text-xs font-semibold text-terminal-text mb-2">Machine Class Decisions</p>

              {/* Machine Dot Visualization */}
              <div className="flex flex-wrap gap-1 mb-3">
                {decisions.map((d, i) =>
                  Array.from({ length: Math.min(d.quantity, 50) }).map((_, j) => (
                    <span
                      key={`${i}-${j}`}
                      className={`w-2 h-2 rounded-full inline-block ${
                        d.action === 'MINE' ? 'bg-terminal-green' : 'bg-terminal-muted'
                      }`}
                      title={`${d.model} — ${d.action}`}
                    />
                  ))
                )}
                {decisions.some(d => d.quantity > 50) && (
                  <span className="text-[10px] text-terminal-muted ml-1">(capped at 50 dots/class)</span>
                )}
              </div>

              <div className="space-y-2">
                {decisions.map((d, i) => (
                  <div
                    key={i}
                    className={`rounded p-2 border text-xs ${
                      d.action === 'MINE'
                        ? 'border-terminal-green/20 bg-terminal-green/5'
                        : 'border-terminal-red/20 bg-terminal-red/5'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-terminal-text">{d.model}</span>
                      <span className={`font-bold ${d.action === 'MINE' ? 'text-terminal-green' : 'text-terminal-red'}`}>
                        {d.action} ({d.quantity} units)
                      </span>
                    </div>
                    <p className="text-terminal-muted leading-relaxed">{d.reason}</p>
                    <div className="flex items-center justify-between mt-1 text-terminal-muted">
                      <span>BE: ${formatNumber(d.breakevenMWh, 1)}/MWh</span>
                      <span>
                        {d.action === 'MINE'
                          ? `+$${formatNumber(d.netRevenuePerHr, 2)}/hr`
                          : d.avoidedLossPerHr > 0
                            ? `Avoids -$${formatNumber(d.avoidedLossPerHr, 2)}/hr`
                            : d.opportunityCostPerHr > 0
                              ? `Opp. cost: $${formatNumber(d.opportunityCostPerHr, 2)}/hr`
                              : ''
                        }
                      </span>
                      <span>Conf: {d.confidence}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Power Summary */}
          <div className="flex items-center justify-between text-xs text-terminal-muted border-t border-terminal-border pt-2">
            <span>Mining: {formatNumber(summary?.miningPowerMW, 2)} MW</span>
            <span>Curtailed: {formatNumber(summary?.curtailedPowerMW, 2)} MW</span>
          </div>
        </div>
      )}
    </Panel>
  );
}

/**
 * Network Context Widget (Charts 4A-4C)
 *
 * Displays Bitcoin network state from SanghaModel.
 * Used in Operations dashboard sidebar or header area.
 */
import React from 'react';
import { Activity, TrendingUp, TrendingDown } from 'lucide-react';
import { useApi } from '../../hooks/useApi';

function fmt(n, d = 0) {
  if (n == null) return '--';
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

// ─── 4A: Network Stats Bar ──────────────────────────────────────────────────

function NetworkStatsBar({ state }) {
  if (!state) return null;

  const chips = [
    { label: 'BTC', value: `$${fmt(state.btc_price_usd)}`, color: 'text-terminal-green' },
    { label: 'Hashprice', value: `$${Number(state.current_hashprice || 0).toFixed(4)}`, color: 'text-terminal-amber' },
    { label: 'Network', value: `${fmt(state.network_hashrate_eh, 1)} EH/s`, color: 'text-terminal-cyan' },
    { label: 'Difficulty', value: `${(Number(state.difficulty || 0) / 1e12).toFixed(1)}T`, color: 'text-terminal-text' },
    { label: 'Reward', value: `${Number(state.block_reward || 0).toFixed(3)} BTC`, color: 'text-terminal-text' },
    { label: 'Fees', value: `${Number(state.avg_fee_per_block || 0).toFixed(2)} BTC`, color: 'text-terminal-muted' },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {chips.map(c => (
        <div key={c.label} className="bg-terminal-bg/50 border border-terminal-border rounded px-2.5 py-1.5 min-w-[80px]">
          <p className="text-[9px] text-terminal-muted uppercase">{c.label}</p>
          <p className={`text-xs font-bold font-sans ${c.color}`}>{c.value}</p>
        </div>
      ))}
    </div>
  );
}

// ─── 4B: Next Difficulty Adjustment ─────────────────────────────────────────

function DifficultyAdjustmentIndicator({ state }) {
  if (!state) return null;

  const blocksRemaining = state.next_adjustment_blocks || 0;
  const progress = ((2016 - blocksRemaining) / 2016) * 100;
  const estimate = state.next_adjustment_estimate_percent || 0;
  const isPositive = estimate > 0;

  return (
    <div className="bg-terminal-bg/50 border border-terminal-border rounded p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] text-terminal-muted uppercase">Next Difficulty Adjustment</p>
        <div className="flex items-center gap-1">
          {isPositive ? (
            <TrendingUp size={12} className="text-terminal-red" />
          ) : (
            <TrendingDown size={12} className="text-terminal-green" />
          )}
          <span className={`text-sm font-bold font-sans ${isPositive ? 'text-terminal-red' : 'text-terminal-green'}`}>
            {estimate > 0 ? '+' : ''}{Number(estimate).toFixed(2)}%
          </span>
        </div>
      </div>
      <div className="w-full h-2 bg-terminal-border rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${Math.min(100, progress)}%`,
            backgroundColor: isPositive ? '#DC3545' : '#28A745',
          }}
        />
      </div>
      <p className="text-[10px] text-terminal-muted mt-1">
        {fmt(blocksRemaining)} blocks remaining
        {isPositive
          ? ' - difficulty rising (harder for miners)'
          : ' - difficulty dropping (good for miners)'}
      </p>
    </div>
  );
}

// ─── 4C: Network Efficiency Distribution ────────────────────────────────────

function EfficiencyDistribution({ distribution, tenantEfficiency }) {
  if (!distribution) return null;

  const { p10, p25, p50, p75, p90, mean } = distribution;
  const minVal = Math.min(p10, tenantEfficiency || p10) - 2;
  const maxVal = Math.max(p90, tenantEfficiency || p90) + 2;
  const range = maxVal - minVal;
  const toPercent = (v) => ((v - minVal) / range) * 100;

  // Determine tenant percentile
  let tenantPercentile = '--';
  if (tenantEfficiency != null) {
    if (tenantEfficiency <= p10) tenantPercentile = '<P10 (excellent)';
    else if (tenantEfficiency <= p25) tenantPercentile = 'P10-P25 (good)';
    else if (tenantEfficiency <= p50) tenantPercentile = 'P25-P50 (above avg)';
    else if (tenantEfficiency <= p75) tenantPercentile = 'P50-P75 (below avg)';
    else tenantPercentile = '>P75 (poor)';
  }

  return (
    <div className="bg-terminal-bg/50 border border-terminal-border rounded p-3">
      <p className="text-[10px] text-terminal-muted uppercase mb-3">Network Efficiency Distribution (J/TH)</p>
      <div className="relative h-8 mb-2">
        {/* P10-P90 range */}
        <div
          className="absolute h-3 top-2.5 bg-[#2E86AB]/15 rounded"
          style={{ left: `${toPercent(p10)}%`, width: `${toPercent(p90) - toPercent(p10)}%` }}
        />
        {/* P25-P75 box */}
        <div
          className="absolute h-3 top-2.5 bg-[#2E86AB]/30 rounded"
          style={{ left: `${toPercent(p25)}%`, width: `${toPercent(p75) - toPercent(p25)}%` }}
        />
        {/* Median line */}
        <div
          className="absolute w-0.5 h-5 top-1.5 bg-[#2E86AB]"
          style={{ left: `${toPercent(p50)}%` }}
        />
        {/* Mean marker */}
        <div
          className="absolute w-1.5 h-1.5 top-3 bg-[#FFC107] rounded-full"
          style={{ left: `${toPercent(mean)}%`, transform: 'translateX(-50%)' }}
          title={`Mean: ${mean} J/TH`}
        />
        {/* Tenant marker */}
        {tenantEfficiency != null && (
          <div
            className="absolute top-0"
            style={{ left: `${toPercent(tenantEfficiency)}%`, transform: 'translateX(-50%)' }}
          >
            <div className="w-2 h-2 bg-[#28A745] rounded-full" />
            <div className="w-0.5 h-4 bg-[#28A745] mx-auto" />
          </div>
        )}
      </div>
      {/* Labels */}
      <div className="flex justify-between text-[9px] text-terminal-muted font-sans">
        <span>{p10}</span>
        <span>{p25}</span>
        <span>{p50}</span>
        <span>{p75}</span>
        <span>{p90}</span>
      </div>
      <div className="flex justify-between text-[9px] text-terminal-muted">
        <span>P10</span>
        <span>P25</span>
        <span>P50</span>
        <span>P75</span>
        <span>P90</span>
      </div>
      {tenantEfficiency != null && (
        <p className="text-[10px] text-terminal-muted mt-2">
          Your fleet: <span className="text-terminal-green font-sans">{tenantEfficiency} J/TH</span> - {tenantPercentile}
        </p>
      )}
    </div>
  );
}

// ─── Main Widget ────────────────────────────────────────────────────────────

export default function NetworkContextWidget() {
  const { data, loading, error } = useApi('/v1/charts/network', { refreshInterval: 5 * 60 * 1000 });

  if (loading) {
    return (
      <div className="bg-terminal-panel border border-terminal-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Activity size={14} className="text-terminal-cyan" />
          <p className="text-xs font-semibold text-terminal-text">Network Context</p>
        </div>
        <div className="animate-pulse space-y-3">
          <div className="flex gap-2">{[1,2,3,4].map(i => <div key={i} className="h-10 bg-terminal-border rounded flex-1" />)}</div>
          <div className="h-12 bg-terminal-border rounded" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-terminal-panel border border-terminal-border rounded-lg p-4">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-terminal-muted" />
          <p className="text-xs text-terminal-muted">Network data unavailable</p>
        </div>
      </div>
    );
  }

  const ns = data.network_state;
  const tenantEff = data.tenant_fleet_efficiency;

  return (
    <div className="bg-terminal-panel border border-terminal-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-terminal-cyan" />
          <p className="text-xs font-semibold text-terminal-text">Network Context</p>
        </div>
        {data._mock && (
          <span className="text-[9px] px-1.5 py-0.5 bg-terminal-amber/20 text-terminal-amber rounded">MOCK</span>
        )}
      </div>
      <div className="space-y-3">
        <NetworkStatsBar state={ns} />
        <DifficultyAdjustmentIndicator state={ns} />
        <EfficiencyDistribution distribution={ns?.efficiency_distribution} tenantEfficiency={tenantEff} />
      </div>
    </div>
  );
}

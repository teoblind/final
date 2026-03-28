import React from 'react';
import Panel from '../../Panel';
import { useApi } from '../../../hooks/useApi';
import { formatNumber } from '../../../utils/formatters';

/**
 * Panel 7a: Site Overview
 * Unified view of all workloads (BTC Mining + AI/HPC) at a site.
 * Shows total capacity, online/curtailed MW, per-workload-type economics,
 * and combined net revenue.
 */
export default function SiteOverviewPanel() {
  const { data, loading, error, lastFetched, refetch } = useApi('/workloads/site-overview', {
    refreshInterval: 60 * 1000,
  });

  const workloads = data?.workloads || [];
  const btcWorkloads = workloads.filter(w => w.type === 'btc');
  const hpcWorkloads = workloads.filter(w => w.type === 'hpc');

  const hasBtc = btcWorkloads.length > 0;
  const hasHpc = hpcWorkloads.length > 0;

  // Aggregate per-type totals
  const aggregate = (items) => {
    const onlineMW = items.reduce((s, w) => s + (w.onlineMW || 0), 0);
    const curtailedMW = items.reduce((s, w) => s + (w.curtailedMW || 0), 0);
    const revenuePerHr = items.reduce((s, w) => s + (w.revenuePerHr || 0), 0);
    const energyCostPerHr = items.reduce((s, w) => s + (w.energyCostPerHr || 0), 0);
    const netRevenuePerHr = items.reduce((s, w) => s + (w.netRevenuePerHr || 0), 0);
    const totalCapacity = items.reduce((s, w) => s + (w.capacityMW || 0), 0);
    const marginPercent = revenuePerHr > 0
      ? (netRevenuePerHr / revenuePerHr) * 100
      : 0;
    return { onlineMW, curtailedMW, revenuePerHr, energyCostPerHr, netRevenuePerHr, totalCapacity, marginPercent };
  };

  const btcAgg = aggregate(btcWorkloads);
  const hpcAgg = aggregate(hpcWorkloads);

  const onlinePercent = data?.totalCapacityMW
    ? ((data.onlineMW / data.totalCapacityMW) * 100)
    : 0;
  const curtailedPercent = data?.totalCapacityMW
    ? ((data.curtailedMW / data.totalCapacityMW) * 100)
    : 0;

  return (
    <Panel
      title="Site Overview"
      source="Workload Manager"
      lastUpdated={lastFetched}
      loading={loading}
      error={error}
      onRefresh={refetch}
    >
      {data && (
        <div className="space-y-4">
          {/* Top capacity bar */}
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-terminal-bg/50 rounded p-3 text-center">
              <p className="text-xs text-terminal-muted uppercase tracking-wider">Total Capacity</p>
              <p className="text-xl font-bold text-terminal-text">
                {formatNumber(data.totalCapacityMW, 1)}
                <span className="text-sm font-normal text-terminal-muted"> MW</span>
              </p>
            </div>
            <div className="bg-terminal-bg/50 rounded p-3 text-center">
              <p className="text-xs text-terminal-muted uppercase tracking-wider">Online</p>
              <p className="text-xl font-bold text-terminal-green">
                {formatNumber(data.onlineMW, 1)}
                <span className="text-sm font-normal text-terminal-muted"> MW</span>
              </p>
              <p className="text-[10px] text-terminal-muted">{formatNumber(onlinePercent, 1)}%</p>
            </div>
            <div className="bg-terminal-bg/50 rounded p-3 text-center">
              <p className="text-xs text-terminal-muted uppercase tracking-wider">Curtailed</p>
              <p className="text-xl font-bold text-terminal-amber">
                {formatNumber(data.curtailedMW, 1)}
                <span className="text-sm font-normal text-terminal-muted"> MW</span>
              </p>
              <p className="text-[10px] text-terminal-muted">{formatNumber(curtailedPercent, 1)}%</p>
            </div>
            <div className="bg-terminal-bg/50 rounded p-3 text-center">
              <p className="text-xs text-terminal-muted uppercase tracking-wider">Firm</p>
              <p className="text-xl font-bold text-terminal-cyan">
                {formatNumber(data.firmMW, 1)}
                <span className="text-sm font-normal text-terminal-muted"> MW</span>
              </p>
            </div>
          </div>

          {/* Workload type cards */}
          <div className={`grid ${hasBtc && hasHpc ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
            {/* BTC Mining card */}
            {hasBtc && (
              <WorkloadCard
                title="BTC Mining"
                icon="BTC"
                color="green"
                agg={btcAgg}
                workloads={btcWorkloads}
              />
            )}

            {/* AI/HPC card */}
            {hasHpc && (
              <WorkloadCard
                title="AI / HPC"
                icon="HPC"
                color="cyan"
                agg={hpcAgg}
                workloads={hpcWorkloads}
              />
            )}
          </div>

          {/* HPC not configured hint */}
          {hasBtc && !hasHpc && (
            <div className="bg-terminal-bg/50 border border-terminal-border rounded px-3 py-2 text-xs text-terminal-muted text-center">
              HPC not configured - add AI/HPC workloads in Settings to see side-by-side economics.
            </div>
          )}

          {/* Combined Net Revenue footer */}
          <div className="border-t border-terminal-border pt-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-terminal-muted uppercase tracking-wider">Combined Net Revenue</span>
              <span className={`text-lg font-bold ${(data.combinedNetRevenuePerHr || 0) >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
                ${formatNumber(data.combinedNetRevenuePerHr, 2)}
                <span className="text-sm font-normal text-terminal-muted">/hr</span>
              </span>
            </div>
            <div className="flex items-center justify-between mt-1">
              <span className="text-[10px] text-terminal-muted">Energy cost</span>
              <span className="text-xs text-terminal-red">
                -${formatNumber(data.combinedEnergyCostPerHr, 2)}/hr
              </span>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}

function WorkloadCard({ title, icon, color, agg, workloads }) {
  const borderColor = color === 'cyan' ? 'border-terminal-cyan/30' : 'border-terminal-green/30';
  const bgColor = color === 'cyan' ? 'bg-terminal-cyan/10' : 'bg-terminal-green/10';
  const textColor = color === 'cyan' ? 'text-terminal-cyan' : 'text-terminal-green';

  return (
    <div className={`${bgColor} border ${borderColor} rounded-lg p-4`}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className={`text-xs font-bold px-2 py-0.5 rounded ${textColor} bg-terminal-bg/50`}>
          {icon}
        </span>
        <span className={`text-sm font-semibold ${textColor}`}>{title}</span>
        <span className="text-[10px] text-terminal-muted ml-auto">
          {workloads.length} workload{workloads.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Power stats */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <p className="text-[10px] text-terminal-muted">Online</p>
          <p className="text-sm font-bold text-terminal-text">
            {formatNumber(agg.onlineMW, 2)} MW
          </p>
        </div>
        <div>
          <p className="text-[10px] text-terminal-muted">Curtailed</p>
          <p className="text-sm font-bold text-terminal-amber">
            {formatNumber(agg.curtailedMW, 2)} MW
          </p>
        </div>
      </div>

      {/* Economics */}
      <div className="space-y-1.5 text-xs border-t border-terminal-border/30 pt-2">
        <div className="flex items-center justify-between">
          <span className="text-terminal-muted">Revenue</span>
          <span className="text-terminal-green font-medium">
            ${formatNumber(agg.revenuePerHr, 2)}/hr
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-terminal-muted">Energy cost</span>
          <span className="text-terminal-red font-medium">
            -${formatNumber(agg.energyCostPerHr, 2)}/hr
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-terminal-muted">Net</span>
          <span className={`font-bold ${agg.netRevenuePerHr >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
            ${formatNumber(agg.netRevenuePerHr, 2)}/hr
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-terminal-muted">Margin</span>
          <span className={`font-medium ${agg.marginPercent >= 0 ? 'text-terminal-text' : 'text-terminal-red'}`}>
            {formatNumber(agg.marginPercent, 1)}%
          </span>
        </div>
      </div>
    </div>
  );
}

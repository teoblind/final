import React from 'react';
import Panel from '../../Panel';
import { useApi } from '../../../hooks/useApi';
import { formatNumber, formatDate } from '../../../utils/formatters';

/**
 * Panel 7c: HPC Contracts
 * Dashboard showing all HPC contracts with SLA status, curtailability,
 * and a summary footer with totals.
 */
export default function HpcContractsPanel() {
  const { data, loading, error, lastFetched, refetch } = useApi('/hpc/contracts', {
    refreshInterval: 5 * 60 * 1000,
  });

  const contracts = data?.contracts || [];
  const summary = data?.summary;

  const statusConfig = {
    active: { label: 'Active', color: 'text-terminal-green', bg: 'bg-terminal-green/15', border: 'border-terminal-green/30' },
    expired: { label: 'Expired', color: 'text-terminal-red', bg: 'bg-terminal-red/15', border: 'border-terminal-red/30' },
    archived: { label: 'Archived', color: 'text-terminal-muted', bg: 'bg-terminal-muted/15', border: 'border-terminal-muted/30' },
  };

  const getUptimeColor = (current, target) => {
    if (current === null || current === undefined || target === null || target === undefined) {
      return 'text-terminal-muted';
    }
    if (current >= target) return 'text-terminal-green';
    if (current >= target - 0.1) return 'text-terminal-amber';
    return 'text-terminal-red';
  };

  return (
    <Panel
      title="HPC Contracts"
      source="Contract Manager"
      lastUpdated={lastFetched}
      loading={loading}
      error={error}
      onRefresh={refetch}
    >
      {data && (
        <div className="space-y-3">
          {/* Contract cards */}
          {contracts.length === 0 && (
            <div className="flex flex-col items-center justify-center py-6 text-terminal-muted text-sm">
              <p>No HPC contracts configured.</p>
              <p className="text-xs mt-1">Add contracts in Settings to track SLA and revenue.</p>
            </div>
          )}

          {contracts.map((c) => {
            const status = statusConfig[c.status] || statusConfig.archived;
            const uptimeColor = getUptimeColor(c.currentUptime, c.uptimeSLA);

            return (
              <div
                key={c.id}
                className="bg-terminal-bg/50 border border-terminal-border rounded-lg p-4"
              >
                {/* Top row: ID, Customer, Status */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-xs font-mono text-terminal-muted">{c.id}</span>
                    <span className="text-sm font-semibold text-terminal-text truncate">{c.customer}</span>
                  </div>
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded border ${status.color} ${status.bg} ${status.border}`}>
                    {status.label}
                  </span>
                </div>

                {/* GPU, Capacity, Rate row */}
                <div className="grid grid-cols-4 gap-3 mb-3">
                  <div>
                    <p className="text-[10px] text-terminal-muted">GPU</p>
                    <p className="text-xs text-terminal-text font-medium">{c.gpuModel}</p>
                    <p className="text-[10px] text-terminal-muted">{formatNumber(c.gpuCount, 0)} units</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-terminal-muted">Capacity</p>
                    <p className="text-xs text-terminal-text font-medium">
                      {formatNumber(c.powerDrawMW, 2)} MW
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-terminal-muted">Rate</p>
                    <p className="text-xs text-terminal-text font-medium">
                      ${formatNumber(c.ratePerGpuHr, 3)}/GPU-hr
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-terminal-muted">Monthly Revenue</p>
                    <p className="text-xs text-terminal-green font-bold">
                      ${formatNumber(c.monthlyRevenue, 0)}
                    </p>
                  </div>
                </div>

                {/* SLA + Curtailability row */}
                <div className="flex items-center gap-4 text-xs border-t border-terminal-border/30 pt-2">
                  {/* SLA */}
                  <div className="flex items-center gap-2">
                    <span className="text-terminal-muted">SLA:</span>
                    <span className="text-terminal-text">{formatNumber(c.uptimeSLA, 2)}%</span>
                    <span className="text-terminal-muted">|</span>
                    <span className="text-terminal-muted">Current:</span>
                    <span className={`font-bold ${uptimeColor}`}>
                      {formatNumber(c.currentUptime, 2)}%
                    </span>
                  </div>

                  <span className="text-terminal-border">|</span>

                  {/* Curtailability */}
                  {c.interruptible ? (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-terminal-amber/15 border border-terminal-amber/30 text-terminal-amber">
                        Interruptible
                      </span>
                      <span className="text-terminal-muted">
                        max {c.curtailmentMaxHours}h/mo, {c.curtailmentNoticeMin}min notice
                      </span>
                    </div>
                  ) : (
                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-terminal-cyan/15 border border-terminal-cyan/30 text-terminal-cyan">
                      Firm
                    </span>
                  )}
                </div>

                {/* Contract dates */}
                <div className="flex items-center gap-4 text-[10px] text-terminal-muted mt-2">
                  <span>Start: {formatDate(c.startDate)}</span>
                  <span>End: {formatDate(c.endDate)}</span>
                  {c.autoRenew && (
                    <span className="text-terminal-green">Auto-renew</span>
                  )}
                </div>
              </div>
            );
          })}

          {/* Summary footer */}
          {summary && contracts.length > 0 && (
            <div className="border-t border-terminal-border pt-3">
              <div className="grid grid-cols-4 gap-3">
                <div>
                  <p className="text-[10px] text-terminal-muted uppercase tracking-wider">Contracted MW</p>
                  <p className="text-sm font-bold text-terminal-text">
                    {formatNumber((summary.totalFirmMW || 0) + (summary.totalInterruptibleMW || 0), 2)}
                  </p>
                  <p className="text-[10px] text-terminal-muted">
                    Firm {formatNumber(summary.totalFirmMW, 2)} + Int. {formatNumber(summary.totalInterruptibleMW, 2)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-terminal-muted uppercase tracking-wider">Monthly Revenue</p>
                  <p className="text-sm font-bold text-terminal-green">
                    ${formatNumber(summary.totalMonthlyRevenue, 0)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-terminal-muted uppercase tracking-wider">Avg Weighted SLA</p>
                  <p className="text-sm font-bold text-terminal-text">
                    {formatNumber(summary.avgWeightedSLA, 2)}%
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-terminal-muted uppercase tracking-wider">Curtailable</p>
                  <p className="text-sm font-bold text-terminal-amber">
                    {formatNumber(summary.curtailableCapacityMW, 2)} MW
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

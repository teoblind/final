import React, { useState } from 'react';
import Panel from '../../Panel';
import { useApi } from '../../../hooks/useApi';
import { formatNumber } from '../../../utils/formatters';

/**
 * Panel 7b: Workload Economics
 * Comparison of $/MW/day for BTC vs HPC over a configurable period.
 * Includes a table with per-workload-type rows, a combined row,
 * horizontal bar chart, and insight text.
 */
export default function WorkloadEconomicsPanel() {
  const [period, setPeriod] = useState(30);

  const periodOptions = [
    { label: '7D', value: 7 },
    { label: '30D', value: 30 },
    { label: '90D', value: 90 },
  ];

  const { data, loading, error, lastFetched, refetch } = useApi(`/workloads/comparison?days=${period}`, {
    refreshInterval: 5 * 60 * 1000,
  });

  const workloads = data?.workloads || [];
  const combined = data?.combined;

  // Find max $/MW/day for bar scaling
  const maxRevenuePerMW = Math.max(
    ...workloads.map(w => w.revenuePerMW || 0),
    1
  );

  const typeConfig = {
    btc: { label: 'BTC Mining', icon: 'BTC', color: 'text-terminal-green', barColor: 'bg-terminal-green' },
    hpc: { label: 'AI / HPC', icon: 'HPC', color: 'text-terminal-cyan', barColor: 'bg-terminal-cyan' },
  };

  return (
    <Panel
      title="Workload Economics"
      source="Workload Manager"
      lastUpdated={lastFetched}
      loading={loading}
      error={error}
      onRefresh={refetch}
      headerRight={
        <div className="flex gap-1">
          {periodOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => setPeriod(opt.value)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                period === opt.value
                  ? 'bg-terminal-green/20 text-terminal-green border border-terminal-green/30'
                  : 'text-terminal-muted hover:text-terminal-text hover:bg-terminal-border'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      }
    >
      {data && (
        <div className="space-y-4">
          {/* Comparison Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-terminal-muted border-b border-terminal-border">
                  <th className="text-left py-2 pr-2">Type</th>
                  <th className="text-right py-2 px-2">Capacity MW</th>
                  <th className="text-right py-2 px-2">Revenue $</th>
                  <th className="text-right py-2 px-2">Energy $</th>
                  <th className="text-right py-2 px-2">Net $</th>
                  <th className="text-right py-2 px-2">$/MW/day</th>
                  <th className="text-right py-2 px-2">Margin %</th>
                  <th className="text-right py-2 px-2">Curtailed %</th>
                  <th className="text-right py-2 pl-2">Volatility</th>
                </tr>
              </thead>
              <tbody>
                {workloads.map((w, idx) => {
                  const cfg = typeConfig[w.type] || typeConfig.btc;
                  return (
                    <tr key={w.id || idx} className="border-b border-terminal-border/30">
                      <td className="py-2 pr-2">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cfg.color} bg-terminal-bg/50`}>
                            {cfg.icon}
                          </span>
                          <span className="text-terminal-text">{cfg.label}</span>
                        </div>
                      </td>
                      <td className="text-right py-2 px-2 text-terminal-text">
                        {formatNumber(w.capacityMW, 1)}
                      </td>
                      <td className="text-right py-2 px-2 text-terminal-green">
                        ${formatNumber(w.grossRevenue, 0)}
                      </td>
                      <td className="text-right py-2 px-2 text-terminal-red">
                        -${formatNumber(w.energyCost, 0)}
                      </td>
                      <td className={`text-right py-2 px-2 font-medium ${(w.netRevenue || 0) >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
                        ${formatNumber(w.netRevenue, 0)}
                      </td>
                      <td className={`text-right py-2 px-2 font-medium ${cfg.color}`}>
                        ${formatNumber(w.revenuePerMW, 0)}
                      </td>
                      <td className={`text-right py-2 px-2 ${(w.marginPercent || 0) >= 0 ? 'text-terminal-text' : 'text-terminal-red'}`}>
                        {formatNumber(w.marginPercent, 1)}%
                      </td>
                      <td className="text-right py-2 px-2 text-terminal-amber">
                        {formatNumber(w.curtailmentPercent, 1)}%
                      </td>
                      <td className="text-right py-2 pl-2 text-terminal-muted">
                        {formatNumber(w.volatility, 2)}
                      </td>
                    </tr>
                  );
                })}

                {/* Combined row */}
                {combined && (
                  <tr className="border-t border-terminal-border font-medium">
                    <td className="py-2 pr-2 text-terminal-text">Combined</td>
                    <td className="text-right py-2 px-2 text-terminal-text">-</td>
                    <td className="text-right py-2 px-2 text-terminal-green">
                      ${formatNumber(combined.grossRevenue, 0)}
                    </td>
                    <td className="text-right py-2 px-2 text-terminal-red">
                      -${formatNumber(combined.energyCost, 0)}
                    </td>
                    <td className={`text-right py-2 px-2 ${(combined.netRevenue || 0) >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
                      ${formatNumber(combined.netRevenue, 0)}
                    </td>
                    <td className="text-right py-2 px-2 text-terminal-text">
                      ${formatNumber(combined.revenuePerMW, 0)}
                    </td>
                    <td className={`text-right py-2 px-2 ${(combined.marginPercent || 0) >= 0 ? 'text-terminal-text' : 'text-terminal-red'}`}>
                      {formatNumber(combined.marginPercent, 1)}%
                    </td>
                    <td className="text-right py-2 px-2 text-terminal-muted">-</td>
                    <td className="text-right py-2 pl-2 text-terminal-muted">-</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Horizontal bar chart: $/MW/day comparison */}
          {workloads.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-terminal-muted uppercase tracking-wider">$/MW/day Comparison</p>
              {workloads.map((w, idx) => {
                const cfg = typeConfig[w.type] || typeConfig.btc;
                const barWidth = maxRevenuePerMW > 0
                  ? ((w.revenuePerMW || 0) / maxRevenuePerMW) * 100
                  : 0;
                return (
                  <div key={w.id || idx} className="flex items-center gap-3">
                    <span className={`text-xs w-20 text-right ${cfg.color}`}>{cfg.label}</span>
                    <div className="flex-1 bg-terminal-bg/50 rounded h-5 overflow-hidden">
                      <div
                        className={`h-full ${cfg.barColor}/60 rounded flex items-center justify-end pr-2`}
                        style={{ width: `${Math.max(barWidth, 2)}%` }}
                      >
                        <span className="text-[10px] font-bold text-terminal-text">
                          ${formatNumber(w.revenuePerMW, 0)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Insight text */}
          {data.insight && (
            <div className="bg-terminal-cyan/5 border border-terminal-cyan/20 rounded p-3 text-xs">
              <p className="text-terminal-cyan font-medium mb-1">Insight</p>
              <p className="text-terminal-text">{data.insight}</p>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

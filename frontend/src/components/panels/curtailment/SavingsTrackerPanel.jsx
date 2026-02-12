import React, { useState, useMemo } from 'react';
import Panel, { PeriodSelector } from '../../Panel';
import { useApi } from '../../../hooks/useApi';
import { formatNumber } from '../../../utils/formatters';

/**
 * Panel 5c: Curtailment Savings Tracker
 * Cumulative savings chart, breakdown by trigger type,
 * and daily savings timeline.
 */
export default function SavingsTrackerPanel() {
  const [period, setPeriod] = useState('1m');

  const daysMap = { '1w': 7, '1m': 30, '3m': 90, '1y': 365 };
  const days = daysMap[period] || 30;

  const { data, loading, error, lastFetched, isStale, refetch } = useApi(`/curtailment/savings?days=${days}`, {
    refreshInterval: 5 * 60 * 1000,
  });

  const totalSavings = data?.totalSavings || 0;
  const totalEvents = data?.totalEvents || 0;
  const byType = data?.byType || {};
  const dailySavings = data?.dailySavings || [];

  // Build cumulative chart data
  const cumulativeData = useMemo(() => {
    let cumulative = 0;
    return dailySavings.map(d => {
      cumulative += d.savings;
      return { ...d, cumulative };
    });
  }, [dailySavings]);

  // Max cumulative for chart scaling
  const maxCumulative = cumulativeData.length > 0
    ? Math.max(...cumulativeData.map(d => d.cumulative)) : 1;

  // Type colors
  const typeColors = {
    price_spike: { label: 'Price Spike', color: 'text-terminal-red', bg: 'bg-terminal-red/20' },
    schedule: { label: 'Scheduled', color: 'text-terminal-amber', bg: 'bg-terminal-amber/20' },
    demand_response: { label: 'Demand Response', color: 'text-terminal-cyan', bg: 'bg-terminal-cyan/20' },
    manual: { label: 'Manual', color: 'text-terminal-muted', bg: 'bg-terminal-border' },
  };

  const handleExport = () => {
    if (!dailySavings.length) return;
    const headers = 'Date,Savings,Events';
    const rows = dailySavings.map(d => `${d.date},${d.savings.toFixed(2)},${d.events}`);
    const csv = [headers, ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `curtailment-savings-${days}d.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Panel
      title="Curtailment Savings"
      source="Event Log"
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
      onExport={dailySavings.length > 0 ? handleExport : undefined}
      headerRight={
        <PeriodSelector
          value={period}
          onChange={setPeriod}
          options={['1W', '1M', '3M', '1Y']}
        />
      }
    >
      <div className="space-y-4">
        {/* Hero: Total Savings */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-terminal-bg/50 rounded p-3 text-center">
            <p className="text-xs text-terminal-muted">Total Savings</p>
            <p className="text-xl font-bold text-terminal-cyan">
              ${formatNumber(totalSavings, 0)}
            </p>
          </div>
          <div className="bg-terminal-bg/50 rounded p-3 text-center">
            <p className="text-xs text-terminal-muted">Events</p>
            <p className="text-xl font-bold text-terminal-text">{totalEvents}</p>
          </div>
          <div className="bg-terminal-bg/50 rounded p-3 text-center">
            <p className="text-xs text-terminal-muted">Avg/Event</p>
            <p className="text-xl font-bold text-terminal-text">
              ${formatNumber(totalEvents > 0 ? totalSavings / totalEvents : 0, 0)}
            </p>
          </div>
        </div>

        {/* Cumulative Savings Chart (simplified) */}
        {cumulativeData.length > 0 && (
          <div>
            <p className="text-xs text-terminal-muted mb-2">Cumulative Savings</p>
            <div className="relative h-24 bg-terminal-bg/30 rounded overflow-hidden">
              <svg width="100%" height="100%" preserveAspectRatio="none" viewBox={`0 0 ${cumulativeData.length} 100`}>
                {/* Area fill */}
                <path
                  d={`M0,100 ${cumulativeData.map((d, i) =>
                    `L${i},${100 - (d.cumulative / maxCumulative) * 95}`
                  ).join(' ')} L${cumulativeData.length - 1},100 Z`}
                  fill="rgba(0, 212, 255, 0.1)"
                />
                {/* Line */}
                <polyline
                  points={cumulativeData.map((d, i) =>
                    `${i},${100 - (d.cumulative / maxCumulative) * 95}`
                  ).join(' ')}
                  fill="none"
                  stroke="#00d4ff"
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <div className="absolute top-1 right-2 text-xs font-bold text-terminal-cyan">
                ${formatNumber(maxCumulative, 0)}
              </div>
              <div className="absolute bottom-1 left-2 text-[10px] text-terminal-muted">
                {cumulativeData[0]?.date}
              </div>
              <div className="absolute bottom-1 right-2 text-[10px] text-terminal-muted">
                {cumulativeData[cumulativeData.length - 1]?.date}
              </div>
            </div>
          </div>
        )}

        {/* Breakdown by Trigger Type */}
        {Object.keys(byType).length > 0 && (
          <div>
            <p className="text-xs text-terminal-muted mb-2">By Trigger Type</p>
            <div className="space-y-2">
              {Object.entries(byType)
                .sort(([, a], [, b]) => b - a)
                .map(([type, savings]) => {
                  const config = typeColors[type] || { label: type, color: 'text-terminal-muted', bg: 'bg-terminal-border' };
                  const pct = totalSavings > 0 ? (savings / totalSavings) * 100 : 0;
                  return (
                    <div key={type} className="flex items-center gap-3">
                      <span className={`text-xs ${config.color} w-24`}>{config.label}</span>
                      <div className="flex-1 h-3 bg-terminal-bg/50 rounded overflow-hidden">
                        <div
                          className={`h-full ${config.bg} rounded`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-terminal-text w-20 text-right">
                        ${formatNumber(savings, 0)} ({formatNumber(pct, 0)}%)
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Empty state */}
        {totalEvents === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-8 text-terminal-muted text-sm">
            <p>No curtailment events recorded yet.</p>
            <p className="text-xs mt-1">Events will appear as the engine logs recommendations.</p>
          </div>
        )}
      </div>
    </Panel>
  );
}

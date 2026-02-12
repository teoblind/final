import React, { useState } from 'react';
import Panel from '../../Panel';
import { useApi } from '../../../hooks/useApi';
import { formatNumber, formatCurrency, exportToCSV } from '../../../utils/formatters';

/**
 * Panel 4b: Machine-Class Breakdown
 * Table view showing profitability per ASIC model, sorted with breakeven line.
 */
export default function MachineBreakdownPanel() {
  const { data, loading, error, lastFetched, isStale, refetch } = useApi('/fleet/profitability', {
    refreshInterval: 5 * 60 * 1000,
  });

  const [sortBy, setSortBy] = useState('margin'); // margin, revenue, efficiency

  if (data && !data.hasFleet) {
    return (
      <Panel title="Machine Class Profitability" source="Not Configured" loading={false}>
        <div className="flex flex-col items-center justify-center py-6 text-terminal-muted text-sm">
          <p>No fleet configured</p>
        </div>
      </Panel>
    );
  }

  const fleet = data?.fleet;
  const models = fleet?.revenueByModel || [];

  // Sort models
  const sorted = [...models].sort((a, b) => {
    if (sortBy === 'margin') return b.profitMargin - a.profitMargin;
    if (sortBy === 'revenue') return (b.netRevenue * b.quantity) - (a.netRevenue * a.quantity);
    if (sortBy === 'efficiency') return a.model.efficiency - b.model.efficiency;
    return 0;
  });

  // Find breakeven index (last profitable model)
  const lastProfitableIdx = sorted.reduce((acc, m, i) => m.isProfitable ? i : acc, -1);

  const handleExport = () => {
    if (!sorted.length) return;
    const csvData = sorted.map(r => ({
      Model: r.model.model,
      Quantity: r.quantity,
      'Hashrate (TH/s)': r.model.hashrate,
      'Efficiency (J/TH)': r.model.efficiency?.toFixed(1),
      'Revenue ($/day)': (r.grossRevenue * r.quantity).toFixed(2),
      'Elec Cost ($/day)': (r.electricityCost * r.quantity).toFixed(2),
      'Net ($/day)': (r.netRevenue * r.quantity).toFixed(2),
      'Margin (%)': r.profitMargin.toFixed(1),
      'Breakeven ($/kWh)': r.breakEvenElectricity.toFixed(4),
      Profitable: r.isProfitable ? 'Yes' : 'No',
    }));
    exportToCSV(csvData, 'fleet-machine-breakdown');
  };

  const sortOptions = [
    { value: 'margin', label: 'Margin' },
    { value: 'revenue', label: 'Revenue' },
    { value: 'efficiency', label: 'Efficiency' },
  ];

  return (
    <Panel
      title="Machine Class Profitability"
      source={data?.source || 'Blockchain.info + ERCOT'}
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
      onExport={handleExport}
      headerRight={
        <div className="flex items-center gap-1 text-xs">
          <span className="text-terminal-muted">Sort:</span>
          {sortOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => setSortBy(opt.value)}
              className={`px-2 py-0.5 rounded transition-colors ${
                sortBy === opt.value
                  ? 'bg-terminal-green/20 text-terminal-green'
                  : 'text-terminal-muted hover:text-terminal-text'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      }
    >
      {sorted.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-terminal-muted border-b border-terminal-border">
                <th className="text-left py-2 pr-2">Model</th>
                <th className="text-right py-2 px-2">Qty</th>
                <th className="text-right py-2 px-2">Revenue</th>
                <th className="text-right py-2 px-2">Cost</th>
                <th className="text-right py-2 px-2">Net</th>
                <th className="text-right py-2 px-2">Margin</th>
                <th className="text-right py-2 pl-2">BE $/kWh</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, idx) => {
                const showBreakeven = idx === lastProfitableIdx && lastProfitableIdx < sorted.length - 1;
                return (
                  <React.Fragment key={idx}>
                    <tr className={`border-b border-terminal-border/30 ${
                      !row.isProfitable ? 'opacity-50' : ''
                    }`}>
                      <td className="py-2 pr-2">
                        <div className="flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${row.isProfitable ? 'bg-terminal-green' : 'bg-terminal-red'}`} />
                          <span className="text-terminal-text">{row.model.model}</span>
                          <span className="text-terminal-muted">({row.model.efficiency?.toFixed(1)} J/TH)</span>
                        </div>
                      </td>
                      <td className="text-right py-2 px-2 text-terminal-text">{row.quantity}</td>
                      <td className="text-right py-2 px-2 text-terminal-green">
                        ${formatNumber(row.grossRevenue * row.quantity, 0)}
                      </td>
                      <td className="text-right py-2 px-2 text-terminal-red">
                        -${formatNumber(row.electricityCost * row.quantity, 0)}
                      </td>
                      <td className={`text-right py-2 px-2 font-medium ${row.isProfitable ? 'text-terminal-green' : 'text-terminal-red'}`}>
                        {row.isProfitable ? '' : '-'}${formatNumber(Math.abs(row.netRevenue * row.quantity), 0)}
                      </td>
                      <td className={`text-right py-2 px-2 ${row.isProfitable ? 'text-terminal-text' : 'text-terminal-red'}`}>
                        {formatNumber(row.profitMargin, 1)}%
                      </td>
                      <td className="text-right py-2 pl-2 text-terminal-muted">
                        ${row.breakEvenElectricity.toFixed(3)}
                      </td>
                    </tr>
                    {showBreakeven && (
                      <tr>
                        <td colSpan={7} className="py-1">
                          <div className="border-t border-dashed border-terminal-amber/40 relative">
                            <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-terminal-panel px-2 text-[10px] text-terminal-amber">
                              BREAKEVEN LINE
                            </span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

import React from 'react';
import Panel from '../../Panel';
import { useApi } from '../../../hooks/useApi';
import { formatNumber, formatDate, getPMIColor, getTrendArrow, exportToCSV } from '../../../utils/formatters';

export default function PmiPanel() {
  const { data, loading, error, lastFetched, isStale, refetch } = useApi(
    '/pmi',
    { refreshInterval: 24 * 60 * 60 * 1000 } // 24 hours
  );

  const countries = data?.countries || [];

  const handleExport = () => {
    if (countries.length) {
      exportToCSV(countries, 'pmi_data');
    }
  };

  return (
    <Panel
      title="Global Manufacturing PMIs"
      source="Various (ISM, S&P Global, Caixin)"
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
      onExport={handleExport}
    >
      {/* Legend */}
      <div className="flex gap-4 mb-3 text-xs">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-terminal-green/20 border border-terminal-green"></span>
          &gt;52 Expansion
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-terminal-amber/20 border border-terminal-amber"></span>
          48-52 Neutral
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded bg-terminal-red/20 border border-terminal-red"></span>
          &lt;48 Contraction
        </span>
      </div>

      {/* PMI Heatmap Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-terminal-muted text-xs uppercase">
              <th className="text-left py-2 px-1">Country</th>
              <th className="text-center py-2 px-1">Headline</th>
              <th className="text-center py-2 px-1 hidden sm:table-cell">New Orders</th>
              <th className="text-center py-2 px-1 hidden md:table-cell">Employment</th>
              <th className="text-center py-2 px-1 hidden md:table-cell">Prices</th>
              <th className="text-left py-2 px-1">Source</th>
            </tr>
          </thead>
          <tbody>
            {countries.map((country, i) => (
              <tr key={i} className="border-t border-terminal-border">
                <td className="py-2 px-1">
                  <div>
                    <span className="font-medium">{country.name}</span>
                    {country.date && (
                      <span className="text-terminal-muted text-xs ml-2">
                        {formatDate(country.date, 'MMM')}
                      </span>
                    )}
                  </div>
                </td>
                <td className="text-center py-2 px-1">
                  <PMICell value={country.headline} change={country.change} />
                </td>
                <td className="text-center py-2 px-1 hidden sm:table-cell">
                  <PMICell value={country.newOrders} />
                </td>
                <td className="text-center py-2 px-1 hidden md:table-cell">
                  <PMICell value={country.employment} />
                </td>
                <td className="text-center py-2 px-1 hidden md:table-cell">
                  <PMICell value={country.pricesPaid} />
                </td>
                <td className="py-2 px-1 text-terminal-muted text-xs">
                  {country.source}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Note */}
      <p className="text-xs text-terminal-muted mt-3">
        {data?.note}
      </p>
    </Panel>
  );
}

function PMICell({ value, change }) {
  if (value === null || value === undefined) {
    return <span className="text-terminal-muted">-</span>;
  }

  const colorClass = getPMIColor(value);

  return (
    <div className={`inline-flex items-center gap-1 px-2 py-1 rounded ${colorClass}`}>
      <span className="font-sans">{formatNumber(value, 1)}</span>
      {change !== null && change !== undefined && (
        <span className="text-xs">{getTrendArrow(change)}</span>
      )}
    </div>
  );
}

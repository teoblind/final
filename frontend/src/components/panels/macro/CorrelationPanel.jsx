import React, { useState } from 'react';
import Panel from '../../Panel';
import { useApi } from '../../../hooks/useApi';
import { formatNumber, getCorrelationColor } from '../../../utils/formatters';

export default function CorrelationPanel({ fullWidth = false }) {
  const [period, setPeriod] = useState('90d');

  const { data, loading, error, lastFetched, isStale, refetch } = useApi(
    '/correlation',
    {
      params: { period },
      refreshInterval: 24 * 60 * 60 * 1000
    }
  );

  const pairs = data?.pairResults || [];
  const matrix = data?.matrix || {};
  const metrics = Object.keys(matrix);

  return (
    <Panel
      title="Correlation Engine"
      source="Calculated from cached data"
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
      className={fullWidth ? 'col-span-full' : ''}
      headerRight={
        <div className="flex gap-1">
          <button
            onClick={() => setPeriod('30d')}
            className={`px-2 py-1 text-xs rounded ${
              period === '30d' ? 'bg-terminal-green/20 text-terminal-green' : 'text-terminal-muted'
            }`}
          >
            30D
          </button>
          <button
            onClick={() => setPeriod('90d')}
            className={`px-2 py-1 text-xs rounded ${
              period === '90d' ? 'bg-terminal-green/20 text-terminal-green' : 'text-terminal-muted'
            }`}
          >
            90D
          </button>
        </div>
      }
    >
      {/* Legend */}
      <div className="flex gap-4 mb-4 text-xs flex-wrap">
        <span className="flex items-center gap-1">
          <span className="w-4 h-4 rounded bg-terminal-green/30"></span>
          Strong +
        </span>
        <span className="flex items-center gap-1">
          <span className="w-4 h-4 rounded bg-terminal-green/15"></span>
          Moderate +
        </span>
        <span className="flex items-center gap-1">
          <span className="w-4 h-4 rounded bg-terminal-muted/10"></span>
          Weak
        </span>
        <span className="flex items-center gap-1">
          <span className="w-4 h-4 rounded bg-terminal-red/15"></span>
          Moderate -
        </span>
        <span className="flex items-center gap-1">
          <span className="w-4 h-4 rounded bg-terminal-red/30"></span>
          Strong -
        </span>
      </div>

      {/* Pair Results */}
      <div className="space-y-2 mb-6">
        {pairs.map((pair, i) => (
          <div
            key={i}
            className={`flex justify-between items-center p-3 rounded ${getCorrelationColor(pair.correlation)}`}
          >
            <div>
              <p className="font-medium text-sm">{pair.label}</p>
              <p className="text-xs text-terminal-muted">
                {pair.x} vs {pair.y}
              </p>
            </div>
            <div className="text-right">
              {pair.correlation !== null ? (
                <>
                  <p className={`text-xl font-mono ${
                    pair.correlation > 0.3 ? 'text-terminal-green' :
                    pair.correlation < -0.3 ? 'text-terminal-red' :
                    'text-terminal-muted'
                  }`}>
                    {formatNumber(pair.correlation, 2)}
                  </p>
                  <p className="text-xs text-terminal-muted">
                    {pair.dataPoints} points
                  </p>
                </>
              ) : (
                <p className="text-terminal-muted">-</p>
              )}
            </div>
          </div>
        ))}

        {pairs.length === 0 && (
          <p className="text-terminal-muted text-center py-8">
            Insufficient data for correlation calculations. Add more historical data.
          </p>
        )}
      </div>

      {/* Correlation Matrix */}
      {metrics.length > 1 && (
        <div className="border-t border-terminal-border pt-4">
          <p className="text-xs text-terminal-muted uppercase mb-3">Correlation Matrix</p>
          <div className="overflow-x-auto">
            <table className="text-xs w-full">
              <thead>
                <tr>
                  <th className="text-left p-1"></th>
                  {metrics.slice(0, 6).map(m => (
                    <th key={m} className="p-1 text-center">
                      <span className="inline-block w-16 truncate" title={m}>
                        {m.slice(0, 8)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {metrics.slice(0, 6).map(m1 => (
                  <tr key={m1}>
                    <td className="p-1 font-medium">
                      <span className="inline-block w-20 truncate" title={m1}>
                        {m1.slice(0, 10)}
                      </span>
                    </td>
                    {metrics.slice(0, 6).map(m2 => {
                      const corr = matrix[m1]?.[m2];
                      return (
                        <td key={m2} className="p-1 text-center">
                          <span className={`inline-block w-12 py-1 rounded ${
                            m1 === m2 ? 'bg-terminal-muted/30' : getCorrelationColor(corr)
                          }`}>
                            {corr !== undefined ? formatNumber(corr, 2) : '-'}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Methodology */}
      <div className="mt-4 text-xs text-terminal-muted">
        <p><strong>Methodology:</strong> {data?.methodology?.formula}</p>
        <p><strong>Window:</strong> {data?.methodology?.window}</p>
        <p className="mt-1">{data?.methodology?.note}</p>
      </div>
    </Panel>
  );
}

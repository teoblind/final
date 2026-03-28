import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import Panel from '../Panel';
import { useApi } from '../../hooks/useApi';
import { formatNumber, formatDate, formatPercent, exportToCSV, getTrendColor } from '../../utils/formatters';

const ELEMENT_COLORS = {
  NdPr: '#00d26a',
  Dy: '#007aff',
  Tb: '#af52de',
  Ce: '#ffb800'
};

export default function RareEarthPanel() {
  const [selectedElement, setSelectedElement] = useState('NdPr');

  const { data, loading, error, lastFetched, isStale, refetch } = useApi(
    '/rareearth',
    { refreshInterval: 24 * 60 * 60 * 1000 }
  );

  const elements = data?.elements || [];
  const primary = data?.primary;

  const handleExport = () => {
    if (elements.length) {
      const exportData = elements.flatMap(e =>
        e.history.map(h => ({
          element: e.symbol,
          name: e.name,
          date: h.date,
          price: h.value
        }))
      );
      exportToCSV(exportData, 'rare_earth_prices');
    }
  };

  const selectedData = elements.find(e => e.symbol === selectedElement)?.history || [];

  return (
    <Panel
      title="Rare Earth Oxide Prices"
      source="SMM, Asian Metal"
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
      onExport={handleExport}
    >
      {/* Element Tabs */}
      <div className="flex gap-1 mb-4">
        {elements.map((element) => (
          <button
            key={element.symbol}
            onClick={() => setSelectedElement(element.symbol)}
            className={`px-3 py-1.5 text-xs rounded transition-colors ${
              selectedElement === element.symbol
                ? 'bg-terminal-green/20 text-terminal-green border border-terminal-green/30'
                : 'text-terminal-muted hover:text-terminal-text hover:bg-terminal-border'
            }`}
          >
            {element.symbol}
          </button>
        ))}
      </div>

      {/* Price Table */}
      <div className="overflow-x-auto mb-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-terminal-muted text-xs uppercase border-b border-terminal-border">
              <th className="text-left py-2">Element</th>
              <th className="text-right py-2">Price (USD/kg)</th>
              <th className="text-right py-2">WoW</th>
              <th className="text-right py-2">YoY</th>
            </tr>
          </thead>
          <tbody>
            {elements.map((element) => (
              <tr
                key={element.symbol}
                className={`border-b border-terminal-border ${
                  element.symbol === selectedElement ? 'bg-terminal-green/5' : ''
                }`}
              >
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: ELEMENT_COLORS[element.symbol] }}
                    ></span>
                    <span className="font-medium">{element.symbol}</span>
                    <span className="text-terminal-muted text-xs hidden sm:inline">
                      {element.name}
                    </span>
                  </div>
                </td>
                <td className="text-right py-2 font-sans">
                  {element.current ? `$${formatNumber(element.current, 0)}` : '-'}
                </td>
                <td className={`text-right py-2 ${getTrendColor(element.weekChange)}`}>
                  {element.weekChange !== null ? formatPercent(element.weekChange) : '-'}
                </td>
                <td className={`text-right py-2 ${getTrendColor(element.yearChange)}`}>
                  {element.yearChange !== null ? formatPercent(element.yearChange) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Selected Element Chart */}
      {selectedData.length > 0 ? (
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={selectedData.slice(-30)}>
              <XAxis
                dataKey="date"
                tickFormatter={(d) => formatDate(d, 'MM/dd')}
                stroke="#666"
                fontSize={10}
                tickLine={false}
              />
              <YAxis
                domain={['auto', 'auto']}
                stroke="#666"
                fontSize={10}
                tickFormatter={(v) => `$${v}`}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#111',
                  border: '1px solid #333',
                  borderRadius: '4px'
                }}
                formatter={(value) => [`$${formatNumber(value, 0)}/kg`, selectedElement]}
                labelFormatter={(label) => formatDate(label)}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={ELEMENT_COLORS[selectedElement]}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-32 flex items-center justify-center text-terminal-muted">
          No price history for {selectedElement}
        </div>
      )}

      {/* Context */}
      {primary && (
        <p className="text-xs text-terminal-muted mt-3">
          {primary.importance}
        </p>
      )}
    </Panel>
  );
}

import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, BarChart, Bar, Cell } from 'recharts';
import Panel from '../Panel';
import { useApi } from '../../hooks/useApi';
import { formatNumber, formatDate, exportToCSV } from '../../utils/formatters';

const COUNTRY_COLORS = {
  US: '#3b82f6',
  CN: '#ef4444',
  RU: '#a855f7',
  KZ: '#f59e0b',
  IR: '#10b981'
};

export default function IranHashratePanel() {
  const { data, loading, error, lastFetched, isStale, refetch } = useApi(
    '/iran',
    { refreshInterval: 7 * 24 * 60 * 60 * 1000 } // Weekly
  );

  const countries = data?.countries || [];
  const iran = data?.iran;
  const chinaGap = data?.chinaGap;

  // Prepare bar chart data
  const barData = countries.map(c => ({
    name: c.code,
    value: c.current || 0,
    color: COUNTRY_COLORS[c.code]
  })).filter(d => d.value > 0);

  const handleExport = () => {
    if (countries.length) {
      exportToCSV(countries.map(c => ({
        country: c.name,
        code: c.code,
        share: c.current,
        date: c.date
      })), 'hashrate_share');
    }
  };

  return (
    <Panel
      title="Iran Hashrate Share"
      source="CBECI + Manual"
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
      onExport={handleExport}
    >
      {/* Iran Highlight */}
      <div className="bg-terminal-green/10 border border-terminal-green/30 rounded-lg p-4 mb-4">
        <div className="flex justify-between items-center">
          <div>
            <p className="text-xs text-terminal-muted">Iran Hashrate Share</p>
            <p className="text-3xl font-bold text-terminal-green">
              {iran?.current ? `${formatNumber(iran.current, 1)}%` : 'No data'}
            </p>
          </div>
          {iran?.date && (
            <div className="text-right text-xs text-terminal-muted">
              <p>Last Update</p>
              <p>{formatDate(iran.date)}</p>
            </div>
          )}
        </div>
      </div>

      {/* Country Distribution */}
      <div className="mb-4">
        <p className="text-xs text-terminal-muted uppercase mb-2">Global Distribution</p>
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData} layout="vertical">
              <XAxis
                type="number"
                domain={[0, 'auto']}
                tickFormatter={(v) => `${v}%`}
                stroke="#666"
                fontSize={10}
              />
              <YAxis
                type="category"
                dataKey="name"
                stroke="#666"
                fontSize={10}
                width={30}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#111',
                  border: '1px solid #333',
                  borderRadius: '4px'
                }}
                formatter={(value, name, props) => [
                  `${formatNumber(value, 1)}%`,
                  countries.find(c => c.code === props.payload.name)?.name
                ]}
              />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {barData.map((entry, index) => (
                  <Cell key={index} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Country Details */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        {countries.slice(0, 4).map((country) => (
          <div
            key={country.code}
            className="bg-terminal-bg/50 rounded p-2"
          >
            <div className="flex items-center gap-2">
              <span
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: COUNTRY_COLORS[country.code] }}
              ></span>
              <span className="text-sm">{country.name}</span>
            </div>
            <p className="font-sans text-lg ml-4">
              {country.current ? `${formatNumber(country.current, 1)}%` : '-'}
            </p>
            {country.note && (
              <p className="text-xs text-terminal-amber ml-4">{country.note}</p>
            )}
          </div>
        ))}
      </div>

      {/* China Gap Highlight */}
      {chinaGap && (
        <div className="bg-terminal-red/10 border border-terminal-red/30 rounded p-3 mb-4">
          <p className="text-sm font-medium text-terminal-red">China Reporting Gap</p>
          <div className="flex justify-between mt-1 text-sm">
            <span>Official: {chinaGap.official}%</span>
            <span>Estimated: ~{chinaGap.estimated}%</span>
          </div>
          <p className="text-xs text-terminal-muted mt-1">{chinaGap.explanation}</p>
        </div>
      )}

      {/* Data Quality Warning */}
      <div className="bg-terminal-amber/10 border border-terminal-amber/30 rounded p-2">
        <p className="text-xs text-terminal-amber">
          {data?.disclaimer}
        </p>
      </div>

      {/* Sources */}
      {data?.cbeci && (
        <div className="mt-3 text-xs text-terminal-muted">
          <p>CBECI last update: {data.cbeci.lastUpdate ? formatDate(data.cbeci.lastUpdate) : 'Unknown'}</p>
          <p>{data.refreshNote}</p>
        </div>
      )}
    </Panel>
  );
}

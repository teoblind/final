import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import Panel, { Stat } from '../../Panel';
import { useApi } from '../../../hooks/useApi';
import { formatNumber, formatDate, formatCurrency, exportToCSV } from '../../../utils/formatters';

export default function JapanPanel() {
  const { data, loading, error, lastFetched, isStale, refetch } = useApi(
    '/japan',
    { refreshInterval: 30 * 60 * 1000 } // 30 minutes
  );

  const jgb = data?.jgb || {};
  const niip = data?.niip || {};
  const yieldCurve = jgb.yieldCurve || [];
  const jgbHistory = jgb.history10Y || [];
  const niipHistory = niip.history || [];

  const handleExport = () => {
    if (jgbHistory.length) {
      exportToCSV(jgbHistory, 'jgb_10y');
    }
  };

  return (
    <Panel
      title="Japan Macro Panel"
      source="FRED + Bank of Japan"
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
      onExport={handleExport}
    >
      {/* JGB Yields */}
      <div className="mb-4">
        <p className="text-xs text-terminal-muted uppercase mb-2">JGB Yield Curve</p>
        <div className="grid grid-cols-4 gap-2 mb-3">
          {['2Y', '5Y', '10Y', '30Y'].map((tenor) => (
            <div key={tenor} className="bg-terminal-bg/50 rounded p-2 text-center">
              <p className="text-xs text-terminal-muted">{tenor}</p>
              <p className={`font-mono ${tenor === '10Y' ? 'text-terminal-green' : ''}`}>
                {formatNumber(jgb.current?.[tenor], 3)}%
              </p>
            </div>
          ))}
        </div>

        {/* Yield curve visualization */}
        <div className="h-24">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={yieldCurve}>
              <XAxis
                dataKey="tenor"
                stroke="#666"
                fontSize={10}
                tickLine={false}
              />
              <YAxis
                domain={['auto', 'auto']}
                stroke="#666"
                fontSize={10}
                tickFormatter={(v) => `${v}%`}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#111',
                  border: '1px solid #333',
                  borderRadius: '4px'
                }}
                formatter={(value) => [`${formatNumber(value, 3)}%`, 'Yield']}
              />
              <Line
                type="monotone"
                dataKey="yield"
                stroke="#00d26a"
                strokeWidth={2}
                dot={{ fill: '#00d26a', r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 10Y JGB History */}
      <div className="mb-4">
        <p className="text-xs text-terminal-muted uppercase mb-2">10Y JGB Yield History</p>
        <div className="h-32">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={jgbHistory.slice(-180)}>
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
                tickFormatter={(v) => `${v}%`}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#111',
                  border: '1px solid #333',
                  borderRadius: '4px'
                }}
                formatter={(value) => [`${formatNumber(value, 3)}%`, '10Y Yield']}
                labelFormatter={(label) => formatDate(label)}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#00d26a"
                strokeWidth={1.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* NIIP */}
      <div className="border-t border-terminal-border pt-3">
        <p className="text-xs text-terminal-muted uppercase mb-2">Net International Investment Position</p>
        <div className="flex justify-between items-center mb-3">
          <div>
            <p className="text-2xl font-bold text-terminal-cyan">
              {formatCurrency(niip.current, 'USD', 0)}
            </p>
            <p className="text-xs text-terminal-muted">World's largest NIIP</p>
          </div>
          <div className="text-right">
            <p className="text-sm">~{formatCurrency((niip.current || 0) * 150, 'JPY', 0)}</p>
            <p className="text-xs text-terminal-muted">in JPY (est.)</p>
          </div>
        </div>

        {/* NIIP History */}
        <div className="h-24">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={niipHistory.slice(-20)}>
              <XAxis
                dataKey="date"
                tickFormatter={(d) => formatDate(d, 'yyyy')}
                stroke="#666"
                fontSize={10}
                tickLine={false}
              />
              <YAxis
                stroke="#666"
                fontSize={10}
                tickFormatter={(v) => `$${(v / 1e12).toFixed(1)}T`}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#111',
                  border: '1px solid #333',
                  borderRadius: '4px'
                }}
                formatter={(value) => [formatCurrency(value, 'USD', 0), 'NIIP']}
                labelFormatter={(label) => formatDate(label, 'Q Q yyyy')}
              />
              <Bar
                dataKey="value"
                fill="#00d4ff"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Context */}
      <div className="mt-3 text-xs text-terminal-muted">
        <p>{data?.context?.repatriationRisk}</p>
      </div>
    </Panel>
  );
}

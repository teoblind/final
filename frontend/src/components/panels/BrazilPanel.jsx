import React from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar } from 'recharts';
import Panel, { Stat } from '../Panel';
import { useApi } from '../../hooks/useApi';
import { formatNumber, formatDate, formatPercent, exportToCSV } from '../../utils/formatters';

const ENERGY_COLORS = {
  hydro: '#00d4ff',
  wind: '#00d26a',
  solar: '#ffb800',
  biomass: '#af52de',
  nuclear: '#ff3b30',
  thermal: '#666'
};

export default function BrazilPanel() {
  const { data, loading, error, lastFetched, isStale, refetch } = useApi(
    '/brazil',
    { refreshInterval: 5 * 60 * 1000 }
  );

  const equities = data?.equities || {};
  const macro = data?.macro || {};
  const energy = data?.energy || {};
  const minerals = data?.minerals || {};
  const datacenters = data?.datacenters || {};

  const ewzSpyRatio = equities.ewzSpyRatio || [];
  const currentRatio = ewzSpyRatio[ewzSpyRatio.length - 1]?.ratio;

  // Prepare energy mix for pie chart
  const energyMix = Object.entries(energy.generationMix || {}).map(([key, value]) => ({
    name: key.charAt(0).toUpperCase() + key.slice(1),
    value,
    color: ENERGY_COLORS[key]
  }));

  const handleExport = () => {
    if (ewzSpyRatio.length) {
      exportToCSV(ewzSpyRatio, 'ewz_spy_ratio');
    }
  };

  return (
    <Panel
      title="Brazil Green Compute Arbitrage"
      source="Yahoo Finance + Manual"
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
      onExport={handleExport}
    >
      {/* EWZ vs SPY and Macro */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-terminal-bg/50 rounded p-3">
          <p className="text-xs text-terminal-muted">EWZ/SPY Ratio</p>
          <p className={`text-xl font-bold ${currentRatio > 1 ? 'text-terminal-green' : 'text-terminal-red'}`}>
            {formatNumber(currentRatio, 3)}
          </p>
        </div>
        <div className="bg-terminal-bg/50 rounded p-3">
          <p className="text-xs text-terminal-muted">BRL/USD</p>
          <p className="text-xl font-bold">
            {formatNumber(equities.brlUsd?.rate, 2)}
          </p>
          <p className={`text-xs ${equities.brlUsd?.change > 0 ? 'text-terminal-red' : 'text-terminal-green'}`}>
            {formatPercent(equities.brlUsd?.change)}
          </p>
        </div>
      </div>

      {/* Real Rate */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="bg-terminal-bg/50 rounded p-2 text-center">
          <p className="text-xs text-terminal-muted">SELIC</p>
          <p className="font-mono">{formatNumber(macro.selic?.current, 2)}%</p>
        </div>
        <div className="bg-terminal-bg/50 rounded p-2 text-center">
          <p className="text-xs text-terminal-muted">IPCA</p>
          <p className="font-mono">{formatNumber(macro.ipca?.current, 2)}%</p>
        </div>
        <div className="bg-terminal-green/10 border border-terminal-green/30 rounded p-2 text-center">
          <p className="text-xs text-terminal-muted">Real Rate</p>
          <p className="font-mono text-terminal-green">
            {formatNumber(macro.realRate?.current, 2)}%
          </p>
        </div>
      </div>

      {/* EWZ/SPY Chart */}
      <div className="h-28 mb-4">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={ewzSpyRatio.slice(-90)}>
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
              tickFormatter={(v) => v.toFixed(2)}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#111',
                border: '1px solid #333',
                borderRadius: '4px'
              }}
              formatter={(value) => [formatNumber(value, 3), 'EWZ/SPY']}
              labelFormatter={(label) => formatDate(label)}
            />
            <Line
              type="monotone"
              dataKey="ratio"
              stroke="#00d26a"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Energy Section */}
      <div className="border-t border-terminal-border pt-3 mb-4">
        <p className="text-xs text-terminal-muted uppercase mb-2">Energy Capacity</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="bg-terminal-bg/50 rounded p-2">
                <p className="text-xs text-terminal-muted">Installed</p>
                <p className="font-mono">{formatNumber(energy.installedCapacity?.value, 0)} GW</p>
              </div>
              <div className="bg-terminal-bg/50 rounded p-2">
                <p className="text-xs text-terminal-muted">Peak Demand</p>
                <p className="font-mono">{formatNumber(energy.peakDemand?.value, 0)} GW</p>
              </div>
            </div>
            <div className="bg-terminal-green/10 border border-terminal-green/30 rounded p-2">
              <p className="text-xs text-terminal-muted">Headroom</p>
              <p className="font-mono text-terminal-green text-lg">
                {formatNumber(energy.headroom?.value, 0)} GW
              </p>
            </div>
          </div>
          <div className="h-24">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={energyMix}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={20}
                  outerRadius={40}
                >
                  {energyMix.map((entry, index) => (
                    <Cell key={index} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#111',
                    border: '1px solid #333',
                    borderRadius: '4px'
                  }}
                  formatter={(value) => [`${value}%`]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Minerals */}
      <div className="border-t border-terminal-border pt-3 mb-4">
        <p className="text-xs text-terminal-muted uppercase mb-2">Critical Minerals</p>
        <div className="bg-terminal-amber/10 border border-terminal-amber/30 rounded p-2 mb-2">
          <div className="flex justify-between">
            <span className="text-terminal-amber font-medium">Niobium</span>
            <span className="text-terminal-amber font-bold">{minerals.niobium?.globalShare}% Global Share</span>
          </div>
          <p className="text-xs text-terminal-muted mt-1">{minerals.niobium?.uses}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div className="bg-terminal-bg/50 rounded p-2">
            <p className="text-terminal-muted text-xs">Rare Earths</p>
            <p>{minerals.rareEarths?.status || 'Development'}</p>
          </div>
          <div className="bg-terminal-bg/50 rounded p-2">
            <p className="text-terminal-muted text-xs">Lithium</p>
            <p>{minerals.lithium?.status || 'Exploration'}</p>
          </div>
        </div>
      </div>

      {/* Data Center Pipeline */}
      <div className="border-t border-terminal-border pt-3">
        <div className="flex justify-between items-center mb-2">
          <p className="text-xs text-terminal-muted uppercase">Data Center Pipeline</p>
          <span className="text-terminal-green font-mono">{formatNumber(datacenters.totalMW, 0)} MW</span>
        </div>
        <div className="flex flex-wrap gap-1">
          {datacenters.majorPlayers?.map((player, i) => (
            <span key={i} className="px-2 py-0.5 bg-terminal-bg rounded text-xs">
              {player}
            </span>
          ))}
        </div>
      </div>

      {/* Thesis */}
      <p className="text-xs text-terminal-muted mt-3">
        {data?.thesis?.summary}
      </p>
    </Panel>
  );
}

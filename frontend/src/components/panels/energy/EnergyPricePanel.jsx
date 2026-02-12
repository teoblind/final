import React, { useState, useEffect } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import Panel from '../../Panel';
import { useApi } from '../../../hooks/useApi';
import { formatNumber } from '../../../utils/formatters';

const ERCOT_NODES = [
  'HB_NORTH', 'HB_SOUTH', 'HB_WEST', 'HB_HOUSTON', 'HB_PAN', 'HB_BUSAVG',
  'LZ_NORTH', 'LZ_SOUTH', 'LZ_WEST', 'LZ_HOUSTON'
];

/**
 * Panel 3a: Current Energy Price — The "hero" metric panel.
 * Shows current LMP, moving averages, system load, and grid status.
 */
export default function EnergyPricePanel() {
  const [node, setNode] = useState('HB_NORTH');

  const { data, loading, error, lastFetched, isStale, refetch } = useApi(
    '/energy/realtime',
    { params: { node, iso: 'ERCOT' }, refreshInterval: 5 * 60 * 1000 }
  );

  const { data: loadData } = useApi('/energy/load', { refreshInterval: 5 * 60 * 1000 });

  const lmp = data?.realTimePrice?.lmp;
  const gridStatus = data?.gridCondition?.status || 'normal';
  const isMock = data?.isMock;
  const avg24h = data?.averages?.avg24h;
  const avg7d = data?.averages?.avg7d;
  const avg30d = data?.averages?.avg30d;
  const systemLoad = loadData?.systemLoad?.current;

  const priceColor = lmp != null
    ? lmp < 0 ? 'text-terminal-cyan' : lmp > 75 ? 'text-terminal-red' : lmp > 40 ? 'text-terminal-amber' : 'text-terminal-green'
    : 'text-terminal-muted';

  const gridColors = {
    normal: 'bg-terminal-green', watch: 'bg-terminal-amber',
    warning: 'bg-terminal-amber animate-pulse', emergency: 'bg-terminal-red animate-pulse'
  };

  return (
    <Panel
      title="Energy Price"
      source={data?.source || 'ERCOT'}
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
      headerRight={
        <div className="flex items-center gap-2">
          <span className="text-xs text-terminal-muted">ERCOT</span>
          <select
            value={node}
            onChange={e => setNode(e.target.value)}
            className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text"
          >
            {ERCOT_NODES.map(n => (
              <option key={n} value={n}>{n.replace('_', ' ')}</option>
            ))}
          </select>
        </div>
      }
    >
      {/* Mock data warning */}
      {isMock && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-terminal-amber/10 border border-terminal-amber/20 rounded text-xs text-terminal-amber">
          <Info size={14} />
          <span>Simulated data — configure ERCOT API credentials for live prices</span>
        </div>
      )}

      {/* Hero metric */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-xs text-terminal-muted uppercase tracking-wider">Current LMP</p>
          <p className={`text-4xl font-bold ${priceColor}`}>
            ${lmp != null ? formatNumber(lmp, 2) : '—'}<span className="text-lg text-terminal-muted">/MWh</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-terminal-muted uppercase">System Load</p>
          <p className="text-xl font-bold">
            {systemLoad != null ? `${formatNumber(systemLoad, 0)}` : '—'}
            <span className="text-xs text-terminal-muted"> MW</span>
          </p>
        </div>
      </div>

      {/* Moving averages */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[
          { label: '24H Avg', value: avg24h },
          { label: '7D Avg', value: avg7d },
          { label: '30D Avg', value: avg30d }
        ].map(({ label, value }) => (
          <div key={label} className="bg-terminal-bg/50 rounded p-2 text-center">
            <p className="text-xs text-terminal-muted">{label}</p>
            <p className="font-mono text-sm">
              {value != null ? `$${formatNumber(value, 2)}` : '—'}
            </p>
          </div>
        ))}
      </div>

      {/* Grid status */}
      <div className="flex items-center justify-between pt-3 border-t border-terminal-border">
        <div className="flex items-center gap-2">
          <span className="text-xs text-terminal-muted">Grid Status:</span>
          <div className={`w-2.5 h-2.5 rounded-full ${gridColors[gridStatus]}`} />
          <span className="text-xs text-terminal-text capitalize">{gridStatus}</span>
        </div>
        {data?.gridCondition?.ordcAdder > 0 && (
          <span className="text-xs text-terminal-amber">
            ORDC +${formatNumber(data.gridCondition.ordcAdder, 2)}/MWh
          </span>
        )}
      </div>

      {/* Price components breakdown */}
      {data?.realTimePrice && (
        <div className="mt-3 pt-3 border-t border-terminal-border">
          <div className="flex gap-4 text-xs text-terminal-muted">
            <span>Energy: ${formatNumber(data.realTimePrice.energyComponent, 2)}</span>
            <span>Congestion: ${formatNumber(data.realTimePrice.congestionComponent, 2)}</span>
            <span>Loss: ${formatNumber(data.realTimePrice.lossComponent, 2)}</span>
          </div>
        </div>
      )}
    </Panel>
  );
}

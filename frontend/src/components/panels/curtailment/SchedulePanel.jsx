import React, { useMemo } from 'react';
import Panel from '../../Panel';
import { useApi } from '../../../hooks/useApi';
import { formatNumber } from '../../../utils/formatters';

/**
 * Panel 5b: 24-Hour Operating Schedule
 * Gantt-style timeline generated from day-ahead prices showing mining/curtailment windows.
 */
export default function SchedulePanel() {
  const { data, loading, error, lastFetched, isStale, refetch } = useApi('/curtailment/schedule', {
    refreshInterval: 15 * 60 * 1000, // 15 minutes
  });

  const schedule = data?.schedule || [];
  const summary = data?.summary;
  const isMock = data?.isMock;

  // Current hour for marker
  const currentHour = new Date().getHours();

  // Color mapping for states
  const stateColor = {
    MINING: 'bg-terminal-green',
    PARTIAL: 'bg-terminal-amber',
    CURTAILED: 'bg-terminal-red',
  };

  const stateLabel = {
    MINING: 'Mine',
    PARTIAL: 'Partial',
    CURTAILED: 'Curtail',
  };

  // Find price range for normalization
  const priceRange = useMemo(() => {
    if (schedule.length === 0) return { min: 0, max: 100 };
    const prices = schedule.map(h => h.priceMWh);
    return { min: Math.min(...prices), max: Math.max(...prices) };
  }, [schedule]);

  const priceToHeight = (price) => {
    const range = priceRange.max - priceRange.min || 1;
    return Math.min(100, Math.max(5, ((price - priceRange.min) / range) * 100));
  };

  if (data && !data.hasFleet) {
    return (
      <Panel title="24h Schedule" source="Curtailment Engine" loading={false}>
        <div className="flex flex-col items-center justify-center py-6 text-terminal-muted text-sm">
          <p>Configure your fleet to generate operating schedules.</p>
        </div>
      </Panel>
    );
  }

  if (data?.error) {
    return (
      <Panel title="24h Schedule" source="Curtailment Engine" loading={false}>
        <div className="flex flex-col items-center justify-center py-6 text-terminal-amber text-sm">
          <p>{data.error}</p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="24h Operating Schedule"
      source={data?.source || 'DAM + Curtailment Engine'}
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
    >
      {schedule.length > 0 && (
        <div className="space-y-4">
          {isMock && (
            <div className="bg-terminal-amber/10 border border-terminal-amber/20 rounded px-3 py-2 text-xs text-terminal-amber">
              Mock DAM data — real prices publish daily ~1PM
            </div>
          )}

          {/* Summary Row */}
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-terminal-bg/50 rounded p-2 text-center">
              <p className="text-[10px] text-terminal-muted">Mining Hours</p>
              <p className="text-sm font-bold text-terminal-green">{summary?.miningHours || 0}h</p>
            </div>
            <div className="bg-terminal-bg/50 rounded p-2 text-center">
              <p className="text-[10px] text-terminal-muted">Curtailed</p>
              <p className="text-sm font-bold text-terminal-red">{summary?.curtailedHours || 0}h</p>
            </div>
            <div className="bg-terminal-bg/50 rounded p-2 text-center">
              <p className="text-[10px] text-terminal-muted">Est. Net Rev</p>
              <p className="text-sm font-bold text-terminal-text">
                ${formatNumber(summary?.estimatedNetRevenue, 0)}
              </p>
            </div>
            <div className="bg-terminal-bg/50 rounded p-2 text-center">
              <p className="text-[10px] text-terminal-muted">Avg Price</p>
              <p className="text-sm font-bold text-terminal-text">
                ${formatNumber(summary?.avgPriceMWh, 1)}
              </p>
            </div>
          </div>

          {/* Gantt-style Timeline */}
          <div>
            <p className="text-xs text-terminal-muted mb-2">Operating State by Hour</p>

            {/* State bars */}
            <div className="flex gap-px h-6 rounded overflow-hidden">
              {schedule.map((h, i) => (
                <div
                  key={i}
                  className={`flex-1 ${stateColor[h.state] || 'bg-terminal-border'} ${
                    i === currentHour ? 'ring-1 ring-white' : ''
                  } relative group cursor-default`}
                  title={`${h.hour}:00 — ${stateLabel[h.state]} — $${h.priceMWh?.toFixed(1)}/MWh`}
                >
                  {/* Tooltip on hover */}
                  <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-terminal-panel border border-terminal-border rounded px-2 py-1 text-[10px] text-terminal-text whitespace-nowrap z-10 hidden group-hover:block">
                    {h.hour}:00 — {stateLabel[h.state]}<br />
                    ${h.priceMWh?.toFixed(1)}/MWh
                    {h.note && <><br />{h.note}</>}
                  </div>
                </div>
              ))}
            </div>

            {/* Hour labels */}
            <div className="flex mt-1">
              {[0, 4, 8, 12, 16, 20].map(h => (
                <div key={h} className="text-[10px] text-terminal-muted" style={{ width: `${(1/6)*100}%` }}>
                  {h}:00
                </div>
              ))}
            </div>
          </div>

          {/* Price overlay (simplified bar chart) */}
          <div>
            <p className="text-xs text-terminal-muted mb-2">Day-Ahead Price ($/MWh)</p>
            <div className="flex gap-px items-end h-16">
              {schedule.map((h, i) => (
                <div
                  key={i}
                  className={`flex-1 rounded-t ${
                    h.state === 'CURTAILED' ? 'bg-terminal-red/60' :
                    h.state === 'PARTIAL' ? 'bg-terminal-amber/60' :
                    'bg-terminal-green/40'
                  } ${i === currentHour ? 'ring-1 ring-white' : ''}`}
                  style={{ height: `${priceToHeight(h.priceMWh)}%` }}
                  title={`$${h.priceMWh?.toFixed(1)}/MWh`}
                />
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-terminal-muted mt-1">
              <span>${formatNumber(priceRange.min, 0)}</span>
              <span>${formatNumber(priceRange.max, 0)}</span>
            </div>
          </div>

          {/* Mining Windows */}
          {data?.miningWindows?.length > 0 && (
            <div className="border-t border-terminal-border pt-2">
              <p className="text-xs text-terminal-muted mb-1">Mining Windows</p>
              <div className="flex flex-wrap gap-2">
                {data.miningWindows.map((w, i) => (
                  <span key={i} className="px-2 py-1 text-[10px] bg-terminal-green/10 text-terminal-green border border-terminal-green/20 rounded">
                    {w.startHour}:00–{w.endHour + 1}:00 ({w.duration}h) avg ${formatNumber(w.avgPrice, 0)}/MWh
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Legend */}
          <div className="flex items-center gap-4 text-[10px] text-terminal-muted">
            <span className="flex items-center gap-1"><span className="w-3 h-2 bg-terminal-green rounded-sm inline-block" /> Mining</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 bg-terminal-amber rounded-sm inline-block" /> Partial</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 bg-terminal-red rounded-sm inline-block" /> Curtailed</span>
            <span className="flex items-center gap-1"><span className="w-3 h-2 ring-1 ring-white rounded-sm inline-block" /> Now</span>
          </div>
        </div>
      )}
    </Panel>
  );
}

import React, { useMemo } from 'react';
import Panel from '../../Panel';
import { useApi } from '../../../hooks/useApi';
import { formatNumber } from '../../../utils/formatters';

/**
 * Panel 5b: 24-Hour Operating Schedule
 * Gantt-style timeline from day-ahead prices showing mining/curtailment windows.
 * Includes per-machine-class Gantt bars, breakeven reference lines,
 * and always-on comparison.
 */
export default function SchedulePanel() {
  const { data, loading, error, lastFetched, isStale, refetch } = useApi('/curtailment/schedule', {
    refreshInterval: 15 * 60 * 1000, // 15 minutes
  });

  const schedule = data?.schedule || [];
  const modelSchedule = data?.modelSchedule || [];
  const summary = data?.summary;
  const comparedToAlwaysOn = data?.comparedToAlwaysOn;
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

  // Collect breakeven values from modelSchedule for reference lines
  const breakevenLines = useMemo(() => {
    if (!data?.schedule?.[0]?.decisions) return [];
    // Get breakevens from the first hour's decisions (static per model)
    return data.schedule[0].decisions.map(d => ({
      model: d.model,
      breakevenMWh: d.breakevenMWh,
    }));
  }, [data]);

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
              Mock DAM data - real prices publish daily ~1PM
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

          {/* Aggregate Gantt-style Timeline */}
          <div>
            <p className="text-xs text-terminal-muted mb-2">Fleet Operating State by Hour</p>

            {/* State bars */}
            <div className="flex gap-px h-6 rounded overflow-hidden">
              {schedule.map((h, i) => (
                <div
                  key={i}
                  className={`flex-1 ${stateColor[h.state] || 'bg-terminal-border'} ${
                    i === currentHour ? 'ring-1 ring-white' : ''
                  } relative group cursor-default`}
                  title={`${h.hour}:00 - ${stateLabel[h.state]} - $${h.priceMWh?.toFixed(1)}/MWh`}
                >
                  <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-terminal-panel border border-terminal-border rounded px-2 py-1 text-[10px] text-terminal-text whitespace-nowrap z-10 hidden group-hover:block">
                    {h.hour}:00 - {stateLabel[h.state]}<br />
                    ${h.priceMWh?.toFixed(1)}/MWh
                    {h.note && <><br />{h.note}</>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Per-Model Gantt Bars */}
          {modelSchedule.length > 1 && (
            <div>
              <p className="text-xs text-terminal-muted mb-2">Per-Class Schedule</p>
              <div className="space-y-1">
                {modelSchedule.map((ms, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="text-[9px] text-terminal-muted w-20 truncate text-right" title={ms.model}>
                      {ms.model?.split(' ').pop()}
                    </span>
                    <div className="flex gap-px h-3 flex-1 rounded overflow-hidden">
                      {(ms.schedule || []).map((h, i) => (
                        <div
                          key={i}
                          className={`flex-1 ${
                            h.action === 'MINE' ? 'bg-terminal-green' : 'bg-terminal-red/60'
                          } ${i === currentHour ? 'ring-1 ring-white' : ''}`}
                          title={`${h.hour}:00 - ${ms.model} - ${h.action}`}
                        />
                      ))}
                    </div>
                    <span className="text-[9px] text-terminal-muted w-10 text-right">
                      {ms.miningHours}h
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Hour labels */}
          <div className="flex">
            {[0, 4, 8, 12, 16, 20].map(h => (
              <div key={h} className="text-[10px] text-terminal-muted" style={{ width: `${(1/6)*100}%` }}>
                {h}:00
              </div>
            ))}
          </div>

          {/* Price overlay with breakeven reference lines */}
          <div>
            <p className="text-xs text-terminal-muted mb-2">Day-Ahead Price ($/MWh)</p>
            <div className="relative">
              {/* Breakeven reference lines */}
              {breakevenLines.map((be, i) => {
                const pct = priceToHeight(be.breakevenMWh);
                if (pct < 2 || pct > 98) return null;
                return (
                  <div
                    key={i}
                    className="absolute left-0 right-0 border-t border-dashed border-terminal-amber/40 z-10 pointer-events-none"
                    style={{ bottom: `${pct}%` }}
                  >
                    <span className="absolute -top-3 right-0 text-[8px] text-terminal-amber/60 bg-terminal-panel px-0.5">
                      BE:{be.model?.split(' ').pop()}
                    </span>
                  </div>
                );
              })}
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
            </div>
            <div className="flex justify-between text-[10px] text-terminal-muted mt-1">
              <span>${formatNumber(priceRange.min, 0)}</span>
              <span>${formatNumber(priceRange.max, 0)}</span>
            </div>
          </div>

          {/* Always-On Comparison */}
          {comparedToAlwaysOn && (
            <div className="bg-terminal-bg/50 border border-terminal-border rounded p-3">
              <p className="text-xs font-semibold text-terminal-text mb-2">vs. Always-On (24/7 mining)</p>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-[10px] text-terminal-muted">Always-On</p>
                  <p className={`text-xs font-bold ${comparedToAlwaysOn.alwaysOnNetRevenue >= 0 ? 'text-terminal-text' : 'text-terminal-red'}`}>
                    ${formatNumber(comparedToAlwaysOn.alwaysOnNetRevenue, 0)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-terminal-muted">Optimized</p>
                  <p className={`text-xs font-bold ${comparedToAlwaysOn.optimizedNetRevenue >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
                    ${formatNumber(comparedToAlwaysOn.optimizedNetRevenue, 0)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-terminal-muted">Savings</p>
                  <p className={`text-xs font-bold ${comparedToAlwaysOn.savings >= 0 ? 'text-terminal-cyan' : 'text-terminal-red'}`}>
                    {comparedToAlwaysOn.savings >= 0 ? '+' : ''}${formatNumber(comparedToAlwaysOn.savings, 0)}
                    <span className="text-[10px] font-normal text-terminal-muted ml-1">
                      ({comparedToAlwaysOn.savingsPercent >= 0 ? '+' : ''}{formatNumber(comparedToAlwaysOn.savingsPercent, 1)}%)
                    </span>
                  </p>
                </div>
              </div>
            </div>
          )}

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
            <span className="flex items-center gap-1"><span className="w-4 border-t border-dashed border-terminal-amber/40 inline-block" /> Breakeven</span>
          </div>
        </div>
      )}
    </Panel>
  );
}

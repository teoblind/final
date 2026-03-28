import React, { useState, useMemo } from 'react';
import { useHeatmapLmp } from '../../../../hooks/useErcotLmp';

function lmpToColor(lmp) {
  if (lmp <= 10) return '#1a6b3c';
  if (lmp <= 20) return '#22884d';
  if (lmp <= 30) return '#a3d9a5';
  if (lmp <= 45) return '#b8860b';
  return '#c0392b';
}

function getDayLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

export default function LmpHeatmap({ node = 'HB_NORTH' }) {
  const [days, setDays] = useState(7);
  const { data: resp, loading } = useHeatmapLmp(node, days);
  const [hovered, setHovered] = useState(null);

  const { grid, dates } = useMemo(() => {
    if (!resp?.data) return { grid: {}, dates: [] };
    const g = {};
    resp.data.forEach(cell => {
      if (!g[cell.date]) g[cell.date] = {};
      g[cell.date][cell.hour] = cell;
    });
    const d = [...new Set(resp.data.map(c => c.date))].sort();
    return { grid: g, dates: d };
  }, [resp]);

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const currentHour = now.getHours(); // local, but ERCOT is CST; approximate

  const pills = [
    { key: 7, label: '7D' },
    { key: 30, label: '30D' },
    { key: 90, label: '90D' },
  ];

  return (
    <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden mb-4">
      <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
        <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">LMP Heatmap - Hourly Averages</span>
        <div className="flex gap-1">
          {pills.map(p => (
            <button
              key={p.key}
              onClick={() => setDays(p.key)}
              className={`px-[10px] py-1 rounded-md border text-[10px] font-semibold transition-all ${
                days === p.key
                  ? 'bg-terminal-text text-white border-terminal-text'
                  : 'bg-terminal-panel text-terminal-muted border-terminal-border hover:bg-[#f5f4f0]'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-[18px]">
        {loading && dates.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-terminal-muted text-sm">Loading…</div>
        ) : dates.length === 0 ? (
          <div className="h-40 flex items-center justify-center text-terminal-muted text-sm">No data</div>
        ) : (
          <>
            {/* Grid */}
            <div className="grid gap-[2px]" style={{ gridTemplateColumns: '60px repeat(24, 1fr)' }}>
              {dates.map(date => {
                const isToday = date === todayStr;
                return (
                  <React.Fragment key={date}>
                    <div className={`font-mono text-[10px] flex items-center ${isToday ? 'font-bold text-terminal-text' : 'text-terminal-muted font-medium'}`}>
                      {getDayLabel(date)}
                    </div>
                    {Array.from({ length: 24 }, (_, h) => {
                      const cell = grid[date]?.[h];
                      const isFuture = isToday && h > currentHour;
                      const isCurrent = isToday && h === currentHour;

                      if (isFuture) {
                        return (
                          <div
                            key={h}
                            className="rounded-[3px] border border-dashed border-[#c5c5bc]"
                            style={{ aspectRatio: '2/1', background: 'var(--t-surface-inset, #f5f4f0)' }}
                          />
                        );
                      }

                      return (
                        <div
                          key={h}
                          className="rounded-[3px] cursor-crosshair hover:scale-[1.2] hover:z-10 transition-transform relative"
                          style={{
                            aspectRatio: '2/1',
                            background: cell ? lmpToColor(cell.avgLmp) : '#f5f4f0',
                            outline: isCurrent ? '2px solid #2dd478' : 'none',
                            outlineOffset: '-1px',
                          }}
                          onMouseEnter={() => setHovered({ date, hour: h, cell })}
                          onMouseLeave={() => setHovered(null)}
                        >
                          {hovered?.date === date && hovered?.hour === h && cell && (
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-20 bg-terminal-text text-white text-[10px] px-2 py-1 rounded whitespace-nowrap font-mono shadow-lg">
                              {date} {String(h).padStart(2, '0')}:00 · ${cell.avgLmp.toFixed(2)}/MWh
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </div>

            {/* Hour labels */}
            <div className="grid gap-[2px] mt-1" style={{ gridTemplateColumns: '60px repeat(24, 1fr)' }}>
              <div />
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className="font-mono text-[8px] text-[#c5c5bc] text-center">{h}</div>
              ))}
            </div>

            {/* Legend */}
            <div className="flex items-center gap-[6px] mt-3 text-[10px] text-terminal-muted">
              <span>Low</span>
              <div className="w-[120px] h-2 rounded bg-gradient-to-r from-[#1a6b3c] via-[#a3d9a5] via-60% to-[#c0392b]" />
              <span>High</span>
              <span className="ml-3 text-[#c5c5bc]">$/MWh - darker green = cheaper energy = more profitable mining</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

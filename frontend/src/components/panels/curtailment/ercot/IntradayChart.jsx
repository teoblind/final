import React, { useState, useMemo } from 'react';
import { useIntradayLmp } from '../../../../hooks/useErcotLmp';

const BREAKEVENS = { s19xp: 36.80, fleet: 41.30, s19: 52.10 };

function getBarColor(lmp) {
  if (lmp <= BREAKEVENS.s19xp) return 'bg-[#1a6b3c]';
  if (lmp <= BREAKEVENS.fleet) return 'bg-[#a3d9a5]';
  if (lmp <= BREAKEVENS.s19) return 'bg-[#b8860b]';
  return 'bg-[#c0392b]';
}

function formatHour(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Chicago' });
}

export default function IntradayChart({ node = 'HB_NORTH' }) {
  const [range, setRange] = useState('today');
  const [hovered, setHovered] = useState(null);

  const dateParam = range === 'yesterday'
    ? new Date(Date.now() - 86400000).toISOString().split('T')[0]
    : null;
  const daysParam = range === '7d' ? 7 : range === '30d' ? 30 : 0;

  const { data: resp, loading } = useIntradayLmp(node, dateParam, daysParam);
  const intervals = resp?.data || [];

  const { maxLmp, yLabels } = useMemo(() => {
    if (intervals.length === 0) return { maxLmp: 100, yLabels: [] };
    const allLmps = intervals.map(i => i.lmp);
    const max = Math.max(...allLmps, BREAKEVENS.s19 + 10);
    const ceilMax = Math.ceil(max / 20) * 20;
    const labels = [];
    for (let v = ceilMax; v >= 0; v -= ceilMax / 5) {
      labels.push(Math.round(v));
    }
    return { maxLmp: ceilMax, yLabels: labels };
  }, [intervals]);

  const xLabels = useMemo(() => {
    if (intervals.length < 2) return [];
    const step = Math.max(1, Math.floor(intervals.length / 8));
    const labels = [];
    for (let i = 0; i < intervals.length; i += step) {
      labels.push({ idx: i, label: formatHour(intervals[i].timestamp) });
    }
    if (intervals.length > 0) {
      labels.push({ idx: intervals.length - 1, label: 'Now' });
    }
    return labels;
  }, [intervals]);

  const pills = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: '7d', label: '7D' },
    { key: '30d', label: '30D' },
  ];

  return (
    <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden mb-4">
      <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">
            Intraday LMP - {node}
          </span>
          <span className="text-[9px] font-bold text-[#1a6b3c] bg-[#edf7f0] px-2 py-[2px] rounded-full uppercase tracking-[0.5px] flex items-center gap-[5px]">
            <span className="w-[5px] h-[5px] rounded-full bg-[#2dd478] animate-pulse" />
            5-min
          </span>
        </div>
        <div className="flex gap-1">
          {pills.map(p => (
            <button
              key={p.key}
              onClick={() => setRange(p.key)}
              className={`px-[10px] py-1 rounded-md border text-[10px] font-semibold transition-all ${
                range === p.key
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
        {loading && intervals.length === 0 ? (
          <div className="h-[240px] flex items-center justify-center text-terminal-muted text-sm">Loading…</div>
        ) : intervals.length === 0 ? (
          <div className="h-[240px] flex items-center justify-center text-terminal-muted text-sm">No data available</div>
        ) : (
          <>
            <div className="relative h-[220px] border-l border-b border-[#f0eeea]">
              {/* Y axis */}
              <div className="absolute left-0 top-0 bottom-0 w-[50px] flex flex-col justify-between pb-5 pr-2 text-right">
                {yLabels.map((v, i) => (
                  <div key={i} className="font-mono text-[9px] text-[#c5c5bc]">${v}</div>
                ))}
              </div>

              {/* Breakeven lines */}
              {[
                { val: BREAKEVENS.s19, label: `S19 BE $${BREAKEVENS.s19}`, cls: 'border-[rgba(192,57,43,0.3)]', tagCls: 'bg-[#fbeae8] text-[#c0392b]' },
                { val: BREAKEVENS.fleet, label: `Fleet Avg $${BREAKEVENS.fleet}`, cls: 'border-[#b8860b]', tagCls: 'bg-[#fdf6e8] text-[#b8860b]' },
                { val: BREAKEVENS.s19xp, label: `S19 XP BE $${BREAKEVENS.s19xp}`, cls: 'border-[rgba(26,107,60,0.3)]', tagCls: 'bg-[#edf7f0] text-[#1a6b3c]' },
              ].map(be => {
                const pct = ((maxLmp - be.val) / maxLmp) * 100;
                if (pct < 0 || pct > 100) return null;
                return (
                  <div
                    key={be.val}
                    className={`absolute left-[50px] right-0 border-t-[1.5px] border-dashed ${be.cls}`}
                    style={{ top: `${pct}%` }}
                  >
                    <span className={`absolute right-0 text-[9px] font-semibold px-[6px] py-[2px] rounded -translate-y-1/2 whitespace-nowrap ${be.tagCls}`}>
                      {be.label}
                    </span>
                  </div>
                );
              })}

              {/* Bars */}
              <div className="absolute left-[50px] top-0 right-0 bottom-5 flex items-end gap-[1px] px-[2px]">
                {intervals.map((iv, i) => {
                  const h = Math.max(1, (Math.max(0, iv.lmp) / maxLmp) * 100);
                  const negH = iv.lmp < 0 ? (Math.abs(iv.lmp) / maxLmp) * 100 : 0;
                  return (
                    <div
                      key={i}
                      className="flex-1 min-w-[1px] relative cursor-crosshair group"
                      style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}
                      onMouseEnter={() => setHovered(i)}
                      onMouseLeave={() => setHovered(null)}
                    >
                      {iv.lmp < 0 ? (
                        <div className="bg-[#2dd478] rounded-b-[2px] opacity-80" style={{ height: `${negH}%` }} />
                      ) : (
                        <div className={`${getBarColor(iv.lmp)} rounded-t-[2px] hover:opacity-70 transition-opacity`} style={{ height: `${h}%` }} />
                      )}
                      {hovered === i && (
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-20 bg-terminal-text text-white text-[10px] px-2 py-1 rounded whitespace-nowrap font-mono shadow-lg">
                          {formatHour(iv.timestamp)} · ${iv.lmp.toFixed(2)}/MWh
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* X axis */}
            <div className="flex justify-between pl-[50px] pt-[6px]">
              {xLabels.map((xl, i) => (
                <div key={i} className="font-mono text-[9px] text-[#c5c5bc]">{xl.label}</div>
              ))}
            </div>

            {/* Legend */}
            <div className="flex gap-4 mt-3 text-[10px] text-terminal-muted">
              <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-sm bg-[#1a6b3c]" /> Below S19 XP BE</div>
              <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-sm bg-[#a3d9a5]" /> Below Fleet Avg</div>
              <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-sm bg-[#b8860b]" /> Above Fleet Avg</div>
              <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-sm bg-[#c0392b]" /> Above S19 BE</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

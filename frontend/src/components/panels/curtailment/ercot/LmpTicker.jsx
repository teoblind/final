import React from 'react';
import { useCurrentLmp } from '../../../../hooks/useErcotLmp';

const BREAKEVENS = { s19xp: 36.80, fleet: 41.30, s19: 52.10 };

function getSignal(lmp) {
  if (lmp <= BREAKEVENS.s19xp) return { label: 'Below all breakevens', cls: 'text-[#1a6b3c]', bg: 'linear-gradient(135deg, var(--t-panel, #fff), #edf7f0)' };
  if (lmp <= BREAKEVENS.fleet) return { label: 'Above S19 XP BE', cls: 'text-[#b8860b]', bg: 'linear-gradient(135deg, var(--t-panel, #fff), #fdf6e8)' };
  if (lmp <= BREAKEVENS.s19) return { label: 'Above fleet avg BE', cls: 'text-[#b8860b]', bg: 'linear-gradient(135deg, var(--t-panel, #fff), #fdf6e8)' };
  return { label: 'Above all breakevens', cls: 'text-[#c0392b]', bg: 'linear-gradient(135deg, var(--t-panel, #fff), #fbeae8)' };
}

function formatTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Chicago' }) + ' CST';
}

export default function LmpTicker({ node = 'HB_NORTH', ppaRate = 22.40 }) {
  const { data, loading } = useCurrentLmp(node);

  if (loading && !data) {
    return (
      <div className="flex gap-[1px] bg-terminal-border border border-terminal-border rounded-[14px] overflow-hidden mb-4 animate-pulse">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-terminal-panel p-4 flex-1 h-20" />
        ))}
      </div>
    );
  }

  if (!data) return null;

  const lmp = data.lmp ?? 0;
  const signal = getSignal(lmp);
  const changeCls = data.change5m < 0 ? 'text-[#1a6b3c]' : data.change5m > 0 ? 'text-[#c0392b]' : 'text-terminal-muted';
  const changeLabel = data.change5m < 0 ? 'Falling' : data.change5m > 0 ? 'Rising' : 'Flat';

  return (
    <div className="flex gap-[1px] bg-terminal-border border border-terminal-border rounded-[14px] overflow-hidden mb-4">
      {/* Current LMP */}
      <div className="bg-terminal-panel p-[14px_18px] flex-1" style={{ background: signal.bg }}>
        <div className="text-[9px] font-bold text-terminal-muted uppercase tracking-[1px] mb-[3px]">Current LMP</div>
        <div className="text-xl font-bold text-terminal-text tabular-nums font-mono leading-none">
          ${lmp.toFixed(2)}<span className="text-[11px] font-medium text-terminal-muted"> /MWh</span>
        </div>
        <div className={`text-[10px] font-semibold mt-[3px] ${signal.cls}`}>{signal.label}</div>
      </div>

      {/* 5-Min Change */}
      <div className="bg-terminal-panel p-[14px_18px] flex-1">
        <div className="text-[9px] font-bold text-terminal-muted uppercase tracking-[1px] mb-[3px]">5-Min Change</div>
        <div className="text-xl font-bold text-terminal-text tabular-nums font-mono leading-none">
          {data.change5m >= 0 ? '+' : ''}${data.change5m?.toFixed(2) ?? '0.00'}
        </div>
        <div className={`text-[10px] font-semibold mt-[3px] ${changeCls}`}>{changeLabel}</div>
      </div>

      {/* Node */}
      <div className="bg-terminal-panel p-[14px_18px] flex-1">
        <div className="text-[9px] font-bold text-terminal-muted uppercase tracking-[1px] mb-[3px]">Node</div>
        <div className="text-[15px] font-semibold text-terminal-text leading-none mt-1">{data.node}</div>
        <div className="text-[10px] font-semibold mt-[3px] text-terminal-muted">Settlement Point</div>
      </div>

      {/* Today Avg */}
      <div className="bg-terminal-panel p-[14px_18px] flex-1">
        <div className="text-[9px] font-bold text-terminal-muted uppercase tracking-[1px] mb-[3px]">Today Avg</div>
        <div className="text-xl font-bold text-terminal-text tabular-nums font-mono leading-none">
          ${data.todayAvg?.toFixed(2) ?? '—'}<span className="text-[11px] font-medium text-terminal-muted"> /MWh</span>
        </div>
        <div className="text-[10px] font-semibold mt-[3px] text-terminal-muted">{data.intervals} intervals</div>
      </div>

      {/* Today Peak */}
      <div className="bg-terminal-panel p-[14px_18px] flex-1">
        <div className="text-[9px] font-bold text-terminal-muted uppercase tracking-[1px] mb-[3px]">Today Peak</div>
        <div className="text-xl font-bold text-terminal-text tabular-nums font-mono leading-none">
          ${data.todayPeak?.toFixed(2) ?? '—'}<span className="text-[11px] font-medium text-terminal-muted"> /MWh</span>
        </div>
        <div className={`text-[10px] font-semibold mt-[3px] ${data.todayPeak > BREAKEVENS.fleet ? 'text-[#b8860b]' : 'text-terminal-muted'}`}>
          {formatTime(data.todayPeakTime)}
        </div>
      </div>

      {/* PPA Rate */}
      <div className="bg-terminal-panel p-[14px_18px] flex-1">
        <div className="text-[9px] font-bold text-terminal-muted uppercase tracking-[1px] mb-[3px]">PPA Rate</div>
        <div className="text-xl font-bold text-terminal-text tabular-nums font-mono leading-none">
          ${ppaRate.toFixed(2)}<span className="text-[11px] font-medium text-terminal-muted"> /MWh</span>
        </div>
        <div className="text-[10px] font-semibold mt-[3px] text-[#1a6b3c]">Fixed contract</div>
      </div>
    </div>
  );
}

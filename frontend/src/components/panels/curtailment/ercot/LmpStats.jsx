import React, { useState } from 'react';
import { useLmpStats } from '../../../../hooks/useErcotLmp';

function KVRow({ label, value, cls = '' }) {
  const colorCls = {
    green: 'text-[#1a6b3c]',
    warn: 'text-[#b8860b]',
    danger: 'text-[#c0392b]',
    muted: 'text-terminal-muted',
    '': 'text-terminal-text',
  }[cls] || 'text-terminal-text';

  return (
    <div className="flex items-center justify-between px-[18px] py-[10px] border-b border-[#f0eeea] last:border-b-0 text-[13px]">
      <span className="text-[#6b6b65]">{label}</span>
      <span className={`font-semibold tabular-nums font-mono text-xs ${colorCls}`}>{value}</span>
    </div>
  );
}

export default function LmpStats({ node = 'HB_NORTH' }) {
  const [days, setDays] = useState(30);
  const { data: resp, loading } = useLmpStats(node, days);

  const pills = [7, 30, 90];

  return (
    <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
      <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
        <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">LMP Statistics</span>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-terminal-muted">{node}</span>
          <div className="flex gap-1">
            {pills.map(p => (
              <button
                key={p}
                onClick={() => setDays(p)}
                className={`px-[8px] py-[3px] rounded-md border text-[10px] font-semibold transition-all ${
                  days === p
                    ? 'bg-terminal-text text-white border-terminal-text'
                    : 'bg-terminal-panel text-terminal-muted border-terminal-border hover:bg-[#f5f4f0]'
                }`}
              >
                {p}D
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading && !resp ? (
        <div className="p-8 text-center text-terminal-muted text-sm">Loading…</div>
      ) : !resp ? (
        <div className="p-8 text-center text-terminal-muted text-sm">No data</div>
      ) : (
        <div>
          <KVRow label={`${days}D Average`} value={resp.avg != null ? `$${resp.avg.toFixed(2)}` : '—'} />
          <KVRow label={`${days}D Median`} value={resp.median != null ? `$${resp.median.toFixed(2)}` : '—'} />
          <KVRow label={`${days}D Peak`} value={resp.peak != null ? `$${resp.peak.toFixed(2)}` : '—'} cls={resp.peak > 100 ? 'danger' : resp.peak > 50 ? 'warn' : ''} />
          <KVRow label={`${days}D Trough`} value={resp.trough != null ? `$${resp.trough.toFixed(2)}` : '—'} cls={resp.trough < 0 ? 'green' : ''} />
          <KVRow label="Negative Price Hours" value={resp.negativeHours ?? '—'} cls={resp.negativeHours > 0 ? 'green' : ''} />
          <KVRow label="Hours Above Fleet BE" value={resp.hoursAboveFleetBE ?? '—'} cls={resp.hoursAboveFleetBE > 20 ? 'warn' : ''} />
          <KVRow label="Hours Above S19 BE" value={resp.hoursAboveS19BE ?? '—'} cls={resp.hoursAboveS19BE > 10 ? 'danger' : ''} />
          <KVRow label="Volatility (Std Dev)" value={resp.stdDev != null ? `$${resp.stdDev.toFixed(2)}` : '—'} />
          <KVRow label="Data Points" value={resp.dataPoints?.toLocaleString() ?? '—'} cls="muted" />
        </div>
      )}
    </div>
  );
}

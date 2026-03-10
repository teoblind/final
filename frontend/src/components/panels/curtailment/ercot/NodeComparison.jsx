import React from 'react';
import { useLmpNodes } from '../../../../hooks/useErcotLmp';

const BREAKEVENS = { s19xp: 36.80, fleet: 41.30, s19: 52.10 };

function getSignal(lmp) {
  if (lmp <= BREAKEVENS.s19xp) return { label: 'Mine', cls: 'text-[#1a6b3c]' };
  if (lmp <= BREAKEVENS.fleet) return { label: 'Mine', cls: 'text-[#1a6b3c]' };
  if (lmp <= BREAKEVENS.s19) return { label: 'Watch', cls: 'text-[#b8860b]' };
  return { label: 'Curtail', cls: 'text-[#c0392b]' };
}

function valCls(val, thresholds = {}) {
  if (thresholds.danger && val >= thresholds.danger) return 'text-[#c0392b]';
  if (thresholds.warn && val >= thresholds.warn) return 'text-[#b8860b]';
  if (thresholds.green && val <= thresholds.green) return 'text-[#1a6b3c]';
  return 'text-terminal-text';
}

export default function NodeComparison() {
  const { data: resp, loading } = useLmpNodes();
  const nodes = resp?.data || [];

  return (
    <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
      <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
        <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Settlement Point Comparison</span>
        <span className="text-[11px] text-terminal-muted">Current interval</span>
      </div>

      {/* Header */}
      <div
        className="grid px-[18px] py-[10px] text-[10px] font-bold text-terminal-muted uppercase tracking-[0.8px] border-b border-terminal-border"
        style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr' }}
      >
        <div>Node</div>
        <div>Current</div>
        <div>24H Avg</div>
        <div>24H Peak</div>
        <div>Neg Hours</div>
        <div>Signal</div>
      </div>

      {loading && nodes.length === 0 ? (
        <div className="p-8 text-center text-terminal-muted text-sm">Loading…</div>
      ) : nodes.length === 0 ? (
        <div className="p-8 text-center text-terminal-muted text-sm">No data</div>
      ) : (
        nodes.map((n, i) => {
          const signal = getSignal(n.current_lmp);
          return (
            <div
              key={n.node}
              className="grid px-[18px] py-[11px] border-b border-[#f0eeea] last:border-b-0 items-center text-[13px] hover:bg-[#f5f4f0] transition-colors"
              style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr' }}
            >
              <div className="font-semibold text-terminal-text">{n.node}</div>
              <div className={`font-mono text-xs tabular-nums ${valCls(n.current_lmp, { green: BREAKEVENS.s19xp })}`}>
                ${n.current_lmp?.toFixed(2)}
              </div>
              <div className="font-mono text-xs tabular-nums text-terminal-text">
                ${n.avg_24h?.toFixed(2)}
              </div>
              <div className={`font-mono text-xs tabular-nums ${valCls(n.peak_24h, { warn: BREAKEVENS.fleet, danger: 100 })}`}>
                ${n.peak_24h?.toFixed(2)}
              </div>
              <div className={`font-mono text-xs tabular-nums ${n.neg_hours > 0 ? 'text-[#1a6b3c]' : 'text-terminal-text'}`}>
                {Math.round(n.neg_hours)}
              </div>
              <div className={`font-mono text-xs tabular-nums font-semibold ${signal.cls}`}>
                {signal.label}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

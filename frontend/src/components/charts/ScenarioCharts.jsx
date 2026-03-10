/**
 * Scenario / Stress Test Charts (Charts 3A-3D)
 *
 * Visualizes SanghaModel scenario analysis for admin and LP dashboards.
 */
import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, Legend,
} from 'recharts';

const COLORS = {
  blue: '#2E86AB',
  green: '#28A745',
  amber: '#FFC107',
  red: '#DC3545',
  sangha: '#E63946',
  gray: '#6C757D',
  cyan: '#00D4FF',
};

const TOOLTIP_STYLE = { backgroundColor: '#111', border: '1px solid #333', fontSize: 11, borderRadius: 4 };

function fmt(n, d = 0) {
  if (n == null) return '--';
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
}

function fmtPct(n) {
  if (n == null) return '--';
  return `${n > 0 ? '+' : ''}${Number(n).toFixed(1)}%`;
}

// ─── 3A: Baseline vs Shocked Comparison Table ───────────────────────────────

export function ScenarioComparisonTable({ baseline, shocked, impact }) {
  if (!baseline || !shocked) return null;

  const rows = [
    { label: 'Hashprice', base: `$${fmt(baseline.hashprice, 4)}`, shock: `$${fmt(shocked.hashprice, 4)}`, delta: impact?.hashprice_change_pct },
    { label: 'Revenue ($/mo)', base: `$${fmt(baseline.revenue)}`, shock: `$${fmt(shocked.revenue)}`, delta: impact?.revenue_change_pct },
    { label: 'Network (EH/s)', base: fmt(baseline.network_hashrate), shock: fmt(shocked.network_hashrate), delta: impact?.network_hashrate_change_pct },
    { label: 'BTC Price', base: `$${fmt(baseline.btc_price)}`, shock: `$${fmt(shocked.btc_price)}`, delta: null },
    { label: 'Energy ($/MWh)', base: `$${fmt(baseline.energy_cost_mwh)}`, shock: `$${fmt(shocked.energy_cost_mwh)}`, delta: null },
  ];

  return (
    <div>
      <p className="text-xs font-semibold text-terminal-text mb-2">Baseline vs Stressed</p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-terminal-border text-terminal-muted text-[10px] uppercase">
              <th className="text-left py-1.5 pr-4">Metric</th>
              <th className="text-right py-1.5 px-3">Baseline</th>
              <th className="text-right py-1.5 px-3">Stressed</th>
              <th className="text-right py-1.5 pl-3">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.label} className="border-b border-terminal-border/30">
                <td className="py-1.5 pr-4 text-terminal-muted">{r.label}</td>
                <td className="py-1.5 px-3 text-right font-sans text-terminal-text">{r.base}</td>
                <td className="py-1.5 px-3 text-right font-sans text-terminal-text">{r.shock}</td>
                <td className={`py-1.5 pl-3 text-right font-sans ${r.delta != null ? (r.delta >= 0 ? 'text-terminal-green' : 'text-terminal-red') : 'text-terminal-muted'}`}>
                  {r.delta != null ? fmtPct(r.delta) : '--'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── 3B: Impact Summary Bar Chart ───────────────────────────────────────────

export function ImpactBarChart({ impact }) {
  if (!impact) return null;

  const data = [
    { name: 'Hashprice', value: impact.hashprice_change_pct || 0 },
    { name: 'Revenue', value: impact.revenue_change_pct || 0 },
    { name: 'Network Hashrate', value: impact.network_hashrate_change_pct || 0 },
    { name: 'Miners Offline', value: -(impact.miners_offline_pct || 0) },
  ].sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  return (
    <div>
      <p className="text-xs font-semibold text-terminal-text mb-2">Impact Summary (% change)</p>
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, left: 100, bottom: 5 }}>
          <XAxis type="number" stroke="#666" fontSize={9} tickFormatter={v => fmtPct(v)} />
          <YAxis type="category" dataKey="name" stroke="#666" fontSize={9} width={90} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(val) => [fmtPct(val)]} />
          <Bar dataKey="value" radius={[0, 3, 3, 0]}>
            {data.map((d, i) => <Cell key={i} fill={d.value >= 0 ? COLORS.green : COLORS.red} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── 3C: Fleet-Specific Impact Card ─────────────────────────────────────────

export function FleetImpactCard({ fleet }) {
  if (!fleet) return null;

  const stateColor = fleet.fleet_state === 'online' ? 'text-terminal-green' : fleet.fleet_state === 'curtailed' ? 'text-terminal-amber' : 'text-terminal-red';
  const marginDelta = ((fleet.fleet_margin_shocked || 0) - (fleet.fleet_margin_baseline || 0)) * 100;

  return (
    <div>
      <p className="text-xs font-semibold text-terminal-text mb-2">Fleet-Specific Impact</p>
      {fleet.breakeven_breached && (
        <div className="flex items-center gap-2 bg-terminal-red/10 border border-terminal-red/20 rounded px-3 py-2 mb-2 text-xs text-terminal-red">
          <span className="font-bold">BREAKEVEN BREACHED</span> — Fleet becomes unprofitable under this scenario
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-terminal-bg/50 border border-terminal-border rounded p-2">
          <p className="text-[10px] text-terminal-muted">Revenue (Base)</p>
          <p className="text-sm font-bold text-terminal-text font-sans">${fmt(fleet.fleet_revenue_baseline)}</p>
        </div>
        <div className="bg-terminal-bg/50 border border-terminal-border rounded p-2">
          <p className="text-[10px] text-terminal-muted">Revenue (Stressed)</p>
          <p className={`text-sm font-bold font-sans ${fleet.fleet_revenue_shocked < fleet.fleet_revenue_baseline ? 'text-terminal-red' : 'text-terminal-green'}`}>
            ${fmt(fleet.fleet_revenue_shocked)}
          </p>
        </div>
        <div className="bg-terminal-bg/50 border border-terminal-border rounded p-2">
          <p className="text-[10px] text-terminal-muted">Margin Change</p>
          <p className={`text-sm font-bold font-sans ${marginDelta >= 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
            {marginDelta >= 0 ? '+' : ''}{marginDelta.toFixed(1)}%
          </p>
        </div>
        <div className="bg-terminal-bg/50 border border-terminal-border rounded p-2">
          <p className="text-[10px] text-terminal-muted">Fleet State</p>
          <p className={`text-sm font-bold uppercase ${stateColor}`}>{fleet.fleet_state}</p>
        </div>
      </div>
    </div>
  );
}

// ─── 3D: Multi-Scenario Comparison ──────────────────────────────────────────

export function MultiScenarioChart({ scenarios }) {
  if (!scenarios?.length) return null;

  const data = scenarios.map(s => ({
    name: s.name,
    hashprice: s.impact_summary?.hashprice_change_pct || 0,
    revenue: s.impact_summary?.revenue_change_pct || 0,
    minersOffline: s.impact_summary?.miners_offline_pct || 0,
  }));

  return (
    <div>
      <p className="text-xs font-semibold text-terminal-text mb-2">Multi-Scenario Comparison</p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 30 }}>
          <XAxis dataKey="name" stroke="#666" fontSize={8} angle={-25} textAnchor="end" height={50} />
          <YAxis stroke="#666" fontSize={9} tickFormatter={v => `${v}%`} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(val, name) => [`${Number(val).toFixed(1)}%`, name]} />
          <Legend verticalAlign="top" height={24} wrapperStyle={{ fontSize: 10 }} />
          <Bar dataKey="hashprice" name="Hashprice" fill={COLORS.blue} radius={[2, 2, 0, 0]} />
          <Bar dataKey="revenue" name="Revenue" fill={COLORS.amber} radius={[2, 2, 0, 0]} />
          <Bar dataKey="minersOffline" name="Offline %" fill={COLORS.red} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

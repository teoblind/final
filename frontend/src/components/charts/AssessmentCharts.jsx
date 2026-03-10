/**
 * Assessment Charts (Charts 1A-1E, 2A-2D)
 *
 * Renders SanghaModel risk assessment data as interactive Recharts visualizations.
 * Used by CoverageExplorerPanel (quick) and RiskDetailPanel (full).
 */
import React, { useMemo } from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  Cell, Legend,
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

function fmtUsd(n) {
  if (n == null) return '--';
  return `$${fmt(n)}`;
}

// ─── 1A: Revenue Fan Chart ─────────────────────────────────────────────────

export function RevenueFanChart({ projections }) {
  if (!projections?.length) return null;

  return (
    <div>
      <p className="text-xs font-semibold text-terminal-text mb-2">Revenue Projections (12-month fan)</p>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={projections} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <defs>
            <linearGradient id="fanP90" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={COLORS.blue} stopOpacity={0.1} />
              <stop offset="1" stopColor={COLORS.blue} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="fanP75" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={COLORS.blue} stopOpacity={0.2} />
              <stop offset="1" stopColor={COLORS.blue} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <XAxis dataKey="month" stroke="#666" fontSize={9} tickFormatter={m => `M${m}`} />
          <YAxis stroke="#666" fontSize={9} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(val, name) => [fmtUsd(val), name]}
            labelFormatter={m => `Month ${m}`}
          />
          <ReferenceLine y={0} stroke={COLORS.gray} strokeDasharray="4 4" label={{ value: 'Breakeven', fill: '#666', fontSize: 9 }} />
          {/* P10-P90 band (lightest) */}
          <Area type="monotone" dataKey="p90_net_revenue" stackId="outer" stroke="none" fill="url(#fanP90)" />
          <Area type="monotone" dataKey="p10_net_revenue" stackId="outer_low" stroke="none" fill="transparent" />
          {/* P25-P75 band (medium) */}
          <Area type="monotone" dataKey="p75_net_revenue" stackId="mid" stroke="none" fill="url(#fanP75)" />
          <Area type="monotone" dataKey="p25_net_revenue" stackId="mid_low" stroke="none" fill="transparent" />
          {/* P50 center line */}
          <Area type="monotone" dataKey="p50_net_revenue" stroke={COLORS.blue} strokeWidth={2} fill="none" />
          {/* Mean overlay (dashed) */}
          <Area type="monotone" dataKey="mean_net_revenue" stroke={COLORS.cyan} strokeWidth={1} strokeDasharray="4 3" fill="none" />
        </AreaChart>
      </ResponsiveContainer>
      <div className="flex justify-center gap-4 text-[10px] text-terminal-muted mt-1">
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#2E86AB] inline-block" /> P50</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#00D4FF] inline-block" style={{ borderTop: '1px dashed #00D4FF' }} /> Mean</span>
        <span className="flex items-center gap-1"><span className="w-3 h-2 bg-[#2E86AB]/20 inline-block rounded" /> P25-P75</span>
        <span className="flex items-center gap-1"><span className="w-3 h-2 bg-[#2E86AB]/10 inline-block rounded" /> P10-P90</span>
      </div>
    </div>
  );
}

// ─── 1B: Hashprice Forecast Ribbon ──────────────────────────────────────────

export function HashpriceRibbonChart({ horizons, currentHashprice }) {
  if (!horizons?.length) return null;

  const data = horizons.map(h => ({
    month: h.months_ahead,
    median: h.median,
    p5: h.percentiles?.['5'],
    p10: h.percentiles?.['10'],
    p25: h.percentiles?.['25'],
    p75: h.percentiles?.['75'],
    p90: h.percentiles?.['90'],
    p95: h.percentiles?.['95'],
    probBelow: h.prob_below_current,
  }));

  return (
    <div>
      <p className="text-xs font-semibold text-terminal-text mb-2">
        Hashprice Forecast ($/TH/s/day)
      </p>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <defs>
            <linearGradient id="hpBand" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor={COLORS.amber} stopOpacity={0.15} />
              <stop offset="1" stopColor={COLORS.amber} stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <XAxis dataKey="month" stroke="#666" fontSize={9} tickFormatter={m => `+${m}mo`} />
          <YAxis stroke="#666" fontSize={9} tickFormatter={v => `$${v.toFixed(3)}`} domain={['auto', 'auto']} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(val, name) => [`$${Number(val).toFixed(4)}`, name]}
            labelFormatter={m => `+${m} months`}
          />
          {currentHashprice && (
            <ReferenceLine y={currentHashprice} stroke={COLORS.gray} strokeDasharray="4 4" label={{ value: 'Current', fill: '#666', fontSize: 9 }} />
          )}
          <Area type="monotone" dataKey="p95" stroke="none" fill="url(#hpBand)" />
          <Area type="monotone" dataKey="p5" stroke="none" fill="transparent" />
          <Area type="monotone" dataKey="p90" stroke="none" fill="url(#hpBand)" />
          <Area type="monotone" dataKey="p10" stroke="none" fill="transparent" />
          <Area type="monotone" dataKey="p75" stroke="none" fill={COLORS.amber} fillOpacity={0.12} />
          <Area type="monotone" dataKey="p25" stroke="none" fill="transparent" />
          <Area type="monotone" dataKey="median" stroke={COLORS.amber} strokeWidth={2} fill="none" />
        </AreaChart>
      </ResponsiveContainer>
      <div className="flex gap-3 mt-1">
        {data.slice(-3).map(d => (
          <span key={d.month} className="text-[10px] text-terminal-muted">
            +{d.month}mo: <span className="text-terminal-amber">{Math.round((d.probBelow || 0) * 100)}%</span> chance below current
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── 1C: Risk Score Gauge ───────────────────────────────────────────────────

export function RiskScoreGauge({ riskScore, probLoss12m }) {
  if (riskScore == null) return null;

  const angle = (riskScore / 100) * 180;
  const color = riskScore <= 30 ? COLORS.green : riskScore <= 60 ? COLORS.amber : COLORS.red;
  const label = riskScore <= 30 ? 'Low Risk' : riskScore <= 60 ? 'Moderate Risk' : 'High Risk';

  // SVG arc path
  const r = 70;
  const cx = 80;
  const cy = 80;
  const startAngle = Math.PI;
  const endAngle = Math.PI + (angle / 180) * Math.PI;
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  const largeArc = angle > 180 ? 1 : 0;

  return (
    <div className="flex flex-col items-center">
      <p className="text-xs font-semibold text-terminal-text mb-2">Risk Score</p>
      <svg width="160" height="100" viewBox="0 0 160 100">
        {/* Background arc */}
        <path d={`M 10 80 A 70 70 0 0 1 150 80`} fill="none" stroke="#333" strokeWidth="10" strokeLinecap="round" />
        {/* Green zone */}
        <path d={`M 10 80 A 70 70 0 0 1 ${cx + r * Math.cos(Math.PI + (54 / 180) * Math.PI)} ${cy + r * Math.sin(Math.PI + (54 / 180) * Math.PI)}`} fill="none" stroke={COLORS.green} strokeWidth="10" strokeLinecap="round" opacity={0.3} />
        {/* Amber zone */}
        <path d={`M ${cx + r * Math.cos(Math.PI + (54 / 180) * Math.PI)} ${cy + r * Math.sin(Math.PI + (54 / 180) * Math.PI)} A 70 70 0 0 1 ${cx + r * Math.cos(Math.PI + (108 / 180) * Math.PI)} ${cy + r * Math.sin(Math.PI + (108 / 180) * Math.PI)}`} fill="none" stroke={COLORS.amber} strokeWidth="10" opacity={0.3} />
        {/* Red zone */}
        <path d={`M ${cx + r * Math.cos(Math.PI + (108 / 180) * Math.PI)} ${cy + r * Math.sin(Math.PI + (108 / 180) * Math.PI)} A 70 70 0 0 1 150 80`} fill="none" stroke={COLORS.red} strokeWidth="10" strokeLinecap="round" opacity={0.3} />
        {/* Value arc */}
        {angle > 0 && (
          <path d={`M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" />
        )}
        {/* Value text */}
        <text x={cx} y={cy - 8} textAnchor="middle" fill={color} fontSize="24" fontWeight="bold" fontFamily="'Exo 2', sans-serif">{riskScore}</text>
        <text x={cx} y={cy + 8} textAnchor="middle" fill="#999" fontSize="10">{label}</text>
      </svg>
      {probLoss12m != null && (
        <p className="text-[10px] text-terminal-muted mt-1">
          Probability of loss in 12 months: <span className="text-terminal-text font-sans">{Math.round(probLoss12m * 100)}%</span>
        </p>
      )}
    </div>
  );
}

// ─── 1D: Suggested Floor Cards ──────────────────────────────────────────────

export function FloorCards({ insuranceInputs }) {
  if (!insuranceInputs) return null;

  const cards = [
    { label: 'Conservative', floor: insuranceInputs.suggested_floor_conservative, payout: insuranceInputs.expected_annual_payout_conservative, color: 'text-terminal-green', border: 'border-terminal-green/20' },
    { label: 'Moderate', floor: insuranceInputs.suggested_floor_moderate, payout: insuranceInputs.expected_annual_payout_moderate, color: 'text-terminal-amber', border: 'border-terminal-amber/20' },
    { label: 'Aggressive', floor: insuranceInputs.suggested_floor_aggressive, payout: insuranceInputs.expected_annual_payout_aggressive, color: 'text-terminal-red', border: 'border-terminal-red/20' },
  ];

  return (
    <div>
      <p className="text-xs font-semibold text-terminal-text mb-2">Suggested Floor Prices</p>
      <div className="grid grid-cols-3 gap-2">
        {cards.map(c => (
          <div key={c.label} className={`bg-terminal-bg/50 border ${c.border} rounded p-3`}>
            <p className={`text-[10px] ${c.color} uppercase font-semibold mb-1`}>{c.label}</p>
            <p className={`text-lg font-bold font-sans ${c.color}`}>${fmt(c.floor, 4)}</p>
            <p className="text-[10px] text-terminal-muted">/TH/s/day</p>
            <p className="text-xs text-terminal-muted mt-2">Est. annual payout</p>
            <p className="text-sm font-sans text-terminal-text">{fmtUsd(c.payout)}</p>
          </div>
        ))}
      </div>
      {insuranceInputs.loss_ratio_estimate != null && (
        <p className="text-[10px] text-terminal-muted mt-2">
          Expected loss ratio: <span className="text-terminal-text font-sans">{Math.round(insuranceInputs.loss_ratio_estimate * 100)}%</span>
        </p>
      )}
    </div>
  );
}

// ─── 1E: Probability of Negative Revenue ────────────────────────────────────

export function ProbNegativeChart({ projections }) {
  if (!projections?.length) return null;

  const data = projections.filter(p => p.month > 0).map(p => ({
    month: `M${p.month}`,
    prob: Math.round((p.prob_negative || 0) * 100),
  }));

  const getBarColor = (prob) => {
    if (prob < 10) return COLORS.green;
    if (prob < 30) return COLORS.amber;
    return COLORS.red;
  };

  return (
    <div>
      <p className="text-xs font-semibold text-terminal-text mb-2">Probability of Negative Revenue</p>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <XAxis dataKey="month" stroke="#666" fontSize={9} />
          <YAxis stroke="#666" fontSize={9} tickFormatter={v => `${v}%`} domain={[0, 'auto']} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(val) => [`${val}%`, 'Prob. negative']}
          />
          <Bar dataKey="prob" radius={[2, 2, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={getBarColor(d.prob)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── 2A: Risk Metrics Radar ─────────────────────────────────────────────────

export function RiskRadarChart({ riskMetrics }) {
  if (!riskMetrics) return null;

  const data = [
    { axis: 'Breakeven Risk', value: riskMetrics.prob_below_breakeven_12m || 0 },
    { axis: 'Extended Loss', value: riskMetrics.prob_extended_loss_12m || 0 },
    { axis: 'Max Drawdown', value: Math.min(1, (riskMetrics.max_drawdown_p95 || 0) / 100000) },
    { axis: 'Fleet Efficiency', value: 1 - (riskMetrics.fleet_efficiency_percentile || 0.5) },
    { axis: 'Energy Cost', value: 1 - (riskMetrics.energy_cost_percentile || 0.5) },
    { axis: 'Curtailment', value: 1 - (riskMetrics.curtailment_effectiveness || 0.5) },
  ];

  return (
    <div>
      <p className="text-xs font-semibold text-terminal-text mb-2">Risk Profile Radar</p>
      <ResponsiveContainer width="100%" height={250}>
        <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
          <PolarGrid stroke="#333" />
          <PolarAngleAxis dataKey="axis" tick={{ fill: '#999', fontSize: 9 }} />
          <PolarRadiusAxis angle={30} domain={[0, 1]} tick={{ fill: '#666', fontSize: 8 }} />
          <Radar name="Risk" dataKey="value" stroke={COLORS.sangha} fill={COLORS.sangha} fillOpacity={0.25} strokeWidth={2} />
        </RadarChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-terminal-muted text-center">Larger polygon = more risk</p>
    </div>
  );
}

// ─── 2B: Monthly VaR Waterfall ──────────────────────────────────────────────

export function VaRWaterfallChart({ riskMetrics }) {
  if (!riskMetrics) return null;

  const data = [
    { name: 'Monthly VaR', value: riskMetrics.value_at_risk_monthly || 0, fill: COLORS.amber },
    { name: 'Expected Loss', value: riskMetrics.expected_loss_given_breach || 0, fill: COLORS.red },
    { name: 'Max Drawdown (P95)', value: riskMetrics.max_drawdown_p95 || 0, fill: COLORS.sangha },
  ];

  return (
    <div>
      <p className="text-xs font-semibold text-terminal-text mb-2">Value at Risk</p>
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={data} layout="vertical" margin={{ top: 5, right: 10, left: 100, bottom: 5 }}>
          <XAxis type="number" stroke="#666" fontSize={9} tickFormatter={v => fmtUsd(v)} />
          <YAxis type="category" dataKey="name" stroke="#666" fontSize={9} width={90} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(val) => [fmtUsd(val)]} />
          <Bar dataKey="value" radius={[0, 3, 3, 0]}>
            {data.map((d, i) => <Cell key={i} fill={d.fill} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="text-[10px] text-terminal-muted mt-1">
        If hashprice breaches breakeven, expected loss is <span className="text-terminal-red font-sans">{fmtUsd(riskMetrics.expected_loss_given_breach)}</span>/month
      </p>
    </div>
  );
}

// ─── 2C: Diversification Score Bar ──────────────────────────────────────────

export function DiversificationBar({ score }) {
  if (score == null) return null;

  const pct = Math.round(score * 100);
  const color = score < 0.3 ? COLORS.red : score < 0.7 ? COLORS.amber : COLORS.green;
  const label = score < 0.3 ? 'Concentrated — single region/model risk' : score < 0.7 ? 'Moderate diversification' : 'Well diversified';

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-semibold text-terminal-text">Diversification Score</p>
        <span className="text-sm font-bold font-sans" style={{ color }}>{pct}%</span>
      </div>
      <div className="w-full h-3 bg-terminal-border rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <p className="text-[10px] text-terminal-muted mt-1">{label}</p>
    </div>
  );
}

// ─── 2D: Simulation Metadata ────────────────────────────────────────────────

export function SimulationMetadata({ params, generatedAt, modelVersion }) {
  if (!params) return null;

  return (
    <div className="flex flex-wrap gap-2 mt-3">
      <span className="px-2 py-0.5 text-[10px] bg-terminal-border/50 text-terminal-muted rounded">
        {fmt(params.num_simulations)} simulations
      </span>
      <span className="px-2 py-0.5 text-[10px] bg-terminal-border/50 text-terminal-muted rounded">
        {params.horizon_months}-month horizon
      </span>
      <span className="px-2 py-0.5 text-[10px] bg-terminal-border/50 text-terminal-muted rounded">
        BTC: {params.btc_price_model}
      </span>
      <span className="px-2 py-0.5 text-[10px] bg-terminal-border/50 text-terminal-muted rounded">
        Difficulty: {params.difficulty_model}
      </span>
      {modelVersion && (
        <span className="px-2 py-0.5 text-[10px] bg-terminal-border/50 text-terminal-muted rounded">
          Model v{modelVersion}
        </span>
      )}
      {generatedAt && (
        <span className="px-2 py-0.5 text-[10px] bg-terminal-border/50 text-terminal-muted rounded">
          Generated: {new Date(generatedAt).toLocaleString()}
        </span>
      )}
    </div>
  );
}

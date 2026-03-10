import React, { useState } from 'react';
import { LmpTicker, IntradayChart, LmpHeatmap, NodeComparison, LmpStats } from '../panels/curtailment/ercot';

// ─── Demo Data ──────────────────────────────────────────────────────────────

const SITE = {
  name: 'Oberon Solar — ERCOT West',
  type: 'Behind-the-meter · 12 MW capacity',
  fleetOnline: 847,
  fleetTotal: 960,
  utilization: 88.2,
  hashrate: 72.4,
  hashrateTarget: 82.1,
  energyCost: 22.40,
  energyNote: 'Fixed PPA rate',
  hashprice: 48.12,
  breakeven: 41.30,
  netRevHr: 487,
  netRevToday: 11688,
};

const SCHEDULE_HOURS = [
  'profitable','profitable','profitable','profitable','marginal','marginal',
  'mining','mining','mining','mining','mining','mining',
  'mining','curtailed','curtailed','curtailed','mining','mining',
  'profitable','profitable','profitable','profitable','profitable','profitable',
];

const FLEET = [
  { model: 'Antminer S19 XP', count: 320, online: 318, hashrate: '140 TH/s', efficiency: '21.5 J/TH', breakeven: '$36.80', beClass: 'green', status: 'mining', dotClass: 'on' },
  { model: 'Antminer S19k Pro', count: 280, online: 277, hashrate: '120 TH/s', efficiency: '23.0 J/TH', breakeven: '$39.50', beClass: '', status: 'mining', dotClass: 'on' },
  { model: 'Antminer S19j Pro', count: 240, online: 172, hashrate: '104 TH/s', efficiency: '29.5 J/TH', breakeven: '$45.20', beClass: 'warn', status: 'partial', dotClass: 'cur' },
  { model: 'Antminer S19', count: 120, online: 80, hashrate: '95 TH/s', efficiency: '34.5 J/TH', breakeven: '$52.10', beClass: 'danger', status: 'curtailed', dotClass: 'off' },
];

const EVENTS = [
  { time: '16:42', type: 'stop', title: 'Curtailed 40 S19 units — hashprice below S19 breakeven', sub: 'Hashprice $47.80 vs breakeven $52.10 · Savings: $34/hr' },
  { time: '15:58', type: 'alert', title: 'Margin alert: S19j Pro fleet approaching breakeven', sub: 'Current margin 6.4% · Threshold: 5%' },
  { time: '14:12', type: 'stop', title: 'Curtailed 68 S19j Pro units — demand response event', sub: 'ERCOT 4CP signal detected · Duration: 2h 15m' },
  { time: '11:57', type: 'start', title: 'Restarted 68 S19j Pro units — demand response cleared', sub: 'All units back online within 4 min' },
  { time: '08:30', type: 'info', title: 'Daily strategy set: Peeling mode — HB NORTH node', sub: 'Least efficient machines curtail first · 4 tiers configured' },
  { time: '06:15', type: 'start', title: 'Full fleet online — overnight mining complete', sub: 'Night revenue: $4,280 · Avg hashprice: $49.60' },
];

const BREAKEVEN = [
  { label: 'Current Hashprice', value: '$48.12', cls: '' },
  { label: 'Breakeven (fleet avg)', value: '$41.30', cls: 'warn' },
  { label: 'Margin', value: '+16.5%', cls: 'green' },
  { label: 'Breakeven (S19 XP)', value: '$36.80', cls: '' },
  { label: 'Breakeven (S19j Pro)', value: '$45.20', cls: 'warn' },
  { label: 'Breakeven (S19)', value: '$52.10', cls: 'danger' },
  { label: 'Curtailment Strategy', value: 'Peeling — least efficient first', cls: 'accent' },
];

const SAVINGS = [
  { label: 'Total Savings', value: '$14,220', cls: 'green' },
  { label: 'Curtailment Events', value: '47', cls: '' },
  { label: 'Avg per Event', value: '$302', cls: 'green' },
  { label: 'Hours Curtailed', value: '126', cls: '' },
  { label: 'Avoided Loss', value: '$8,940', cls: 'green' },
];

const ENERGY = [
  { label: 'PPA Rate', value: '$22.40', cls: '' },
  { label: 'ERCOT Spot (HB North)', value: '$31.20', cls: '' },
  { label: 'Consumption', value: '9.8 MW', cls: '' },
  { label: 'Demand Response', value: 'Eligible', cls: 'accent' },
  { label: '4CP Events Today', value: '1', cls: 'warn' },
];

const AGENT_CONFIG = [
  { label: 'Mode', value: 'Copilot', cls: 'accent' },
  { label: 'Strategy', value: 'Peeling', cls: '' },
  { label: 'ERCOT Node', value: 'HB North', cls: '' },
  { label: 'Margin Threshold', value: '5%', cls: '' },
  { label: 'Restart Delay', value: '3 min', cls: '' },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

const HOUR_COLORS = {
  profitable: 'bg-[#2dd478]',
  marginal: 'bg-[#a3d9a5]',
  mining: 'bg-[#1a6b3c] opacity-85',
  curtailed: 'bg-[#b8860b] opacity-70',
};

const DOT_COLORS = { on: 'bg-[#2dd478]', cur: 'bg-[#b8860b]', off: 'bg-[#c5c5bc]' };

const STATUS_TAGS = {
  mining: { bg: 'bg-[#edf7f0]', text: 'text-[#1a6b3c]', label: 'Mining' },
  partial: { bg: 'bg-[#fdf6e8]', text: 'text-[#b8860b]', label: 'Partial' },
  curtailed: { bg: 'bg-[#fdf6e8]', text: 'text-[#b8860b]', label: 'Curtailed' },
  offline: { bg: 'bg-[#f5f4f0]', text: 'text-[#9a9a92]', label: 'Offline' },
};

const EV_DOTS = {
  start: 'bg-[#2dd478]',
  stop: 'bg-[#b8860b]',
  alert: 'bg-[#c0392b]',
  info: 'bg-[#9a9a92]',
};

const VAL_CLS = {
  green: 'text-[#1a6b3c]',
  warn: 'text-[#b8860b]',
  danger: 'text-[#c0392b]',
  accent: 'text-[#1a6b3c]',
  '': 'text-terminal-text',
};

// ─── Sub-components ─────────────────────────────────────────────────────────

function Card({ title, meta, children }) {
  return (
    <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
      <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
        <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">{title}</span>
        {meta && <span className="text-[11px] text-terminal-muted">{meta}</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function KVRow({ label, value, cls = '', last = false }) {
  return (
    <div className={`flex items-center justify-between px-[18px] py-[10px] ${last ? '' : 'border-b border-[#f0eeea]'} text-[13px]`}>
      <span className="text-[#6b6b65]">{label}</span>
      <span className={`font-semibold tabular-nums font-mono text-xs ${VAL_CLS[cls] || 'text-terminal-text'}`}>{value}</span>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function CurtailmentDashboard() {
  const [timeRange, setTimeRange] = useState('24H');

  return (
    <div className="p-6 lg:px-7 lg:py-6">
      {/* Top bar */}
      <div className="flex items-center justify-end gap-2 mb-5">
        {['1H', '24H', '7D', '30D'].map(r => (
          <button
            key={r}
            onClick={() => setTimeRange(r)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
              timeRange === r
                ? 'bg-terminal-text text-white border-terminal-text'
                : 'bg-terminal-panel text-terminal-muted border-terminal-border hover:bg-[#f5f4f0]'
            }`}
          >
            {r}
          </button>
        ))}
        <div className="w-px h-5 bg-terminal-border mx-1" />
        <button onClick={() => alert('Backtest initiated — analyzing last 30 days of ERCOT pricing against curtailment decisions.')} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-terminal-green text-white border border-terminal-green hover:opacity-90 transition-all">
          Run Backtest
        </button>
        <button onClick={() => alert('All curtailment recommendations paused. Resume manually when ready.')} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-[#c0392b] text-white border border-[#c0392b] hover:opacity-90 transition-all">
          Pause All
        </button>
      </div>

      {/* ERCOT LMP Integration */}
      <LmpTicker node="HB_NORTH" ppaRate={SITE.energyCost} />
      <IntradayChart node="HB_NORTH" />
      <LmpHeatmap node="HB_NORTH" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <NodeComparison />
        <LmpStats node="HB_NORTH" />
      </div>

      {/* Site Banner */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 border border-terminal-border rounded-[14px] overflow-hidden mb-5" style={{ gap: '1px', background: 'var(--t-border)' }}>
        <div className="bg-terminal-panel p-[16px_20px]" style={{ background: 'linear-gradient(135deg, var(--t-panel), #edf7f0)' }}>
          <div className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px] mb-1">Site</div>
          <div className="text-[15px] font-semibold text-terminal-text leading-tight">{SITE.name}</div>
          <div className="text-[11px] text-terminal-muted mt-1">{SITE.type}</div>
        </div>
        <div className="bg-terminal-panel p-[16px_20px]">
          <div className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px] mb-1">Fleet Online</div>
          <div className="text-2xl font-bold text-terminal-text tabular-nums leading-none">{SITE.fleetOnline}<span className="text-[13px] font-medium text-terminal-muted ml-0.5"> / {SITE.fleetTotal}</span></div>
          <div className="text-[11px] font-semibold text-[#1a6b3c] mt-1">{SITE.utilization}% utilization</div>
        </div>
        <div className="bg-terminal-panel p-[16px_20px]">
          <div className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px] mb-1">Hashrate</div>
          <div className="text-2xl font-bold text-terminal-text tabular-nums leading-none">{SITE.hashrate}<span className="text-[13px] font-medium text-terminal-muted ml-0.5"> PH/s</span></div>
          <div className="text-[11px] text-terminal-muted mt-1">Target: {SITE.hashrateTarget} PH/s</div>
        </div>
        <div className="bg-terminal-panel p-[16px_20px]">
          <div className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px] mb-1">Energy Cost</div>
          <div className="text-2xl font-bold text-terminal-text tabular-nums leading-none">${SITE.energyCost}<span className="text-[13px] font-medium text-terminal-muted ml-0.5"> /MWh</span></div>
          <div className="text-[11px] font-semibold text-[#1a6b3c] mt-1">{SITE.energyNote}</div>
        </div>
        <div className="bg-terminal-panel p-[16px_20px]" style={{ background: 'linear-gradient(135deg, var(--t-panel), #fdf6e8)' }}>
          <div className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px] mb-1">Hashprice</div>
          <div className="text-2xl font-bold text-terminal-text tabular-nums leading-none">${SITE.hashprice}<span className="text-[13px] font-medium text-terminal-muted ml-0.5"> /PH/day</span></div>
          <div className="text-[11px] font-semibold text-[#b8860b] mt-1">Breakeven: ${SITE.breakeven}</div>
        </div>
        <div className="bg-terminal-panel p-[16px_20px]">
          <div className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px] mb-1">Net Revenue</div>
          <div className="text-2xl font-bold text-[#1a6b3c] tabular-nums leading-none">${SITE.netRevHr}<span className="text-[13px] font-medium text-terminal-muted ml-0.5"> /hr</span></div>
          <div className="text-[11px] font-semibold text-[#1a6b3c] mt-1">+${SITE.netRevToday.toLocaleString()} today</div>
        </div>
      </div>

      {/* 24h Schedule + Breakeven Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Schedule */}
        <Card title="24-Hour Operating Schedule" meta="Today — Mar 7, 2026">
          <div className="grid grid-cols-24 gap-[2px] p-[18px]" style={{ gridTemplateColumns: 'repeat(24, 1fr)' }}>
            {SCHEDULE_HOURS.map((h, i) => (
              <div
                key={i}
                className={`aspect-square rounded-[4px] cursor-pointer hover:scale-[1.3] hover:z-10 transition-transform ${HOUR_COLORS[h]}`}
              />
            ))}
          </div>
          <div className="grid gap-[2px] px-[18px] pb-3" style={{ gridTemplateColumns: 'repeat(24, 1fr)' }}>
            {Array.from({ length: 24 }, (_, i) => (
              <div key={i} className="text-[8px] font-semibold text-[#c5c5bc] text-center font-mono">
                {String(i).padStart(2, '0')}
              </div>
            ))}
          </div>
          <div className="flex gap-4 px-[18px] pb-4 text-[11px] text-terminal-muted">
            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-[3px] bg-[#2dd478]" /> Highly profitable</div>
            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-[3px] bg-[#a3d9a5]" /> Marginal</div>
            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-[3px] bg-[#1a6b3c] opacity-85" /> Mining</div>
            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-[3px] bg-[#b8860b] opacity-70" /> Curtailed</div>
          </div>
        </Card>

        {/* Breakeven Analysis */}
        <Card title="Breakeven Analysis" meta="Live">
          <div className="p-[18px]">
            {BREAKEVEN.map((item, i) => (
              <KVRow key={i} label={item.label} value={item.value} cls={item.cls} last={i === BREAKEVEN.length - 1} />
            ))}
          </div>
        </Card>
      </div>

      {/* Fleet + Event Log */}
      <div className="grid grid-cols-1 lg:grid-cols-[5fr_3fr] gap-4 mb-4">
        {/* Fleet Table */}
        <Card title="Worker Fleet" meta="960 machines · 4 models">
          {/* Header */}
          <div className="grid items-center gap-2 px-[18px] py-[10px] text-[10px] font-bold text-terminal-muted uppercase tracking-[0.8px] border-b border-terminal-border"
            style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 80px' }}>
            <div>Model</div><div>Count</div><div>Online</div><div>Hashrate</div><div>Efficiency</div><div>Breakeven</div><div>Status</div>
          </div>
          {/* Rows */}
          {FLEET.map((m, i) => {
            const tag = STATUS_TAGS[m.status];
            return (
              <div key={i}
                className="grid items-center gap-2 px-[18px] py-3 border-b border-[#f0eeea] last:border-b-0 hover:bg-[#f5f4f0] transition-colors text-[13px]"
                style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr 80px' }}>
                <div className="font-semibold text-terminal-text flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT_COLORS[m.dotClass]}`} />
                  {m.model}
                </div>
                <div className="font-mono text-xs text-terminal-text tabular-nums">{m.count}</div>
                <div className={`font-mono text-xs tabular-nums ${m.beClass === 'danger' ? 'text-terminal-muted' : m.online < m.count * 0.9 ? 'text-[#b8860b]' : 'text-[#1a6b3c]'}`}>{m.online}</div>
                <div className="font-mono text-xs text-terminal-text tabular-nums">{m.hashrate}</div>
                <div className="font-mono text-xs text-terminal-text tabular-nums">{m.efficiency}</div>
                <div className={`font-mono text-xs tabular-nums ${VAL_CLS[m.beClass]}`}>{m.breakeven}</div>
                <div>
                  <span className={`text-[10px] font-semibold px-2.5 py-[3px] rounded-md uppercase tracking-[0.3px] ${tag.bg} ${tag.text}`}>
                    {tag.label}
                  </span>
                </div>
              </div>
            );
          })}
        </Card>

        {/* Event Log */}
        <Card title="Curtailment Log" meta="Today">
          {EVENTS.map((ev, i) => (
            <div key={i} className="flex items-start gap-3 px-[18px] py-3 border-b border-[#f0eeea] last:border-b-0 hover:bg-[#f5f4f0] transition-colors">
              <div className="font-mono text-[11px] font-medium text-terminal-muted min-w-[40px] shrink-0 mt-0.5 tabular-nums">{ev.time}</div>
              <div className={`w-1 h-1 rounded-full mt-[7px] shrink-0 ${EV_DOTS[ev.type]}`} />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-terminal-text leading-[1.4]">{ev.title}</div>
                <div className="text-[11px] text-terminal-muted mt-0.5">{ev.sub}</div>
              </div>
            </div>
          ))}
        </Card>
      </div>

      {/* Bottom stats: Savings + Energy + Agent Config */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card title="Curtailment Savings" meta="30-day">
          {SAVINGS.map((item, i) => (
            <KVRow key={i} label={item.label} value={item.value} cls={item.cls} last={i === SAVINGS.length - 1} />
          ))}
        </Card>

        <Card title="Energy" meta="Current">
          {ENERGY.map((item, i) => (
            <KVRow key={i} label={item.label} value={item.value} cls={item.cls} last={i === ENERGY.length - 1} />
          ))}
        </Card>

        <Card title="Agent Config" meta="Curtailment Engine">
          {AGENT_CONFIG.map((item, i) => (
            <KVRow key={i} label={item.label} value={item.value} cls={item.cls} last={i === AGENT_CONFIG.length - 1} />
          ))}
        </Card>
      </div>
    </div>
  );
}

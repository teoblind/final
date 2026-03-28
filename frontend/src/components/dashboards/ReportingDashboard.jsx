import React, { useState } from 'react';

// ─── Data ───────────────────────────────────────────────────────────────────

const TEMPLATES = [
  {
    id: 'daily-ops',
    name: 'Daily Operations Summary',
    desc: 'Fleet performance, hashrate, revenue, curtailment events, and agent actions for the past 24 hours.',
    freq: 'Daily',
    freqCls: 'bg-[#edf7f0] text-[#1a6b3c]',
    iconCls: 'bg-[#edf7f0]',
    iconColor: '#1a6b3c',
    dotCls: 'bg-[#1a6b3c]',
    sections: ['Fleet Status', 'Revenue', 'Curtailment', 'Pool Earnings', 'Agent Activity'],
  },
  {
    id: 'investor',
    name: 'Investor Update',
    desc: 'Monthly performance report for LPs and investors. Includes P&L, fleet utilization, market conditions, and forward outlook.',
    freq: 'Monthly',
    freqCls: 'bg-[#f3f0ff] text-[#7c3aed]',
    iconCls: 'bg-[#eff6ff]',
    iconColor: '#2563eb',
    dotCls: 'bg-[#2563eb]',
    sections: ['Executive Summary', 'P&L', 'Fleet Utilization', 'Market Outlook', 'Hashprice Forecast'],
  },
  {
    id: 'exec',
    name: 'Executive Briefing',
    desc: 'High-level KPIs and strategic insights for leadership. Trends, risks, and recommendations in under 2 minutes.',
    freq: 'Weekly',
    freqCls: 'bg-[#eff6ff] text-[#2563eb]',
    iconCls: 'bg-[#f3f0ff]',
    iconColor: '#7c3aed',
    dotCls: 'bg-[#7c3aed]',
    sections: ['KPI Snapshot', 'Trend Analysis', 'Risk Flags', 'Recommendations'],
  },
  {
    id: 'custom',
    name: 'Custom Report',
    desc: 'Build a custom report by selecting sections, date range, and sites. Export as PDF or Google Doc.',
    freq: 'On Demand',
    freqCls: 'bg-[#f5f4f0] text-[#9a9a92]',
    iconCls: 'bg-[#fdf6e8]',
    iconColor: '#b8860b',
    dotCls: 'bg-[#b8860b]',
    sections: ['Configurable', 'Multi-site', 'PDF / Doc Export'],
  },
];

const RECENT_REPORTS = [
  { name: 'Daily Ops - Mar 7', type: 'daily-ops', generated: '06:00 CST', pages: 3, status: 'delivered' },
  { name: 'Daily Ops - Mar 6', type: 'daily-ops', generated: '06:00 CST', pages: 3, status: 'delivered' },
  { name: 'Weekly Briefing - W10', type: 'exec', generated: 'Mar 3, 08:00', pages: 2, status: 'delivered' },
  { name: 'February Investor Update', type: 'investor', generated: 'Mar 1, 09:00', pages: 8, status: 'delivered' },
  { name: 'Oberon Site Deep Dive', type: 'custom', generated: 'Feb 28, 14:30', pages: 5, status: 'delivered' },
  { name: 'Daily Ops - Mar 5', type: 'daily-ops', generated: '06:00 CST', pages: 3, status: 'delivered' },
  { name: 'Weekly Briefing - W9', type: 'exec', generated: 'Feb 24, 08:00', pages: 2, status: 'delivered' },
];

const SCHEDULES = [
  { name: 'Daily Operations', freq: 'Daily', next: 'Mar 8, 06:00', recipients: 'Spencer, Marcel', format: 'Telegram', active: true },
  { name: 'Weekly Briefing', freq: 'Monday', next: 'Mar 10, 08:00', recipients: 'Spencer, Mihir', format: 'PDF + Email', active: true },
  { name: 'Investor Update', freq: 'Monthly', next: 'Apr 1, 09:00', recipients: 'LP Distribution', format: 'PDF + Email', active: true },
  { name: 'Pool Fee Analysis', freq: 'Quarterly', next: 'Apr 1, 10:00', recipients: 'Spencer', format: 'Dashboard', active: true },
];

const ENGINE_CONFIG = [
  { k: 'Mode', v: 'Autonomous', cls: 'accent' },
  { k: 'Data Sources', v: 'Fleet, Pool, ERCOT, Agents', cls: 'sans' },
  { k: 'Generation Model', v: 'Sonnet 4.6', cls: 'sans' },
  { k: 'Avg Generation Time', v: '42 sec', cls: '' },
  { k: 'Avg API Cost per Report', v: '$0.08', cls: 'green' },
  { k: 'Reports Generated (30D)', v: '38', cls: '' },
  { k: 'Delivery Channel', v: 'Telegram + Email', cls: 'sans' },
  { k: 'Timezone', v: 'CST (UTC-6)', cls: 'sans' },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

const DOT_MAP = {
  'daily-ops': 'bg-[#1a6b3c]',
  investor: 'bg-[#2563eb]',
  exec: 'bg-[#7c3aed]',
  custom: 'bg-[#b8860b]',
};

const STATUS_CLS = {
  delivered: 'bg-[#edf7f0] text-[#1a6b3c]',
  pending: 'bg-[#fdf6e8] text-[#b8860b]',
  draft: 'bg-[#f5f4f0] text-[#9a9a92]',
  failed: 'bg-[#fbeae8] text-[#c0392b]',
};

function Card({ title, meta, children }) {
  return (
    <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
      <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
        <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">{title}</span>
        {meta && <span className="text-[11px] text-terminal-muted">{meta}</span>}
      </div>
      {children}
    </div>
  );
}

function KVRow({ label, value, cls = '' }) {
  const valStyle = {
    accent: 'font-sans text-[#1a6b3c]',
    green: 'text-[#1a6b3c]',
    warn: 'text-[#b8860b]',
    sans: 'font-sans text-terminal-text',
    '': 'text-terminal-text',
  }[cls] || 'text-terminal-text';
  return (
    <div className="flex items-center justify-between px-[18px] py-[10px] border-b border-[#f0eeea] last:border-b-0 text-[13px]">
      <span className="text-[#6b6b65]">{label}</span>
      <span className={`font-semibold tabular-nums font-mono text-xs ${valStyle}`}>{value}</span>
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ReportingDashboard() {
  const [selectedTemplate, setSelectedTemplate] = useState('daily-ops');

  return (
    <div className="p-6 lg:px-7 lg:py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <span className="text-[9px] font-bold text-[#2563eb] bg-[#eff6ff] px-[10px] py-[3px] rounded-full uppercase tracking-[0.5px]">
            4 Scheduled
          </span>
        </div>
        <button onClick={() => alert('Generating report from selected template...')} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-terminal-green text-white border border-terminal-green hover:opacity-90 transition-all">
          Generate Report
        </button>
      </div>

      {/* Templates */}
      <Card title="Report Templates" meta="4 configured">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 p-[18px]">
          {TEMPLATES.map(t => (
            <div
              key={t.id}
              onClick={() => setSelectedTemplate(t.id)}
              className={`border-[1.5px] rounded-xl p-4 cursor-pointer transition-all ${
                selectedTemplate === t.id
                  ? 'border-[#1a6b3c] bg-[#edf7f0]/40'
                  : 'border-terminal-border hover:border-[#1a6b3c] hover:bg-[#edf7f0]/20'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${t.iconCls}`}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill={t.iconColor}>
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                  </svg>
                </div>
                <span className={`text-[9px] font-bold px-2 py-[2px] rounded-[5px] uppercase tracking-[0.5px] ${t.freqCls}`}>
                  {t.freq}
                </span>
              </div>
              <div className="text-sm font-semibold text-terminal-text mb-1">{t.name}</div>
              <div className="text-xs text-terminal-muted leading-relaxed">{t.desc}</div>
              <div className="flex flex-wrap gap-1 mt-2.5">
                {t.sections.map(s => (
                  <span key={s} className="text-[10px] font-medium px-2 py-[2px] rounded-[5px] bg-[#f5f4f0] text-[#6b6b65]">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="h-4" />

      {/* Recent Reports + Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-[5fr_3fr] gap-4 mb-4">
        {/* Recent Reports */}
        <Card title="Recent Reports" meta="Last 30 days">
          {/* Header */}
          <div
            className="grid px-[18px] py-[10px] text-[10px] font-bold text-terminal-muted uppercase tracking-[0.8px] border-b border-terminal-border"
            style={{ gridTemplateColumns: '3fr 1.5fr 1fr 1fr 100px' }}
          >
            <div>Report</div><div>Generated</div><div>Pages</div><div>Status</div><div />
          </div>
          {RECENT_REPORTS.map((r, i) => (
            <div
              key={i}
              className="grid px-[18px] py-[13px] border-b border-[#f0eeea] last:border-b-0 items-center text-[13px] hover:bg-[#f5f4f0] transition-colors cursor-pointer"
              style={{ gridTemplateColumns: '3fr 1.5fr 1fr 1fr 100px' }}
            >
              <div className="font-semibold text-terminal-text flex items-center gap-2">
                <div className={`w-2 h-2 rounded-[3px] shrink-0 ${DOT_MAP[r.type]}`} />
                {r.name}
              </div>
              <div className="font-mono text-xs text-terminal-text tabular-nums">{r.generated}</div>
              <div className="font-mono text-xs text-terminal-muted tabular-nums">{r.pages}</div>
              <div>
                <span className={`text-[10px] font-semibold px-[9px] py-[3px] rounded-md uppercase tracking-[0.3px] ${STATUS_CLS[r.status]}`}>
                  {r.status}
                </span>
              </div>
              <div>
                <span onClick={(e) => { e.stopPropagation(); alert(`Viewing report: ${r.name}`); }} className="text-[11px] font-semibold text-[#1a6b3c] hover:opacity-70 transition-opacity cursor-pointer">View</span>
              </div>
            </div>
          ))}
        </Card>

        {/* Preview */}
        <Card title="Preview - Daily Ops, Mar 7" meta={
          <div className="flex items-center gap-2">
            <span onClick={() => alert('Exporting PDF...')} className="text-[11px] font-semibold text-[#1a6b3c] cursor-pointer hover:opacity-70">Export PDF</span>
            <span className="text-[#c5c5bc]">|</span>
            <span onClick={() => alert('Report sent to team.')} className="text-[11px] font-semibold text-[#1a6b3c] cursor-pointer hover:opacity-70">Send to Team</span>
          </div>
        }>
          <div className="p-[18px]">
            <div className="bg-[#f5f4f0] border border-[#f0eeea] rounded-[10px] p-6 max-h-[460px] overflow-y-auto">
              {/* Header */}
              <div className="mb-5 pb-4 border-b border-[#f0eeea]">
                <div className="text-[10px] font-bold text-terminal-muted tracking-[2px] uppercase mb-3">Coppice - Sangha Renewables</div>
                <div className="font-serif text-xl text-terminal-text mb-1">Daily Operations Report</div>
                <div className="text-xs text-terminal-muted">March 7, 2026 - Oberon Solar, ERCOT West - Auto-generated at 06:00 CST</div>
              </div>

              {/* Fleet Overview */}
              <div className="mb-5">
                <div className="text-[11px] font-bold text-[#6b6b65] tracking-[0.8px] uppercase mb-2.5 pb-1.5 border-b border-[#f0eeea]">Fleet Overview</div>
                <div className="flex gap-3">
                  {[
                    { label: 'Machines Online', val: '847 / 960', sub: '88.2% utilization' },
                    { label: 'Hashrate', val: '72.4 PH/s', sub: 'Target: 82.1' },
                    { label: 'Net Revenue', val: '$11,688', sub: '+4.2% vs 7D avg', valCls: 'text-[#1a6b3c]' },
                  ].map(m => (
                    <div key={m.label} className="flex-1 bg-white border border-[#f0eeea] rounded-lg p-[10px_12px]">
                      <div className="text-[9px] font-bold text-terminal-muted tracking-[0.8px] uppercase mb-[3px]">{m.label}</div>
                      <div className={`font-mono text-base font-bold ${m.valCls || 'text-terminal-text'}`}>{m.val}</div>
                      <div className="text-[10px] text-terminal-muted mt-[2px]">{m.sub}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Earnings by Model */}
              <div className="mb-5">
                <div className="text-[11px] font-bold text-[#6b6b65] tracking-[0.8px] uppercase mb-2.5 pb-1.5 border-b border-[#f0eeea]">Earnings by Model</div>
                <table className="w-full border-collapse mb-2">
                  <thead>
                    <tr>
                      {['Model', 'Count', 'Hashrate', 'Revenue', 'Margin'].map(h => (
                        <th key={h} className="text-[9px] font-bold text-terminal-muted tracking-[0.5px] uppercase text-left px-2 py-[6px] border-b border-[#f0eeea]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { model: 'S19 XP', count: 318, hash: '44.5 PH/s', rev: '$5,280', margin: '+24.1%', cls: 'text-[#1a6b3c]' },
                      { model: 'S19k Pro', count: 277, hash: '33.2 PH/s', rev: '$3,840', margin: '+16.8%', cls: 'text-[#1a6b3c]' },
                      { model: 'S19j Pro', count: 172, hash: '17.9 PH/s', rev: '$1,920', margin: '+6.4%', cls: 'text-[#b8860b]' },
                      { model: 'S19', count: 80, hash: '7.6 PH/s', rev: '$648', margin: '-7.6%', cls: 'text-[#c0392b]' },
                    ].map(r => (
                      <tr key={r.model}>
                        <td className="text-xs font-medium text-terminal-text px-2 py-[7px] border-b border-[#f0eeea]">{r.model}</td>
                        <td className="font-mono text-xs text-terminal-text px-2 py-[7px] border-b border-[#f0eeea] tabular-nums">{r.count}</td>
                        <td className="font-mono text-xs text-terminal-text px-2 py-[7px] border-b border-[#f0eeea] tabular-nums">{r.hash}</td>
                        <td className="font-mono text-xs text-terminal-text px-2 py-[7px] border-b border-[#f0eeea] tabular-nums">{r.rev}</td>
                        <td className={`font-mono text-xs px-2 py-[7px] border-b border-[#f0eeea] tabular-nums ${r.cls}`}>{r.margin}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Curtailment Summary */}
              <div className="mb-5">
                <div className="text-[11px] font-bold text-[#6b6b65] tracking-[0.8px] uppercase mb-2.5 pb-1.5 border-b border-[#f0eeea]">Curtailment Summary</div>
                <div className="text-xs text-[#6b6b65] leading-relaxed p-[10px_12px] bg-white border-l-[3px] border-l-[#1a6b3c] rounded-r-lg">
                  2 curtailment events triggered. 108 machines affected during peak hours (13:00–16:00). Total savings from curtailment: $412. Demand response signal detected at 14:12 - fleet responded within 3 minutes. S19 fleet remained curtailed through end of day due to negative margin.
                </div>
              </div>

              {/* Agent Actions */}
              <div className="mb-2">
                <div className="text-[11px] font-bold text-[#6b6b65] tracking-[0.8px] uppercase mb-2.5 pb-1.5 border-b border-[#f0eeea]">Agent Actions</div>
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      {['Agent', 'Actions', 'Notable'].map(h => (
                        <th key={h} className="text-[9px] font-bold text-terminal-muted tracking-[0.5px] uppercase text-left px-2 py-[6px] border-b border-[#f0eeea]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { agent: 'Curtailment', actions: 2, note: 'Demand response auto-curtail + S19 peel' },
                      { agent: 'Lead Engine', actions: 34, note: '12 PJM leads discovered, 8 emails sent' },
                      { agent: 'Meeting Bot', actions: 1, note: 'Reassurity call transcribed, 4 action items' },
                      { agent: 'Pool Routing', actions: 0, note: 'No action - quarterly review next week' },
                    ].map(r => (
                      <tr key={r.agent}>
                        <td className="text-xs font-medium text-terminal-text px-2 py-[7px] border-b border-[#f0eeea] last:border-b-0">{r.agent}</td>
                        <td className="font-mono text-xs text-terminal-text px-2 py-[7px] border-b border-[#f0eeea] tabular-nums">{r.actions}</td>
                        <td className="text-xs text-terminal-text px-2 py-[7px] border-b border-[#f0eeea]">{r.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Schedule + Config */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* Delivery Schedule */}
        <Card title="Delivery Schedule" meta="4 active">
          <div
            className="grid px-[18px] py-[10px] text-[10px] font-bold text-terminal-muted uppercase tracking-[0.8px] border-b border-terminal-border"
            style={{ gridTemplateColumns: '2.5fr 1fr 1.5fr 1.5fr 1fr 80px' }}
          >
            <div>Report</div><div>Frequency</div><div>Next Delivery</div><div>Recipients</div><div>Format</div><div>Active</div>
          </div>
          {SCHEDULES.map((s, i) => (
            <div
              key={i}
              className="grid px-[18px] py-3 border-b border-[#f0eeea] last:border-b-0 items-center text-[13px] hover:bg-[#f5f4f0] transition-colors"
              style={{ gridTemplateColumns: '2.5fr 1fr 1.5fr 1.5fr 1fr 80px' }}
            >
              <div className="font-semibold text-terminal-text">{s.name}</div>
              <div className="text-xs text-[#6b6b65]">{s.freq}</div>
              <div className="font-mono text-xs text-terminal-text tabular-nums">{s.next}</div>
              <div className="text-xs text-[#6b6b65]">{s.recipients}</div>
              <div className="text-xs text-[#6b6b65]">{s.format}</div>
              <div>
                <div className={`w-9 h-5 rounded-[10px] relative cursor-pointer transition-colors ${s.active ? 'bg-[#1a6b3c]' : 'bg-[#c5c5bc]'}`}>
                  <div
                    className="absolute top-[2px] w-4 h-4 rounded-full bg-white shadow-sm transition-all"
                    style={{ left: s.active ? '18px' : '2px' }}
                  />
                </div>
              </div>
            </div>
          ))}
        </Card>

        {/* Engine Config */}
        <Card title="Engine Configuration" meta="Reporting Agent">
          {ENGINE_CONFIG.map((item, i) => (
            <KVRow key={i} label={item.k} value={item.v} cls={item.cls} />
          ))}
        </Card>
      </div>
    </div>
  );
}

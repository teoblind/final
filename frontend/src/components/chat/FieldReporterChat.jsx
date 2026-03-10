import React, { useState } from 'react';

// ─── Simple markdown-like formatting ────────────────────────────────────────────
function formatContent(text) {
  if (!text) return null;
  return text.split('\n').map((line, i) => {
    const parts = line.split(/(\*\*.*?\*\*)/g).map((part, j) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={j} className="font-semibold">{part.slice(2, -2)}</strong>;
      }
      return part;
    });
    return <span key={i}>{parts}{i < text.split('\n').length - 1 && <br />}</span>;
  });
}

// ─── Constants ──────────────────────────────────────────────────────────────────
const ACCENT = '#1e3a5f';

const DEMO_MESSAGES = [
  {
    id: 1,
    role: 'alert',
    alert: {
      title: 'Field Anomaly Detected',
      subtitle: 'Job J-009 Westpark Retail',
      body: 'Rebar usage tracking 18% over estimate. 2,400 LF of #4 rebar used vs 2,000 LF estimated. Projected overrun: $4,200.',
    },
    actions: [
      { label: 'Review Job Detail', variant: 'primary' },
      { label: 'Acknowledge', variant: 'secondary' },
    ],
    time: '8:45 AM',
  },
  {
    id: 2,
    role: 'agent',
    content: 'Carlos Mendez submitted today\'s field log for Westpark Retail: 52 CY poured (slab section C), 6 finishers on site, weather clear. No incidents reported. Rebar placement on track for section D tomorrow.',
    time: '9:02 AM',
  },
  {
    id: 3,
    role: 'user',
    content: 'How much concrete have we poured total on Westpark?',
    time: '9:15 AM',
  },
  {
    id: 4,
    role: 'agent',
    content: 'Total concrete poured on Westpark Retail (J-009): **312 CY** out of **780 CY** estimated. 40% complete, matching schedule. Running at **$152/CY** actual vs **$158/CY** estimated — currently $6/CY under budget on concrete.\n\nAt current pace (avg 48 CY/day), remaining 468 CY will take approximately 10 working days.',
    time: '9:15 AM',
  },
  {
    id: 5,
    role: 'user',
    content: 'What about St. Luke\'s? Any issues?',
    time: '9:22 AM',
  },
  {
    id: 6,
    role: 'agent',
    content: 'St. Luke\'s Parking (J-010) is at **20% complete**. Pier drilling starts next week. Geotech flags potential rock at 22\' — this could require rock auger attachment and add $8,500-$12,000 to drilling costs.\n\nI recommend requesting a supplemental geotech boring before mobilizing the drill rig. Want me to flag this as a potential change order?',
    time: '9:22 AM',
    actions: [
      { label: 'Flag Change Order', variant: 'primary' },
      { label: 'Note Only', variant: 'secondary' },
    ],
  },
];

const ACTIVE_JOBS = [
  {
    id: 'J-009',
    name: 'Westpark Retail',
    gc: 'Turner Construction',
    progress: 40,
    budget: { spent: '$118K', total: '$264K' },
    rebar: { used: '2,400 LF', est: '2,000 LF', flag: true },
    crew: 6,
    status: 'active',
  },
  {
    id: 'J-010',
    name: 'St. Luke\'s Parking',
    gc: 'DPR Construction',
    progress: 20,
    status: 'active',
  },
  {
    id: 'J-011',
    name: 'Samsung Fab Foundation',
    gc: 'Hensel Phelps',
    progress: 5,
    status: 'mobilizing',
  },
];

const REPORT_ITEMS = [
  { id: 1, job: 'Westpark Retail', title: 'Daily Log', date: 'Today', badges: ['Normal'], selected: true },
  { id: 2, job: 'Westpark Retail', title: 'Rebar Usage Flag', date: 'Today', badges: ['Anomaly'] },
  { id: 3, job: 'Westpark Retail', title: 'Daily Log', date: 'Yesterday', badges: ['Normal'] },
  { id: 4, job: 'Frisco Station', title: 'Rock Encounter Flag', date: '2 days ago', badges: ['Anomaly', 'Change Order'] },
  { id: 5, job: 'St. Luke\'s Parking', title: 'Mobilization Report', date: '3 days ago', badges: ['Normal'] },
  { id: 6, job: 'Westpark Retail', title: 'Daily Log', date: '3 days ago', badges: ['Weather'] },
];

const HISTORY_DATA = [
  { date: 'Mar 9', job: 'Westpark Retail', type: 'Daily Log', status: 'Normal', impact: '—' },
  { date: 'Mar 9', job: 'Westpark Retail', type: 'Anomaly', status: 'Flagged', impact: '+$4,200 rebar' },
  { date: 'Mar 8', job: 'Westpark Retail', type: 'Daily Log', status: 'Normal', impact: '—' },
  { date: 'Mar 7', job: 'Frisco Station', type: 'Anomaly', status: 'Change Order', impact: '+$11,200 drilling' },
  { date: 'Mar 6', job: 'St. Luke\'s Parking', type: 'Mobilization', status: 'Normal', impact: '—' },
  { date: 'Mar 6', job: 'Westpark Retail', type: 'Daily Log', status: 'Weather Delay', impact: '-1 day schedule' },
];

const COST_TRACKING = [
  { item: 'Concrete', budgeted: '$123,240', actual: '$47,424', variance: '-$75,816', varianceColor: '#1a6b3c', note: 'Under (40% complete)' },
  { item: 'Rebar', budgeted: '$28,310', actual: '$12,840', variance: '+$4,200', varianceColor: '#c0392b', note: '18% over rate' },
  { item: 'Labor Hours', budgeted: '3,200 hrs', actual: '1,240 hrs', variance: 'On track', varianceColor: '#1a6b3c', note: '39% used' },
  { item: 'Mob/Demob', budgeted: '$3,500', actual: '$3,500', variance: '$0', varianceColor: '#6b6b65', note: 'Complete' },
];

// ─── Sub-Components ─────────────────────────────────────────────────────────────

function FieldAlertCard({ alert, actions }) {
  return (
    <div className="bg-[#fdf6e8] border border-[#e8d5a0] rounded-[14px] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#e8d5a0] flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-[#b8860b] animate-pulse" />
        <span className="text-[12px] font-bold text-[#7a5a00]">{alert.title}</span>
      </div>
      <div className="px-4 py-3">
        <div className="text-[11px] font-semibold text-[#b8860b] mb-1">{alert.subtitle}</div>
        <div className="text-[12px] text-[#333330] leading-[1.6]">{alert.body}</div>
      </div>
      {actions?.length > 0 && (
        <div className="px-4 pb-3 flex gap-1.5">
          {actions.map((a, i) => (
            <button
              key={i}
              onClick={() => alert(`${a.label} action acknowledged.`)}
              className={`px-3.5 py-[6px] rounded-lg text-[11px] font-semibold transition-colors ${
                a.variant === 'primary'
                  ? 'text-white'
                  : 'bg-white text-[#6b6b65] border-[1.5px] border-[#e8e6e1] hover:bg-[#f5f4f0]'
              }`}
              style={a.variant === 'primary' ? { backgroundColor: ACCENT } : undefined}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ChatMessage({ msg }) {
  if (msg.role === 'alert') {
    return (
      <div className="self-start max-w-[85%]">
        <FieldAlertCard alert={msg.alert} actions={msg.actions} />
      </div>
    );
  }

  const isUser = msg.role === 'user';

  return (
    <div className={`flex gap-2.5 max-w-[85%] ${isUser ? 'self-end flex-row-reverse' : 'self-start'}`}>
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold text-white shrink-0 mt-0.5"
        style={{ backgroundColor: isUser ? '#6b6b65' : '#1e3a5f' }}
      >
        {isUser ? 'A' : 'F'}
      </div>
      <div className="min-w-0">
        <div className={`flex items-center gap-2 mb-1 ${isUser ? 'flex-row-reverse' : ''}`}>
          <span className="text-[11px] font-semibold text-[#6b6b65]">{isUser ? 'Admin' : 'Field Reporter'}</span>
          <span className="text-[10px] text-[#c5c5bc] font-mono">{msg.time}</span>
        </div>
        {msg.content && (
          <div
            className={`px-4 py-3 text-[13px] leading-[1.6] ${
              isUser
                ? 'text-white rounded-[14px] rounded-tr-[4px]'
                : 'bg-terminal-panel border border-[#e8e6e1] text-[#333330] rounded-[14px] rounded-tl-[4px]'
            }`}
            style={isUser ? { backgroundColor: ACCENT } : undefined}
          >
            {formatContent(msg.content)}
          </div>
        )}
        {msg.actions && (
          <div className="flex gap-1.5 mt-2.5">
            {msg.actions.map((a, i) => (
              <button
                key={i}
                className={`px-3.5 py-[6px] rounded-lg text-[11px] font-semibold transition-colors ${
                  a.variant === 'primary'
                    ? 'text-white'
                    : 'bg-terminal-panel text-[#6b6b65] border-[1.5px] border-[#e8e6e1] hover:bg-[#f5f4f0]'
                }`}
                style={a.variant === 'primary' ? { backgroundColor: ACCENT } : undefined}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressBar({ percent, color = '#1e3a5f' }) {
  return (
    <div className="w-full h-1.5 rounded-full bg-[#e8e6e1] overflow-hidden">
      <div className="h-full rounded-full transition-all" style={{ width: `${percent}%`, backgroundColor: color }} />
    </div>
  );
}

function ContextPanel() {
  return (
    <div className="h-full overflow-y-auto">
      {/* Active Jobs */}
      <div className="border-b border-[#f0eeea]">
        <div className="px-4 py-3 flex items-center justify-between">
          <span className="text-[11px] font-bold text-[#6b6b65] uppercase tracking-[0.8px]">Active Jobs</span>
          <span className="text-[10px] text-[#c5c5bc]">3 jobs</span>
        </div>
        <div className="px-4 pb-3.5 space-y-2.5">
          {/* Westpark Retail */}
          <div className="p-3 bg-terminal-panel border border-[#f0eeea] rounded-lg">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[12px] font-semibold text-terminal-text">Westpark Retail</span>
              <span className="text-[9px] font-bold px-2 py-[2px] rounded-[5px] bg-[#edf7f0] text-[#1a6b3c]">J-009</span>
            </div>
            <div className="text-[10px] text-[#9a9a92] mb-2">Turner Construction</div>
            <div className="flex items-center gap-2 mb-2">
              <ProgressBar percent={40} color="#1e3a5f" />
              <span className="text-[10px] font-mono font-semibold text-[#6b6b65] shrink-0">40%</span>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-[#9a9a92]">Budget</span>
                <span className="font-mono text-terminal-text">$118K / $264K</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[#9a9a92]">Rebar</span>
                <span className="font-mono text-[#c0392b] font-semibold">2,400 / 2,000 LF</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[#9a9a92]">Crew today</span>
                <span className="font-mono text-terminal-text">6 finishers</span>
              </div>
            </div>
          </div>

          {/* St. Luke's */}
          <div className="p-3 bg-terminal-panel border border-[#f0eeea] rounded-lg">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[12px] font-semibold text-terminal-text">St. Luke's Parking</span>
              <span className="text-[9px] font-bold px-2 py-[2px] rounded-[5px] bg-[#eef3f9] text-[#1e3a5f]">J-010</span>
            </div>
            <div className="text-[10px] text-[#9a9a92] mb-2">DPR Construction</div>
            <div className="flex items-center gap-2 mb-1">
              <ProgressBar percent={20} color="#1e3a5f" />
              <span className="text-[10px] font-mono font-semibold text-[#6b6b65] shrink-0">20%</span>
            </div>
            <div className="text-[10px] text-[#b8860b] mt-1">Geotech flag — rock at 22'</div>
          </div>

          {/* Samsung */}
          <div className="p-3 bg-terminal-panel border border-[#f0eeea] rounded-lg">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[12px] font-semibold text-terminal-text">Samsung Fab Foundation</span>
              <span className="text-[9px] font-bold px-2 py-[2px] rounded-[5px] bg-[#fdf6e8] text-[#b8860b]">J-011</span>
            </div>
            <div className="text-[10px] text-[#9a9a92] mb-2">Hensel Phelps</div>
            <div className="flex items-center gap-2">
              <ProgressBar percent={5} color="#b8860b" />
              <span className="text-[10px] font-mono font-semibold text-[#6b6b65] shrink-0">5%</span>
            </div>
            <div className="text-[10px] text-[#9a9a92] mt-1">Mobilizing</div>
          </div>
        </div>
      </div>

      {/* Today's Submissions */}
      <div className="border-b border-[#f0eeea]">
        <div className="px-4 py-3 flex items-center justify-between">
          <span className="text-[11px] font-bold text-[#6b6b65] uppercase tracking-[0.8px]">Today's Submissions</span>
          <span className="text-[10px] text-[#c5c5bc]">2 logs</span>
        </div>
        <div className="px-4 pb-3.5 space-y-2">
          <div className="p-2.5 bg-terminal-panel border border-[#f0eeea] rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-terminal-text">Carlos Mendez</span>
              <span className="text-[10px] text-[#9a9a92]">9:02 AM</span>
            </div>
            <div className="text-[10px] text-[#9a9a92] mt-0.5">Westpark Retail — Daily log</div>
          </div>
          <div className="p-2.5 bg-terminal-panel border border-[#f0eeea] rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-terminal-text">Miguel Torres</span>
              <span className="text-[10px] text-[#9a9a92]">8:30 AM</span>
            </div>
            <div className="text-[10px] text-[#9a9a92] mt-0.5">St. Luke's Parking — Site prep</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Reports Tab ────────────────────────────────────────────────────────────────

function ReportsTab() {
  const [filter, setFilter] = useState('All');
  const [selectedId, setSelectedId] = useState(1);
  const filters = ['All', 'Flags', 'Westpark', "St. Luke's"];

  const badgeColor = (badge) => {
    if (badge === 'Anomaly') return 'bg-[#fbeae8] text-[#c0392b]';
    if (badge === 'Change Order') return 'bg-[#fdf6e8] text-[#b8860b]';
    if (badge === 'Weather') return 'bg-blue-50 text-blue-700';
    return 'bg-[#f5f4f0] text-[#6b6b65]';
  };

  const filtered = REPORT_ITEMS.filter(item => {
    if (filter === 'All') return true;
    if (filter === 'Flags') return item.badges.some(b => b === 'Anomaly' || b === 'Change Order');
    if (filter === 'Westpark') return item.job === 'Westpark Retail';
    if (filter === "St. Luke's") return item.job === "St. Luke's Parking";
    return true;
  });

  return (
    <div className="flex flex-1 min-h-0">
      {/* List */}
      <div className="w-[380px] flex flex-col border-r border-terminal-border min-w-0 shrink-0">
        {/* Filters */}
        <div className="px-5 py-3 border-b border-terminal-border flex items-center gap-2 flex-wrap">
          {filters.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-semibold border transition-colors ${
                filter === f
                  ? 'text-white border-transparent'
                  : 'bg-terminal-panel text-[#9a9a92] border-terminal-border hover:bg-[#f5f4f0]'
              }`}
              style={filter === f ? { backgroundColor: ACCENT } : undefined}
            >
              {f}
            </button>
          ))}
        </div>
        {/* Items */}
        <div className="flex-1 overflow-y-auto">
          {filtered.map(item => (
            <div
              key={item.id}
              onClick={() => setSelectedId(item.id)}
              className={`px-5 py-3.5 border-b border-terminal-border cursor-pointer hover:bg-[#f5f4f0] transition-colors ${
                selectedId === item.id ? 'bg-[#f5f4f0]' : ''
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[13px] font-semibold text-terminal-text">{item.job}</span>
                <span className="text-[10px] text-[#9a9a92]">{item.date}</span>
              </div>
              <div className="text-[12px] text-[#6b6b65] mb-1.5">{item.title}</div>
              <div className="flex gap-1.5">
                {item.badges.map((b, i) => (
                  <span key={i} className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${badgeColor(b)}`}>{b}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detail */}
      <div className="flex-1 min-w-0 overflow-y-auto bg-[#f5f4f0] p-5">
        <div className="mb-4">
          <h3 className="text-[15px] font-semibold text-terminal-text">Westpark Retail — Daily Log</h3>
          <div className="text-[11px] text-[#9a9a92] mt-0.5">Submitted by Carlos Mendez at 9:02 AM</div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          {[
            { label: 'Concrete', value: '52 CY', icon: '&#9632;' },
            { label: 'Finishers', value: '6', icon: '&#9632;' },
            { label: 'Weather', value: 'Clear', icon: '&#9632;' },
            { label: 'Hours', value: '8 hrs', icon: '&#9632;' },
          ].map((s, i) => (
            <div key={i} className="bg-terminal-panel rounded-xl border border-terminal-border p-3 text-center">
              <div className="text-[18px] font-bold text-terminal-text">{s.value}</div>
              <div className="text-[10px] text-[#9a9a92] font-semibold uppercase tracking-wider mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Work Performed */}
        <div className="bg-terminal-panel border border-terminal-border rounded-xl p-4 mb-4">
          <div className="text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider mb-2">Work Performed</div>
          <div className="text-[12px] text-terminal-text leading-[1.7]">
            Poured slab section C — 52 CY of 4000 PSI concrete. 6 finishers on site for finishing and curing. Rebar placement for section D prepared and inspected. Pump truck arrived on time at 6:30 AM. No delays or incidents. Weather clear, 72F. Foreman notes: section C cure time started at 2:15 PM.
          </div>
        </div>

        {/* Job Cost Tracking */}
        <div className="bg-terminal-panel border border-terminal-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-terminal-border">
            <span className="text-[13px] font-semibold text-terminal-text">Job Cost Tracking — Westpark Retail</span>
          </div>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-terminal-border">
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Item</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Budgeted</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Actual</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Variance</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Note</th>
              </tr>
            </thead>
            <tbody>
              {COST_TRACKING.map((row, i) => (
                <tr key={i} className="border-b border-terminal-border/50 hover:bg-[#f5f4f0]">
                  <td className="px-4 py-2.5 font-semibold text-terminal-text">{row.item}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-[#6b6b65]">{row.budgeted}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-terminal-text">{row.actual}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold" style={{ color: row.varianceColor }}>{row.variance}</td>
                  <td className="px-4 py-2.5 text-right text-[#9a9a92]">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── History Tab ────────────────────────────────────────────────────────────────

function HistoryTab() {
  const statusBadge = (s) => {
    if (s === 'Normal') return 'bg-[#f5f4f0] text-[#6b6b65]';
    if (s === 'Flagged') return 'bg-[#fbeae8] text-[#c0392b]';
    if (s === 'Change Order') return 'bg-[#fdf6e8] text-[#b8860b]';
    if (s === 'Weather Delay') return 'bg-blue-50 text-blue-700';
    return 'bg-[#f5f4f0] text-[#6b6b65]';
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-terminal-border border-b border-terminal-border">
        {[
          { label: 'Total Reports', value: '127' },
          { label: 'Anomalies Flagged', value: '8' },
          { label: 'Change Orders', value: '3' },
          { label: 'Cost Overruns Caught', value: '$22.4K' },
        ].map((s, i) => (
          <div key={i} className="bg-terminal-panel px-5 py-4 text-center">
            <div className="text-[18px] font-bold text-terminal-text">{s.value}</div>
            <div className="text-[10px] text-[#9a9a92] font-semibold uppercase tracking-wider">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="px-5 py-4">
        <div className="text-[13px] font-semibold text-terminal-text mb-3">Recent Reports</div>
        <div className="bg-terminal-panel border border-terminal-border rounded-xl overflow-hidden">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-terminal-border">
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Date</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Job</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Type</th>
                <th className="text-center px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Status</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Impact</th>
              </tr>
            </thead>
            <tbody>
              {HISTORY_DATA.map((h, i) => (
                <tr key={i} className="border-b border-terminal-border/50 hover:bg-[#f5f4f0]">
                  <td className="px-4 py-2.5 text-[#9a9a92] font-mono">{h.date}</td>
                  <td className="px-4 py-2.5 font-semibold text-terminal-text">{h.job}</td>
                  <td className="px-4 py-2.5 text-[#6b6b65]">{h.type}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${statusBadge(h.status)}`}>{h.status}</span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-terminal-text">{h.impact}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Config Tab ─────────────────────────────────────────────────────────────────

function ConfigTab() {
  const [autonomous, setAutonomous] = useState(true);
  const [autoFlag, setAutoFlag] = useState(true);
  const [materialVariance, setMaterialVariance] = useState('15');
  const [laborVariance, setLaborVariance] = useState('20');
  const [costImpactMin, setCostImpactMin] = useState('2000');
  const [trendingWindow, setTrendingWindow] = useState('3');
  const [chatOn, setChatOn] = useState(true);
  const [whatsappOn, setWhatsappOn] = useState(false);
  const [emailOn, setEmailOn] = useState(true);

  const Toggle = ({ on, setOn }) => (
    <button
      onClick={() => setOn(v => !v)}
      className={`w-9 h-5 rounded-full relative transition-colors ${on ? '' : 'bg-[#d4d4d0]'}`}
      style={on ? { backgroundColor: ACCENT } : undefined}
    >
      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-5 py-5 space-y-5">
        {/* Operating Mode */}
        <div className="bg-terminal-panel border border-terminal-border rounded-xl p-5">
          <div className="text-[13px] font-semibold text-terminal-text mb-1">Operating Mode</div>
          <div className="text-[11px] text-[#9a9a92] mb-4">Controls how the Field Reporter processes incoming field logs</div>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[12px] font-semibold text-terminal-text">Autonomous processing</div>
                <div className="text-[10px] text-[#9a9a92]">Automatically process field logs and update job tracking</div>
              </div>
              <Toggle on={autonomous} setOn={setAutonomous} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[12px] font-semibold text-terminal-text">Auto-flag anomalies</div>
                <div className="text-[10px] text-[#9a9a92]">Flag material and cost variances that exceed thresholds</div>
              </div>
              <Toggle on={autoFlag} setOn={setAutoFlag} />
            </div>
          </div>
        </div>

        {/* Variance Thresholds */}
        <div className="bg-terminal-panel border border-terminal-border rounded-xl p-5">
          <div className="text-[13px] font-semibold text-terminal-text mb-1">Variance Thresholds</div>
          <div className="text-[11px] text-[#9a9a92] mb-4">Anomalies are flagged when usage exceeds these limits</div>
          <div className="grid grid-cols-2 gap-4">
            {[
              { label: 'Material variance', value: materialVariance, set: setMaterialVariance, unit: '%' },
              { label: 'Labor variance', value: laborVariance, set: setLaborVariance, unit: '%' },
              { label: 'Cost impact min', value: costImpactMin, set: setCostImpactMin, unit: '$' },
              { label: 'Trending window', value: trendingWindow, set: setTrendingWindow, unit: 'days' },
            ].map((t, i) => (
              <div key={i}>
                <div className="text-[11px] font-semibold text-[#6b6b65] mb-1.5">{t.label}</div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={t.value}
                    onChange={e => t.set(e.target.value)}
                    className="w-full px-3 py-2 rounded-[8px] border border-terminal-border bg-white text-[13px] font-mono text-terminal-text focus:outline-none focus:border-[#9a9a92]"
                  />
                  <span className="text-[11px] text-[#9a9a92] shrink-0">{t.unit}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Input Channels */}
        <div className="bg-terminal-panel border border-terminal-border rounded-xl p-5">
          <div className="text-[13px] font-semibold text-terminal-text mb-1">Input Channels</div>
          <div className="text-[11px] text-[#9a9a92] mb-4">Where field crews can submit daily logs</div>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[12px] font-semibold text-terminal-text">Chat</div>
                <div className="text-[10px] text-[#9a9a92]">Field crews submit logs via this chat interface</div>
              </div>
              <Toggle on={chatOn} setOn={setChatOn} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[12px] font-semibold text-terminal-text">WhatsApp</div>
                <div className="text-[10px] text-[#9a9a92]">Accept field logs via WhatsApp messages</div>
              </div>
              <Toggle on={whatsappOn} setOn={setWhatsappOn} />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[12px] font-semibold text-terminal-text">Email</div>
                <div className="text-[10px] text-[#9a9a92]">Parse field logs from incoming emails</div>
              </div>
              <Toggle on={emailOn} setOn={setEmailOn} />
            </div>
          </div>
        </div>

        {/* Save */}
        <button
          onClick={() => alert('Configuration saved.')}
          className="w-full py-3 rounded-xl text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: ACCENT }}
        >
          Save Configuration
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function FieldReporterChat() {
  const [activeTab, setActiveTab] = useState('Chat');
  const [input, setInput] = useState('');

  const tabs = ['Chat', 'Reports', 'History', 'Config'];

  const handleSend = () => {
    if (!input.trim()) return;
    setInput('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      {/* ── Top Bar ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-terminal-border bg-terminal-panel shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-[10px] flex items-center justify-center bg-[#fdf6e8]">
            <span className="text-[15px]" role="img" aria-label="clipboard">&#128203;</span>
          </div>
          <div>
            <div className="text-[15px] font-semibold text-terminal-text">Field Reporter</div>
            <div className="text-[11px] text-[#9a9a92] flex items-center gap-[5px]">
              <span className="w-[5px] h-[5px] rounded-full bg-[#2dd478] animate-pulse" />
              Online — 30 reports this month
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <span
            className="px-2.5 py-[4px] rounded-[6px] text-[10px] font-bold text-white uppercase tracking-[0.5px]"
            style={{ backgroundColor: ACCENT }}
          >
            AUTO
          </span>
          <div className="flex items-center gap-1.5">
            {tabs.map(t => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`px-2.5 py-[5px] rounded-[7px] text-[10px] font-semibold border transition-colors ${
                  activeTab === t
                    ? 'border-transparent'
                    : 'bg-terminal-panel text-[#9a9a92] border-terminal-border hover:bg-[#f5f4f0]'
                }`}
                style={activeTab === t ? { backgroundColor: ACCENT + '12', color: ACCENT, borderColor: ACCENT + '33' } : undefined}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Chat Tab ─────────────────────────────────────────────────────────── */}
      {activeTab === 'Chat' && (
        <div className="flex flex-1 min-h-0">
          {/* Chat area */}
          <div className="flex-1 flex flex-col border-r border-terminal-border min-w-0 min-h-0">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-4">
              {DEMO_MESSAGES.map(msg => (
                <ChatMessage key={msg.id} msg={msg} />
              ))}
            </div>

            {/* Input */}
            <div className="px-5 py-3.5 border-t border-terminal-border bg-terminal-panel shrink-0">
              <div className="flex items-end gap-2.5">
                <div className="flex-1 relative">
                  <textarea
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask about field reports, job progress, material tracking..."
                    rows={1}
                    className="w-full px-4 py-3 pr-11 border-[1.5px] border-terminal-border rounded-[14px] text-[13px] text-terminal-text bg-[#f5f4f0] outline-none resize-none min-h-[44px] max-h-[120px] focus:bg-terminal-panel transition-colors placeholder:text-[#c5c5bc]"
                    onFocus={e => e.target.style.borderColor = ACCENT}
                    onBlur={e => e.target.style.borderColor = ''}
                  />
                </div>
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className="w-11 h-11 rounded-xl text-white flex items-center justify-center transition-colors disabled:opacity-40 shrink-0"
                  style={{ backgroundColor: ACCENT }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              </div>
              <div className="text-[10px] text-[#c5c5bc] text-center mt-1.5">Field Reporter tracks daily logs, flags anomalies, and monitors job costs in real time.</div>
            </div>
          </div>

          {/* Context panel */}
          <div className="w-[280px] min-w-0 min-h-0 overflow-y-auto bg-[#f5f4f0] shrink-0">
            <ContextPanel />
          </div>
        </div>
      )}

      {/* ── Reports Tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'Reports' && <ReportsTab />}

      {/* ── History Tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'History' && <HistoryTab />}

      {/* ── Config Tab ───────────────────────────────────────────────────────── */}
      {activeTab === 'Config' && <ConfigTab />}
    </div>
  );
}

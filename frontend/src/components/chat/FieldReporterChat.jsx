import React, { useState, useEffect, useRef, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

function getAuthToken() {
  try {
    const session = JSON.parse(sessionStorage.getItem('sangha_auth'));
    if (session?.tokens?.accessToken) return session.tokens.accessToken;
  } catch {}
  const legacy = localStorage.getItem('auth_token');
  if (legacy) return legacy;
  return null;
}

function authHeaders() {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

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

// Demo messages kept as initial chat context
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

// ─── Helpers ────────────────────────────────────────────────────────────────────

function parseReport(r) {
  return {
    ...r,
    work: r.work || (r.work_json ? JSON.parse(r.work_json) : []),
    materials: r.materials || (r.materials_json ? JSON.parse(r.materials_json) : []),
    labor: r.labor || (r.labor_json ? JSON.parse(r.labor_json) : {}),
    equipment: r.equipment || (r.equipment_json ? JSON.parse(r.equipment_json) : []),
    issues: r.issues || (r.issues_json ? JSON.parse(r.issues_json) : []),
  };
}

function formatRelativeDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatShortDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function fmtMoney(n) {
  if (n == null) return '--';
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
  return `$${n.toLocaleString()}`;
}

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
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, percent || 0)}%`, backgroundColor: color }} />
    </div>
  );
}

// ─── Context Panel (sidebar) ────────────────────────────────────────────────────

function ContextPanel({ jobs, fieldReports, loading }) {
  const activeJobs = jobs.filter(j => j.status === 'active');

  // Compute today's submissions from real field reports
  const today = new Date().toISOString().slice(0, 10);
  const todayReports = fieldReports.filter(r => r.date === today);

  // Build a map of job_id -> aggregated field report data for active jobs
  const jobAggregates = {};
  for (const j of activeJobs) {
    const reports = fieldReports.filter(r => r.job_id === j.id);
    const totalLaborHours = reports.reduce((s, r) => s + (r.labor?.hours || 0), 0);
    const totalCY = reports.reduce((s, r) => {
      return s + (r.materials || []).filter(m => m.unit === 'CY').reduce((ms, m) => ms + (m.quantity || 0), 0);
    }, 0);
    const latestCrew = reports.length > 0 ? reports[reports.length - 1].labor?.crew_size : null;
    jobAggregates[j.id] = { totalLaborHours, totalCY, latestCrew };
  }

  const statusColor = (status) => {
    if (status === 'active') return { bg: '#edf7f0', text: '#1a6b3c' };
    if (status === 'mobilizing') return { bg: '#fdf6e8', text: '#b8860b' };
    return { bg: '#eef3f9', text: '#1e3a5f' };
  };

  // Estimate progress: if actual_cost and estimated_cost exist, use ratio; otherwise fallback
  const estimateProgress = (job) => {
    if (job.actual_cost && job.estimated_cost) {
      return Math.round((job.actual_cost / job.estimated_cost) * 100);
    }
    // Parse from notes if available (e.g., "40% complete")
    const match = job.notes?.match(/(\d+)%\s*complete/i);
    if (match) return parseInt(match[1], 10);
    if (job.start_date && !job.end_date) return 5; // just started
    return 0;
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-[11px] text-[#9a9a92]">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* Active Jobs */}
      <div className="border-b border-[#f0eeea]">
        <div className="px-4 py-3 flex items-center justify-between">
          <span className="text-[11px] font-bold text-[#6b6b65] uppercase tracking-[0.8px]">Active Jobs</span>
          <span className="text-[10px] text-[#c5c5bc]">{activeJobs.length} job{activeJobs.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="px-4 pb-3.5 space-y-2.5">
          {activeJobs.length === 0 && (
            <div className="text-[11px] text-[#9a9a92] text-center py-4">No active jobs</div>
          )}
          {activeJobs.map(job => {
            const sc = statusColor(job.status);
            const progress = estimateProgress(job);
            const agg = jobAggregates[job.id] || {};
            return (
              <div key={job.id} className="p-3 bg-terminal-panel border border-[#f0eeea] rounded-lg">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[12px] font-semibold text-terminal-text">{job.project_name}</span>
                  <span
                    className="text-[9px] font-bold px-2 py-[2px] rounded-[5px]"
                    style={{ backgroundColor: sc.bg, color: sc.text }}
                  >
                    {job.id}
                  </span>
                </div>
                <div className="text-[10px] text-[#9a9a92] mb-2">{job.gc_name}</div>
                <div className="flex items-center gap-2 mb-1">
                  <ProgressBar percent={progress} color={progress < 10 ? '#b8860b' : '#1e3a5f'} />
                  <span className="text-[10px] font-mono font-semibold text-[#6b6b65] shrink-0">{progress}%</span>
                </div>
                <div className="space-y-1">
                  {job.bid_amount && job.actual_cost != null && (
                    <div className="flex justify-between text-[11px]">
                      <span className="text-[#9a9a92]">Budget</span>
                      <span className="font-mono text-terminal-text">{fmtMoney(job.actual_cost)} / {fmtMoney(job.bid_amount)}</span>
                    </div>
                  )}
                  {job.bid_amount && job.actual_cost == null && (
                    <div className="flex justify-between text-[11px]">
                      <span className="text-[#9a9a92]">Bid</span>
                      <span className="font-mono text-terminal-text">{fmtMoney(job.bid_amount)}</span>
                    </div>
                  )}
                  {agg.totalCY > 0 && (
                    <div className="flex justify-between text-[11px]">
                      <span className="text-[#9a9a92]">Concrete</span>
                      <span className="font-mono text-terminal-text">{agg.totalCY.toLocaleString()} CY</span>
                    </div>
                  )}
                  {agg.latestCrew && (
                    <div className="flex justify-between text-[11px]">
                      <span className="text-[#9a9a92]">Crew</span>
                      <span className="font-mono text-terminal-text">{agg.latestCrew}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Today's Submissions */}
      <div className="border-b border-[#f0eeea]">
        <div className="px-4 py-3 flex items-center justify-between">
          <span className="text-[11px] font-bold text-[#6b6b65] uppercase tracking-[0.8px]">Today's Submissions</span>
          <span className="text-[10px] text-[#c5c5bc]">{todayReports.length} log{todayReports.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="px-4 pb-3.5 space-y-2">
          {todayReports.length === 0 && (
            <div className="text-[11px] text-[#9a9a92] text-center py-3">No submissions today</div>
          )}
          {todayReports.map(r => {
            const job = jobs.find(j => j.id === r.job_id);
            return (
              <div key={r.id} className="p-2.5 bg-terminal-panel border border-[#f0eeea] rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-terminal-text">{r.reported_by || 'Unknown'}</span>
                  <span className="text-[10px] text-[#9a9a92]">{r.date}</span>
                </div>
                <div className="text-[10px] text-[#9a9a92] mt-0.5">
                  {job ? job.project_name : r.job_id} — {r.weather ? `${r.weather}` : 'Daily log'}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Reports Tab ────────────────────────────────────────────────────────────────

function ReportsTab({ fieldReports, jobs, loading }) {
  const [filter, setFilter] = useState('All');
  const [selectedIdx, setSelectedIdx] = useState(0);

  // Build job name map
  const jobMap = {};
  for (const j of jobs) jobMap[j.id] = j;

  // Map real field reports to report items
  const reportItems = fieldReports.map((r, i) => {
    const job = jobMap[r.job_id];
    const jobName = job ? job.project_name : r.job_id;
    const badges = [];
    if (r.issues && r.issues.length > 0) badges.push('Anomaly');
    if (r.notes && /change\s*order/i.test(r.notes)) badges.push('Change Order');
    if (r.weather && /rain|storm|delay|wind/i.test(r.weather)) badges.push('Weather');
    if (badges.length === 0) badges.push('Normal');
    const title = r.issues && r.issues.length > 0 ? 'Issue Report' : 'Daily Log';
    return { idx: i, id: r.id, job: jobName, jobId: r.job_id, title, date: formatRelativeDate(r.date), badges, report: r };
  });

  // Build dynamic filter list from unique job names
  const uniqueJobs = [...new Set(reportItems.map(r => r.job))];
  const filters = ['All', 'Flags', ...uniqueJobs.slice(0, 4)];

  const badgeColor = (badge) => {
    if (badge === 'Anomaly') return 'bg-[#fbeae8] text-[#c0392b]';
    if (badge === 'Change Order') return 'bg-[#fdf6e8] text-[#b8860b]';
    if (badge === 'Weather') return 'bg-blue-50 text-blue-700';
    return 'bg-[#f5f4f0] text-[#6b6b65]';
  };

  const filtered = reportItems.filter(item => {
    if (filter === 'All') return true;
    if (filter === 'Flags') return item.badges.some(b => b === 'Anomaly' || b === 'Change Order');
    return item.job === filter;
  });

  const selected = filtered.find(f => f.idx === selectedIdx) || filtered[0];
  const selReport = selected?.report;

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-[12px] text-[#9a9a92]">Loading reports...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0">
      {/* List */}
      <div className="w-[380px] flex flex-col border-r border-terminal-border min-w-0 shrink-0">
        {/* Filters */}
        <div className="px-5 py-3 border-b border-terminal-border flex items-center gap-2 flex-wrap">
          {filters.map(f => (
            <button
              key={f}
              onClick={() => { setFilter(f); setSelectedIdx(0); }}
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
          {filtered.length === 0 && (
            <div className="text-[12px] text-[#9a9a92] text-center py-8">No reports found</div>
          )}
          {filtered.map(item => (
            <div
              key={item.id}
              onClick={() => setSelectedIdx(item.idx)}
              className={`px-5 py-3.5 border-b border-terminal-border cursor-pointer hover:bg-[#f5f4f0] transition-colors ${
                selectedIdx === item.idx ? 'bg-[#f5f4f0]' : ''
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
        {!selReport ? (
          <div className="text-[12px] text-[#9a9a92] text-center py-12">Select a report to view details</div>
        ) : (
          <>
            <div className="mb-4">
              <h3 className="text-[15px] font-semibold text-terminal-text">
                {selected.job} — {selected.title}
              </h3>
              <div className="text-[11px] text-[#9a9a92] mt-0.5">
                Submitted by {selReport.reported_by || 'Unknown'} on {selReport.date}
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-4 gap-3 mb-4">
              {[
                { label: 'Materials', value: selReport.materials?.length > 0 ? selReport.materials.map(m => `${m.quantity} ${m.unit}`).join(', ') : '--' },
                { label: 'Crew', value: selReport.labor?.crew_size || '--' },
                { label: 'Weather', value: selReport.weather || '--' },
                { label: 'Hours', value: selReport.labor?.hours ? `${selReport.labor.hours} hrs` : '--' },
              ].map((s, i) => (
                <div key={i} className="bg-terminal-panel rounded-xl border border-terminal-border p-3 text-center">
                  <div className="text-[18px] font-bold text-terminal-text">{s.value}</div>
                  <div className="text-[10px] text-[#9a9a92] font-semibold uppercase tracking-wider mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>

            {/* Work Performed */}
            {selReport.work && selReport.work.length > 0 && (
              <div className="bg-terminal-panel border border-terminal-border rounded-xl p-4 mb-4">
                <div className="text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider mb-2">Work Performed</div>
                <div className="text-[12px] text-terminal-text leading-[1.7]">
                  {selReport.work.map((w, i) => (
                    <div key={i} className="flex items-start gap-1.5 mb-1">
                      <span className="text-[#9a9a92] mt-0.5">-</span>
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            {selReport.notes && (
              <div className="bg-terminal-panel border border-terminal-border rounded-xl p-4 mb-4">
                <div className="text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider mb-2">Notes</div>
                <div className="text-[12px] text-terminal-text leading-[1.7]">{selReport.notes}</div>
              </div>
            )}

            {/* Issues */}
            {selReport.issues && selReport.issues.length > 0 && (
              <div className="bg-[#fbeae8] border border-[#f0c0bb] rounded-xl p-4 mb-4">
                <div className="text-[10px] font-semibold text-[#c0392b] uppercase tracking-wider mb-2">Issues Flagged</div>
                {selReport.issues.map((issue, i) => (
                  <div key={i} className="text-[12px] text-[#c0392b] flex items-start gap-1.5 mb-1">
                    <span className="mt-0.5">!</span>
                    <span>{issue}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Equipment */}
            {selReport.equipment && selReport.equipment.length > 0 && (
              <div className="bg-terminal-panel border border-terminal-border rounded-xl p-4 mb-4">
                <div className="text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider mb-2">Equipment</div>
                <div className="text-[12px] text-terminal-text">{selReport.equipment.join(', ')}</div>
              </div>
            )}

            {/* Labor Cost Summary */}
            {selReport.labor?.cost && (
              <div className="bg-terminal-panel border border-terminal-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-terminal-border">
                  <span className="text-[13px] font-semibold text-terminal-text">Labor Summary</span>
                </div>
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="border-b border-terminal-border">
                      <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Item</th>
                      <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-terminal-border/50">
                      <td className="px-4 py-2.5 font-semibold text-terminal-text">Hours</td>
                      <td className="px-4 py-2.5 text-right font-mono text-terminal-text">{selReport.labor.hours || '--'}</td>
                    </tr>
                    {selReport.labor.overtime > 0 && (
                      <tr className="border-b border-terminal-border/50">
                        <td className="px-4 py-2.5 font-semibold text-terminal-text">Overtime</td>
                        <td className="px-4 py-2.5 text-right font-mono text-[#b8860b]">{selReport.labor.overtime} hrs</td>
                      </tr>
                    )}
                    <tr className="border-b border-terminal-border/50">
                      <td className="px-4 py-2.5 font-semibold text-terminal-text">Cost</td>
                      <td className="px-4 py-2.5 text-right font-mono text-terminal-text">${selReport.labor.cost.toLocaleString()}</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 font-semibold text-terminal-text">Crew Size</td>
                      <td className="px-4 py-2.5 text-right font-mono text-terminal-text">{selReport.labor.crew_size || '--'}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── History Tab ────────────────────────────────────────────────────────────────

function HistoryTab({ fieldReports, jobs, loading }) {
  const jobMap = {};
  for (const j of jobs) jobMap[j.id] = j;

  // Compute stats from real data
  const totalReports = fieldReports.length;
  const totalIssues = fieldReports.reduce((s, r) => s + (r.issues?.length || 0), 0);
  const totalLaborCost = fieldReports.reduce((s, r) => s + (r.labor?.cost || 0), 0);
  const totalCY = fieldReports.reduce((s, r) => {
    return s + (r.materials || []).filter(m => m.unit === 'CY').reduce((ms, m) => ms + (m.quantity || 0), 0);
  }, 0);

  // Map field reports to history rows
  const historyRows = fieldReports.map(r => {
    const job = jobMap[r.job_id];
    const jobName = job ? job.project_name : r.job_id;
    const hasIssues = r.issues && r.issues.length > 0;
    const isWeather = r.weather && /rain|storm|delay|wind/i.test(r.weather);
    let type = 'Daily Log';
    let status = 'Normal';
    let impact = '--';
    if (hasIssues) {
      type = 'Anomaly';
      status = 'Flagged';
      impact = r.issues[0]?.slice(0, 40) || 'Issue';
    } else if (isWeather) {
      type = 'Daily Log';
      status = 'Weather Delay';
      impact = r.weather;
    }
    if (r.notes && /change\s*order/i.test(r.notes)) {
      status = 'Change Order';
    }
    return { date: formatShortDate(r.date), job: jobName, type, status, impact };
  });

  const statusBadge = (s) => {
    if (s === 'Normal') return 'bg-[#f5f4f0] text-[#6b6b65]';
    if (s === 'Flagged') return 'bg-[#fbeae8] text-[#c0392b]';
    if (s === 'Change Order') return 'bg-[#fdf6e8] text-[#b8860b]';
    if (s === 'Weather Delay') return 'bg-blue-50 text-blue-700';
    return 'bg-[#f5f4f0] text-[#6b6b65]';
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-[12px] text-[#9a9a92]">Loading history...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-terminal-border border-b border-terminal-border">
        {[
          { label: 'Total Reports', value: totalReports.toString() },
          { label: 'Issues Flagged', value: totalIssues.toString() },
          { label: 'Total Concrete', value: `${totalCY.toLocaleString()} CY` },
          { label: 'Total Labor Cost', value: `$${totalLaborCost.toLocaleString()}` },
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
        {historyRows.length === 0 ? (
          <div className="text-[12px] text-[#9a9a92] text-center py-8">No reports yet</div>
        ) : (
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
                {historyRows.map((h, i) => (
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
        )}
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
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      const res = await fetch(`${API_BASE}/v1/tenant`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          settings: {
            fieldReporter: {
              autonomous,
              autoFlag,
              materialVariance: parseFloat(materialVariance) || 15,
              laborVariance: parseFloat(laborVariance) || 20,
              costImpactMin: parseFloat(costImpactMin) || 2000,
              trendingWindow: parseInt(trendingWindow) || 3,
              channels: { chat: chatOn, whatsapp: whatsappOn, email: emailOn },
            },
          },
        }),
      });
      if (res.ok) {
        setSaveMsg('Configuration saved.');
      } else {
        const err = await res.json().catch(() => ({}));
        setSaveMsg(err.error || 'Failed to save.');
      }
    } catch (e) {
      setSaveMsg('Network error.');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(''), 3000);
    }
  };

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
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3 rounded-xl text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          style={{ backgroundColor: ACCENT }}
        >
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
        {saveMsg && (
          <div className={`text-center text-[12px] ${saveMsg.includes('saved') ? 'text-[#1a6b3c]' : 'text-[#c0392b]'}`}>
            {saveMsg}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function FieldReporterChat() {
  const [activeTab, setActiveTab] = useState('Chat');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState(DEMO_MESSAGES);
  const [sending, setSending] = useState(false);
  const [threadId, setThreadId] = useState(null);
  const messagesEndRef = useRef(null);

  // Real data state
  const [jobs, setJobs] = useState([]);
  const [fieldReports, setFieldReports] = useState([]);
  const [loading, setLoading] = useState(true);

  const tabs = ['Chat', 'Reports', 'History', 'Config'];

  // Fetch real data on mount
  useEffect(() => {
    const headers = authHeaders();
    Promise.all([
      fetch(`${API_BASE}/v1/estimates/jobs`, { headers }).then(r => r.json()).catch(() => ({ jobs: [] })),
      fetch(`${API_BASE}/v1/estimates/field-reports`, { headers }).then(r => r.json()).catch(() => ({ fieldReports: [] })),
    ]).then(([jobsRes, reportsRes]) => {
      setJobs(jobsRes.jobs || []);
      const raw = reportsRes.fieldReports || [];
      setFieldReports(raw.map(parseReport));
    }).finally(() => setLoading(false));
  }, []);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || sending) return;
    const text = input.trim();
    setInput('');

    const userMsg = {
      id: Date.now(),
      role: 'user',
      content: text,
      time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
    };
    setMessages(prev => [...prev, userMsg]);
    setSending(true);

    try {
      const token = getAuthToken();
      const headers = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };

      // Create thread if we don't have one yet
      let tid = threadId;
      if (!tid) {
        const tRes = await fetch(`${API_BASE}/v1/chat/field/threads`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ title: text.slice(0, 60) }),
        });
        if (tRes.ok) {
          const tData = await tRes.json();
          tid = tData.thread?.id || tData.id;
          setThreadId(tid);
        }
      }

      const postUrl = tid
        ? `${API_BASE}/v1/chat/field/threads/${tid}/messages`
        : `${API_BASE}/v1/chat/field/messages`;

      const res = await fetch(postUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ content: text }),
      });

      if (res.ok) {
        const data = await res.json();
        const agentContent = data.response || data.message?.content || data.content || 'No response received.';
        const agentMsg = {
          id: Date.now() + 1,
          role: 'agent',
          content: agentContent,
          time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
        };
        setMessages(prev => [...prev, agentMsg]);
      } else {
        const errData = await res.json().catch(() => ({}));
        const agentMsg = {
          id: Date.now() + 1,
          role: 'agent',
          content: `Error: ${errData.error || res.statusText || 'Failed to get response.'}`,
          time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
        };
        setMessages(prev => [...prev, agentMsg]);
      }
    } catch (err) {
      const agentMsg = {
        id: Date.now() + 1,
        role: 'agent',
        content: `Network error: ${err.message}`,
        time: new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
      };
      setMessages(prev => [...prev, agentMsg]);
    } finally {
      setSending(false);
    }
  }, [input, sending, threadId]);

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
              Online — {fieldReports.length} report{fieldReports.length !== 1 ? 's' : ''} total
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
              {messages.map(msg => (
                <ChatMessage key={msg.id} msg={msg} />
              ))}
              {sending && (
                <div className="self-start flex items-center gap-2 text-[12px] text-[#9a9a92]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#9a9a92] animate-pulse" />
                  Field Reporter is thinking...
                </div>
              )}
              <div ref={messagesEndRef} />
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
                  disabled={!input.trim() || sending}
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
            <ContextPanel jobs={jobs} fieldReports={fieldReports} loading={loading} />
          </div>
        </div>
      )}

      {/* ── Reports Tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'Reports' && <ReportsTab fieldReports={fieldReports} jobs={jobs} loading={loading} />}

      {/* ── History Tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'History' && <HistoryTab fieldReports={fieldReports} jobs={jobs} loading={loading} />}

      {/* ── Config Tab ───────────────────────────────────────────────────────── */}
      {activeTab === 'Config' && <ConfigTab />}
    </div>
  );
}

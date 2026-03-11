import React, { useState, useMemo, Suspense, lazy } from 'react';
import { useTenant } from '../../contexts/TenantContext';

const FilesDashboard = lazy(() => import('./FilesDashboard'));

// ─── Agent Icon Config ──────────────────────────────────────────────────────

const MINING_AGENTS = {
  outreach:     { letter: 'O', color: '#1a6b3c', bg: '#edf7f0' },
  curtailment:  { letter: 'C', color: '#b8860b', bg: '#fdf6e8' },
  pool:         { letter: 'P', color: '#5b3a8c', bg: '#f3eef8' },
  meetings:     { letter: 'M', color: '#2c5282', bg: '#e8eef5' },
  reporting:    { letter: 'R', color: '#5b3a8c', bg: '#f3eef8' },
  hivemind:     { letter: 'H', color: '#1a6b3c', bg: '#edf7f0' },
  workspace:    { letter: 'W', color: '#2c5282', bg: '#e8eef5' },
};

const DACP_AGENTS = {
  estimating:   { letter: 'E', color: '#2c5282', bg: '#e8eef5' },
  field:        { letter: 'F', color: '#1a6b3c', bg: '#edf7f0' },
  bid:          { letter: 'B', color: '#b8860b', bg: '#fdf6e8' },
  workspace:    { letter: 'W', color: '#2c5282', bg: '#e8eef5' },
};

// ─── Tag Styles ─────────────────────────────────────────────────────────────

const TAG_STYLES = {
  auto:      'bg-[#edf7f0] text-[#1a6b3c] border-[#d0e8d8]',
  approved:  'bg-[#e8eef5] text-[#2c5282] border-[#c8d8ea]',
  manual:    'bg-[#f5f4f0] text-[#888888] border-[#e5e5e0]',
  alert:     'bg-[#fdf6e8] text-[#b8860b] border-[#f0e0b8]',
  rejected:  'bg-[#fdedf0] text-[#dc3545] border-[#f0c8cc]',
  proactive: 'bg-[#f3eef8] text-[#5b3a8c] border-[#d8cce8]',
};

// ─── Demo Data ──────────────────────────────────────────────────────────────

const MINING_EVENTS = {
  'Today': [
    { time: '09:42', agent: 'curtailment', action: 'Triggered curtailment protocol', target: 'Crane County Site', detail: 'ERCOT real-time price exceeded $85/MWh — 12 miners paused for 45 min', tags: ['auto'], cost: '$0.03' },
    { time: '09:15', agent: 'outreach', action: 'Sent personalized outreach', target: 'James Torres, VP Ops — SunPeak Energy', detail: 'Referenced ERCOT curtailment data & behind-the-meter opportunity', tags: ['auto'], cost: '$0.02' },
    { time: '08:50', agent: 'hivemind', action: 'Answered operator question', target: '#general channel', detail: '"What\'s our current hashrate allocation?" — responded with live pool breakdown', tags: ['auto'], cost: '$0.04' },
    { time: '08:30', agent: 'meetings', action: 'Transcribed strategy call', target: 'Reassurity Product Strategy', detail: '42 min — 6 attendees — 4 action items extracted and assigned', tags: ['auto'], cost: '$0.08' },
    { time: '06:00', agent: 'workspace', action: 'Created Weekly Executive Briefing', target: '/Sangha/Presentations/', detail: '8-slide deck — KPIs, fleet status, revenue, risk flags, action items', tags: ['auto', 'proactive'], cost: '$0.05' },
  ],
  'Yesterday': [
    { time: '16:20', agent: 'pool', action: 'Rebalanced pool allocation', target: 'Foundry → Luxor', detail: 'Shifted 15 PH/s based on 7-day fee differential of 0.3%', tags: ['approved'], cost: '$0.01' },
    { time: '14:45', agent: 'reporting', action: 'Generated weekly briefing', target: 'Week 10 Operations Report', detail: 'Revenue, hashrate, curtailment savings, outreach pipeline summary', tags: ['auto', 'proactive'], cost: '$0.12' },
    { time: '11:30', agent: 'outreach', action: 'Drafted follow-up email', target: 'Mark Liu — GridScale Partners', detail: '5 days since last contact — awaiting operator approval', tags: ['manual', 'alert'], cost: '$0.02' },
    { time: '09:00', agent: 'curtailment', action: 'Published daily ERCOT forecast', target: 'Operations Dashboard', detail: 'Peak price windows: 14:00–16:00 CST, recommended pre-curtailment at 13:45', tags: ['auto', 'proactive'], cost: '$0.05' },
    { time: '07:30', agent: 'workspace', action: 'Updated Fleet Analysis spreadsheet', target: '/Sangha/Fleet/', detail: 'Post-difficulty-adjustment projections — S19 tier now marginal at current hashprice', tags: ['auto'], cost: '$0.03' },
  ],
};

const DACP_EVENTS = {
  'Today': [
    { time: '9:06 AM', agent: 'estimating', action: 'Generated estimate', target: 'Bishop Arts Mixed-Use', detail: '$847,300 — Rogers-O\'Brien — 5 line items', tags: ['auto'], cost: '$0.08' },
    { time: '8:42 AM', agent: 'workspace', action: 'Received RFQ email', target: 'Bishop Arts Mixed-Use', detail: 'From Rogers-O\'Brien (dkim@rogers-obrien.com)', tags: ['auto'], cost: '$0.00' },
    { time: '6:00 AM', agent: 'workspace', action: 'Generated daily ops report', target: 'March 9', detail: '3 active jobs, 2 estimates pending', tags: ['auto'], cost: '$0.04' },
  ],
  'Yesterday': [
    { time: '4:30 PM', agent: 'field', action: 'Daily log submitted', target: 'Westpark Retail Center', detail: 'Carlos Mendez — 52 CY poured, 6 finishers', tags: ['manual'], cost: '$0.00' },
    { time: '2:25 PM', agent: 'estimating', action: 'Drafted response', target: 'I-35 Retaining Walls', detail: 'Email to Hensel Phelps (pending approval)', tags: ['auto'], cost: '$0.06' },
    { time: '2:20 PM', agent: 'estimating', action: 'Generated estimate', target: 'I-35 Retaining Walls', detail: '$312,000 — Hensel Phelps', tags: ['auto'], cost: '$0.08' },
    { time: '2:15 PM', agent: 'workspace', action: 'Received RFQ', target: 'I-35 Retaining Walls', detail: 'From Hensel Phelps (lchen@henselphelps.com)', tags: ['auto'], cost: '$0.00' },
    { time: '11:00 AM', agent: 'workspace', action: 'Discovered 6 new GC contacts', target: 'DFW Area', detail: 'Austin Commercial, Balfour Beatty + 4 others', tags: ['proactive'], cost: '$0.12' },
    { time: '9:30 AM', agent: 'estimating', action: 'Started parsing specs', target: 'McKinney Town Center', detail: '48-page spec document, 3 line items identified', tags: ['auto'], cost: '$0.10' },
    { time: '6:00 AM', agent: 'workspace', action: 'Generated daily ops report', target: 'March 8', detail: '3 active jobs, 3 estimates pending', tags: ['auto'], cost: '$0.04' },
  ],
  'March 6': [
    { time: '3:30 PM', agent: 'workspace', action: 'Transcribed meeting', target: 'Turner Coordination Call', detail: '38 min, 2 action items extracted', tags: ['auto'], cost: '$0.15' },
    { time: '1:00 PM', agent: 'estimating', action: 'Revised estimate', target: 'Samsung Fab Expansion', detail: '$165K → $185K (+12% material increase)', tags: ['auto'], cost: '$0.06' },
    { time: '9:00 AM', agent: 'estimating', action: 'Sent approved estimate', target: 'Memorial Hermann Phase 2', detail: '$266,000 to Turner (mrodriguez@turner.com)', tags: ['approved'], cost: '$0.02' },
    { time: '6:00 AM', agent: 'workspace', action: 'Generated daily ops report', target: 'March 6', detail: '3 active jobs, 1 estimate pending', tags: ['auto'], cost: '$0.04' },
  ],
  'March 5': [
    { time: '4:00 PM', agent: 'workspace', action: 'Transcribed meeting', target: 'Weekly Team Standup', detail: '45 min, 4 action items', tags: ['auto'], cost: '$0.18' },
    { time: '2:00 PM', agent: 'workspace', action: 'Followed up', target: 'Memorial Hermann Phase 2', detail: 'No response from Turner in 48 hours', tags: ['proactive'], cost: '$0.02' },
    { time: '10:00 AM', agent: 'estimating', action: 'Recommended declining', target: 'Plano ISD Natatorium', detail: 'Outside core competency — specialty coatings', tags: ['auto'], cost: '$0.06' },
  ],
  'March 4': [
    { time: '3:00 PM', agent: 'workspace', action: 'Transcribed meeting', target: 'DPR Samsung Fab Scope Review', detail: '25 min, 2 action items', tags: ['auto'], cost: '$0.12' },
    { time: '6:00 AM', agent: 'workspace', action: 'Generated daily ops report', target: 'March 4', detail: '3 active jobs, 2 estimates pending', tags: ['auto'], cost: '$0.04' },
  ],
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function AuditTrailDashboard() {
  const [activeView, setActiveView] = useState('audit');

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-6 pt-5 pb-0">
        {[{ id: 'audit', label: 'Audit Trail' }, { id: 'files', label: 'Files' }].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveView(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
              activeView === tab.id
                ? 'bg-terminal-text text-white'
                : 'text-terminal-muted hover:bg-[#f5f4f0] hover:text-terminal-text'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeView === 'files' ? (
        <Suspense fallback={<div className="flex items-center justify-center py-24"><div className="spinner w-10 h-10" /></div>}>
          <FilesDashboard />
        </Suspense>
      ) : (
        <AuditTrailContent />
      )}
    </div>
  );
}

function AuditTrailContent() {
  const { tenant } = useTenant();
  const isConstruction = tenant?.settings?.industry === 'construction';

  const agents = isConstruction ? DACP_AGENTS : MINING_AGENTS;
  const allEvents = isConstruction ? DACP_EVENTS : MINING_EVENTS;
  const agentKeys = Object.keys(agents);

  const [period, setPeriod] = useState('All');
  const [activeAgents, setActiveAgents] = useState([]);
  const [approvalsOnly, setApprovalsOnly] = useState(false);
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [search, setSearch] = useState('');

  const toggleAgent = (key) => {
    setActiveAgents(prev =>
      prev.includes(key) ? prev.filter(a => a !== key) : [...prev, key]
    );
  };

  const filteredGroups = useMemo(() => {
    let groups = { ...allEvents };

    // Period filter
    if (period === 'Today') {
      groups = { 'Today': groups['Today'] || [] };
    } else if (period === 'This Week') {
      // Show all groups (Today + Yesterday are within the week)
    }

    // Apply filters to each group
    const result = {};
    for (const [date, events] of Object.entries(groups)) {
      let filtered = events;
      if (activeAgents.length > 0) {
        filtered = filtered.filter(e => activeAgents.includes(e.agent));
      }
      if (approvalsOnly) {
        filtered = filtered.filter(e => e.tags.includes('approved') || e.tags.includes('manual'));
      }
      if (alertsOnly) {
        filtered = filtered.filter(e => e.tags.includes('alert'));
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        filtered = filtered.filter(e =>
          e.action.toLowerCase().includes(q) ||
          e.target.toLowerCase().includes(q) ||
          e.detail.toLowerCase().includes(q)
        );
      }
      if (filtered.length > 0) {
        result[date] = filtered;
      }
    }
    return result;
  }, [allEvents, period, activeAgents, approvalsOnly, alertsOnly, search]);

  const totalFiltered = Object.values(filteredGroups).reduce((sum, g) => sum + g.length, 0);

  return (
    <div className="p-6 lg:px-7 lg:py-6">
      {/* Period pills */}
      <div className="flex items-center gap-2 mb-5">
        {['All', 'Today', 'This Week'].map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
              period === p
                ? 'bg-terminal-text text-white border-terminal-text'
                : 'bg-terminal-panel text-terminal-muted border-terminal-border hover:bg-[#f5f4f0]'
            }`}
          >
            {p}
          </button>
        ))}
        <div className="flex-1" />
        <button onClick={() => alert('Audit trail CSV export started.')} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-terminal-panel text-terminal-muted border border-terminal-border hover:bg-[#f5f4f0] transition-all">
          Export CSV
        </button>
      </div>

      {/* Filter bar */}
      <div className="bg-terminal-panel border border-terminal-border rounded-[14px] px-[18px] py-3 mb-5 flex flex-wrap items-center gap-2">
        {agentKeys.map(key => {
          const a = agents[key];
          const active = activeAgents.includes(key);
          return (
            <button
              key={key}
              onClick={() => toggleAgent(key)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
                active
                  ? 'border-terminal-text bg-terminal-text text-white'
                  : 'border-terminal-border bg-terminal-panel text-terminal-muted hover:bg-[#f5f4f0]'
              }`}
            >
              <span
                className="w-4 h-4 rounded-[4px] flex items-center justify-center text-[9px] font-bold shrink-0"
                style={{ background: active ? 'rgba(255,255,255,0.2)' : a.bg, color: active ? '#fff' : a.color }}
              >
                {a.letter}
              </span>
              <span className="capitalize">{key}</span>
            </button>
          );
        })}

        <div className="w-px h-5 bg-terminal-border mx-1" />

        <button
          onClick={() => { setApprovalsOnly(!approvalsOnly); if (!approvalsOnly) setAlertsOnly(false); }}
          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
            approvalsOnly
              ? 'bg-[#e8eef5] text-[#2c5282] border-[#c8d8ea]'
              : 'bg-terminal-panel text-terminal-muted border-terminal-border hover:bg-[#f5f4f0]'
          }`}
        >
          Approvals Only
        </button>
        <button
          onClick={() => { setAlertsOnly(!alertsOnly); if (!alertsOnly) setApprovalsOnly(false); }}
          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all ${
            alertsOnly
              ? 'bg-[#fdf6e8] text-[#b8860b] border-[#f0e0b8]'
              : 'bg-terminal-panel text-terminal-muted border-terminal-border hover:bg-[#f5f4f0]'
          }`}
        >
          Alerts Only
        </button>

        <div className="w-px h-5 bg-terminal-border mx-1" />

        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search actions..."
          className="flex-1 min-w-[160px] px-3 py-1.5 rounded-lg text-[12px] bg-[#f5f4f0] border border-terminal-border text-terminal-text placeholder:text-terminal-muted focus:outline-none focus:border-terminal-green transition-colors"
        />
      </div>

      {/* Timeline */}
      <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
        <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
          <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Audit Trail</span>
          <span className="text-[11px] text-terminal-muted">{totalFiltered} events</span>
        </div>

        {Object.keys(filteredGroups).length === 0 ? (
          <div className="px-[18px] py-10 text-center text-[13px] text-terminal-muted">No events match your filters.</div>
        ) : (
          Object.entries(filteredGroups).map(([date, events]) => (
            <div key={date}>
              {/* Date group header */}
              <div className="px-[18px] py-2 bg-[#f9f9f7] border-b border-[#f0eeea]">
                <span className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px]">{date}</span>
              </div>

              {/* Events */}
              {events.map((event, i) => {
                const agentCfg = agents[event.agent];
                return (
                  <div key={i} className="flex items-start gap-3.5 px-[18px] py-3 border-b border-[#f0eeea] last:border-b-0 hover:bg-[#f5f4f0] transition-colors">
                    {/* Time */}
                    <span className="text-[11px] font-mono text-terminal-muted w-[42px] shrink-0 mt-0.5 tabular-nums">{event.time}</span>

                    {/* Agent icon */}
                    <span
                      className="w-7 h-7 rounded-[7px] flex items-center justify-center text-[11px] font-bold shrink-0"
                      style={{ background: agentCfg.bg, color: agentCfg.color }}
                    >
                      {agentCfg.letter}
                    </span>

                    {/* Body */}
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-terminal-text leading-[1.4]">
                        {event.action} <span className="text-terminal-muted">→</span> {event.target}
                      </div>
                      <div className="text-[11px] text-terminal-muted mt-0.5">{event.detail}</div>
                      <div className="flex items-center gap-1.5 mt-1.5">
                        {event.tags.map(tag => (
                          <span key={tag} className={`text-[9px] font-bold uppercase tracking-[0.5px] px-1.5 py-[1px] rounded border ${TAG_STYLES[tag]}`}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Cost */}
                    <span className="text-[11px] font-mono text-terminal-muted shrink-0 mt-0.5 tabular-nums">{event.cost}</span>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

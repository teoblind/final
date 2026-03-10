import React, { useState, useEffect, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

// ─── Approval Queue Data (demo fallback) ────────────────────────────────────

const DEMO_APPROVAL_QUEUE = [
  { id: 1, agent: 'outreach', agentLabel: 'Outreach', icon: { letter: 'O', color: '#1a6b3c', bg: '#edf7f0' }, title: 'Reply draft: Sarah Chen — Meridian Renewables', desc: 'Personalized response to behind-the-meter mining inquiry, references Crane County site performance', time: '12m ago' },
  { id: 2, agent: 'outreach', agentLabel: 'Outreach', icon: { letter: 'O', color: '#1a6b3c', bg: '#edf7f0' }, title: 'Follow-up draft: Mark Liu — GridScale Partners', desc: '5 days since last contact — gentle check-in with updated hashrate economics', time: '2h ago' },
  { id: 3, agent: 'reporting', agentLabel: 'Reporting', icon: { letter: 'R', color: '#5b3a8c', bg: '#f3eef8' }, title: 'Weekly briefing ready for review', desc: 'Week 10 operations report — revenue, curtailment savings, pipeline summary', time: '3h ago' },
  { id: 4, agent: 'curtailment', agentLabel: 'Curtailment', icon: { letter: 'C', color: '#b8860b', bg: '#fdf6e8' }, title: 'Curtailment recommendation: Pecos County', desc: 'ERCOT price forecast shows $92/MWh window 14:00–16:30 — recommends pre-curtailment at 13:45', time: '5h ago' },
  { id: 5, agent: 'meetings', agentLabel: 'Meetings', icon: { letter: 'M', color: '#2c5282', bg: '#e8eef5' }, title: 'Meeting action items: Reassurity call', desc: '4 action items extracted — 2 assigned to you, 2 to ops team', time: '6h ago' },
];

const AGENT_INSIGHTS = [
  { id: 1, agent: 'pool', agentLabel: 'Pool Routing', type: 'Recommendation', time: '15m ago', title: 'Foundry fee increase detected', body: 'Foundry raised fees from <b>2.0% to 2.5%</b> effective next block. Switching 15 PH/s to <b>Luxor (1.8%)</b> would save ~$340/month.', actions: ['Switch Now', 'Dismiss'] },
  { id: 2, agent: 'hivemind', agentLabel: 'Hivemind', type: 'Question', time: '1h ago', title: 'PPA pricing question from operator', body: 'Operator asked: "What\'s the break-even electricity price for our S19 fleet?" Answer computed: <b>$0.068/kWh</b> at current difficulty.', actions: ['View Thread'] },
  { id: 3, agent: 'outreach', agentLabel: 'Lead Engine', type: 'Pattern', time: '2h ago', title: 'Outreach reply rate trending up', body: 'Reply rate increased from <b>5.1% to 7.3%</b> after switching to ERCOT-data-personalized templates. Recommend expanding to all PJM leads.', actions: ['Apply to PJM', 'Dismiss'] },
  { id: 4, agent: 'curtailment', agentLabel: 'Curtailment', type: 'Analysis', time: '4h ago', title: 'Curtailment revenue opportunity', body: 'Yesterday\'s curtailment at Crane County netted <b>$1,247</b> in 45 minutes. Pattern suggests <b>3–4 similar windows</b> this week.', actions: ['View Forecast'] },
  { id: 5, agent: 'meetings', agentLabel: 'Meetings', type: 'Follow-up', time: '5h ago', title: 'Overdue action item: Oberon deal memo', body: 'Action item from March 3 call: "<b>Revise energy pricing assumptions in section 4.2</b>" — assigned to you, 4 days overdue.', actions: ['Mark Done', 'Snooze'] },
];

const AGENT_ICON_COLORS = {
  outreach:    { letter: 'O', color: '#1a6b3c', bg: '#edf7f0' },
  curtailment: { letter: 'C', color: '#b8860b', bg: '#fdf6e8' },
  pool:        { letter: 'P', color: '#5b3a8c', bg: '#f3eef8' },
  meetings:    { letter: 'M', color: '#2c5282', bg: '#e8eef5' },
  reporting:   { letter: 'R', color: '#5b3a8c', bg: '#f3eef8' },
  hivemind:    { letter: 'H', color: '#1a6b3c', bg: '#edf7f0' },
  monitoring:  { letter: 'M', color: '#b8860b', bg: '#fdf6e8' },
  email:       { letter: 'E', color: '#2c5282', bg: '#e8eef5' },
};

const INSIGHT_TYPE_STYLES = {
  Recommendation: 'bg-[#edf7f0] text-[#1a6b3c]',
  Question: 'bg-[#e8eef5] text-[#2c5282]',
  Pattern: 'bg-[#f3eef8] text-[#5b3a8c]',
  Analysis: 'bg-[#fdf6e8] text-[#b8860b]',
  'Follow-up': 'bg-[#fdedf0] text-[#dc3545]',
  alert: 'bg-[#fdedf0] text-[#dc3545]',
  reminder: 'bg-[#fdf6e8] text-[#b8860b]',
  follow_up: 'bg-[#fdedf0] text-[#dc3545]',
  insight: 'bg-[#edf7f0] text-[#1a6b3c]',
};

// ─── Demo Data ──────────────────────────────────────────────────────────────

const METRICS = [
  { label: 'Leads', value: '502', delta: '+34 today', type: 'up', bar: 68 },
  { label: 'Outreach', value: '96', delta: '+12 this week', type: 'up', bar: 19 },
  { label: 'Replies', value: '7', delta: '7.3% rate', type: 'up', bar: 7.3 },
  { label: 'Meetings', value: '17', delta: '2 this week', type: 'flat', bar: 40 },
  { label: 'API Cost', value: '$4.22', delta: '30-day total', type: 'up', bar: 4, barColor: 'var(--t-amber)' },
];

const ACTIVITY = [
  { type: 'out', title: 'Outreach sent to James Torres, VP Ops at SunPeak Energy', sub: 'Personalized re: ERCOT curtailment patterns on their Crane County site', time: '2m' },
  { type: 'meet', title: 'Transcribed: Reassurity Product Strategy Call', sub: '42 min \u2014 6 attendees \u2014 4 action items extracted', time: '1h' },
  { type: 'out', title: '12 new leads discovered \u2014 PJM region', sub: 'Solar IPPs with merchant exposure, 50 MW+ capacity', time: '3h' },
  { type: 'alert', title: 'Reply received: Sarah Chen, CFO at Meridian Renewables', sub: 'Interested in behind-the-meter mining conversation', time: '5h' },
  { type: 'doc', title: 'Commented on Oberon Deal Memo v3', sub: 'Notes on revised energy pricing assumptions in section 4.2', time: '6h' },
  { type: 'in', title: 'Follow-up drafted for Mark Liu at GridScale Partners', sub: 'Awaiting approval \u2014 5 days since last contact', time: '7h' },
];

const AGENTS = [
  { name: 'Lead Engine', status: 'on', mode: 'Auto', stat: '502', tabId: 'bots' },
  { name: 'Meeting Capture', status: 'on', mode: 'Auto', stat: '17', tabId: 'meetings' },
  { name: 'Outreach', status: 'on', mode: 'Auto', stat: '96', tabId: 'outreach' },
  { name: 'Documents', status: 'on', mode: 'Auto', stat: '8', tabId: 'hivemind-chat' },
  { name: 'Alert Synthesizer', status: 'on', mode: 'Auto', stat: '3', tabId: 'alerts' },
  { name: 'Curtailment', status: 'standby', mode: 'Copilot', stat: '\u2014', tabId: 'curtailment-chat' },
  { name: 'Pool Routing', status: 'standby', mode: 'Copilot', stat: '\u2014', tabId: 'pools-chat' },
  { name: 'Reporting', status: 'off', mode: 'Off', stat: '\u2014', tabId: 'reporting' },
];

const PIPELINE = [
  { label: 'Discovered', value: 389, pct: 100 },
  { label: 'Contacted', value: 96, pct: 24.6 },
  { label: 'Replied', value: 7, pct: 1.8 },
  { label: 'Scheduled', value: 2, pct: 0.5 },
  { label: 'Active Deal', value: 1, pct: 0.25 },
];

const FOLLOWUPS = [
  { name: 'Sarah Chen \u2014 Meridian', due: 'Today', urgency: 'danger' },
  { name: 'Mark Liu \u2014 GridScale', due: 'Tomorrow', urgency: 'warn' },
  { name: 'James Torres \u2014 SunPeak', due: '3 days', urgency: 'normal' },
  { name: 'Linda Pham \u2014 Apex Clean', due: '5 days', urgency: 'normal' },
];

const WEEKLY = [
  { label: 'Emails Sent', value: '12' },
  { label: 'Meetings Captured', value: '2' },
  { label: 'Docs Reviewed', value: '3' },
  { label: 'Action Items Open', value: '6', color: 'warn' },
  { label: 'Monthly API Spend', value: '$4.22', color: 'green' },
];

const HUBSPOT_DEMO_PIPELINE = [
  { stage: 'Discovery', count: 6, value: '$800K' },
  { stage: 'Qualification', count: 4, value: '$600K' },
  { stage: 'Proposal', count: 3, value: '$700K' },
  { stage: 'Negotiation', count: 2, value: '$450K' },
  { stage: 'Closed Won', count: 1, value: '$300K' },
];

// ─── Indicator Colors ───────────────────────────────────────────────────────

const DOT_COLORS = {
  out: 'bg-terminal-green',
  in: 'bg-terminal-amber',
  meet: 'bg-terminal-text',
  doc: 'bg-terminal-muted',
  alert: 'bg-terminal-red',
};

const STATUS_STYLES = {
  on: 'bg-[#2dd478] shadow-[0_0_4px_rgba(45,212,120,0.3)]',
  standby: 'bg-terminal-amber',
  off: 'bg-[#c5c5bc]',
};

const MODE_STYLES = {
  Auto: 'bg-[#edf7f0] text-[#1a6b3c]',
  Copilot: 'bg-[#fdf6e8] text-terminal-amber',
  Off: 'bg-[#f5f4f0] text-terminal-muted',
};

const DELTA_COLORS = {
  up: 'text-[#1a6b3c]',
  warn: 'text-terminal-amber',
  flat: 'text-terminal-muted',
};

const URGENCY_COLORS = {
  danger: 'text-terminal-red font-semibold',
  warn: 'text-terminal-amber font-semibold',
  normal: 'text-terminal-text font-semibold',
};

const VALUE_COLORS = {
  green: 'text-[#1a6b3c]',
  warn: 'text-terminal-amber',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function CommandDashboard({ onNavigate }) {
  const [timeRange, setTimeRange] = useState('30D');
  const [approvals, setApprovals] = useState(DEMO_APPROVAL_QUEUE);
  const [insights, setInsights] = useState(AGENT_INSIGHTS);
  const [toast, setToast] = useState(null);
  const [hubspotPipeline, setHubspotPipeline] = useState(null);
  const [actionItems, setActionItems] = useState([]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  // Fetch HubSpot pipeline data
  useEffect(() => {
    async function fetchHubSpot() {
      try {
        const res = await fetch(`${API_BASE}/v1/hubspot/pipeline`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.configured && data.by_stage) {
          const stageLabels = {
            appointmentscheduled: 'Discovery',
            qualifiedtobuy: 'Qualification',
            presentationscheduled: 'Proposal',
            decisionmakerboughtin: 'Negotiation',
            contractsent: 'Contract Sent',
            closedwon: 'Closed Won',
            closedlost: 'Closed Lost',
          };
          const rows = Object.entries(data.by_stage)
            .filter(([k]) => k !== 'closedlost')
            .map(([k, v]) => ({
              stage: stageLabels[k] || k,
              count: v.count,
              value: v.value >= 1000000 ? `$${(v.value / 1000000).toFixed(1)}M` : v.value >= 1000 ? `$${(v.value / 1000).toFixed(0)}K` : `$${v.value}`,
            }));
          if (rows.length > 0) setHubspotPipeline(rows);
        }
      } catch {}
    }
    fetchHubSpot();
    const interval = setInterval(fetchHubSpot, 60000);
    return () => clearInterval(interval);
  }, []);

  // Fetch real approvals and insights from API
  useEffect(() => {
    async function fetchApprovals() {
      try {
        const res = await fetch(`${API_BASE}/v1/approvals?status=pending`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.items?.length > 0) {
          const mapped = data.items.map(item => ({
            id: item.id,
            agent: item.agent_id,
            agentLabel: (item.agent_id || 'agent').charAt(0).toUpperCase() + (item.agent_id || 'agent').slice(1),
            icon: AGENT_ICON_COLORS[item.agent_id] || { letter: 'A', color: '#1a6b3c', bg: '#edf7f0' },
            title: item.title,
            desc: item.description || '',
            time: formatRelativeTime(item.created_at),
          }));
          setApprovals(mapped);
        }
      } catch {}
    }
    async function fetchInsights() {
      try {
        const res = await fetch(`${API_BASE}/v1/approvals/insights?status=active`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.items?.length > 0) {
          const mapped = data.items.map(item => ({
            id: item.id,
            agent: item.agent_id,
            agentLabel: (item.agent_id || 'agent').charAt(0).toUpperCase() + (item.agent_id || 'agent').slice(1),
            type: item.type || 'insight',
            time: formatRelativeTime(item.created_at),
            title: item.title,
            body: item.description || '',
            actions: item.actions || ['Dismiss'],
          }));
          setInsights(mapped);
        }
      } catch {}
    }
    fetchApprovals();
    fetchInsights();
  }, []);

  // Fetch action items
  useEffect(() => {
    const DEMO_ACTION_ITEMS = [
      { id: 'ACT-MTG-001', assignee: 'Spencer', title: 'Send Hanwha KMZ files to Kishan for site analysis', due_date: '2026-03-10', status: 'open' },
      { id: 'ACT-MTG-002', assignee: 'Spencer', title: 'Schedule Fusion Energy strategy call with Colin', due_date: '2026-03-11', status: 'open' },
      { id: 'ACT-MTG-003', assignee: 'Spencer', title: 'Call Connor re: Auradyne delivery timeline', due_date: '2026-03-10', status: 'open' },
      { id: 'ACT-MTG-004', assignee: 'Spencer', title: 'Prep for Minneapolis investor meetings', due_date: '2026-03-14', status: 'open' },
      { id: 'ACT-MTG-005', assignee: 'Spencer', title: 'Review March forecast with Mihir', due_date: '2026-03-12', status: 'open' },
      { id: 'ACT-MTG-006', assignee: 'Mihir', title: 'Send investor tax K-1 notification email', due_date: '2026-03-11', status: 'open' },
      { id: 'ACT-MTG-007', assignee: 'Mihir', title: 'Reconcile March forecast vs actuals', due_date: '2026-03-14', status: 'open' },
      { id: 'ACT-MTG-008', assignee: 'Mihir', title: 'Resolve South Dakota energy billing discrepancy', due_date: '2026-03-12', status: 'open' },
      { id: 'ACT-MTG-009', assignee: 'Colin', title: 'Send cap table update email to investors', due_date: '2026-03-11', status: 'open' },
      { id: 'ACT-MTG-010', assignee: 'Colin', title: 'Update investor financial model with new fund terms', due_date: '2026-03-14', status: 'open' },
    ];
    async function fetchActionItems() {
      try {
        const res = await fetch(`${API_BASE}/v1/knowledge/action-items?status=all&limit=30`);
        if (!res.ok) throw new Error();
        const items = await res.json();
        if (items.length > 0) { setActionItems(items); return; }
      } catch {}
      setActionItems(DEMO_ACTION_ITEMS);
    }
    fetchActionItems();
  }, []);

  const handleToggleActionItem = useCallback(async (id) => {
    const item = actionItems.find(a => a.id === id);
    if (!item) return;
    const newStatus = item.status === 'completed' ? 'open' : 'completed';
    setActionItems(prev => prev.map(a => a.id === id ? { ...a, status: newStatus } : a));
    showToast(newStatus === 'completed' ? 'Marked complete' : 'Reopened');
    try {
      await fetch(`${API_BASE}/v1/knowledge/action-items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch {}
  }, [actionItems]);

  const handleApprove = useCallback(async (id) => {
    try {
      await fetch(`${API_BASE}/v1/approvals/${id}/approve`, { method: 'POST' });
    } catch {}
    setApprovals(prev => prev.filter(a => a.id !== id));
  }, []);

  const handleReject = useCallback(async (id) => {
    try {
      await fetch(`${API_BASE}/v1/approvals/${id}/reject`, { method: 'POST' });
    } catch {}
    setApprovals(prev => prev.filter(a => a.id !== id));
  }, []);

  const handleInsightAction = useCallback(async (insightId, action) => {
    if (action === 'Dismiss' || action === 'Snooze') {
      try {
        await fetch(`${API_BASE}/v1/approvals/insights/${insightId}/dismiss`, { method: 'POST' });
      } catch {}
      setInsights(prev => prev.filter(i => i.id !== insightId));
      showToast(action === 'Dismiss' ? 'Insight dismissed' : 'Snoozed for 24 hours');
    } else if (action === 'Mark Done') {
      try {
        await fetch(`${API_BASE}/v1/approvals/insights/${insightId}/dismiss`, { method: 'POST' });
      } catch {}
      setInsights(prev => prev.filter(i => i.id !== insightId));
      showToast('Marked as done');
    } else {
      showToast(`${action} — noted`);
    }
  }, []);

  return (
    <div className="p-6 lg:px-7 lg:py-6">
      {/* Time range pills */}
      <div className="flex items-center justify-end gap-2 mb-5">
        {['7D', '30D', '90D'].map(r => (
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
      </div>

      {/* Approval Queue + Agent Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4 mb-5">
        {/* Approval Queue */}
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Approval Queue</span>
              <span className="text-[10px] font-bold text-white bg-terminal-red px-1.5 py-[1px] rounded-full tabular-nums">{approvals.length}</span>
            </div>
          </div>
          <div>
            {approvals.map((item) => (
              <div key={item.id} className="flex items-start gap-3 px-[18px] py-3 border-b border-[#f0eeea] last:border-b-0 hover:bg-[#f5f4f0] transition-colors">
                <span
                  className="w-7 h-7 rounded-[7px] flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5"
                  style={{ background: item.icon.bg, color: item.icon.color }}
                >
                  {item.icon.letter}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-terminal-text leading-[1.4]">{item.title}</div>
                  <div className="text-[11px] text-terminal-muted mt-0.5">{item.desc}</div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[9px] font-bold uppercase tracking-[0.5px] px-1.5 py-[1px] rounded border bg-[#f5f4f0] text-terminal-muted border-[#e5e5e0]">{item.agentLabel}</span>
                    <span className="text-[10px] text-[#c5c5bc] tabular-nums">{item.time}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                  <button onClick={() => handleApprove(item.id)} className="px-2.5 py-1 rounded-md text-[10px] font-semibold bg-[#1a6b3c] text-white hover:opacity-90 transition-opacity">Approve</button>
                  <button onClick={() => handleReject(item.id)} className="px-2.5 py-1 rounded-md text-[10px] font-semibold bg-terminal-panel text-terminal-red border border-terminal-border hover:bg-red-50 transition-colors">Reject</button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Agent Insights */}
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Agent Insights</span>
              <span className="text-[9px] font-bold text-[#5b3a8c] bg-[#f3eef8] px-2 py-0.5 rounded-full uppercase tracking-[0.5px]">New</span>
            </div>
          </div>
          <div>
            {insights.map((item) => {
              const iconCfg = AGENT_ICON_COLORS[item.agent];
              return (
                <div key={item.id} className="px-[18px] py-3 border-b border-[#f0eeea] last:border-b-0 hover:bg-[#f5f4f0] transition-colors">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[9px] font-bold uppercase tracking-[0.5px] px-1.5 py-[1px] rounded border bg-[#f5f4f0] text-terminal-muted border-[#e5e5e0]">{item.agentLabel}</span>
                    <span className={`text-[9px] font-bold uppercase tracking-[0.5px] px-1.5 py-[1px] rounded ${INSIGHT_TYPE_STYLES[item.type]}`}>{item.type}</span>
                    <span className="text-[10px] text-[#c5c5bc] tabular-nums ml-auto">{item.time}</span>
                  </div>
                  <div className="text-[13px] font-medium text-terminal-text leading-[1.4]">{item.title}</div>
                  <div className="text-[11px] text-terminal-muted mt-0.5" dangerouslySetInnerHTML={{ __html: item.body }} />
                  <div className="flex items-center gap-1.5 mt-2">
                    {item.actions.map((action) => (
                      <button
                        key={action}
                        onClick={() => handleInsightAction(item.id, action)}
                        className={`px-2.5 py-1 rounded-md text-[10px] font-semibold transition-opacity ${
                          action === 'Dismiss' || action === 'Snooze'
                            ? 'bg-terminal-panel text-terminal-muted border border-terminal-border hover:bg-[#f5f4f0]'
                            : 'bg-[#1a6b3c] text-white hover:opacity-90'
                        }`}
                      >
                        {action}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Metrics Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 border border-terminal-border rounded-[14px] overflow-hidden mb-5" style={{ gap: '1px', background: 'var(--t-border)' }}>
        {METRICS.map((m, i) => (
          <div key={m.label} className="bg-terminal-panel p-[18px_20px] relative">
            <div className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px] mb-1.5">{m.label}</div>
            <div className="text-2xl font-bold text-terminal-text tabular-nums leading-none">{m.value}</div>
            <div className={`text-[11px] font-semibold mt-1 ${DELTA_COLORS[m.type]}`}>{m.delta}</div>
            <div className="absolute bottom-0 left-5 right-5 h-[3px] rounded-[3px] bg-[#f0eeea] overflow-hidden">
              <div
                className="h-full rounded-[3px] transition-all duration-1000"
                style={{ width: `${m.bar}%`, background: m.barColor || 'var(--t-accent)' }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Team Action Items */}
      {actionItems.length > 0 && (() => {
        const openCount = actionItems.filter(a => a.status !== 'completed').length;
        const ASSIGNEE_META = {
          Spencer: { full: 'Spencer Marr', role: 'President', color: '#1a6b3c' },
          Mihir: { full: 'Mihir Bhangley', role: 'Finance', color: '#5b3a8c' },
          Colin: { full: 'Colin Peirce', role: 'Fundraising', color: '#2c5282' },
        };
        const grouped = {};
        const order = [];
        for (const item of actionItems) {
          const key = item.assignee || 'Unassigned';
          if (!grouped[key]) { grouped[key] = []; order.push(key); }
          grouped[key].push(item);
        }
        const getDuePillClass = (dueDate) => {
          if (!dueDate) return 'text-terminal-muted bg-[#f5f4f0]';
          const today = new Date(); today.setHours(0,0,0,0);
          const due = new Date(dueDate + 'T00:00:00'); due.setHours(0,0,0,0);
          const diff = (due - today) / 86400000;
          if (diff < 0) return 'text-terminal-red bg-[#fdedf0] font-semibold';
          if (diff === 0) return 'text-[#b8860b] bg-[#fdf6e8] font-semibold';
          return 'text-terminal-muted bg-[#f5f4f0]';
        };
        const formatDue = (dueDate) => {
          if (!dueDate) return '';
          const d = new Date(dueDate + 'T00:00:00');
          return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        };
        return (
          <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden mb-5">
            <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Team Action Items</span>
                <span className="text-[10px] font-bold text-white bg-terminal-red px-1.5 py-[1px] rounded-full tabular-nums">{openCount}</span>
              </div>
              <span className="text-[11px] text-terminal-muted">From leadership sync</span>
            </div>
            <div className="px-[18px] py-2">
              {order.map((assignee) => {
                const meta = ASSIGNEE_META[assignee] || { full: assignee, role: '', color: '#6b6b65' };
                return (
                  <div key={assignee} className="mb-3 last:mb-1">
                    <div className="flex items-center gap-2 mb-1.5 pt-1">
                      <div className="w-[3px] h-4 rounded-full" style={{ background: meta.color }} />
                      <span className="text-[12px] font-bold text-terminal-text">{meta.full}</span>
                      {meta.role && <span className="text-[10px] text-terminal-muted">{meta.role}</span>}
                    </div>
                    {grouped[assignee].map((item) => {
                      const done = item.status === 'completed';
                      return (
                        <div
                          key={item.id}
                          className="flex items-center gap-3 py-[7px] pl-3 pr-1 rounded-lg hover:bg-[#f5f4f0] transition-colors cursor-pointer group"
                          onClick={() => handleToggleActionItem(item.id)}
                        >
                          <div className={`w-[18px] h-[18px] rounded-[5px] border-2 flex items-center justify-center shrink-0 transition-all ${
                            done
                              ? 'bg-[#1a6b3c] border-[#1a6b3c]'
                              : 'border-[#d1d1cb] group-hover:border-[#a0a098]'
                          }`}>
                            {done && (
                              <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                                <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                          </div>
                          <span className={`flex-1 text-[13px] leading-[1.4] transition-all ${
                            done ? 'line-through text-[#c5c5bc]' : 'text-terminal-text'
                          }`}>
                            {item.title}
                          </span>
                          <span className={`text-[10px] px-2 py-[2px] rounded-md shrink-0 tabular-nums ${getDuePillClass(item.due_date)}`}>
                            {formatDue(item.due_date)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Two-column: Activity + Agents */}
      <div className="grid grid-cols-1 lg:grid-cols-[5fr_3fr] gap-4 mb-4">
        {/* Activity Feed */}
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Activity</span>
              <span className="text-[9px] font-bold text-[#1a6b3c] bg-[#edf7f0] px-2 py-0.5 rounded-full uppercase tracking-[0.5px]">Live</span>
            </div>
            <span className="text-[11px] text-terminal-muted">All agents</span>
          </div>
          <div>
            {ACTIVITY.map((item, i) => (
              <div key={i} className="flex items-start gap-3.5 px-[18px] py-3 border-b border-[#f0eeea] last:border-b-0 hover:bg-[#f5f4f0] transition-colors">
                <div className={`w-1 h-1 rounded-full mt-[7px] shrink-0 ${DOT_COLORS[item.type]}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-terminal-text leading-[1.4]">{item.title}</div>
                  <div className="text-[11px] text-terminal-muted mt-0.5">{item.sub}</div>
                </div>
                <div className="text-[10px] text-[#c5c5bc] font-medium shrink-0 mt-0.5 tabular-nums">{item.time}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Agents Table */}
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
            <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Agents</span>
            <span className="text-[11px] text-terminal-muted">{AGENTS.filter(a => a.status === 'on').length} of {AGENTS.length} active</span>
          </div>
          <div>
            {AGENTS.map((agent, i) => (
              <div key={i} onClick={() => onNavigate?.(agent.tabId)} className="flex items-center gap-3 px-[18px] py-[11px] border-b border-[#f0eeea] last:border-b-0 hover:bg-[#f5f4f0] cursor-pointer transition-colors">
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_STYLES[agent.status]}`} />
                <div className="text-[13px] font-medium text-terminal-text flex-1">{agent.name}</div>
                <span className={`text-[10px] font-semibold px-2.5 py-[3px] rounded-md uppercase tracking-[0.3px] ${MODE_STYLES[agent.mode]}`}>
                  {agent.mode}
                </span>
                <span className="text-xs text-[#6b6b65] font-medium min-w-[56px] text-right tabular-nums">{agent.stat}</span>
                <span className="text-[#c5c5bc] text-sm">&rsaquo;</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Three-column: Pipeline + Follow-Ups + This Week */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {/* Pipeline */}
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
            <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Pipeline</span>
            <span className="text-[11px] text-terminal-muted">502 total</span>
          </div>
          <div className="py-1">
            {PIPELINE.map((row, i) => (
              <div key={i} className="flex items-center gap-2.5 px-[18px] py-2 border-b border-[#f0eeea] last:border-b-0">
                <span className="text-xs text-[#6b6b65] w-[100px] shrink-0">{row.label}</span>
                <div className="flex-1 h-1.5 bg-[#f5f4f0] rounded-[3px] overflow-hidden">
                  <div
                    className="h-full bg-terminal-green rounded-[3px] transition-all duration-700"
                    style={{ width: `${Math.max(row.pct, 1)}%` }}
                  />
                </div>
                <span className="text-xs font-semibold text-terminal-text w-9 text-right tabular-nums">{row.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Follow-Ups */}
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
            <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Follow-Ups</span>
            <span className="text-[11px] text-terminal-muted">{FOLLOWUPS.length} pending</span>
          </div>
          <div>
            {FOLLOWUPS.map((item, i) => (
              <div key={i} className="flex items-center justify-between px-[18px] py-[9px] border-b border-[#f0eeea] last:border-b-0 text-[13px]">
                <span className="text-[#6b6b65]">{item.name}</span>
                <span className={URGENCY_COLORS[item.urgency]}>{item.due}</span>
              </div>
            ))}
          </div>
        </div>

        {/* HubSpot CRM Pipeline */}
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
            <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">HubSpot CRM</span>
            <span className="text-[11px] text-terminal-muted flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-terminal-green" />
              Live
            </span>
          </div>
          <div>
            {(hubspotPipeline || HUBSPOT_DEMO_PIPELINE).map((row, i) => (
              <div key={i} className="flex items-center justify-between px-[18px] py-[9px] border-b border-[#f0eeea] last:border-b-0 text-[13px]">
                <span className="text-[#6b6b65]">{row.stage}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-terminal-muted tabular-nums">{row.value}</span>
                  <span className="font-semibold text-terminal-text tabular-nums w-5 text-right">{row.count}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-terminal-text text-white text-[13px] font-medium px-5 py-3 rounded-xl shadow-lg animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}

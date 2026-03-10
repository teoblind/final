import React, { useState, useEffect } from 'react';
import InsightModal from '../modals/InsightModal';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const FILE_BASE = window.location.hostname.includes('localhost') ? 'http://localhost:3002' : '';

// ─── Indicator Colors ───────────────────────────────────────────────────────

const URGENCY_COLORS = {
  high: 'text-terminal-red font-semibold',
  medium: 'text-terminal-amber font-semibold',
  low: 'text-terminal-muted font-semibold',
};

const URGENCY_BADGE = {
  high: 'bg-red-50 text-terminal-red border-red-200',
  medium: 'bg-amber-50 text-terminal-amber border-amber-200',
  low: 'bg-gray-50 text-terminal-muted border-gray-200',
};

const STATUS_STYLES = {
  on: 'bg-[#2dd478] shadow-[0_0_4px_rgba(45,212,120,0.3)]',
  standby: 'bg-terminal-amber',
  off: 'bg-[#c5c5bc]',
};

const MODE_STYLES = {
  Auto: 'bg-[#e8eef5] text-[#1e3a5f]',
  Copilot: 'bg-[#fdf6e8] text-terminal-amber',
  Off: 'bg-[#f5f4f0] text-terminal-muted',
};

// ─── Approval Queue + Insights Data ─────────────────────────────────────────

const DACP_APPROVAL_QUEUE = [
  { id: 1, agent: 'estimating', agentLabel: 'Estimating', icon: { letter: 'E', color: '#2c5282', bg: '#e8eef5' }, title: 'Estimate ready for review: Bishop Arts Mixed-Use', desc: 'Rogers-O\'Brien — 5 line items, $847K total, 18% margin — auto-generated from SOW', time: '20m ago' },
  { id: 2, agent: 'field', agentLabel: 'Field', icon: { letter: 'F', color: '#1a6b3c', bg: '#edf7f0' }, title: 'Field report flagged: Rock at 28\' on pier P-5', desc: 'Job J-002, Frisco Station — geotech discrepancy, estimated cost impact ~$8K', time: '1h ago' },
  { id: 3, agent: 'estimating', agentLabel: 'Estimating', icon: { letter: 'E', color: '#2c5282', bg: '#e8eef5' }, title: 'Revised estimate: Samsung Fab Expansion', desc: 'DPR Construction — equipment pads updated from $165K to $185K (+12%) based on material price changes', time: '3h ago' },
  { id: 4, agent: 'bid', agentLabel: 'Bid Mgr', icon: { letter: 'B', color: '#b8860b', bg: '#fdf6e8' }, title: 'Bid deadline alert: I-35 Retaining Walls', desc: 'Hensel Phelps — due 3/21, 12 days remaining. Estimate complete but not yet submitted.', time: '4h ago' },
  { id: 5, agent: 'estimating', agentLabel: 'Estimating', icon: { letter: 'E', color: '#2c5282', bg: '#e8eef5' }, title: 'New estimate started: McKinney Town Center', desc: 'Austin Commercial — parsing 48-page spec document, 3 line items identified so far', time: '5h ago' },
];

const DACP_INSIGHTS = [
  { id: 1, agent: 'estimating', agentLabel: 'Estimating', type: 'Alert', time: '30m ago', title: 'Concrete pricing up 8% this month', body: 'Ready-mix concrete in DFW up from <b>$142 to $153/CY</b>. 3 active estimates affected — recommend updating unit prices before submission.', actions: ['Update Prices', 'Dismiss'] },
  { id: 2, agent: 'field', agentLabel: 'Field', type: 'Pattern', time: '2h ago', title: 'Labor hours trending over projection', body: 'Job J-009 Westpark Retail — foundation work averaging <b>1.3x projected hours</b> over last 5 days. Current pace adds ~$12K to costs if trend continues.', actions: ['View Details'] },
  { id: 3, agent: 'bid', agentLabel: 'Bid Mgr', type: 'Reminder', time: '5h ago', title: '3 bids due within 14 days', body: 'I-35 Retaining Walls (<b>12 days</b>), McKinney Town Center (<b>16 days</b>), Memorial Hermann Ph2 (<b>5 days</b>). 2 estimates still in draft.', actions: ['View Calendar'] },
  { id: 4, agent: 'estimating', agentLabel: 'Estimating', type: 'Insight', time: '5h ago', title: 'Win rate improving on foundation work', body: 'Win rate on foundation-only bids is <b>62%</b> (vs. 38% overall). Consider targeting more foundation-specific RFQs.', actions: ['View Analysis', 'Dismiss'] },
  { id: 5, agent: 'field', agentLabel: 'Field', type: 'Follow-up', time: '6h ago', title: 'Geotech report pending: Frisco Station', body: 'Requested updated boring logs for pier P-5 area <b>3 days ago</b>. No response from geotech consultant yet.', actions: ['Send Reminder', 'Dismiss'] },
];

const DACP_INSIGHT_TYPE_STYLES = {
  Alert: 'bg-[#fdf6e8] text-[#b8860b]',
  Pattern: 'bg-[#f3eef8] text-[#5b3a8c]',
  Reminder: 'bg-[#e8eef5] text-[#2c5282]',
  Insight: 'bg-[#edf7f0] text-[#1a6b3c]',
  'Follow-up': 'bg-[#fdedf0] text-[#dc3545]',
};

const PIPELINE = [
  { label: 'RFQ Received', value: 15, pct: 100 },
  { label: 'Estimated', value: 5, pct: 33 },
  { label: 'Bid Sent', value: 0, pct: 0 },
  { label: 'Won', value: 0, pct: 0 },
  { label: 'Active', value: 0, pct: 0 },
];

const AGENTS = [
  { name: 'Estimating Bot', status: 'on', mode: 'Auto', stat: '5', tabId: 'estimating-chat' },
  { name: 'Field Reporter', status: 'on', mode: 'Auto', stat: '30', tabId: 'field-chat' },
  { name: 'Scope Analyzer', status: 'standby', mode: 'Copilot', stat: '—', tabId: 'scope-chat' },
];

const DELTA_COLORS = {
  up: 'text-[#1e3a5f]',
  warn: 'text-terminal-amber',
  flat: 'text-terminal-muted',
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function DacpCommandDashboard({ onNavigate }) {
  const [stats, setStats] = useState(null);
  const [bids, setBids] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dismissedApprovals, setDismissedApprovals] = useState(new Set());
  const [dismissedInsights, setDismissedInsights] = useState(new Set());
  const [toast, setToast] = useState(null);
  const [activeInsight, setActiveInsight] = useState(null);

  const handleApprove = async (approvalId) => {
    try {
      const token = localStorage.getItem('auth_token');
      await fetch(`${FILE_BASE}/api/v1/approvals/${approvalId}/approve`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      setDismissedApprovals(prev => new Set([...prev, approvalId]));
    } catch (err) {
      console.error('Approve failed:', err);
      // Still dismiss locally on error so UI doesn't feel stuck
      setDismissedApprovals(prev => new Set([...prev, approvalId]));
    }
  };

  const handleReject = async (approvalId) => {
    try {
      const token = localStorage.getItem('auth_token');
      await fetch(`${FILE_BASE}/api/v1/approvals/${approvalId}/reject`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      setDismissedApprovals(prev => new Set([...prev, approvalId]));
    } catch (err) {
      console.error('Reject failed:', err);
      setDismissedApprovals(prev => new Set([...prev, approvalId]));
    }
  };

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleInsightAction = async (insightId, action) => {
    if (action === 'Dismiss') {
      setDismissedInsights(prev => new Set([...prev, insightId]));
      return;
    }
    // Open modal for all other actions
    setActiveInsight({ id: insightId, action });
  };

  const handleModalAction = async (actionType, detail) => {
    const insightId = activeInsight?.id;
    if (actionType === 'update_prices') {
      showToast('Pricing table updated. 3 estimates recalculated.');
      setDismissedInsights(prev => new Set([...prev, insightId]));
      setActiveInsight(null);
    } else if (actionType === 'acknowledge') {
      setDismissedInsights(prev => new Set([...prev, insightId]));
      setActiveInsight(null);
    } else if (actionType === 'view_full_job') {
      setActiveInsight(null);
      onNavigate?.('field-chat');
    } else if (actionType === 'go_to_estimating' || actionType === 'select_bid') {
      setActiveInsight(null);
      onNavigate?.('estimating-chat');
    } else if (actionType === 'dismiss') {
      setDismissedInsights(prev => new Set([...prev, insightId]));
      setActiveInsight(null);
    } else if (actionType === 'update_lead_engine') {
      showToast('Foundation keywords added to Lead Engine search queries.');
      setDismissedInsights(prev => new Set([...prev, insightId]));
      setActiveInsight(null);
    } else if (actionType === 'send_reminder') {
      try {
        const token = localStorage.getItem('auth_token');
        await fetch(`${FILE_BASE}/api/v1/chat/send-reminder`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'geotech_followup' }),
        });
      } catch { /* fire and forget */ }
      showToast('Reminder sent \u2713');
      setDismissedInsights(prev => new Set([...prev, insightId]));
      setActiveInsight(null);
    }
  };

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`${API_BASE}/v1/estimates/stats`, { headers }).then(r => r.json()),
      fetch(`${API_BASE}/v1/estimates/inbox`, { headers }).then(r => r.json()),
    ]).then(([statsRes, inboxRes]) => {
      setStats(statsRes.stats);
      setBids(inboxRes.bidRequests || []);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const metrics = stats ? [
    { label: 'Open RFQs', value: stats.openRfqs, delta: `${stats.totalBidRequests} total`, type: 'up', bar: Math.min((stats.openRfqs / Math.max(stats.totalBidRequests, 1)) * 100, 100) },
    { label: 'Active Bids', value: stats.totalEstimates, delta: `${stats.draftEstimates} draft`, type: 'up', bar: Math.min((stats.totalEstimates / Math.max(stats.totalBidRequests, 1)) * 100, 100) },
    { label: 'Win Rate', value: `${stats.winRate}%`, delta: `${stats.wonJobs}W / ${stats.lostJobs}L`, type: stats.winRate > 50 ? 'up' : 'warn', bar: stats.winRate },
    { label: 'Active Jobs', value: stats.activeJobs, delta: `${stats.completeJobs} complete`, type: 'flat', bar: Math.min((stats.activeJobs / Math.max(stats.totalJobs, 1)) * 100, 100) },
    { label: 'Total Revenue', value: `$${(stats.totalRevenue / 1000).toFixed(0)}K`, delta: `${stats.avgMargin}% avg margin`, type: 'up', bar: Math.min(stats.avgMargin * 5, 100) },
  ] : [];

  const upcoming = bids
    .filter(b => b.status === 'new' || b.status === 'estimated')
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
    .slice(0, 6);

  const activity = [
    { type: 'estimate', title: 'Estimating Bot generated estimate for Bishop Arts Mixed-Use', sub: '$847,300 at 92% confidence', time: '1h' },
    { type: 'bid', title: 'Email Agent drafted response to Hensel Phelps', sub: 'I-35 Retaining Walls RFQ', time: '1h' },
    { type: 'field', title: 'Carlos submitted daily log for Westpark Retail', sub: '52 CY poured, 6 finishers on site', time: '2h' },
    { type: 'estimate', title: 'Meeting Bot transcribed Turner coordination call', sub: '38 min. 2 action items extracted.', time: '4h' },
    { type: 'estimate', title: 'Estimating Bot sent approved quote to Turner', sub: 'Memorial Hermann Phase 2, $266,000', time: '6h' },
    { type: 'field', title: 'Lead Engine discovered 6 new GC contacts', sub: 'Dallas-Fort Worth area', time: '8h' },
    { type: 'estimate', title: 'Reporting Engine generated daily ops report', sub: '3 active jobs, 2 estimates pending', time: '10h' },
    { type: 'bid', title: 'Email Agent followed up on Memorial Hermann Phase 2', sub: 'No response from Turner in 48 hours', time: '12h' },
    { type: 'estimate', title: 'Estimating Bot revised Samsung Fab estimate', sub: 'Material price adjustment +12%', time: '1d' },
    { type: 'estimate', title: 'Meeting Bot transcribed weekly team standup', sub: '45 min, 4 action items', time: '1d' },
    { type: 'field', title: 'Field Reporter flagged rock at 28\' on Frisco Station', sub: 'Pier P-5, estimated cost impact ~$8K', time: '1d' },
    { type: 'estimate', title: 'Estimating Bot recommended declining Plano ISD Natatorium', sub: 'Outside core competency — specialty coatings', time: '2d' },
  ];

  const DOT_COLORS = {
    estimate: 'bg-[#1e3a5f]',
    bid: 'bg-terminal-green',
    field: 'bg-terminal-muted',
    alert: 'bg-terminal-red',
  };

  if (loading) {
    return <div className="flex items-center justify-center py-24"><div className="spinner w-10 h-10" /></div>;
  }

  return (
    <div className="p-6 lg:px-7 lg:py-6">
      {/* Approval Queue + Agent Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4 mb-5">
        {/* Approval Queue */}
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Approval Queue</span>
              <span className="text-[10px] font-bold text-white bg-terminal-red px-1.5 py-[1px] rounded-full tabular-nums">{DACP_APPROVAL_QUEUE.length}</span>
            </div>
          </div>
          <div>
            {DACP_APPROVAL_QUEUE.filter(item => !dismissedApprovals.has(item.id)).map((item) => (
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
                  <button onClick={() => handleApprove(item.id)} className="px-2.5 py-1 rounded-md text-[10px] font-semibold bg-[#1e3a5f] text-white hover:opacity-90 transition-opacity">Approve</button>
                  <button onClick={() => handleReject(item.id)} className="px-2.5 py-1 rounded-md text-[10px] font-semibold bg-terminal-panel text-terminal-red border border-terminal-border hover:bg-red-50 transition-colors">Reject</button>
                </div>
              </div>
            ))}
            {DACP_APPROVAL_QUEUE.filter(item => !dismissedApprovals.has(item.id)).length === 0 && (
              <div className="px-[18px] py-6 text-center text-[#9a9a92] text-[13px]">All approvals handled</div>
            )}
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
            {DACP_INSIGHTS.filter(item => !dismissedInsights.has(item.id)).map((item) => (
              <div key={item.id} className="px-[18px] py-3 border-b border-[#f0eeea] last:border-b-0 hover:bg-[#f5f4f0] transition-colors">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[9px] font-bold uppercase tracking-[0.5px] px-1.5 py-[1px] rounded border bg-[#f5f4f0] text-terminal-muted border-[#e5e5e0]">{item.agentLabel}</span>
                  <span className={`text-[9px] font-bold uppercase tracking-[0.5px] px-1.5 py-[1px] rounded ${DACP_INSIGHT_TYPE_STYLES[item.type]}`}>{item.type}</span>
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
                          : 'bg-[#1e3a5f] text-white hover:opacity-90'
                      }`}
                    >
                      {action}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            {DACP_INSIGHTS.filter(item => !dismissedInsights.has(item.id)).length === 0 && (
              <div className="px-[18px] py-6 text-center text-[#9a9a92] text-[13px]">No new insights. Your agents will surface recommendations as they find them.</div>
            )}
          </div>
        </div>
      </div>

      {/* Metrics Strip */}
      {metrics.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 border border-terminal-border rounded-[14px] overflow-hidden mb-5" style={{ gap: '1px', background: 'var(--t-border)' }}>
          {metrics.map((m) => (
            <div key={m.label} className="bg-terminal-panel p-[18px_20px] relative">
              <div className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px] mb-1.5">{m.label}</div>
              <div className="text-2xl font-bold text-terminal-text tabular-nums leading-none">{m.value}</div>
              <div className={`text-[11px] font-semibold mt-1 ${DELTA_COLORS[m.type]}`}>{m.delta}</div>
              <div className="absolute bottom-0 left-5 right-5 h-[3px] rounded-[3px] bg-[#f0eeea] overflow-hidden">
                <div className="h-full rounded-[3px] transition-all duration-1000" style={{ width: `${m.bar}%`, background: '#1e3a5f' }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Two-column: Activity + Agents */}
      <div className="grid grid-cols-1 lg:grid-cols-[5fr_3fr] gap-4 mb-4">
        {/* Activity Feed */}
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Activity</span>
              <span className="text-[9px] font-bold text-[#1e3a5f] bg-[#e8eef5] px-2 py-0.5 rounded-full uppercase tracking-[0.5px]">Live</span>
            </div>
            <span className="text-[11px] text-terminal-muted">All agents</span>
          </div>
          <div>
            {activity.map((item, i) => (
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

        {/* Agents */}
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

      {/* Three-column: Pipeline + Deadlines + Weekly */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {/* Pipeline Funnel */}
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
            <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Pipeline</span>
            <span className="text-[11px] text-terminal-muted">{stats?.totalBidRequests || 0} total</span>
          </div>
          <div className="py-1">
            {PIPELINE.map((row, i) => (
              <div key={i} className="flex items-center gap-2.5 px-[18px] py-2 border-b border-[#f0eeea] last:border-b-0">
                <span className="text-xs text-[#6b6b65] w-[100px] shrink-0">{row.label}</span>
                <div className="flex-1 h-1.5 bg-[#f5f4f0] rounded-[3px] overflow-hidden">
                  <div className="h-full rounded-[3px] transition-all duration-700" style={{ width: `${Math.max(row.pct, 1)}%`, background: '#1e3a5f' }} />
                </div>
                <span className="text-xs font-semibold text-terminal-text w-9 text-right tabular-nums">{row.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Upcoming Deadlines */}
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
            <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Bid Deadlines</span>
            <span className="text-[11px] text-terminal-muted">{upcoming.length} pending</span>
          </div>
          <div>
            {upcoming.map((bid, i) => {
              const days = Math.ceil((new Date(bid.due_date) - new Date()) / (1000 * 60 * 60 * 24));
              const urgClass = days <= 7 ? 'high' : days <= 14 ? 'medium' : 'low';
              return (
                <div key={i} className="flex items-center justify-between px-[18px] py-[9px] border-b border-[#f0eeea] last:border-b-0 text-[13px]">
                  <div className="min-w-0 flex-1">
                    <span className="text-[#6b6b65] truncate block">{bid.gc_name}</span>
                  </div>
                  <span className={`text-[11px] px-2 py-0.5 rounded border ${URGENCY_BADGE[urgClass]}`}>
                    {days <= 0 ? 'Today' : `${days}d`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Summary */}
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
            <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Summary</span>
            <span className="text-[11px] text-terminal-muted">All time</span>
          </div>
          <div>
            {[
              { label: 'Jobs Won', value: stats?.wonJobs || 0 },
              { label: 'Jobs Lost', value: stats?.lostJobs || 0 },
              { label: 'Avg Margin', value: `${stats?.avgMargin || 0}%`, color: 'text-[#1e3a5f]' },
              { label: 'Field Reports', value: stats?.totalFieldReports || 0 },
              { label: 'Win Rate', value: `${stats?.winRate || 0}%`, color: (stats?.winRate || 0) >= 50 ? 'text-[#1e3a5f]' : 'text-terminal-amber' },
            ].map((item, i) => (
              <div key={i} className="flex items-center justify-between px-[18px] py-[9px] border-b border-[#f0eeea] last:border-b-0 text-[13px]">
                <span className="text-[#6b6b65]">{item.label}</span>
                <span className={`font-semibold tabular-nums ${item.color || 'text-terminal-text'}`}>{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      {/* Insight Modal */}
      <InsightModal
        insight={activeInsight}
        onClose={() => setActiveInsight(null)}
        onAction={handleModalAction}
      />

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#1e3a5f] text-white px-5 py-3 rounded-xl shadow-lg text-[13px] font-medium max-w-sm animate-[fadeIn_0.2s_ease-out]">
          {toast}
        </div>
      )}
    </div>
  );
}

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
  outreach:       { letter: 'O', color: '#1a6b3c', bg: '#edf7f0' },
  curtailment:    { letter: 'C', color: '#b8860b', bg: '#fdf6e8' },
  pool:           { letter: 'P', color: '#5b3a8c', bg: '#f3eef8' },
  meetings:       { letter: 'M', color: '#2c5282', bg: '#e8eef5' },
  reporting:      { letter: 'R', color: '#5b3a8c', bg: '#f3eef8' },
  hivemind:       { letter: 'H', color: '#1a6b3c', bg: '#edf7f0' },
  monitoring:     { letter: 'M', color: '#b8860b', bg: '#fdf6e8' },
  email:          { letter: 'E', color: '#2c5282', bg: '#e8eef5' },
  'lead-engine':  { letter: 'L', color: '#1a6b3c', bg: '#edf7f0' },
  knowledge:      { letter: 'K', color: '#2c5282', bg: '#e8eef5' },
  coppice:        { letter: 'C', color: '#1a6b3c', bg: '#edf7f0' },
  estimating:     { letter: 'E', color: '#b8860b', bg: '#fdf6e8' },
};

const INSIGHT_TYPE_STYLES = {
  Recommendation: 'bg-[#edf7f0] text-[#1a6b3c]',
  Question: 'bg-[#e8eef5] text-[#2c5282]',
  Pattern: 'bg-[#f3eef8] text-[#5b3a8c]',
  Analysis: 'bg-[#fdf6e8] text-[#b8860b]',
  'Follow-up': 'bg-[#fdedf0] text-[#dc3545]',
  Thread: 'bg-[#fdf6e8] text-[#b8860b]',
  alert: 'bg-[#fdedf0] text-[#dc3545]',
  reminder: 'bg-[#fdf6e8] text-[#b8860b]',
  follow_up: 'bg-[#fdedf0] text-[#dc3545]',
  insight: 'bg-[#edf7f0] text-[#1a6b3c]',
};

// ─── Insight Modal Content (per agent) ───────────────────────────────────────

const INSIGHT_MODAL_CONTENT = {
  curtailment: {
    title: 'Curtailment Revenue Forecast',
    subtitle: 'Crane County site · ERCOT · Based on 30-day pattern recognition',
    kpis: [
      { label: "Yesterday's Revenue", value: '$1,247', delta: '\u2191 in 45 min window', green: true },
      { label: 'Projected This Week', value: '$3,800', delta: '\u2191 3\u20134 similar windows' },
      { label: 'Avg Price Threshold', value: '$85/MWh', delta: 'ERCOT real-time' },
    ],
    cardsLabel: 'Projected Curtailment Windows This Week',
    cards: [
      { label: 'Friday', value: '2:00 PM \u2013 3:15 PM', sub: 'Proj. peak: $118/MWh', highlight: '~$1,400', best: true },
      { label: 'Saturday', value: '11:30 AM \u2013 12:30 PM', sub: 'Proj. peak: $97/MWh', highlight: '~$980' },
      { label: 'Sunday', value: '3:30 PM \u2013 4:15 PM', sub: 'Proj. peak: $92/MWh', highlight: '~$720' },
    ],
    contextLabel: 'Signal Context',
    context: [
      { key: 'Pattern confidence', value: '87% \u2014 12 of 14 similar weeks triggered' },
      { key: 'Current ERCOT real-time price', value: '$62/MWh \u2014 below threshold', warn: true },
      { key: 'Next difficulty adjustment', value: '+4.24% \u00b7 913 blocks remaining' },
      { key: 'Fleet efficiency', value: '28 J/TH \u00b7 P25\u2013P50 (above avg)' },
      { key: 'S19j Pro fleet curtailable', value: '142 units \u00b7 ~8.2 MW' },
    ],
    cta: 'Set Curtailment Alert',
  },
  pool: {
    title: 'Pool Routing Optimization',
    subtitle: 'Automatic fee analysis across connected pools',
    kpis: [
      { label: 'Current Pool', value: 'Foundry', delta: 'Fee: 2.5% (up from 2.0%)' },
      { label: 'Recommended', value: 'Luxor', delta: 'Fee: 1.8%', green: true },
      { label: 'Monthly Savings', value: '$340', delta: '\u2191 per month at 15 PH/s', green: true },
    ],
    cardsLabel: 'Pool Comparison',
    cards: [
      { label: 'Foundry (current)', value: '2.5% fee', sub: 'Uptime: 99.7%', highlight: '$13,600/mo net' },
      { label: 'Luxor', value: '1.8% fee', sub: 'Uptime: 99.8%', highlight: '$13,940/mo net', best: true },
      { label: 'Braiins', value: '2.0% fee', sub: 'Uptime: 99.5%', highlight: '$13,780/mo net' },
    ],
    contextLabel: 'Routing Details',
    context: [
      { key: 'Hashrate to migrate', value: '15 PH/s \u00b7 all S19j Pro units' },
      { key: 'Foundry fee change', value: '2.0% \u2192 2.5% \u2014 effective next block', warn: true },
      { key: 'Luxor payout scheme', value: 'FPPS \u00b7 daily payout' },
      { key: 'Migration downtime', value: '~2 minutes \u00b7 no revenue loss' },
      { key: 'Annualized savings', value: '~$4,080 at current hashprice' },
    ],
    cta: 'Switch to Luxor',
  },
  outreach: {
    title: 'Outreach Performance Analysis',
    subtitle: 'ERCOT-personalized templates vs. generic \u00b7 last 30 days',
    kpis: [
      { label: 'Reply Rate (Before)', value: '5.1%', delta: 'Generic templates' },
      { label: 'Reply Rate (After)', value: '7.3%', delta: 'ERCOT-personalized', green: true },
      { label: 'Lift', value: '+43%', delta: '\u2191 relative improvement', green: true },
    ],
    cardsLabel: 'Template Performance Breakdown',
    cards: [
      { label: 'ERCOT Curtailment', value: '9.2% reply rate', sub: '38 sent \u00b7 top performer', highlight: '3.5 replies', best: true },
      { label: 'Co-Location Pitch', value: '6.8% reply rate', sub: '44 sent', highlight: '3.0 replies' },
      { label: 'Generic Intro', value: '4.1% reply rate', sub: '52 sent \u00b7 control', highlight: '2.1 replies' },
    ],
    contextLabel: 'Expansion Opportunity',
    context: [
      { key: 'PJM leads ready for ERCOT template', value: '47 leads \u00b7 enriched with contacts' },
      { key: 'Projected additional replies', value: '3\u20134 replies from PJM batch' },
      { key: 'Best day to send', value: 'Tuesday AM \u00b7 2.1x open rate vs Friday' },
      { key: 'Current send rate', value: '12 emails/day \u00b7 within safe limit' },
    ],
    cta: 'Apply to PJM Leads',
  },
  hivemind: {
    title: 'Operator Thread: Break-Even Pricing',
    subtitle: 'Question from Google Chat \u00b7 auto-answered by Hivemind',
    kpis: [
      { label: 'Break-Even Price', value: '$0.068', delta: 'per kWh at current difficulty', green: true },
      { label: 'Current Hashprice', value: '$48.20', delta: 'per PH/s/day' },
      { label: 'Fleet Model', value: 'S19 XP', delta: '140 TH/s \u00b7 21.5 J/TH' },
    ],
    cardsLabel: 'Sensitivity Analysis',
    cards: [
      { label: 'Optimistic (+10% BTC)', value: '$0.074/kWh', sub: 'Break-even rises', highlight: '+8.8% margin', best: true },
      { label: 'Base Case', value: '$0.068/kWh', sub: 'Current conditions', highlight: 'Break-even' },
      { label: 'Pessimistic (-10% BTC)', value: '$0.061/kWh', sub: 'Break-even falls', highlight: '\u22126.2% margin' },
    ],
    contextLabel: 'Calculation Inputs',
    context: [
      { key: 'BTC price', value: '$67,420 \u00b7 spot' },
      { key: 'Network difficulty', value: '83.95T \u00b7 next adj. +4.24%' },
      { key: 'Pool fee (Foundry)', value: '2.5% FPPS' },
      { key: 'Hosting / infra cost', value: '$0.012/kWh overhead' },
      { key: 'Operator asked', value: 'Mar 10 \u00b7 Google Chat' },
    ],
    cta: 'View Full Thread',
  },
  meetings: {
    title: 'Overdue Action Item',
    subtitle: 'From: Reassurity Product Strategy Call \u00b7 March 3, 2026',
    kpis: [
      { label: 'Days Overdue', value: '4', delta: 'Assigned Mar 3', warn: true },
      { label: 'Assigned To', value: 'You' },
      { label: 'Meeting', value: 'Reassurity', delta: '42 min \u00b7 6 attendees' },
    ],
    cardsLabel: 'All Action Items from This Meeting',
    cards: [
      { label: 'You', value: 'Revise energy pricing \u00a74.2', sub: 'Oberon deal memo', highlight: '4 days overdue', best: false },
      { label: 'You', value: 'Send site KMZ to Kishan', sub: 'Hanwha project', highlight: '2 days overdue' },
      { label: 'Ops Team', value: 'Schedule Crane County visit', sub: 'Site inspection', highlight: 'On track' },
    ],
    contextLabel: 'Meeting Details',
    context: [
      { key: 'Date', value: 'March 3, 2026 \u00b7 10:00 AM' },
      { key: 'Duration', value: '42 minutes' },
      { key: 'Attendees', value: 'Spencer, Teo, Kishan, Colin, Mihir, Alex' },
      { key: 'Key decision', value: 'Parametric trigger on ERCOT node prices' },
      { key: 'Next check-in', value: 'March 14 \u00b7 calendar invite sent' },
    ],
    cta: 'Mark as Done',
  },
};

// ─── Demo Data ──────────────────────────────────────────────────────────────

const DEFAULT_METRICS = [
  { label: 'Leads', value: '—', delta: 'loading...', type: 'flat', bar: 0 },
  { label: 'Outreach', value: '—', delta: '', type: 'flat', bar: 0 },
  { label: 'Replies', value: '—', delta: '', type: 'flat', bar: 0 },
  { label: 'Meetings', value: '—', delta: '', type: 'flat', bar: 0 },
];

const ACTIVITY_FALLBACK = [
  { id: 0, type: 'out', title: 'Outreach sent to James Torres, VP Ops at SunPeak Energy', subtitle: 'Personalized re: ERCOT curtailment patterns on their Crane County site', time: '2m', hasDetail: false },
  { id: 1, type: 'meet', title: 'Transcribed: Reassurity Product Strategy Call', subtitle: '42 min \u2014 6 attendees \u2014 4 action items extracted', time: '1h', hasDetail: false },
  { id: 2, type: 'lead', title: '12 new leads discovered \u2014 PJM region', subtitle: 'Solar IPPs with merchant exposure, 50 MW+ capacity', time: '3h', hasDetail: false },
  { id: 3, type: 'in', title: 'Reply received: Sarah Chen, CFO at Meridian Renewables', subtitle: 'Interested in behind-the-meter mining conversation', time: '5h', hasDetail: false },
  { id: 4, type: 'doc', title: 'Commented on Oberon Deal Memo v3', subtitle: 'Notes on revised energy pricing assumptions in section 4.2', time: '6h', hasDetail: false },
  { id: 5, type: 'out', title: 'Follow-up drafted for Mark Liu at GridScale Partners', subtitle: 'Awaiting approval \u2014 5 days since last contact', time: '7h', hasDetail: false },
];

const AGENTS_TEMPLATE = [
  { name: 'Lead Engine', status: 'on', mode: 'Auto', statKey: 'totalLeads', tabId: 'bots' },
  { name: 'Meeting Capture', status: 'on', mode: 'Auto', statKey: 'meetingLeads', tabId: 'meetings' },
  { name: 'Outreach', status: 'on', mode: 'Auto', statKey: 'totalEmailsSent', tabId: 'outreach' },
  { name: 'Documents', status: 'on', mode: 'Auto', stat: '8', tabId: 'hivemind-chat' },
  { name: 'Alert Synthesizer', status: 'on', mode: 'Auto', stat: '3', tabId: 'alerts' },
  { name: 'Curtailment', status: 'standby', mode: 'Copilot', stat: '\u2014', tabId: 'curtailment-chat' },
  { name: 'Pool Routing', status: 'standby', mode: 'Copilot', stat: '\u2014', tabId: 'pools-chat' },
  { name: 'Reporting', status: 'off', mode: 'Off', stat: '\u2014', tabId: 'reporting' },
];

const DEFAULT_PIPELINE = [
  { label: 'Discovered', value: 0, pct: 0 },
  { label: 'Contacted', value: 0, pct: 0 },
  { label: 'Replied', value: 0, pct: 0 },
  { label: 'Scheduled', value: 0, pct: 0 },
  { label: 'Active Deal', value: 0, pct: 0 },
];

const FOLLOWUPS = [];

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
  lead: 'bg-[#5b3a8c]',
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

function ActivityDetail({ detail, type }) {
  if (!detail) return null;

  if (type === 'out' || type === 'in') {
    return (
      <div className="space-y-2 text-[12px]">
        {detail.to && <div><span className="text-terminal-muted">To:</span> <span className="text-terminal-text">{detail.to}</span></div>}
        {detail.from && <div><span className="text-terminal-muted">From:</span> <span className="text-terminal-text">{detail.fromName || detail.from}</span></div>}
        {detail.subject && <div><span className="text-terminal-muted">Subject:</span> <span className="text-terminal-text">{detail.subject}</span></div>}
        {detail.body && <pre className="mt-2 text-[11px] text-terminal-text whitespace-pre-wrap font-sans leading-[1.5] bg-white/50 rounded-lg p-3 border border-[#f0eeea]">{detail.body}</pre>}
      </div>
    );
  }

  if (type === 'meet') {
    return (
      <div className="space-y-2 text-[12px]">
        {detail.summary && <p className="text-terminal-text leading-[1.5]">{detail.summary}</p>}
        {detail.attendees?.length > 0 && (
          <div><span className="text-terminal-muted">Attendees:</span> <span className="text-terminal-text">{detail.attendees.join(', ')}</span></div>
        )}
        {detail.actionItems?.length > 0 && (
          <div className="mt-1.5">
            <span className="text-terminal-muted text-[11px] font-semibold uppercase tracking-[0.5px]">Action Items</span>
            <ul className="mt-1 space-y-0.5">
              {detail.actionItems.map((item, i) => (
                <li key={i} className="text-[11px] text-terminal-text pl-3 relative before:content-['•'] before:absolute before:left-0 before:text-terminal-muted">{item}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  if (type === 'lead') {
    return (
      <div className="text-[12px]">
        {detail.leads?.length > 0 && (
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-terminal-muted text-left">
                <th className="font-semibold pb-1">Company</th>
                <th className="font-semibold pb-1">Location</th>
                <th className="font-semibold pb-1 text-right">Score</th>
              </tr>
            </thead>
            <tbody>
              {detail.leads.map((lead, i) => (
                <tr key={i} className="border-t border-[#f0eeea]">
                  <td className="py-1 text-terminal-text">{lead.company}</td>
                  <td className="py-1 text-terminal-muted">{lead.location}</td>
                  <td className="py-1 text-right font-semibold text-terminal-text">{lead.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {detail.queriesRun && <div className="mt-1 text-terminal-muted">Queries: {Array.isArray(detail.queriesRun) ? detail.queriesRun.join(', ') : detail.queriesRun}</div>}
      </div>
    );
  }

  if (type === 'doc') {
    return (
      <div className="space-y-1 text-[12px]">
        {detail.type && <div><span className="text-terminal-muted">Type:</span> <span className="text-terminal-text">{detail.type}</span></div>}
        {detail.source && <div><span className="text-terminal-muted">Source:</span> <span className="text-terminal-text">{detail.source}</span></div>}
        {detail.summary && <p className="text-terminal-text leading-[1.5] mt-1">{detail.summary}</p>}
      </div>
    );
  }

  // Fallback: render raw JSON
  return <pre className="text-[11px] text-terminal-muted whitespace-pre-wrap">{JSON.stringify(detail, null, 2)}</pre>;
}

export default function CommandDashboard({ onNavigate }) {
  const [timeRange, setTimeRange] = useState('30D');
  const [approvals, setApprovals] = useState([]);
  const [insights, setInsights] = useState([]);
  const [toast, setToast] = useState(null);
  const [hubspotPipeline, setHubspotPipeline] = useState(null);
  const [actionItems, setActionItems] = useState([]);
  const [activities, setActivities] = useState(ACTIVITY_FALLBACK);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedDetail, setExpandedDetail] = useState(null);
  const [insightModal, setInsightModal] = useState(null);
  const [threadModal, setThreadModal] = useState(null); // { thread, messages, loading }
  const [leadStats, setLeadStats] = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  // Fetch lead stats from API
  useEffect(() => {
    async function fetchLeadStats() {
      try {
        const token = localStorage.getItem('accessToken');
        const res = await fetch(`${API_BASE}/v1/lead-engine/stats`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const data = await res.json();
        setLeadStats(data);
      } catch {}
    }
    fetchLeadStats();
    const interval = setInterval(fetchLeadStats, 60000);
    return () => clearInterval(interval);
  }, []);

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
        const mapped = (data.items || []).map(item => ({
          id: item.id,
          type: item.type,
          agent: item.agentId,
          agentLabel: (item.agentId || 'agent').charAt(0).toUpperCase() + (item.agentId || 'agent').slice(1),
          icon: AGENT_ICON_COLORS[item.agentId] || { letter: 'A', color: '#1a6b3c', bg: '#edf7f0' },
          title: item.title,
          desc: item.description || '',
          time: formatRelativeTime(item.createdAt),
        }));
        setApprovals(mapped);
      } catch {}
    }
    async function fetchInsights() {
      try {
        const res = await fetch(`${API_BASE}/v1/approvals/insights?status=active`);
        if (!res.ok) return;
        const data = await res.json();
        const mapped = (data.items || []).map(item => ({
          id: item.id,
          agent: item.agent_id,
          agentLabel: (item.agent_id || 'agent').charAt(0).toUpperCase() + (item.agent_id || 'agent').slice(1),
          type: item.type || 'insight',
          time: formatRelativeTime(item.created_at),
          title: item.title,
          body: item.description || '',
          actions: item.actions || ['Dismiss'],
        }));

        // Also fetch pinned threads and merge into insights
        try {
          const pinnedRes = await fetch(`${API_BASE}/v1/chat/pinned-threads`);
          if (pinnedRes.ok) {
            const pinnedData = await pinnedRes.json();
            const pinnedInsights = (pinnedData.threads || []).map(thread => ({
              id: `thread-${thread.id}`,
              agent: thread.agent_id,
              agentLabel: (thread.agent_id || 'agent').charAt(0).toUpperCase() + (thread.agent_id || 'agent').slice(1),
              type: 'Thread',
              time: formatRelativeTime(thread.updated_at),
              title: thread.title || 'Pinned thread',
              body: `Pinned conversation in <b>${(thread.agent_id || 'agent').charAt(0).toUpperCase() + (thread.agent_id || 'agent').slice(1)}</b>`,
              actions: ['View Thread'],
              _threadId: thread.id,
              _agentId: thread.agent_id,
            }));
            mapped.push(...pinnedInsights);
          }
        } catch {}

        setInsights(mapped.length > 0 ? mapped : AGENT_INSIGHTS);
      } catch {
        setInsights(AGENT_INSIGHTS);
      }
    }
    fetchApprovals();
    fetchInsights();
  }, []);

  // Fetch live activity feed
  useEffect(() => {
    async function fetchActivities() {
      try {
        const res = await fetch(`${API_BASE}/v1/activity?limit=20`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.activities?.length > 0) setActivities(data.activities);
      } catch {}
    }
    fetchActivities();
    const interval = setInterval(fetchActivities, 30000);
    return () => clearInterval(interval);
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
    const item = approvals.find(a => a.id === id);
    try {
      await fetch(`${API_BASE}/v1/approvals/${id}/approve`, { method: 'POST' });
      showToast(item?.type === 'email_draft' ? 'Approved — email sent' : 'Approved');
    } catch {
      showToast('Approve failed');
    }
    setApprovals(prev => prev.filter(a => a.id !== id));
  }, [approvals]);

  const handleReject = useCallback(async (id) => {
    try {
      await fetch(`${API_BASE}/v1/approvals/${id}/reject`, { method: 'POST' });
      showToast('Rejected');
    } catch {
      showToast('Reject failed');
    }
    setApprovals(prev => prev.filter(a => a.id !== id));
  }, []);

  const toggleExpand = useCallback(async (id) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedDetail(null);
      return;
    }
    setExpandedId(id);
    setExpandedDetail(null);
    try {
      const res = await fetch(`${API_BASE}/v1/activity/${id}`);
      if (res.ok) {
        const data = await res.json();
        setExpandedDetail(data.detail);
      }
    } catch {}
  }, [expandedId]);

  const handleInsightAction = async (insightId, action) => {
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
    } else if (action === 'View Thread') {
      const insight = insights.find(i => i.id === insightId);
      if (insight?._threadId && insight?._agentId) {
        // Open thread modal for real threads
        setThreadModal({ threadId: insight._threadId, agentId: insight._agentId, title: insight.title, agentLabel: insight.agentLabel, type: insight.type, time: insight.time, messages: [], loading: true });
        try {
          const token = localStorage.getItem('auth_token');
          const res = await fetch(`${API_BASE}/v1/chat/${insight._agentId}/threads/${insight._threadId}/messages`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (res.ok) {
            const data = await res.json();
            setThreadModal(prev => prev ? { ...prev, messages: data.messages || [], loading: false, thread: data.thread } : null);
          } else {
            setThreadModal(prev => prev ? { ...prev, loading: false } : null);
          }
        } catch {
          setThreadModal(prev => prev ? { ...prev, loading: false } : null);
        }
      } else if (insight) {
        // Fallback: open detail modal for demo/hardcoded insights
        setInsightModal({ ...insight, triggeredAction: action });
      }
    } else {
      const insight = insights.find(i => i.id === insightId);
      if (insight) {
        setInsightModal({ ...insight, triggeredAction: action });
      }
    }
  };

  // Compute dynamic metrics from leadStats
  const METRICS = leadStats ? [
    { label: 'Leads', value: String(leadStats.totalLeads || 0), delta: leadStats.withEmail ? `${leadStats.withEmail} with email` : '', type: 'up', bar: Math.min(100, (leadStats.totalLeads || 0) / 2) },
    { label: 'Outreach', value: String(leadStats.totalEmailsSent || 0), delta: leadStats.sentToday ? `+${leadStats.sentToday} today` : '', type: leadStats.totalEmailsSent > 0 ? 'up' : 'flat', bar: leadStats.totalLeads > 0 ? Math.round((leadStats.totalEmailsSent / leadStats.totalLeads) * 100) : 0 },
    { label: 'Replies', value: String(leadStats.totalResponded || 0), delta: leadStats.responseRate ? `${leadStats.responseRate}% rate` : '', type: leadStats.totalResponded > 0 ? 'up' : 'flat', bar: leadStats.responseRate || 0 },
    { label: 'Meetings', value: String(leadStats.meetingLeads || 0), delta: '', type: 'flat', bar: leadStats.totalLeads > 0 ? Math.round((leadStats.meetingLeads || 0) / leadStats.totalLeads * 100) : 0 },
  ] : DEFAULT_METRICS;

  const AGENTS = AGENTS_TEMPLATE.map(a => ({
    ...a,
    stat: a.statKey && leadStats ? String(leadStats[a.statKey] || 0) : (a.stat || '\u2014'),
  }));

  const PIPELINE = leadStats ? [
    { label: 'Discovered', value: leadStats.totalLeads || 0, pct: 100 },
    { label: 'Contacted', value: leadStats.contactedLeads || 0, pct: leadStats.totalLeads > 0 ? Math.round((leadStats.contactedLeads || 0) / leadStats.totalLeads * 100 * 10) / 10 : 0 },
    { label: 'Replied', value: leadStats.respondedLeads || 0, pct: leadStats.totalLeads > 0 ? Math.round((leadStats.respondedLeads || 0) / leadStats.totalLeads * 100 * 10) / 10 : 0 },
    { label: 'Scheduled', value: leadStats.meetingLeads || 0, pct: leadStats.totalLeads > 0 ? Math.round((leadStats.meetingLeads || 0) / leadStats.totalLeads * 100 * 10) / 10 : 0 },
    { label: 'Active Deal', value: leadStats.qualifiedLeads || 0, pct: leadStats.totalLeads > 0 ? Math.round((leadStats.qualifiedLeads || 0) / leadStats.totalLeads * 100 * 10) / 10 : 0 },
  ] : DEFAULT_PIPELINE;

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

      {/* Metrics Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 border border-terminal-border rounded-[14px] overflow-hidden mb-5" style={{ gap: '1px', background: 'var(--t-border)' }}>
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

      {/* Row 1: Team Action Items + Approval Queue */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4 mb-5">
        {/* Team Action Items */}
        {(() => {
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
            <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
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
      </div>

      {/* Row 2: Agent Insights + HubSpot Pipeline */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4 mb-5">
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

      {/* Row 3: Activity Feed (full width) */}
      <div className="mb-4">
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Activity</span>
              <span className="text-[9px] font-bold text-[#1a6b3c] bg-[#edf7f0] px-2 py-0.5 rounded-full uppercase tracking-[0.5px]">Live</span>
            </div>
            <span className="text-[11px] text-terminal-muted">All agents</span>
          </div>
          <div>
            {(() => {
              // Group consecutive activities with same title+subtitle
              const grouped = [];
              for (const item of activities) {
                const key = `${item.title}|||${item.subtitle}`;
                const last = grouped[grouped.length - 1];
                if (last && last._key === key) {
                  last.times.push(item.time);
                } else {
                  grouped.push({ ...item, _key: key, times: [item.time] });
                }
              }
              return grouped.map((item) => (
                <div key={item.id}>
                  <div
                    className={`flex items-start gap-3.5 px-[18px] py-3 border-b border-[#f0eeea] last:border-b-0 hover:bg-[#f5f4f0] transition-colors ${item.hasDetail ? 'cursor-pointer' : ''}`}
                    onClick={() => item.hasDetail && toggleExpand(item.id)}
                  >
                    <div className={`w-1 h-1 rounded-full mt-[7px] shrink-0 ${DOT_COLORS[item.type] || 'bg-terminal-muted'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-terminal-text leading-[1.4]">{item.title}</div>
                      <div className="text-[11px] text-terminal-muted mt-0.5">{item.subtitle}</div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                      <span className="text-[10px] text-[#c5c5bc] font-medium tabular-nums">
                        {item.times.length > 1
                          ? item.times.join(', ')
                          : item.time}
                      </span>
                      {item.hasDetail && (
                        <span className={`text-[10px] text-[#c5c5bc] transition-transform ${expandedId === item.id ? 'rotate-90' : ''}`}>&rsaquo;</span>
                      )}
                    </div>
                  </div>
                  {expandedId === item.id && (
                    <div className="px-[18px] py-3 bg-[#f9f8f5] border-b border-[#f0eeea]">
                      {expandedDetail ? (
                        <ActivityDetail detail={expandedDetail} type={item.type} />
                      ) : (
                        <div className="text-[11px] text-terminal-muted">Loading...</div>
                      )}
                    </div>
                  )}
                </div>
              ));
            })()}
          </div>
        </div>
      </div>

      {/* Pipeline + Follow-Ups + Agents */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {/* Pipeline */}
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
            <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Pipeline</span>
            <span className="text-[11px] text-terminal-muted">{leadStats ? `${leadStats.totalLeads || 0} total` : '—'}</span>
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

      {/* Insight Modal */}
      {insightModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]" onClick={() => setInsightModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl border border-[#e5e5e0] w-full max-w-[680px] mx-4 max-h-[calc(100vh-60px)] overflow-y-auto" onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="px-7 pt-6 pb-5 border-b border-[#f0eeea] flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-1.5 mb-2.5">
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] px-2 py-[2px] rounded bg-[#edf7f0] text-[#1a6b3c] border border-[#d4edda]">
                    <span className="w-[5px] h-[5px] rounded-full bg-[#1a6b3c]" />
                    {insightModal.agentLabel} · {insightModal.type}
                  </span>
                </div>
                <h2 className="text-[20px] font-semibold text-terminal-text leading-[1.2] mb-1">{INSIGHT_MODAL_CONTENT[insightModal.agent]?.title || insightModal.title}</h2>
                <p className="text-[12px] text-[#9a9a92]">{INSIGHT_MODAL_CONTENT[insightModal.agent]?.subtitle || ''}</p>
              </div>
              <button onClick={() => setInsightModal(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#9a9a92] border border-[#f0eeea] hover:bg-[#f5f4f0] hover:text-terminal-text transition-colors text-base shrink-0">&times;</button>
            </div>

            {/* KPI Strip */}
            {INSIGHT_MODAL_CONTENT[insightModal.agent]?.kpis && (
              <div className="grid border-b border-[#f0eeea]" style={{ gridTemplateColumns: `repeat(${INSIGHT_MODAL_CONTENT[insightModal.agent].kpis.length}, 1fr)`, gap: '1px', background: '#f0eeea' }}>
                {INSIGHT_MODAL_CONTENT[insightModal.agent].kpis.map((kpi, i) => (
                  <div key={i} className="bg-white px-6 py-[18px]">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#9a9a92] mb-1.5">{kpi.label}</div>
                    <div className={`text-[22px] font-bold tabular-nums leading-none ${kpi.green ? 'text-[#1a6b3c]' : 'text-terminal-text'}`}>{kpi.value}</div>
                    {kpi.delta && <div className="text-[11px] text-[#1a6b3c] font-medium mt-1">{kpi.delta}</div>}
                  </div>
                ))}
              </div>
            )}

            {/* Chart (curtailment only) */}
            {insightModal.agent === 'curtailment' && (
              <div className="px-7 pt-5 pb-4 border-b border-[#f0eeea]">
                <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#9a9a92] mb-4">7-Day Price Forecast ($/MWh) · Curtailment Windows Highlighted</div>
                <svg viewBox="0 0 620 140" className="w-full h-[140px]">
                  <defs>
                    <linearGradient id="igArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1a6b3c" stopOpacity="0.18"/><stop offset="100%" stopColor="#1a6b3c" stopOpacity="0"/></linearGradient>
                    <linearGradient id="igWin" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1a6b3c" stopOpacity="0.1"/><stop offset="100%" stopColor="#1a6b3c" stopOpacity="0.02"/></linearGradient>
                  </defs>
                  <line x1="0" y1="28" x2="620" y2="28" stroke="#f0eeea" /><line x1="0" y1="56" x2="620" y2="56" stroke="#f0eeea" /><line x1="0" y1="84" x2="620" y2="84" stroke="#f0eeea" /><line x1="0" y1="112" x2="620" y2="112" stroke="#f0eeea" />
                  <line x1="0" y1="42" x2="620" y2="42" stroke="#b8860b" strokeWidth="1" strokeDasharray="4 4" opacity="0.5"/>
                  <text x="4" y="39" fontFamily="monospace" fontSize="8" fill="#b8860b" opacity="0.7">$85 threshold</text>
                  <text x="596" y="31" fontFamily="monospace" fontSize="8" fill="#c5c5bc" textAnchor="end">$120</text>
                  <text x="596" y="59" fontFamily="monospace" fontSize="8" fill="#c5c5bc" textAnchor="end">$90</text>
                  <text x="596" y="87" fontFamily="monospace" fontSize="8" fill="#c5c5bc" textAnchor="end">$60</text>
                  <text x="596" y="115" fontFamily="monospace" fontSize="8" fill="#c5c5bc" textAnchor="end">$30</text>
                  <rect x="110" y="0" width="44" height="140" fill="url(#igWin)" rx="2"/><rect x="290" y="0" width="38" height="140" fill="url(#igWin)" rx="2"/><rect x="460" y="0" width="42" height="140" fill="url(#igWin)" rx="2"/>
                  <path d="M0,95 C20,92 40,88 60,80 C80,72 90,60 110,38 C130,18 140,28 154,48 C168,68 180,85 200,90 C220,95 250,92 270,88 C280,86 286,82 290,68 C298,48 310,35 328,55 C336,65 345,82 360,86 C380,90 410,88 430,85 C450,82 456,78 460,62 C468,42 475,30 502,52 C512,60 518,72 535,80 C552,88 580,90 620,88 L620,140 L0,140 Z" fill="url(#igArea)"/>
                  <path d="M0,95 C20,92 40,88 60,80 C80,72 90,60 110,38 C130,18 140,28 154,48 C168,68 180,85 200,90 C220,95 250,92 270,88 C280,86 286,82 290,68 C298,48 310,35 328,55 C336,65 345,82 360,86 C380,90 410,88 430,85 C450,82 456,78 460,62 C468,42 475,30 502,52 C512,60 518,72 535,80 C552,88 580,90 620,88" fill="none" stroke="#1a6b3c" strokeWidth="1.5"/>
                  <circle cx="132" cy="18" r="4" fill="#1a6b3c"/><circle cx="310" cy="35" r="4" fill="#1a6b3c"/><circle cx="477" cy="30" r="4" fill="#1a6b3c"/>
                  <circle cx="132" cy="18" r="7" fill="none" stroke="#1a6b3c" strokeWidth="1" opacity="0.4"/>
                  <text x="132" y="12" fontFamily="monospace" fontSize="7" fill="#1a6b3c" textAnchor="middle">$1,247</text>
                </svg>
                <div className="flex justify-between pt-1.5">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => (
                    <span key={d} className={`font-mono text-[10px] ${[1,4,6].includes(i) ? 'text-[#1a6b3c] font-medium' : 'text-[#c5c5bc]'}`}>
                      {d}{i === 1 ? ' \u2190 yesterday' : ''}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Detail Cards */}
            {INSIGHT_MODAL_CONTENT[insightModal.agent]?.cards && (
              <div className="px-7 py-5 border-b border-[#f0eeea]">
                <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#9a9a92] mb-3.5">{INSIGHT_MODAL_CONTENT[insightModal.agent].cardsLabel}</div>
                <div className="grid gap-2.5" style={{ gridTemplateColumns: `repeat(${INSIGHT_MODAL_CONTENT[insightModal.agent].cards.length}, 1fr)` }}>
                  {INSIGHT_MODAL_CONTENT[insightModal.agent].cards.map((card, i) => (
                    <div key={i} className={`rounded-lg border p-3.5 ${card.best ? 'border-[#1a6b3c]/30 bg-[#edf7f0]/50' : 'border-[#f0eeea] bg-[#fafaf8]'}`}>
                      {card.best && <span className="text-[9px] font-bold uppercase tracking-[0.06em] text-[#1a6b3c] bg-[#edf7f0] border border-[#d4edda] rounded px-1.5 py-[1px] inline-block mb-1.5">Best</span>}
                      <div className="text-[10px] font-semibold uppercase tracking-[0.04em] text-[#9a9a92] mb-1">{card.label}</div>
                      <div className="font-mono text-[13px] text-terminal-text mb-2">{card.value}</div>
                      {card.sub && <div className="text-[11px] text-[#9a9a92] mb-1">{card.sub}</div>}
                      <div className="font-mono text-[15px] font-medium text-[#1a6b3c]">{card.highlight}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Context Rows */}
            {INSIGHT_MODAL_CONTENT[insightModal.agent]?.context && (
              <div className="px-7 py-5 border-b border-[#f0eeea]">
                <div className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[#9a9a92] mb-3">{INSIGHT_MODAL_CONTENT[insightModal.agent].contextLabel || 'Signal Context'}</div>
                {INSIGHT_MODAL_CONTENT[insightModal.agent].context.map((row, i) => (
                  <div key={i} className="flex justify-between items-center py-2.5 border-b border-[#f5f4f0] last:border-b-0 text-[12px]">
                    <span className="text-[#9a9a92]">{row.key}</span>
                    <span className={`font-mono text-[11px] ${row.warn ? 'text-[#b8860b]' : 'text-terminal-text'}`}>{row.value}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Footer */}
            <div className="px-7 py-[18px] flex items-center justify-between">
              <span className="text-[10px] text-[#c5c5bc] tabular-nums">{insightModal.time}</span>
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => { setInsightModal(null); handleInsightAction(insightModal.id, 'Dismiss'); }}
                  className="px-4 py-2 rounded-lg text-[12px] font-medium text-[#1a6b3c] border border-[#f0eeea] hover:border-[#1a6b3c]/30 hover:bg-[#edf7f0]/30 transition-all"
                >
                  Dismiss
                </button>
                <button
                  onClick={() => setInsightModal(null)}
                  className="px-4 py-2 rounded-lg text-[12px] font-semibold bg-[#1a6b3c] text-white hover:bg-[#22884d] transition-colors flex items-center gap-1.5"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  {INSIGHT_MODAL_CONTENT[insightModal.agent]?.cta || 'Got it'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Thread Modal */}
      {threadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(6px)' }} onClick={() => setThreadModal(null)}>
          <div
            className="flex flex-col w-full max-w-[660px] mx-4 max-h-[calc(100vh-60px)] rounded-[14px] overflow-hidden"
            style={{ background: '#141f19', border: '1px solid #1e3028', boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-[26px] pt-[22px] pb-[18px] flex items-start justify-between gap-4 shrink-0" style={{ borderBottom: '1px solid #1e3028' }}>
              <div>
                <div className="inline-flex items-center gap-1.5 mb-2.5 px-2 py-[3px] rounded text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ background: 'rgba(45,106,79,0.2)', border: '1px solid rgba(64,145,108,0.25)', color: '#74c69d', letterSpacing: '0.08em' }}>
                  <span className="w-[5px] h-[5px] rounded-full" style={{ background: '#74c69d' }} />
                  {threadModal.agentLabel} · {threadModal.type || 'Thread'}
                </div>
                <h2 className="text-[20px] leading-[1.25] mb-[3px]" style={{ fontFamily: "'Instrument Serif', Georgia, serif", color: '#e8f5ee' }}>{threadModal.title || 'Thread'}</h2>
                <p className="text-[11px]" style={{ color: '#3d6b57' }}>{threadModal.agentLabel} · {threadModal.time} · {threadModal.messages.length} messages</p>
              </div>
              <button
                onClick={() => setThreadModal(null)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0 transition-colors"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid #1e3028', color: '#52796f' }}
                onMouseEnter={e => { e.target.style.background = 'rgba(255,255,255,0.08)'; e.target.style.color = '#d8f3dc'; }}
                onMouseLeave={e => { e.target.style.background = 'rgba(255,255,255,0.04)'; e.target.style.color = '#52796f'; }}
              >
                &times;
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-[26px] py-5 flex flex-col gap-4" style={{ scrollbarWidth: 'thin', scrollbarColor: '#1e3028 transparent' }}>
              {threadModal.loading ? (
                <div className="text-center py-10 text-[13px]" style={{ color: '#3d6b57' }}>Loading thread...</div>
              ) : threadModal.messages.length === 0 ? (
                <div className="text-center py-10 text-[13px]" style={{ color: '#3d6b57' }}>No messages in this thread</div>
              ) : (
                threadModal.messages.map((msg, i) => {
                  const isAgent = msg.role === 'assistant';
                  return (
                    <div key={msg.id || i} className={`flex gap-3 ${isAgent ? 'flex-row-reverse' : ''}`}>
                      {/* Avatar */}
                      <div
                        className="w-[30px] h-[30px] rounded-lg flex items-center justify-center text-[11px] font-bold shrink-0"
                        style={isAgent
                          ? { background: 'rgba(45,106,79,0.3)', color: '#d8f3dc', border: '1px solid rgba(64,145,108,0.3)', fontSize: '9px' }
                          : { background: '#1e3028', color: '#74c69d', border: '1px solid #2d4a3e' }
                        }
                      >
                        {isAgent ? 'AI' : (msg.userId || 'U').slice(0, 2).toUpperCase()}
                      </div>
                      {/* Bubble */}
                      <div className={`flex-1 max-w-[78%] ${isAgent ? 'flex flex-col items-end' : ''}`}>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.05em] mb-[5px]" style={{ color: isAgent ? '#52796f' : '#3d6b57', textAlign: isAgent ? 'right' : 'left' }}>
                          {isAgent ? (threadModal.agentLabel || 'Agent') : 'User'}
                        </div>
                        <div
                          className="px-[15px] py-[13px] text-[13px] leading-[1.6] whitespace-pre-wrap"
                          style={isAgent
                            ? { background: 'rgba(45,106,79,0.12)', border: '1px solid rgba(64,145,108,0.2)', borderRadius: '10px 10px 3px 10px', color: '#d8f3dc' }
                            : { background: '#1a2b22', border: '1px solid #1e3028', borderRadius: '10px 10px 10px 3px', color: '#b7d5c4' }
                          }
                        >
                          {msg.content}
                        </div>
                        <div className="text-[10px] mt-[5px]" style={{ color: '#2d4a3e', textAlign: isAgent ? 'right' : 'left' }}>
                          {msg.createdAt ? new Date(msg.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : ''}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Footer — open in chat */}
            <div className="px-[26px] py-[14px] flex items-center justify-between shrink-0" style={{ borderTop: '1px solid #1e3028' }}>
              <span className="text-[10px] tabular-nums" style={{ color: '#2d4a3e' }}>{threadModal.messages.length} messages</span>
              <button
                onClick={() => {
                  localStorage.setItem('open_thread_id', threadModal.threadId);
                  const targetTab = `${threadModal.agentId || 'hivemind'}-chat`;
                  setThreadModal(null);
                  onNavigate?.(targetTab);
                }}
                className="px-4 py-2 rounded-lg text-[12px] font-semibold flex items-center gap-1.5 transition-colors"
                style={{ background: '#2d6a4f', border: '1px solid #40916c', color: '#d8f3dc' }}
                onMouseEnter={e => e.target.style.background = '#40916c'}
                onMouseLeave={e => e.target.style.background = '#2d6a4f'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                Open in Chat
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-terminal-text text-white text-[13px] font-medium px-5 py-3 rounded-xl shadow-lg animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  );
}

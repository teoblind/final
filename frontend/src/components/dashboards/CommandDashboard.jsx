import React, { useState, useEffect, useCallback } from 'react';
import { AlertCircle, CheckCircle, XCircle, RotateCcw, Share2, Check, X, MessageSquare, ChevronDown, ChevronUp, FileText, Download, ExternalLink } from 'lucide-react';
import EmptyState from '../ui/EmptyState';
import InfoRequestCard from '../panels/agents/InfoRequestCard.jsx';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

function getAuthHeaders() {
  try {
    const session = JSON.parse(sessionStorage.getItem('sangha_auth'));
    if (session?.tokens?.accessToken) return { Authorization: `Bearer ${session.tokens.accessToken}` };
  } catch {}
  const legacy = localStorage.getItem('auth_token');
  if (legacy) return { Authorization: `Bearer ${legacy}` };
  return {};
}

const AGENT_ICON_COLORS = {
  outreach:       { letter: 'O', color: 'var(--t-ui-accent)', bg: 'var(--t-ui-accent-bg)' },
  curtailment:    { letter: 'C', color: '#b8860b', bg: '#fdf6e8' },
  pool:           { letter: 'P', color: '#5b3a8c', bg: '#f3eef8' },
  meetings:       { letter: 'M', color: '#2c5282', bg: '#e8eef5' },
  reporting:      { letter: 'R', color: '#5b3a8c', bg: '#f3eef8' },
  hivemind:       { letter: 'H', color: 'var(--t-ui-accent)', bg: 'var(--t-ui-accent-bg)' },
  monitoring:     { letter: 'M', color: '#b8860b', bg: '#fdf6e8' },
  email:          { letter: 'E', color: '#2c5282', bg: '#e8eef5' },
  'lead-engine':  { letter: 'L', color: 'var(--t-ui-accent)', bg: 'var(--t-ui-accent-bg)' },
  knowledge:      { letter: 'K', color: '#2c5282', bg: '#e8eef5' },
  coppice:        { letter: 'C', color: 'var(--t-ui-accent)', bg: 'var(--t-ui-accent-bg)' },
  estimating:     { letter: 'E', color: '#b8860b', bg: '#fdf6e8' },
};

const INSIGHT_TYPE_STYLES = {
  Recommendation: 'bg-[var(--t-ui-accent-bg)] text-[var(--t-ui-accent)]',
  Question: 'bg-[#e8eef5] text-[#2c5282]',
  Pattern: 'bg-[#f3eef8] text-[#5b3a8c]',
  Analysis: 'bg-[#fdf6e8] text-[#b8860b]',
  'Follow-up': 'bg-[#fdedf0] text-[#dc3545]',
  Thread: 'bg-[#fdf6e8] text-[#b8860b]',
  alert: 'bg-[#fdedf0] text-[#dc3545]',
  reminder: 'bg-[#fdf6e8] text-[#b8860b]',
  follow_up: 'bg-[#fdedf0] text-[#dc3545]',
  insight: 'bg-[var(--t-ui-accent-bg)] text-[var(--t-ui-accent)]',
};

// ─── Structural Defaults ─────────────────────────────────────────────────────

const DEFAULT_METRICS = [
  { label: 'Leads', value: '—', delta: 'loading...', type: 'flat', bar: 0 },
  { label: 'Outreach', value: '—', delta: '', type: 'flat', bar: 0 },
  { label: 'Replies', value: '—', delta: '', type: 'flat', bar: 0 },
  { label: 'Meetings', value: '—', delta: '', type: 'flat', bar: 0 },
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

// ─── Indicator Colors ───────────────────────────────────────────────────────

const DOT_COLORS = {
  out: 'bg-[var(--t-ui-accent)]',
  in: 'bg-terminal-amber',
  meet: 'bg-terminal-text',
  doc: 'bg-terminal-muted',
  alert: 'bg-terminal-red',
  lead: 'bg-[#5b3a8c]',
};

const STATUS_STYLES = {
  on: 'bg-[var(--t-sidebar-accent)] shadow-[0_0_4px_rgba(var(--t-sidebar-accent-rgb),0.3)]',
  standby: 'bg-terminal-amber',
  off: 'bg-[#c5c5bc]',
};

const MODE_STYLES = {
  Auto: 'bg-[var(--t-ui-accent-bg)] text-[var(--t-ui-accent)]',
  Copilot: 'bg-[#fdf6e8] text-terminal-amber',
  Off: 'bg-[#f5f4f0] text-terminal-muted',
};

const DELTA_COLORS = {
  up: 'text-[var(--t-ui-accent)]',
  warn: 'text-terminal-amber',
  flat: 'text-terminal-muted',
};

const URGENCY_COLORS = {
  danger: 'text-terminal-red font-semibold',
  warn: 'text-terminal-amber font-semibold',
  normal: 'text-terminal-text font-semibold',
};

const VALUE_COLORS = {
  green: 'text-[var(--t-ui-accent)]',
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
            <span className="text-terminal-muted text-[11px] font-heading font-semibold uppercase tracking-[0.5px]">Action Items</span>
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
                  <td className="py-1 text-right font-mono font-semibold text-terminal-text">{lead.score}</td>
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

function UpcomingMeetingsPanel() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(() => {
    try { return JSON.parse(localStorage.getItem('dismissed_meetings') || '[]'); } catch { return []; }
  });
  const [invitedIds, setInvitedIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem('invited_meetings') || '[]'); } catch { return []; }
  });
  const [inviting, setInviting] = useState(null);

  useEffect(() => {
    async function fetchEvents() {
      try {
        const res = await fetch(`${API_BASE}/v1/crm/calendar/events`);
        if (res.ok) {
          const data = await res.json();
          setEvents(data.events || []);
        }
      } catch {}
      setLoading(false);
    }
    fetchEvents();
    const interval = setInterval(fetchEvents, 120000);
    return () => clearInterval(interval);
  }, []);

  const handleDismiss = (id) => {
    const next = [...dismissed, id];
    setDismissed(next);
    localStorage.setItem('dismissed_meetings', JSON.stringify(next));
  };

  const handleInvite = async (id) => {
    setInviting(id);
    try {
      const res = await fetch(`${API_BASE}/v1/crm/calendar/events/${id}/invite`, { method: 'POST' });
      if (res.ok) {
        const next = [...invitedIds, id];
        setInvitedIds(next);
        localStorage.setItem('invited_meetings', JSON.stringify(next));
      }
    } catch {}
    setInviting(null);
  };

  const visibleEvents = events.filter(e => !dismissed.includes(e.id));

  const formatTime = (isoStr, allDay) => {
    if (!isoStr) return '';
    if (allDay) return 'All day';
    const d = new Date(isoStr);
    const h = d.getHours();
    const m = d.getMinutes().toString().padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    return `${h % 12 || 12}:${m} ${ampm}`;
  };

  const formatDate = (isoStr) => {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
    const eventDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (eventDate.getTime() === today.getTime()) return 'Today';
    if (eventDate.getTime() === tomorrow.getTime()) return 'Tomorrow';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  return (
    <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
      <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
        <span className="text-xs font-heading font-bold text-terminal-text tracking-[0.3px]">Upcoming Meetings</span>
        <span className="text-[11px] font-mono text-terminal-muted">{visibleEvents.length} this week</span>
      </div>
      <div>
        {loading ? (
          <div className="px-[18px] py-6 text-center">
            <div className="spinner w-6 h-6 mx-auto mb-2" />
            <p className="text-[11px] text-terminal-muted">Loading calendar...</p>
          </div>
        ) : visibleEvents.length === 0 ? (
          <EmptyState icon="calendar" title="No upcoming meetings" subtitle="Calendar events for the next 7 days will appear here." compact />
        ) : (
          visibleEvents.map((event) => {
            const isInvited = invitedIds.includes(event.id);
            return (
              <div key={event.id} className="flex items-center gap-3 px-[18px] py-2.5 border-b border-[#f0eeea] last:border-b-0 hover:bg-[#f5f4f0] transition-colors">
                <div className="shrink-0 text-center w-[46px]">
                  <div className="text-[10px] text-terminal-muted font-medium">{formatDate(event.start)}</div>
                  <div className="text-[12px] font-mono font-semibold text-terminal-text tabular-nums">{formatTime(event.start, event.allDay)}</div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium text-terminal-text truncate">{event.title}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {event.attendees > 0 && (
                      <span className="text-[10px] text-terminal-muted">{event.attendees} attendee{event.attendees !== 1 ? 's' : ''}</span>
                    )}
                    {event.location && (
                      <span className="text-[10px] text-terminal-muted truncate max-w-[150px]">{event.location}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {event.meetLink && (isInvited ? (
                    <span className="px-2 py-1 rounded-md text-[10px] font-medium text-terminal-muted">Invited</span>
                  ) : (
                    <button
                      onClick={() => handleInvite(event.id)}
                      disabled={inviting === event.id}
                      className="px-2 py-1 rounded-md text-[10px] font-heading font-semibold bg-[var(--t-ui-accent-bg)] text-[var(--t-ui-accent)] border border-[var(--t-ui-accent-border)] hover:opacity-80 transition-opacity disabled:opacity-50"
                    >
                      {inviting === event.id ? '...' : 'Invite Coppice'}
                    </button>
                  ))}
                  {event.meetLink && (
                    <a href={event.meetLink} target="_blank" rel="noopener noreferrer" className="px-2 py-1 rounded-md text-[10px] font-heading font-semibold bg-[var(--t-ui-accent-bg)] text-[var(--t-ui-accent)] border border-[var(--t-ui-accent-border)] hover:opacity-80 transition-opacity">
                      Join
                    </a>
                  )}
                  <button
                    onClick={() => handleDismiss(event.id)}
                    className="px-1.5 py-1 rounded-md text-[10px] text-terminal-muted hover:text-terminal-text hover:bg-[#eee] transition-colors"
                    title="Hide from dashboard"
                  >
                    &times;
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function CommandDashboard({ onNavigate }) {
  const [timeRange, setTimeRange] = useState('30D');
  const [approvals, setApprovals] = useState([]);
  const [insights, setInsights] = useState([]);
  const [toast, setToast] = useState(null);
  const [hubspotPipeline, setHubspotPipeline] = useState(null);
  const [crmData, setCrmData] = useState(null);
  const [crmLoading, setCrmLoading] = useState(false);
  const [actionItems, setActionItems] = useState([]);
  const [activities, setActivities] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedDetail, setExpandedDetail] = useState(null);
  const [insightModal, setInsightModal] = useState(null);
  const [threadModal, setThreadModal] = useState(null); // { thread, messages, loading }
  const [leadStats, setLeadStats] = useState(null);
  // Agent Assignments
  const [assignments, setAssignments] = useState([]);
  const [docPreview, setDocPreview] = useState(null);
  const [processingAssignment, setProcessingAssignment] = useState(null);
  const [sharedAssignments, setSharedAssignments] = useState({});
  const [infoRequests, setInfoRequests] = useState({});
  const [assignmentExpanded, setAssignmentExpanded] = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  // Fetch lead stats from API
  useEffect(() => {
    async function fetchLeadStats() {
      try {
        // Token is in sessionStorage under sangha_auth
        let token = null;
        try {
          const session = JSON.parse(sessionStorage.getItem('sangha_auth'));
          token = session?.tokens?.accessToken;
        } catch {}
        if (!token) return;
        const res = await fetch(`${API_BASE}/v1/lead-engine/stats`, {
          headers: { Authorization: `Bearer ${token}` },
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

  // Fetch deal pipeline data (Google Sheets CRM or HubSpot)
  useEffect(() => {
    async function fetchPipeline() {
      try {
        // Try Google Sheets CRM first
        const crmRes = await fetch(`${API_BASE}/v1/crm/pipeline`);
        if (crmRes.ok) {
          const data = await crmRes.json();
          if (data.configured && data.by_stage) {
            const formatValue = (v) => v >= 1000000 ? `$${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `$${(v / 1000).toFixed(0)}K` : v > 0 ? `$${v}` : '';
            const rows = Object.entries(data.by_stage)
              .filter(([, v]) => v.count > 0)
              .map(([stage, v]) => ({ stage, count: v.count, value: formatValue(v.value) }));
            setCrmData({ rows, source: data.source, sheetUrl: data.sheetUrl, total: data.total_deals });
            return;
          }
        }
      } catch {}

      // Fallback to HubSpot
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
    fetchPipeline();
    const interval = setInterval(fetchPipeline, 60000);
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
          icon: AGENT_ICON_COLORS[item.agentId] || { letter: 'A', color: 'var(--t-ui-accent)', bg: 'var(--t-ui-accent-bg)' },
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

        setInsights(mapped);
      } catch {
        setInsights([]);
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
        setActivities(data.activities || []);
      } catch {}
    }
    fetchActivities();
    const interval = setInterval(fetchActivities, 30000);
    return () => clearInterval(interval);
  }, []);

  // Fetch action items
  useEffect(() => {
    async function fetchActionItems() {
      try {
        const res = await fetch(`${API_BASE}/v1/knowledge/action-items?status=all&limit=30`);
        if (!res.ok) throw new Error();
        const items = await res.json();
        setActionItems(items);
      } catch {
        setActionItems([]);
      }
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

  const fetchInfoRequests = useCallback(async (jobId) => {
    try {
      const res = await fetch(`${API_BASE}/v1/jobs/${jobId}`, { headers: getAuthHeaders() });
      const data = await res.json();
      const pending = (data.messages || []).filter(m => m.message_type === 'request' && !m.response);
      if (pending.length > 0) {
        setInfoRequests(prev => ({ ...prev, [jobId]: pending }));
      }
    } catch {}
  }, []);

  // Fetch agent assignments
  const fetchAssignments = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/estimates/assignments`, { headers: getAuthHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      const all = data.assignments || [];
      setAssignments(all);
      // Fetch info requests for active assignments
      const active = all.filter(a => a.status === 'in_progress' && a.job_id);
      for (const a of active) {
        fetchInfoRequests(a.job_id);
      }
    } catch {}
  }, [fetchInfoRequests]);

  useEffect(() => {
    fetchAssignments();
    const interval = setInterval(fetchAssignments, 30000);
    return () => clearInterval(interval);
  }, [fetchAssignments]);

  const handleConfirmAssignment = useCallback(async (id) => {
    setProcessingAssignment(id);
    try {
      await fetch(`${API_BASE}/v1/estimates/assignments/${id}/confirm`, { method: 'POST', headers: getAuthHeaders() });
      setAssignments(prev => prev.map(a => a.id === id ? { ...a, status: 'in_progress' } : a));
      const poll = setInterval(async () => {
        try {
          const res = await fetch(`${API_BASE}/v1/estimates/assignments`, { headers: getAuthHeaders() });
          const data = await res.json();
          const updated = (data.assignments || []).find(a => a.id === id);
          if (updated && updated.status !== 'in_progress') {
            setAssignments(prev => prev.map(a => a.id === id ? updated : a));
            clearInterval(poll);
          }
        } catch {}
      }, 5000);
      setTimeout(() => clearInterval(poll), 300000);
    } catch {}
    finally { setProcessingAssignment(null); }
  }, []);

  const handleDismissAssignment = useCallback(async (id) => {
    try {
      await fetch(`${API_BASE}/v1/estimates/assignments/${id}/dismiss`, { method: 'POST', headers: getAuthHeaders() });
      setAssignments(prev => prev.filter(a => a.id !== id));
    } catch {}
  }, []);

  const handleShareToHivemind = useCallback(async (sourceId, sourceType = 'assignment') => {
    try {
      setSharedAssignments(prev => ({ ...prev, [sourceId]: 'sharing' }));
      const res = await fetch(`${API_BASE}/v1/knowledge/share-to-hivemind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ source_type: sourceType, source_id: sourceId }),
      });
      if (res.ok) {
        setSharedAssignments(prev => ({ ...prev, [sourceId]: 'shared' }));
      } else {
        setSharedAssignments(prev => ({ ...prev, [sourceId]: 'error' }));
      }
    } catch {
      setSharedAssignments(prev => ({ ...prev, [sourceId]: 'error' }));
    }
  }, []);

  const handleApprove = useCallback(async (id) => {
    const item = approvals.find(a => a.id === id);
    try {
      await fetch(`${API_BASE}/v1/approvals/${id}/approve`, { method: 'POST' });
      const toastMap = { email_draft: 'Approved — email sent', tool_action: 'Approved — executing action', meeting_instruction: 'Approved — executing instruction' };
      showToast(toastMap[item?.type] || 'Approved');
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
    { label: 'Meetings', value: String(leadStats.meetingLeads || 0), delta: leadStats.meetingsThisWeek ? `${leadStats.meetingsThisWeek} this week` : '', type: leadStats.meetingLeads > 0 ? 'up' : 'flat', bar: Math.min(100, (leadStats.meetingLeads || 0) * 5) },
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
            className={`px-3 py-1.5 rounded-lg text-[11px] font-heading font-semibold border transition-all ${
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
            <div className="text-[10px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1.5">{m.label}</div>
            <div className="text-2xl font-display text-terminal-text tabular-nums leading-none">{m.value}</div>
            <div className={`text-[11px] font-mono font-semibold mt-1 ${DELTA_COLORS[m.type]}`}>{m.delta}</div>
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
            Spencer: { full: 'Spencer Marr', role: 'President', color: 'var(--t-ui-accent)' },
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
                  <span className="text-xs font-heading font-bold text-terminal-text tracking-[0.3px]">Team Action Items</span>
                  <span className="text-[10px] font-mono font-bold text-white bg-terminal-red px-1.5 py-[1px] rounded-full tabular-nums">{openCount}</span>
                </div>
                <span className="text-[11px] text-terminal-muted">From leadership sync</span>
              </div>
              <div className="px-[18px] py-2">
                {actionItems.length === 0 ? (
                  <EmptyState icon="users" title="No action items" subtitle="Action items from meetings and agents will appear here." compact />
                ) : order.map((assignee) => {
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
                                ? 'bg-[var(--t-ui-accent)] border-[var(--t-ui-accent)]'
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
                            <span className={`text-[10px] font-mono px-2 py-[2px] rounded-md shrink-0 tabular-nums ${getDuePillClass(item.due_date)}`}>
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
              <span className="text-xs font-heading font-bold text-terminal-text tracking-[0.3px]">Approval Queue</span>
              <span className="text-[10px] font-mono font-bold text-white bg-terminal-red px-1.5 py-[1px] rounded-full tabular-nums">{approvals.length}</span>
            </div>
          </div>
          <div>
            {approvals.length === 0 ? (
              <EmptyState icon="shield" title="No pending approvals" subtitle="Agent actions requiring your review will appear here." compact />
            ) : approvals.map((item) => (
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
                    <span className="text-[9px] font-heading font-bold uppercase tracking-[0.5px] px-1.5 py-[1px] rounded border bg-[#f5f4f0] text-terminal-muted border-[#e5e5e0]">{item.agentLabel}</span>
                    <span className="text-[10px] font-mono text-[#c5c5bc] tabular-nums">{item.time}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                  <button onClick={() => handleApprove(item.id)} className="px-2.5 py-1 rounded-md text-[10px] font-heading font-semibold bg-[var(--t-ui-accent)] text-white hover:opacity-90 transition-opacity">Approve</button>
                  <button onClick={() => handleReject(item.id)} className="px-2.5 py-1 rounded-md text-[10px] font-heading font-semibold bg-terminal-panel text-terminal-red border border-terminal-border hover:bg-red-50 transition-colors">Reject</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Agent Assignments */}
      {assignments.filter(a => !['dismissed'].includes(a.status)).length > 0 && (
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden mb-5">
          <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
            <div className="flex items-center gap-2">
              <span className="text-xs font-heading font-bold text-terminal-text tracking-[0.3px]">Agent Tasks</span>
              <span className="text-[10px] font-mono font-bold text-white bg-[var(--t-ui-accent)] px-1.5 py-[1px] rounded-full tabular-nums">
                {assignments.filter(a => ['proposed', 'in_progress'].includes(a.status)).length}
              </span>
            </div>
            <span className="text-[11px] text-terminal-muted">Overnight analysis</span>
          </div>
          <div>
            {assignments.filter(a => !['dismissed'].includes(a.status)).map((a) => (
              <div key={a.id} className="border-b border-[#f0eeea] last:border-b-0">
                <div className="flex items-start gap-3 px-[18px] py-3 hover:bg-[#f5f4f0] transition-colors">
                  <span
                    className="w-7 h-7 rounded-[7px] flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5"
                    style={{ background: 'var(--t-ui-accent-bg)', color: 'var(--t-ui-accent)' }}
                  >
                    {(a.agent_id || 'A').charAt(0).toUpperCase()}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-[13px] font-medium text-terminal-text leading-[1.4] cursor-pointer"
                      onClick={() => setAssignmentExpanded(assignmentExpanded === a.id ? null : a.id)}
                    >
                      {a.title}
                    </div>
                    {a.category && (
                      <span className="text-[9px] font-heading font-bold uppercase tracking-[0.5px] px-1.5 py-[1px] rounded border bg-[#f5f4f0] text-terminal-muted border-[#e5e5e0] mr-1.5">
                        {a.category}
                      </span>
                    )}
                    {a.priority && a.priority !== 'medium' && (
                      <span className={`text-[9px] font-heading font-bold uppercase tracking-[0.5px] px-1.5 py-[1px] rounded ${
                        a.priority === 'high' ? 'bg-[#fdedf0] text-terminal-red border border-red-200' : 'bg-[#f5f4f0] text-terminal-muted border border-[#e5e5e0]'
                      }`}>
                        {a.priority}
                      </span>
                    )}
                    {assignmentExpanded === a.id && a.description && (
                      <div className="text-[11px] text-terminal-muted mt-1.5 leading-[1.5]">{a.description}</div>
                    )}
                    {assignmentExpanded === a.id && a.status === 'completed' && a.result_summary && !a.result_summary.startsWith('Failed') && (
                      <div className="text-[11px] text-[var(--t-ui-accent)] mt-1.5 leading-[1.5] bg-[var(--t-ui-accent-bg)] rounded-lg p-2.5 border border-[var(--t-ui-accent-border)]">
                        {a.result_summary.slice(0, 500)}{a.result_summary.length > 500 ? '...' : ''}
                      </div>
                    )}
                    {assignmentExpanded === a.id && a.status === 'completed' && (() => {
                      try {
                        const artifacts = JSON.parse(a.output_artifacts_json || '[]');
                        if (!artifacts.length) return null;
                        return (
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {artifacts.map((art, i) => {
                              const href = art.url || (art.path ? `${API_BASE}${art.path}` : '#');
                              const icon = art.type === 'gdoc' ? <ExternalLink size={10} />
                                : art.type === 'pdf' ? <FileText size={10} />
                                : art.type === 'docx' ? <Download size={10} />
                                : <ExternalLink size={10} />;
                              const openPreview = (e) => {
                                if (art.type === 'gdoc') return;
                                e.preventDefault();
                                setDocPreview({ type: art.type, url: href, title: a.title, filename: art.filename, assignment: a });
                              };
                              return (
                                <a key={i} href={href} target={art.type === 'gdoc' ? '_blank' : '_self'} rel="noopener noreferrer"
                                  onClick={openPreview}
                                  className={`inline-flex items-center gap-1 text-[10px] font-medium px-2.5 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                                    art.type === 'gdoc' ? 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200'
                                    : art.type === 'pdf' ? 'bg-red-50 hover:bg-red-100 text-red-700 border-red-200'
                                    : art.type === 'docx' ? 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
                                    : 'bg-white hover:bg-blue-50 text-[var(--t-ui-accent)] border-[var(--t-border)]'
                                  }`}
                                >
                                  {icon} {art.label || art.title || art.type}
                                </a>
                              );
                            })}
                          </div>
                        );
                      } catch { return null; }
                    })()}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                    {a.status === 'proposed' && (
                      <>
                        <button
                          onClick={() => handleConfirmAssignment(a.id)}
                          disabled={processingAssignment === a.id}
                          className="px-2.5 py-1 rounded-md text-[10px] font-heading font-semibold bg-[var(--t-ui-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50"
                        >
                          {processingAssignment === a.id ? 'Running...' : 'Run'}
                        </button>
                        <button
                          onClick={() => handleDismissAssignment(a.id)}
                          className="w-6 h-6 rounded-md flex items-center justify-center text-terminal-muted hover:text-terminal-red hover:bg-red-50 transition-colors"
                        >
                          <X size={13} />
                        </button>
                      </>
                    )}
                    {a.status === 'in_progress' && (
                      <span className="flex items-center gap-1 text-[11px] text-[var(--t-ui-accent)] font-medium">
                        {infoRequests[a.job_id]?.length > 0
                          ? <><AlertCircle size={11} className="text-amber-600" /> Needs input</>
                          : <><RotateCcw size={11} className="animate-spin" /> Working...</>
                        }
                      </span>
                    )}
                    {a.status === 'completed' && (
                      <div className="flex items-center gap-2">
                        {a.result_summary?.startsWith('Failed') && (
                          <button
                            onClick={() => handleConfirmAssignment(a.id)}
                            disabled={processingAssignment === a.id}
                            className="flex items-center gap-1 px-2 py-1 text-[11px] font-heading font-semibold bg-[var(--t-ui-accent)] text-white rounded-md hover:opacity-90 disabled:opacity-50"
                          >
                            <RotateCcw size={10} /> Retry
                          </button>
                        )}
                        <span className={`flex items-center gap-1 text-[11px] font-medium ${a.result_summary?.startsWith('Failed') ? 'text-red-500' : 'text-emerald-600'}`}>
                          {a.result_summary?.startsWith('Failed') ? <><XCircle size={11} /> Failed</> : <><CheckCircle size={11} /> Done</>}
                        </span>
                        {!a.result_summary?.startsWith('Failed') && (
                          <>
                          <button
                            onClick={() => { localStorage.setItem('coppice_chat_prefill', `Let's discuss the report: "${a.title}"\n\nHere's the summary:\n${(a.result_summary || '').slice(0, 1000)}`); window.location.hash = 'hivemind-chat'; }}
                            className="flex items-center gap-1 px-2 py-1 text-[11px] font-heading font-semibold bg-[#f0f0ec] text-[#6b6b65] rounded-md hover:bg-[#e8e6e1] hover:text-terminal-text transition-colors"
                            title="Chat about this report"
                          >
                            <MessageSquare size={10} /> Chat
                          </button>
                          <button
                            onClick={() => handleShareToHivemind(a.id, 'assignment')}
                            disabled={!!sharedAssignments[a.id]}
                            className="flex items-center gap-1 px-2 py-1 text-[11px] font-heading font-semibold bg-[#f0f0ec] text-[#6b6b65] rounded-md hover:bg-[#e8e6e1] hover:text-terminal-text disabled:opacity-50 transition-colors"
                            title="Share to Hivemind"
                          >
                            <Share2 size={10} />
                            {sharedAssignments[a.id] === 'shared' ? 'Shared' : sharedAssignments[a.id] === 'sharing' ? '...' : 'Share'}
                          </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {/* Info request cards for paused jobs */}
                {a.status === 'in_progress' && a.job_id && infoRequests[a.job_id]?.length > 0 && (
                  <div className="border-t border-terminal-border">
                    {infoRequests[a.job_id].map(req => (
                      <InfoRequestCard
                        key={req.id}
                        jobId={a.job_id}
                        request={req}
                        onResolved={() => {
                          setInfoRequests(prev => {
                            const updated = { ...prev };
                            updated[a.job_id] = (updated[a.job_id] || []).filter(r => r.id !== req.id);
                            return updated;
                          });
                          fetchAssignments();
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Row 2: Upcoming Meetings + Deal Pipeline */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4 mb-5">
        {/* Upcoming Meetings */}
        <UpcomingMeetingsPanel />

        {/* Keep Agent Insights hidden but functional */}
        {insights.length > 0 && <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
            <div className="flex items-center gap-2">
              <span className="text-xs font-heading font-bold text-terminal-text tracking-[0.3px]">Agent Insights</span>
              <span className="text-[9px] font-heading font-bold text-[#5b3a8c] bg-[#f3eef8] px-2 py-0.5 rounded-full uppercase tracking-[0.5px]">New</span>
            </div>
          </div>
          <div>
            {insights.length === 0 ? (
              <EmptyState icon="zap" title="No agent insights" subtitle="Recommendations and patterns from your agents will appear here." compact />
            ) : insights.map((item) => {
              const iconCfg = AGENT_ICON_COLORS[item.agent];
              return (
                <div key={item.id} className="px-[18px] py-3 border-b border-[#f0eeea] last:border-b-0 hover:bg-[#f5f4f0] transition-colors">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[9px] font-heading font-bold uppercase tracking-[0.5px] px-1.5 py-[1px] rounded border bg-[#f5f4f0] text-terminal-muted border-[#e5e5e0]">{item.agentLabel}</span>
                    <span className={`text-[9px] font-heading font-bold uppercase tracking-[0.5px] px-1.5 py-[1px] rounded ${INSIGHT_TYPE_STYLES[item.type]}`}>{item.type}</span>
                    <span className="text-[10px] font-mono text-[#c5c5bc] tabular-nums ml-auto">{item.time}</span>
                  </div>
                  <div className="text-[13px] font-medium text-terminal-text leading-[1.4]">{item.title}</div>
                  <div className="text-[11px] text-terminal-muted mt-0.5" dangerouslySetInnerHTML={{ __html: item.body }} />
                  <div className="flex items-center gap-1.5 mt-2">
                    {item.actions.map((action) => (
                      <button
                        key={action}
                        onClick={() => handleInsightAction(item.id, action)}
                        className={`px-2.5 py-1 rounded-md text-[10px] font-heading font-semibold transition-opacity ${
                          action === 'Dismiss' || action === 'Snooze'
                            ? 'bg-terminal-panel text-terminal-muted border border-terminal-border hover:bg-[#f5f4f0]'
                            : 'bg-[var(--t-ui-accent)] text-white hover:opacity-90'
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
        </div>}

        {/* Deal Pipeline */}
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
            <span className="text-xs font-heading font-bold text-terminal-text tracking-[0.3px]">Deal Pipeline</span>
            {(crmData || hubspotPipeline) && (
              <span className="text-[11px] text-terminal-muted flex items-center gap-1.5">
                {crmData?.sheetUrl && (
                  <a href={crmData.sheetUrl} target="_blank" rel="noopener noreferrer" className="hover:text-terminal-text transition-colors">
                    Open Sheet ↗
                  </a>
                )}
                {!crmData?.sheetUrl && (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--t-ui-accent)]" />
                    Live
                  </>
                )}
              </span>
            )}
          </div>
          <div>
            {crmData?.rows?.length > 0 ? crmData.rows.map((row, i) => (
              <div key={i} className="flex items-center justify-between px-[18px] py-[9px] border-b border-[#f0eeea] last:border-b-0 text-[13px]">
                <span className="text-[#6b6b65]">{row.stage}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-mono text-terminal-muted tabular-nums">{row.value}</span>
                  <span className="font-mono font-semibold text-terminal-text tabular-nums w-5 text-right">{row.count}</span>
                </div>
              </div>
            )) : hubspotPipeline ? hubspotPipeline.map((row, i) => (
              <div key={i} className="flex items-center justify-between px-[18px] py-[9px] border-b border-[#f0eeea] last:border-b-0 text-[13px]">
                <span className="text-[#6b6b65]">{row.stage}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] font-mono text-terminal-muted tabular-nums">{row.value}</span>
                  <span className="font-mono font-semibold text-terminal-text tabular-nums w-5 text-right">{row.count}</span>
                </div>
              </div>
            )) : crmData?.rows?.length === 0 ? (
              <div className="px-[18px] py-6 text-center">
                <p className="text-[13px] text-terminal-muted mb-1">No deals yet</p>
                {crmData?.sheetUrl && (
                  <a href={crmData.sheetUrl} target="_blank" rel="noopener noreferrer" className="text-[12px] text-[var(--t-ui-accent)] hover:underline">
                    Add deals in your pipeline sheet ↗
                  </a>
                )}
              </div>
            ) : (
              <div className="px-[18px] py-6 text-center">
                <p className="text-[13px] text-terminal-muted mb-3">Track your deals with a Google Sheet or HubSpot.</p>
                <div className="flex items-center justify-center gap-2">
                  <button
                    onClick={async () => {
                      setCrmLoading(true);
                      try {
                        let token = null;
                        try { const s = JSON.parse(sessionStorage.getItem('sangha_auth')); token = s?.tokens?.accessToken; } catch {}
                        const doSetup = async (confirmReplace = false) => {
                          const res = await fetch(`${API_BASE}/v1/crm/setup-sheet`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                            body: JSON.stringify(confirmReplace ? { confirm_replace: true } : {}),
                          });
                          return res.json();
                        };
                        let data = await doSetup();
                        if (data.needs_confirmation) {
                          const yes = window.confirm('A contact sheet is already connected to your dashboard. Replace it with a new one?');
                          if (!yes) { setCrmLoading(false); return; }
                          data = await doSetup(true);
                        }
                        if (data.success) {
                          setCrmData({ rows: [], source: 'sheets', sheetUrl: data.sheetUrl, total: 0 });
                          showToast('Pipeline sheet created');
                        } else {
                          showToast(data.error || 'Failed to create sheet');
                        }
                      } catch { showToast('Failed to create sheet'); }
                      setCrmLoading(false);
                    }}
                    disabled={crmLoading}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-heading font-semibold bg-terminal-text text-white hover:opacity-90 transition-all disabled:opacity-50"
                  >
                    {crmLoading ? 'Creating...' : 'Connect Google Sheets'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Row 3: Activity Feed (full width) */}
      <div className="mb-4">
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
            <div className="flex items-center gap-2">
              <span className="text-xs font-heading font-bold text-terminal-text tracking-[0.3px]">Activity</span>
              <span className="text-[9px] font-heading font-bold text-[var(--t-ui-accent)] bg-[var(--t-ui-accent-bg)] px-2 py-0.5 rounded-full uppercase tracking-[0.5px]">Live</span>
            </div>
            <span className="text-[11px] text-terminal-muted">All agents</span>
          </div>
          <div>
            {activities.length === 0 ? (
              <EmptyState icon="activity" title="No activity yet" subtitle="Agent actions and events will appear here as they happen." compact />
            ) : (() => {
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
                      <span className="text-[10px] font-mono text-[#c5c5bc] font-medium tabular-nums">
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
            <span className="text-xs font-heading font-bold text-terminal-text tracking-[0.3px]">Pipeline</span>
            <span className="text-[11px] font-mono text-terminal-muted">{leadStats ? `${leadStats.totalLeads || 0} total` : '—'}</span>
          </div>
          <div className="py-1">
            {PIPELINE.map((row, i) => (
              <div key={i} className="flex items-center gap-2.5 px-[18px] py-2 border-b border-[#f0eeea] last:border-b-0">
                <span className="text-xs text-[#6b6b65] w-[100px] shrink-0">{row.label}</span>
                <div className="flex-1 h-1.5 bg-[#f5f4f0] rounded-[3px] overflow-hidden">
                  <div
                    className="h-full bg-[var(--t-ui-accent)] rounded-[3px] transition-all duration-700"
                    style={{ width: `${Math.max(row.pct, 1)}%` }}
                  />
                </div>
                <span className="text-xs font-mono font-semibold text-terminal-text w-9 text-right tabular-nums">{row.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Follow-Ups */}
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
            <span className="text-xs font-heading font-bold text-terminal-text tracking-[0.3px]">Follow-Ups</span>
            <span className="text-[11px] font-mono text-terminal-muted">{FOLLOWUPS.length} pending</span>
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
            <span className="text-xs font-heading font-bold text-terminal-text tracking-[0.3px]">Agents</span>
            <span className="text-[11px] font-mono text-terminal-muted">{AGENTS.filter(a => a.status === 'on').length} of {AGENTS.length} active</span>
          </div>
          <div>
            {AGENTS.map((agent, i) => (
              <div key={i} onClick={() => onNavigate?.(agent.tabId)} className="flex items-center gap-3 px-[18px] py-[11px] border-b border-[#f0eeea] last:border-b-0 hover:bg-[#f5f4f0] cursor-pointer transition-colors">
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_STYLES[agent.status]}`} />
                <div className="text-[13px] font-medium text-terminal-text flex-1">{agent.name}</div>
                <span className={`text-[10px] font-heading font-semibold px-2.5 py-[3px] rounded-md uppercase tracking-[0.3px] ${MODE_STYLES[agent.mode]}`}>
                  {agent.mode}
                </span>
                <span className="text-xs font-mono text-[#6b6b65] font-medium min-w-[56px] text-right tabular-nums">{agent.stat}</span>
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
                  <span className="inline-flex items-center gap-1.5 text-[10px] font-heading font-semibold uppercase tracking-[0.06em] px-2 py-[2px] rounded bg-[var(--t-ui-accent-bg)] text-[var(--t-ui-accent)] border border-[var(--t-ui-accent-border)]">
                    <span className="w-[5px] h-[5px] rounded-full bg-[var(--t-ui-accent)]" />
                    {insightModal.agentLabel} · {insightModal.type}
                  </span>
                </div>
                <h2 className="text-[20px] font-semibold text-terminal-text leading-[1.2] mb-1">{insightModal.title}</h2>
              </div>
              <button onClick={() => setInsightModal(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#9a9a92] border border-[#f0eeea] hover:bg-[#f5f4f0] hover:text-terminal-text transition-colors text-base shrink-0">&times;</button>
            </div>

            {/* Body */}
            {insightModal.body && (
              <div className="px-7 py-5 border-b border-[#f0eeea]">
                <div className="text-[13px] text-terminal-text leading-[1.6]" dangerouslySetInnerHTML={{ __html: insightModal.body }} />
              </div>
            )}

            {/* Footer */}
            <div className="px-7 py-[18px] flex items-center justify-between">
              <span className="text-[10px] font-mono text-[#c5c5bc] tabular-nums">{insightModal.time}</span>
              <div className="flex items-center gap-2.5">
                <button
                  onClick={() => { setInsightModal(null); handleInsightAction(insightModal.id, 'Dismiss'); }}
                  className="px-4 py-2 rounded-lg text-[12px] font-heading font-medium text-[var(--t-ui-accent)] border border-[#f0eeea] hover:border-[var(--t-ui-accent-border)] hover:bg-[var(--t-ui-accent-bg)]/30 transition-all"
                >
                  Dismiss
                </button>
                <button
                  onClick={() => setInsightModal(null)}
                  className="px-4 py-2 rounded-lg text-[12px] font-heading font-semibold bg-[var(--t-ui-accent)] text-white hover:opacity-90 transition-colors flex items-center gap-1.5"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  Got it
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
                <div className="inline-flex items-center gap-1.5 mb-2.5 px-2 py-[3px] rounded text-[10px] font-heading font-semibold uppercase tracking-[0.08em]" style={{ background: 'rgba(45,106,79,0.2)', border: '1px solid rgba(64,145,108,0.25)', color: '#74c69d', letterSpacing: '0.08em' }}>
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
                        <div className="text-[10px] font-heading font-semibold uppercase tracking-[0.05em] mb-[5px]" style={{ color: isAgent ? '#52796f' : '#3d6b57', textAlign: isAgent ? 'right' : 'left' }}>
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
              <span className="text-[10px] font-mono tabular-nums" style={{ color: '#2d4a3e' }}>{threadModal.messages.length} messages</span>
              <button
                onClick={() => {
                  localStorage.setItem('open_thread_id', threadModal.threadId);
                  const targetTab = `${threadModal.agentId || 'hivemind'}-chat`;
                  setThreadModal(null);
                  onNavigate?.(targetTab);
                }}
                className="px-4 py-2 rounded-lg text-[12px] font-heading font-semibold flex items-center gap-1.5 transition-colors"
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

      {/* Document Preview Modal */}
      {docPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setDocPreview(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[90vw] max-w-[900px] h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--t-border)] bg-[var(--t-surface-dim)]">
              <div className="flex items-center gap-2.5 min-w-0">
                {docPreview.type === 'pdf' ? <FileText size={16} className="text-red-600 shrink-0" /> : <Download size={16} className="text-indigo-600 shrink-0" />}
                <div className="min-w-0">
                  <h3 className="text-[14px] font-bold text-terminal-text font-heading truncate">{docPreview.title}</h3>
                  <span className="text-[11px] text-terminal-muted uppercase">{docPreview.type === 'pdf' ? 'PDF Document' : 'Word Document'}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a href={docPreview.url} download={docPreview.filename || true}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold font-heading rounded-lg border border-[var(--t-border)] bg-white text-[var(--t-ui-accent)] hover:bg-[var(--t-surface-dim)] transition-colors">
                  <Download size={12} /> Download
                </a>
                <button onClick={() => setDocPreview(null)} className="w-7 h-7 rounded-lg flex items-center justify-center text-terminal-muted hover:text-terminal-text hover:bg-[var(--t-surface-dim)] transition-colors">
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              {docPreview.type === 'pdf' ? (
                <iframe src={docPreview.url} className="w-full h-full border-0" title={docPreview.title} />
              ) : (
                <div className="p-6 max-w-[700px] mx-auto">
                  <div className="text-[13px] leading-[1.7] text-[#333]">
                    {(docPreview.assignment?.result_summary || '').split('\n').map((line, i) => {
                      if (line.startsWith('# ')) return <h1 key={i} className="text-[18px] font-bold text-[var(--t-ui-accent)] mt-6 mb-2 font-heading">{line.slice(2)}</h1>;
                      if (line.startsWith('## ')) return <h2 key={i} className="text-[15px] font-bold text-[var(--t-ui-accent)] mt-5 mb-1.5 font-heading">{line.slice(3)}</h2>;
                      if (line.startsWith('### ')) return <h3 key={i} className="text-[13px] font-bold text-[var(--t-ui-accent)] mt-4 mb-1 font-heading">{line.slice(4)}</h3>;
                      if (line.startsWith('- ')) return <li key={i} className="ml-4 text-[12px] text-[#444] mb-0.5">{line.slice(2)}</li>;
                      if (line.trim() === '') return <div key={i} className="h-2" />;
                      return <p key={i} className="text-[12px] text-[#444] mb-1">{line}</p>;
                    })}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

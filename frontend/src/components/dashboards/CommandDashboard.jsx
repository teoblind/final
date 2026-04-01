import React, { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Calendar, CheckCircle, XCircle, RotateCcw, Share2, Check, X, MessageSquare, ChevronDown, ChevronUp, FileText, Download, ExternalLink, Archive, Users, ClipboardList, FileSpreadsheet, Link2, Search, Unlink, Mic, Video } from 'lucide-react';
import EmptyState from '../ui/EmptyState';
import InfoRequestCard from '../panels/agents/InfoRequestCard.jsx';
import TaskInputForm from './TaskInputForm.jsx';

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

function cleanResultSummary(s) {
  if (!s) return '';
  return s.replace(/<task_proposal>[\s\S]*?<\/task_proposal>/g, '').trim();
}

// ─── Structural Defaults ─────────────────────────────────────────────────────

const DEFAULT_METRICS = [
  { label: 'Leads', value: '-', delta: 'loading...', type: 'flat', bar: 0 },
  { label: 'Outreach', value: '-', delta: '', type: 'flat', bar: 0 },
  { label: 'Replies', value: '-', delta: '', type: 'flat', bar: 0 },
  { label: 'Meetings', value: '-', delta: '', type: 'flat', bar: 0 },
];


const DELTA_COLORS = {
  up: 'text-[var(--t-ui-accent)]',
  warn: 'text-terminal-amber',
  flat: 'text-terminal-muted',
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

// ─── Constants ──────────────────────────────────────────────────────────────

const MEETING_RANGES = [
  { key: 'week', label: '7d' },
  { key: 'month', label: '30d' },
  { key: '90', label: '90d' },
];

export default function CommandDashboard({ onNavigate }) {
  const [approvals, setApprovals] = useState([]);
  const [insights, setInsights] = useState([]);
  const [toast, setToast] = useState(null);
  const [actionItems, setActionItems] = useState([]);
  const [insightModal, setInsightModal] = useState(null);
  const [threadModal, setThreadModal] = useState(null); // { thread, messages, loading }
  const [leadStats, setLeadStats] = useState(null);
  const [approvalsPage, setApprovalsPage] = useState(0);
  const [expandedApproval, setExpandedApproval] = useState(null);
  const [meetingsPage, setMeetingsPage] = useState(0);
  // Meetings state (matches DACP pattern)
  const [meetings, setMeetings] = useState([]);
  const [meetingRange, setMeetingRange] = useState('week');
  const [invitedMeetings, setInvitedMeetings] = useState(new Set());
  const [invitingId, setInvitingId] = useState(null);
  // Agent Assignments
  const [assignments, setAssignments] = useState([]);
  const [docPreview, setDocPreview] = useState(null);
  const [processingAssignment, setProcessingAssignment] = useState(null);
  const [sharedAssignments, setSharedAssignments] = useState({});
  const [infoRequests, setInfoRequests] = useState({});
  const [assignmentExpanded, setAssignmentExpanded] = useState(null);
  // Task tabs + pagination
  const [taskTab, setTaskTab] = useState('suggested');
  const [assignmentsPage, setAssignmentsPage] = useState(0);
  // Leads pipeline state
  const [leadsSheet, setLeadsSheet] = useState(null);
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadsPage, setLeadsPage] = useState(1);
  const [leadsActiveTab, setLeadsActiveTab] = useState(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkInput, setLinkInput] = useState('');
  const [linkError, setLinkError] = useState('');
  const [linking, setLinking] = useState(false);
  const [driveResults, setDriveResults] = useState([]);
  const [driveSearching, setDriveSearching] = useState(false);
  const [driveQuery, setDriveQuery] = useState('');
  const [leadsShares, setLeadsShares] = useState([]);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareTeam, setShareTeam] = useState([]);
  const [leadsShareSelected, setLeadsShareSelected] = useState([]);
  const [leadsShareLoading, setLeadsShareLoading] = useState(false);
  const [acceptingShare, setAcceptingShare] = useState(null);
  // HubSpot state
  const [hubspotConnected, setHubspotConnected] = useState(false);
  const [showHubspotModal, setShowHubspotModal] = useState(false);
  const [hubspotKey, setHubspotKey] = useState('');
  const [hubspotConnecting, setHubspotConnecting] = useState(false);
  const [hubspotError, setHubspotError] = useState('');
  const [hubspotPipeline, setHubspotPipeline] = useState(null);
  const [hubspotLoading, setHubspotLoading] = useState(false);
  const [leadsTab, setLeadsTab] = useState('sheet');
  // HubSpot contacts + classification
  const [hsContacts, setHsContacts] = useState([]);
  const [hsContactsLoading, setHsContactsLoading] = useState(false);
  const [hsClassFilter, setHsClassFilter] = useState('all'); // 'all' | 'true' | 'false'
  const [hsClassStats, setHsClassStats] = useState(null);
  const [hsPaging, setHsPaging] = useState(null);
  const [hsSearch, setHsSearch] = useState('');
  const [hsIndustryFilter, setHsIndustryFilter] = useState('');
  const [hsReasonFilter, setHsReasonFilter] = useState('');
  const [hsMaterialsFilter, setHsMaterialsFilter] = useState('');
  const [hsContactModal, setHsContactModal] = useState(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2500); };

  // ─── Leads Pipeline Handlers ──────────────────────────────────────────────
  const fetchLeadsSheet = useCallback((tab, page) => {
    setLeadsLoading(true);
    const params = new URLSearchParams();
    if (tab) params.set('tab', tab);
    if (page) params.set('page', page);
    params.set('pageSize', '10');
    fetch(`${API_BASE}/v1/estimates/leads-sheet?${params}`, { headers: getAuthHeaders() })
      .then(r => r.json())
      .then(data => {
        if (data.configured && data.sheetId !== '__unlinked__') {
          setLeadsSheet(data);
          setLeadsTab('sheet');
          if (data.activeTab) setLeadsActiveTab(data.activeTab);
          if (data.page) setLeadsPage(data.page);
        } else {
          setLeadsSheet({ configured: false });
        }
        if (data.pendingSharesCount > 0) {
          fetch(`${API_BASE}/v1/estimates/leads-sheet/shares`, { headers: getAuthHeaders() })
            .then(r => r.json()).then(d => setLeadsShares(d.shares || [])).catch(() => {});
        } else {
          setLeadsShares([]);
        }
      })
      .catch(() => setLeadsSheet({ configured: false }))
      .finally(() => setLeadsLoading(false));
  }, []);

  const handleLinkSheet = useCallback(async (url) => {
    setLinking(true);
    setLinkError('');
    try {
      const res = await fetch(`${API_BASE}/v1/estimates/leads-sheet/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ sheetUrl: url }),
      });
      const data = await res.json();
      if (data.error) { setLinkError(data.error); return; }
      setShowLinkModal(false);
      setLinkInput('');
      fetchLeadsSheet();
    } catch (err) { setLinkError(err.message); }
    finally { setLinking(false); }
  }, [fetchLeadsSheet]);

  const handleUnlinkSheet = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/v1/estimates/leads-sheet/unlink`, { method: 'DELETE', headers: getAuthHeaders() });
      setLeadsSheet({ configured: false });
    } catch {}
  }, []);

  const handleOpenShareModal = useCallback(async () => {
    setShowShareModal(true);
    setLeadsShareSelected([]);
    try {
      const res = await fetch(`${API_BASE}/v1/estimates/leads-sheet/team`, { headers: getAuthHeaders() });
      const data = await res.json();
      setShareTeam(data.users || []);
    } catch { setShareTeam([]); }
  }, []);

  const handleShareSheet = useCallback(async () => {
    if (!leadsShareSelected.length || !leadsSheet?.sheetId) return;
    setLeadsShareLoading(true);
    try {
      await fetch(`${API_BASE}/v1/estimates/leads-sheet/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ targetUserIds: leadsShareSelected, sheetId: leadsSheet.sheetId, sheetTitle: leadsSheet.sheetTitle }),
      });
      setShowShareModal(false);
      setLeadsShareSelected([]);
    } catch {}
    finally { setLeadsShareLoading(false); }
  }, [leadsShareSelected, leadsSheet]);

  const handleAcceptShare = useCallback(async (shareId) => {
    setAcceptingShare(shareId);
    try {
      await fetch(`${API_BASE}/v1/estimates/leads-sheet/shares/${shareId}/accept`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      });
      setLeadsShares(prev => prev.filter(s => s.id !== shareId));
      fetchLeadsSheet();
    } catch {}
    finally { setAcceptingShare(null); }
  }, [fetchLeadsSheet]);

  const handleDeclineShare = useCallback(async (shareId) => {
    try {
      await fetch(`${API_BASE}/v1/estimates/leads-sheet/shares/${shareId}/decline`, {
        method: 'POST', headers: getAuthHeaders(),
      });
      setLeadsShares(prev => prev.filter(s => s.id !== shareId));
    } catch {}
  }, []);

  const searchDrive = useCallback(async (q) => {
    if (!q.trim()) return;
    setDriveSearching(true);
    try {
      const res = await fetch(`${API_BASE}/v1/estimates/leads-sheet/search?q=${encodeURIComponent(q)}`, { headers: getAuthHeaders() });
      const data = await res.json();
      setDriveResults(data.files || []);
    } catch { setDriveResults([]); }
    finally { setDriveSearching(false); }
  }, []);

  // Fetch lead stats from API
  useEffect(() => {
    async function fetchLeadStats() {
      try {
        const res = await fetch(`${API_BASE}/v1/lead-engine/stats`, {
          headers: getAuthHeaders(),
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

  // Fetch leads pipeline data (Sheet + HubSpot)
  useEffect(() => {
    fetchLeadsSheet();
    fetch(`${API_BASE}/v1/hubspot/status`, { headers: getAuthHeaders() })
      .then(r => r.json()).then(d => {
        setHubspotConnected(!!d.configured);
        if (d.configured) {
          setHubspotLoading(true);
          Promise.all([
            fetch(`${API_BASE}/v1/hubspot/pipeline`, { headers: getAuthHeaders() }).then(r => r.json()).catch(() => null),
            fetch(`${API_BASE}/v1/hubspot/local-stats`, { headers: getAuthHeaders() }).then(r => r.json()).catch(() => null),
            fetch(`${API_BASE}/v1/hubspot/local-contacts?limit=50`, { headers: getAuthHeaders() }).then(r => r.json()).catch(() => null),
          ]).then(([pipeline, classStats, contacts]) => {
            if (pipeline) setHubspotPipeline(pipeline);
            if (classStats) setHsClassStats(classStats);
            if (contacts) { setHsContacts(contacts.classifications || []); setHsPaging({ total: contacts.total, offset: contacts.offset, limit: contacts.limit }); }
          }).finally(() => setHubspotLoading(false));
          if (!leadsSheet?.configured) setLeadsTab('hubspot');
        }
      }).catch(() => {});
  }, [fetchLeadsSheet]);

  const fetchHsContacts = useCallback(async (filter, afterOffset, { query, industry, reason, materials } = {}) => {
    setHsContactsLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (filter && filter !== 'all') params.set('classified', filter);
      if (afterOffset) params.set('offset', String(afterOffset));
      if (query) params.set('q', query);
      if (industry) params.set('industry', industry);
      if (reason) params.set('reason', reason);
      if (materials) params.set('materials', materials);
      const r = await fetch(`${API_BASE}/v1/hubspot/local-contacts?${params}`, { headers: getAuthHeaders() });
      const d = await r.json();
      if (afterOffset) {
        setHsContacts(prev => [...prev, ...(d.classifications || [])]);
      } else {
        setHsContacts(d.classifications || []);
      }
      setHsPaging({ total: d.total, offset: d.offset, limit: d.limit });
    } catch {} finally { setHsContactsLoading(false); }
  }, []);

  // Fetch real approvals and insights from API
  useEffect(() => {
    async function fetchApprovals() {
      try {
        const res = await fetch(`${API_BASE}/v1/approvals?status=pending`, { headers: getAuthHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        const mapped = (data.items || []).map(item => {
          const pl = item.payload || {};
          // Generate a description from payload if none provided
          let desc = item.description || '';
          if (!desc) {
            if (item.type === 'email_draft' || pl.to) {
              desc = pl.to ? `Email to ${pl.to}` : '';
              if (pl.subject) desc += desc ? ` - ${pl.subject}` : pl.subject;
            } else if (pl.subject) {
              desc = pl.subject;
            } else if (item.type === 'estimate') {
              desc = 'Estimate ready for review';
            } else if (item.type === 'report') {
              desc = 'Report ready for review';
            }
          }
          return {
            id: item.id,
            type: item.type,
            agent: item.agentId,
            agentLabel: (item.agentId || 'agent').charAt(0).toUpperCase() + (item.agentId || 'agent').slice(1),
            icon: AGENT_ICON_COLORS[item.agentId] || { letter: 'A', color: 'var(--t-ui-accent)', bg: 'var(--t-ui-accent-bg)' },
            title: item.title,
            description: item.description || '',
            desc,
            time: formatRelativeTime(item.createdAt),
            payload: pl,
          };
        });
        setApprovals(mapped);
      } catch {}
    }
    async function fetchInsights() {
      try {
        const res = await fetch(`${API_BASE}/v1/approvals/insights?status=active`, { headers: getAuthHeaders() });
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
          const pinnedRes = await fetch(`${API_BASE}/v1/chat/pinned-threads`, { headers: getAuthHeaders() });
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


  // Fetch action items
  useEffect(() => {
    async function fetchActionItems() {
      try {
        const res = await fetch(`${API_BASE}/v1/knowledge/action-items?status=all&limit=30`, { headers: getAuthHeaders() });
        if (!res.ok) throw new Error();
        const items = await res.json();
        setActionItems(items);
      } catch {
        setActionItems([]);
      }
    }
    fetchActionItems();
  }, []);

  // Fetch meetings from /v1/meetings (same endpoint as DACP)
  useEffect(() => {
    async function fetchMeetings() {
      try {
        const res = await fetch(`${API_BASE}/v1/meetings?range=${meetingRange}`, { headers: getAuthHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        const mtgs = data.meetings || [];
        setMeetings(mtgs);
        // Auto-detect already-invited meetings
        const alreadyInvited = new Set();
        for (const m of mtgs) {
          if (m.attendees?.some(a => a.email?.includes('coppice') || a.email?.includes('agent@'))) {
            alreadyInvited.add(m.id);
          }
        }
        if (alreadyInvited.size > 0) setInvitedMeetings(prev => new Set([...prev, ...alreadyInvited]));
      } catch {}
    }
    fetchMeetings();
    const interval = setInterval(fetchMeetings, 30000);
    return () => clearInterval(interval);
  }, [meetingRange]);

  const handleInviteCoppice = async (meeting) => {
    setInvitingId(meeting.id);
    try {
      const headers = { ...getAuthHeaders(), 'Content-Type': 'application/json' };
      const res = await fetch(`${API_BASE}/v1/meetings/${encodeURIComponent(meeting.id)}/invite`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ meetLink: meeting.meetLink, title: meeting.title }),
      });
      if (res.ok) {
        setInvitedMeetings(prev => new Set([...prev, meeting.id]));
      }
    } catch (err) {
      console.error('Failed to invite Coppice:', err);
    } finally {
      setInvitingId(null);
    }
  };

  const formatMeetingTime = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  };

  const formatMeetingDay = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  const handleToggleActionItem = useCallback(async (id) => {
    const item = actionItems.find(a => a.id === id);
    if (!item) return;
    const newStatus = item.status === 'completed' ? 'open' : 'completed';
    setActionItems(prev => prev.map(a => a.id === id ? { ...a, status: newStatus } : a));
    showToast(newStatus === 'completed' ? 'Marked complete' : 'Reopened');
    try {
      await fetch(`${API_BASE}/v1/knowledge/action-items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
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

  const handleSubmitInputs = useCallback(async (id, values) => {
    try {
      const res = await fetch(`${API_BASE}/v1/estimates/assignments/${id}/inputs`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ values }),
      });
      if (res.ok) {
        setAssignments(prev => prev.map(a => a.id === id ? { ...a, input_values_json: JSON.stringify(values) } : a));
      }
    } catch {}
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

  const handleArchiveAssignment = useCallback(async (id) => {
    try {
      await fetch(`${API_BASE}/v1/estimates/assignments/${id}/archive`, { method: 'POST', headers: getAuthHeaders() });
      setAssignments(prev => prev.filter(a => a.id !== id));
    } catch {}
  }, []);

  const handleShareInternal = useCallback(async (id) => {
    try {
      setSharedAssignments(prev => ({ ...prev, [`internal-${id}`]: 'sharing' }));
      const res = await fetch(`${API_BASE}/v1/estimates/assignments/${id}/share-internal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      });
      if (res.ok) {
        setSharedAssignments(prev => ({ ...prev, [`internal-${id}`]: 'shared' }));
        setAssignments(prev => prev.map(a => a.id === id ? { ...a, visibility: 'shared' } : a));
      }
    } catch {}
  }, []);

  const handleApprove = useCallback(async (id) => {
    const item = approvals.find(a => a.id === id);
    try {
      await fetch(`${API_BASE}/v1/approvals/${id}/approve`, { method: 'POST', headers: getAuthHeaders() });
      const toastMap = { email_draft: 'Approved - email sent', tool_action: 'Approved - executing action', meeting_instruction: 'Approved - executing instruction' };
      showToast(toastMap[item?.type] || 'Approved');
    } catch {
      showToast('Approve failed');
    }
    setApprovals(prev => prev.filter(a => a.id !== id));
  }, [approvals]);

  const handleReject = useCallback(async (id) => {
    try {
      await fetch(`${API_BASE}/v1/approvals/${id}/reject`, { method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Rejected by operator' }) });
      showToast('Rejected');
    } catch {
      showToast('Reject failed');
    }
    setApprovals(prev => prev.filter(a => a.id !== id));
  }, []);


  const handleInsightAction = async (insightId, action) => {
    if (action === 'Dismiss' || action === 'Snooze') {
      try {
        await fetch(`${API_BASE}/v1/approvals/insights/${insightId}/dismiss`, { method: 'POST', headers: getAuthHeaders() });
      } catch {}
      setInsights(prev => prev.filter(i => i.id !== insightId));
      showToast(action === 'Dismiss' ? 'Insight dismissed' : 'Snoozed for 24 hours');
    } else if (action === 'Mark Done') {
      try {
        await fetch(`${API_BASE}/v1/approvals/insights/${insightId}/dismiss`, { method: 'POST', headers: getAuthHeaders() });
      } catch {}
      setInsights(prev => prev.filter(i => i.id !== insightId));
      showToast('Marked as done');
    } else if (action === 'View Thread') {
      const insight = insights.find(i => i.id === insightId);
      if (insight?._threadId && insight?._agentId) {
        // Open thread modal for real threads
        setThreadModal({ threadId: insight._threadId, agentId: insight._agentId, title: insight.title, agentLabel: insight.agentLabel, type: insight.type, time: insight.time, messages: [], loading: true });
        try {
          const res = await fetch(`${API_BASE}/v1/chat/${insight._agentId}/threads/${insight._threadId}/messages`, {
            headers: getAuthHeaders(),
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


  return (
    <div className="p-6 lg:px-7 lg:py-6">
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
          {(() => {
            const APPROVALS_PER_PAGE = 5;
            const totalApprovalPages = Math.max(1, Math.ceil(approvals.length / APPROVALS_PER_PAGE));
            const safeApprovalPage = Math.min(approvalsPage, totalApprovalPages - 1);
            const pagedApprovals = approvals.slice(safeApprovalPage * APPROVALS_PER_PAGE, (safeApprovalPage + 1) * APPROVALS_PER_PAGE);
            return (
              <div>
                {approvals.length === 0 ? (
                  <EmptyState icon="shield" title="No pending approvals" subtitle="Agent actions requiring your review will appear here." compact />
                ) : pagedApprovals.map((item) => {
                  const isExpanded = expandedApproval === item.id;
                  const payload = item.payload || {};
                  return (
                    <div key={item.id} className="border-b border-[#f0eeea] last:border-b-0">
                      <div
                        className="flex items-start gap-3 px-[18px] py-3 hover:bg-[#f5f4f0] transition-colors cursor-pointer"
                        onClick={() => setExpandedApproval(isExpanded ? null : item.id)}
                      >
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
                          <button onClick={(e) => { e.stopPropagation(); handleApprove(item.id); }} className="px-2.5 py-1 rounded-md text-[10px] font-heading font-semibold bg-[var(--t-ui-accent)] text-white hover:opacity-90 transition-opacity">Approve</button>
                          <button onClick={(e) => { e.stopPropagation(); handleReject(item.id); }} className="px-2.5 py-1 rounded-md text-[10px] font-heading font-semibold bg-terminal-panel text-terminal-red border border-terminal-border hover:bg-red-50 transition-colors">Reject</button>
                          {isExpanded ? <ChevronUp size={14} className="text-terminal-muted ml-1" /> : <ChevronDown size={14} className="text-terminal-muted ml-1" />}
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="px-[18px] pb-4 pt-1 space-y-3">
                          <div className="bg-[#f9f9f7] border border-[#e8e6e2] rounded-lg overflow-hidden">
                            {(payload.to || payload.subject) && (
                              <div className="px-4 py-2.5 border-b border-[#e8e6e2] bg-[#f5f4f0]">
                                <div className="text-[10px] font-heading font-semibold text-terminal-muted uppercase mb-1.5">Details</div>
                                {payload.to && (
                                  <div className="text-[11px] text-[#6b6b65]">
                                    <span className="font-medium text-terminal-text">To:</span> {payload.to}
                                  </div>
                                )}
                                {payload.subject && (
                                  <div className="text-[11px] text-[#6b6b65]">
                                    <span className="font-medium text-terminal-text">Subject:</span> {payload.subject}
                                  </div>
                                )}
                              </div>
                            )}
                            <div className="p-4">
                              {payload.html ? (
                                <div
                                  className="text-[12px] text-terminal-text leading-relaxed [&_table]:w-full [&_table]:border-collapse [&_td]:p-1.5 [&_td]:text-[11px] [&_th]:p-1.5 [&_th]:text-[11px] [&_th]:text-left [&_th]:font-semibold [&_h2]:text-[13px] [&_h2]:font-bold [&_h2]:mb-2 [&_h3]:text-[12px] [&_h3]:font-semibold [&_h3]:mb-1 [&_p]:mb-2 [&_p]:text-[12px]"
                                  dangerouslySetInnerHTML={{ __html: payload.html }}
                                />
                              ) : payload.body ? (
                                <div className="text-[12px] text-terminal-text whitespace-pre-wrap leading-relaxed">
                                  {payload.body}
                                </div>
                              ) : (
                                <div className="text-[12px] text-terminal-text whitespace-pre-wrap leading-relaxed">
                                  {item.description || 'No preview available'}
                                </div>
                              )}
                            </div>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const context = { approvalId: item.id, title: item.title, description: item.description, type: item.type, payload };
                              sessionStorage.setItem('approval_context', JSON.stringify(context));
                              onNavigate?.('hivemind-chat');
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-heading font-semibold text-[var(--t-ui-accent)] bg-[var(--t-ui-accent-bg)] border border-[var(--t-ui-accent-border,#c8d8e8)] hover:opacity-80 transition-opacity"
                          >
                            <MessageSquare size={12} />
                            Edit in Agent Chat
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
                {totalApprovalPages > 1 && (
                  <div className="px-[18px] py-2 flex items-center justify-between border-t border-[#f0eeea]">
                    <span className="text-[10px] text-terminal-muted">{approvals.length} pending</span>
                    <div className="flex items-center gap-2">
                      <button disabled={safeApprovalPage <= 0} onClick={() => setApprovalsPage(p => p - 1)}
                        className="px-2 py-0.5 text-[10px] font-heading font-semibold rounded border border-[#e0ddd8] disabled:opacity-30 hover:bg-[#f5f4f0]">Prev</button>
                      <span className="text-[10px] text-terminal-muted">{safeApprovalPage + 1} / {totalApprovalPages}</span>
                      <button disabled={safeApprovalPage >= totalApprovalPages - 1} onClick={() => setApprovalsPage(p => p + 1)}
                        className="px-2 py-0.5 text-[10px] font-heading font-semibold rounded border border-[#e0ddd8] disabled:opacity-30 hover:bg-[#f5f4f0]">Next</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Agent Assignments - tabbed */}
      <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden mb-5">
        <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
          <div className="flex items-center gap-2">
            <ClipboardList size={14} className="text-[var(--t-ui-accent)]" />
            <div className="flex items-center gap-0.5 bg-[#f5f4f0] rounded-lg p-0.5">
              {[
                { id: 'suggested', label: 'Suggested', count: assignments.filter(a => a.status === 'proposed').length },
                { id: 'active', label: 'Active', count: assignments.filter(a => a.status === 'in_progress' || a.status === 'confirmed').length },
                { id: 'completed', label: 'Completed', count: assignments.filter(a => a.status === 'completed').length },
              ].map(t => (
                <button
                  key={t.id}
                  onClick={() => { setTaskTab(t.id); setAssignmentsPage(0); }}
                  className={`text-[11px] font-heading font-semibold px-2.5 py-1 rounded-md transition-colors ${
                    taskTab === t.id
                      ? 'bg-white text-[var(--t-ui-accent)] shadow-sm'
                      : 'text-[#9a9a92] hover:text-[#6b6b65]'
                  }`}
                >
                  {t.label}{t.count > 0 ? ` (${t.count})` : ''}
                </button>
              ))}
            </div>
          </div>
        </div>
        {(() => {
          const TASKS_PER_PAGE = 5;
          const statusFilter = taskTab === 'suggested' ? ['proposed']
            : taskTab === 'active' ? ['confirmed', 'in_progress']
            : ['completed'];
          const visible = assignments.filter(a => statusFilter.includes(a.status));
          const totalPages = Math.max(1, Math.ceil(visible.length / TASKS_PER_PAGE));
          const safePage = Math.min(assignmentsPage, totalPages - 1);
          const paged = visible.slice(safePage * TASKS_PER_PAGE, (safePage + 1) * TASKS_PER_PAGE);
          const emptyMessages = {
            suggested: { title: 'No pending tasks', sub: 'Coppice generates new tasks every morning at 3 AM based on your pipeline.' },
            active: { title: 'No active tasks', sub: 'Run a suggested task to see it here while it executes.' },
            completed: { title: 'No completed tasks yet', sub: 'Completed tasks and their results will appear here.' },
          };
          if (visible.length === 0) return (
            <div className="px-[18px] py-5 text-center">
              <div className="text-[12px] text-[#9a9a92] mb-1">{emptyMessages[taskTab].title}</div>
              <div className="text-[11px] text-terminal-muted">{emptyMessages[taskTab].sub}</div>
            </div>
          );
          const catColors = {
            follow_up: 'bg-blue-50 text-blue-600 border-blue-200',
            estimate: 'bg-emerald-50 text-emerald-600 border-emerald-200',
            outreach: 'bg-purple-50 text-purple-600 border-purple-200',
            admin: 'bg-gray-50 text-gray-600 border-gray-200',
            research: 'bg-amber-50 text-amber-600 border-amber-200',
            analysis: 'bg-indigo-50 text-indigo-600 border-indigo-200',
            document: 'bg-rose-50 text-rose-600 border-rose-200',
          };
          return (
            <div>
              {paged.map(a => (
                <div key={a.id} className="border-b border-[#f0eeea] last:border-b-0">
                  <div className="flex items-start gap-3 px-[18px] py-3 hover:bg-[#f5f4f0] transition-colors">
                    <div className="flex-1 min-w-0">
                      <div
                        className="cursor-pointer hover:bg-[#f5f4f0] -mx-1 px-1 rounded transition-colors"
                        onClick={() => setAssignmentExpanded(assignmentExpanded === a.id ? null : a.id)}
                      >
                        <div className="flex items-center gap-2 mb-0.5">
                          {a.priority === 'high' && <span className="text-[10px] font-bold text-red-500">HIGH</span>}
                          <span className="text-[13px] font-medium text-terminal-text">{a.title}</span>
                          {a.category && (
                            <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border font-semibold uppercase ${catColors[a.category] || catColors.admin}`}>
                              {a.category?.replace('_', ' ')}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-[#6b6b65] leading-relaxed">{a.description}</div>
                      </div>
                      {assignmentExpanded === a.id && a.status === 'proposed' && a.input_fields_json && (() => {
                        try {
                          const fields = JSON.parse(a.input_fields_json);
                          if (!fields.length) return null;
                          const existingValues = a.input_values_json ? JSON.parse(a.input_values_json) : {};
                          return (
                            <TaskInputForm
                              inputFields={fields}
                              inputValues={existingValues}
                              onSubmit={(values) => handleSubmitInputs(a.id, values)}
                              disabled={processingAssignment === a.id}
                            />
                          );
                        } catch { return null; }
                      })()}
                      {assignmentExpanded === a.id && a.status === 'completed' && a.result_summary && (
                        <div className={`text-[11px] px-2 py-1.5 rounded leading-relaxed mt-1.5 ${
                          /^(Failed|Error|Execution failed)/i.test(cleanResultSummary(a.result_summary))
                            ? 'text-red-600 bg-red-50'
                            : 'text-emerald-600 bg-emerald-50'
                        }`}>
                          {cleanResultSummary(a.result_summary).slice(0, 500)}{cleanResultSummary(a.result_summary).length > 500 ? '...' : ''}
                        </div>
                      )}
                      {assignmentExpanded === a.id && a.status === 'completed' && (() => {
                        try {
                          const artifacts = JSON.parse(a.output_artifacts_json || '[]');
                          if (!artifacts.length) return null;
                          const handleArtifactClick = async (art) => {
                            // Email drafts - create approval item
                            if (art.type === 'email_draft') {
                              try {
                                const r = await fetch(`${API_BASE}/v1/approvals`, {
                                  method: 'POST', headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                                  body: JSON.stringify({
                                    title: art.label || `Email to ${art.to}`,
                                    description: `Email to ${art.to}: ${art.subject}`,
                                    type: 'email_draft',
                                    agent_id: a.agent_id || 'sangha',
                                    payload: { to: art.to, subject: art.subject, body: art.body, assignmentId: a.id },
                                  }),
                                });
                                if (r.ok) {
                                  // Refresh approvals
                                  setApprovals(prev => [...prev, { id: Date.now(), type: 'email_draft', agent: a.agent_id || 'sangha', agentLabel: 'Agent', desc: `Email to ${art.to} - ${art.subject}`, ts: new Date().toISOString(), payload: { to: art.to, subject: art.subject, body: art.body } }]);
                                  alert('Email draft added to approval queue. Review it in the Approvals section above.');
                                } else { alert('Failed to create approval'); }
                              } catch (err) { console.error('Approval creation error:', err); }
                              return;
                            }
                            // External URLs (Google Docs/Drive) - open directly
                            if (art.url) { window.open(art.url, '_blank'); return; }
                            // Local paths need auth - fetch as blob and open
                            if (!art.path) return;
                            try {
                              const token = (() => { try { const s = JSON.parse(sessionStorage.getItem('sangha_auth')); if (s?.tokens?.accessToken) return s.tokens.accessToken; } catch {} return localStorage.getItem('auth_token'); })();
                              const r = await fetch(`${API_BASE}${art.path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
                              if (!r.ok) throw new Error('Download failed');
                              const blob = await r.blob();
                              const url = URL.createObjectURL(blob);
                              window.open(url, '_blank');
                            } catch (err) { console.error('Artifact download error:', err); }
                          };
                          return (
                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                              {artifacts.map((art, i) => {
                                const icon = art.type === 'gdoc' ? <ExternalLink size={10} />
                                  : art.type === 'pdf' ? <FileText size={10} />
                                  : art.type === 'docx' ? <Download size={10} />
                                  : <ExternalLink size={10} />;
                                return (
                                  <button key={i} onClick={() => handleArtifactClick(art)}
                                    className={`inline-flex items-center gap-1 text-[10px] font-medium px-2.5 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                                      art.type === 'gdoc' ? 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200'
                                      : art.type === 'pdf' ? 'bg-red-50 hover:bg-red-100 text-red-700 border-red-200'
                                      : art.type === 'docx' ? 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
                                      : 'bg-white hover:bg-blue-50 text-[var(--t-ui-accent)] border-[var(--t-border)]'
                                    }`}
                                  >
                                    {icon} {art.label || art.title || art.type}
                                  </button>
                                );
                              })}
                            </div>
                          );
                        } catch { return null; }
                      })()}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                      {a.status === 'proposed' && (() => {
                        let inputsReady = true;
                        try {
                          const fields = JSON.parse(a.input_fields_json || '[]');
                          const vals = a.input_values_json ? JSON.parse(a.input_values_json) : {};
                          if (fields.length > 0) {
                            inputsReady = fields.filter(f => f.required).every(f => vals[f.name] && String(vals[f.name]).trim() !== '');
                          }
                        } catch {}
                        return (
                          <>
                            <button
                              onClick={() => handleConfirmAssignment(a.id)}
                              disabled={processingAssignment === a.id || !inputsReady}
                              title={!inputsReady ? 'Fill in required fields to confirm' : ''}
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
                        );
                      })()}
                      {a.status === 'in_progress' && (
                        <span className="flex items-center gap-1 text-[11px] text-[var(--t-ui-accent)] font-medium">
                          {infoRequests[a.job_id]?.length > 0
                            ? <><AlertCircle size={11} className="text-amber-600" /> Needs input</>
                            : <><RotateCcw size={11} className="animate-spin" /> Working...</>
                          }
                        </span>
                      )}
                      {a.status === 'completed' && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {/^(Failed|Error|Execution failed)/i.test(cleanResultSummary(a.result_summary)) ? (
                            <>
                              <button
                                onClick={() => handleConfirmAssignment(a.id)}
                                disabled={processingAssignment === a.id}
                                className="flex items-center gap-1 px-2 py-1 text-[11px] font-heading font-semibold bg-[var(--t-ui-accent)] text-white rounded-md hover:opacity-90 disabled:opacity-50"
                              >
                                <RotateCcw size={10} /> Retry
                              </button>
                              <span className="flex items-center gap-1 text-[11px] font-medium text-red-500">
                                <XCircle size={11} /> Failed
                              </span>
                            </>
                          ) : (
                            <>
                              <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-600">
                                <CheckCircle size={11} /> Done
                              </span>
                              <button
                                onClick={() => {
                                  localStorage.setItem('coppice_chat_prefill', `Let's discuss the report: "${a.title}"\n\nHere's the summary:\n${cleanResultSummary(a.result_summary).slice(0, 1000)}`);
                                  // Store assignment context so chat can load report into context panel
                                  try {
                                    const arts = JSON.parse(a.output_artifacts_json || '[]');
                                    const gdocArt = arts.find(x => x.type === 'gdoc' && x.url);
                                    if (gdocArt?.fileId) {
                                      localStorage.setItem('coppice_chat_context_file', JSON.stringify({ fileId: gdocArt.fileId, title: a.title, type: 'gdoc', url: gdocArt.url }));
                                    }
                                  } catch {}
                                  window.location.hash = 'hivemind-chat';
                                }}
                                className="flex items-center gap-1 px-2 py-1 text-[11px] font-heading font-semibold bg-[#f0f0ec] text-[#6b6b65] rounded-md hover:bg-[#e8e6e1] hover:text-terminal-text transition-colors"
                              >
                                <MessageSquare size={10} /> Chat
                              </button>
                              <button
                                onClick={() => handleShareInternal(a.id)}
                                disabled={a.visibility === 'shared' || sharedAssignments[`internal-${a.id}`] === 'sharing'}
                                className="flex items-center gap-1 px-2 py-1 text-[11px] font-heading font-semibold bg-[#f0f0ec] text-[#6b6b65] rounded-md hover:bg-[#e8e6e1] hover:text-terminal-text disabled:opacity-50 transition-colors"
                              >
                                <Users size={10} /> {a.visibility === 'shared' ? 'Shared' : 'Share'}
                              </button>
                              <button
                                onClick={() => handleArchiveAssignment(a.id)}
                                className="flex items-center gap-1 px-2 py-1 text-[11px] font-heading font-semibold bg-[#f0f0ec] text-[#6b6b65] rounded-md hover:bg-[#e8e6e1] hover:text-amber-600 transition-colors"
                              >
                                <Archive size={10} /> Archive
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
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
              {totalPages > 1 && (
                <div className="px-[18px] py-2 flex items-center justify-between border-t border-[#f0eeea]">
                  <span className="text-[10px] text-terminal-muted">{visible.length} tasks</span>
                  <div className="flex items-center gap-2">
                    <button disabled={safePage <= 0} onClick={() => setAssignmentsPage(p => p - 1)}
                      className="px-2 py-0.5 text-[10px] font-heading font-semibold rounded border border-[#e0ddd8] disabled:opacity-30 hover:bg-[#f5f4f0]">Prev</button>
                    <span className="text-[10px] text-terminal-muted">{safePage + 1} / {totalPages}</span>
                    <button disabled={safePage >= totalPages - 1} onClick={() => setAssignmentsPage(p => p + 1)}
                      className="px-2 py-0.5 text-[10px] font-heading font-semibold rounded border border-[#e0ddd8] disabled:opacity-30 hover:bg-[#f5f4f0]">Next</button>
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Meetings (matches DACP pattern - inline with range pills in header) */}
      <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden mb-5">
        <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-[var(--t-ui-accent)]" />
            <span className="text-xs font-heading font-bold text-terminal-text tracking-[0.3px]">Meetings</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-mono text-terminal-muted">{meetings.length} meeting{meetings.length !== 1 ? 's' : ''}</span>
            <div className="flex rounded-lg border border-[#e0ddd8] overflow-hidden">
              {MEETING_RANGES.map(r => (
                <button
                  key={r.key}
                  onClick={() => { setMeetingRange(r.key); setMeetingsPage(0); }}
                  className={`px-2.5 py-1 text-[10px] font-heading font-semibold transition-colors ${meetingRange === r.key ? 'bg-[var(--t-ui-accent)] text-white' : 'bg-white text-[#6b6b65] hover:bg-[#f5f4f0]'}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {(() => {
          const MEETINGS_PER_PAGE = 10;
          const totalMeetingPages = Math.max(1, Math.ceil(meetings.length / MEETINGS_PER_PAGE));
          const safeMeetingsPage = Math.min(meetingsPage, totalMeetingPages - 1);
          const pagedMeetings = meetings.slice(safeMeetingsPage * MEETINGS_PER_PAGE, (safeMeetingsPage + 1) * MEETINGS_PER_PAGE);
          return meetings.length === 0 ? (
          <div className="px-[18px] py-8 text-center text-[13px] text-terminal-muted">No meetings scheduled</div>
        ) : (
          <div>
            {pagedMeetings.map((m) => {
              const isInvited = invitedMeetings.has(m.id);
              const isInviting = invitingId === m.id;
              const hasMeetLink = !!m.meetLink;
              const isPast = new Date(m.end || m.start) < new Date();
              return (
                <div key={m.id} className={`flex items-center gap-4 px-[18px] py-3 border-b border-[#f0eeea] last:border-b-0 hover:bg-[#f9f9f7] transition-colors ${isPast ? 'opacity-60' : ''}`}>
                  {/* Time */}
                  <div className="w-[72px] shrink-0">
                    <div className="text-[11px] font-heading font-semibold text-[var(--t-ui-accent)]">{formatMeetingDay(m.start)}</div>
                    <div className="text-[11px] font-mono text-terminal-muted tabular-nums">
                      {formatMeetingTime(m.start)}
                    </div>
                  </div>

                  {/* Title + attendees */}
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-terminal-text truncate">{m.title}</div>
                    {m.attendees && m.attendees.length > 0 && (
                      <div className="text-[10px] text-terminal-muted truncate mt-px">
                        {m.attendees.slice(0, 3).map(a => a.name || a.email.split('@')[0]).join(', ')}
                        {m.attendees.length > 3 && ` +${m.attendees.length - 3}`}
                      </div>
                    )}
                  </div>

                  {/* Meet link */}
                  {hasMeetLink && (
                    <a
                      href={m.meetLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-heading font-semibold text-[#2c5282] bg-[#e8eef5] border border-[#c5d5e8] hover:bg-[#dce6f0] transition-colors shrink-0"
                      onClick={e => e.stopPropagation()}
                    >
                      <Video size={10} /> Join
                    </a>
                  )}

                  {/* Invite Coppice button */}
                  {!isPast && (
                    isInvited ? (
                      <div className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-heading font-semibold text-[#1a6b3c] bg-[#edf7f0] border border-[#d0e8d8] shrink-0">
                        <Check size={10} /> Coppice Invited
                      </div>
                    ) : (
                      <button
                        onClick={() => handleInviteCoppice(m)}
                        disabled={isInviting}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-heading font-semibold text-white bg-[var(--t-ui-accent)] hover:opacity-90 transition-colors disabled:opacity-50 shrink-0"
                      >
                        {isInviting ? (
                          <><div className="spinner w-3 h-3 border-white" /> Inviting...</>
                        ) : (
                          <><Mic size={10} /> Invite Coppice</>
                        )}
                      </button>
                    )
                  )}
                </div>
              );
            })}
            {totalMeetingPages > 1 && (
              <div className="px-[18px] py-2 flex items-center justify-between border-t border-[#f0eeea]">
                <span className="text-[10px] text-terminal-muted">{meetings.length} meetings</span>
                <div className="flex items-center gap-2">
                  <button disabled={safeMeetingsPage <= 0} onClick={() => setMeetingsPage(p => p - 1)}
                    className="px-2 py-0.5 text-[10px] font-heading font-semibold rounded border border-[#e0ddd8] disabled:opacity-30 hover:bg-[#f5f4f0]">Prev</button>
                  <span className="text-[10px] text-terminal-muted">{safeMeetingsPage + 1} / {totalMeetingPages}</span>
                  <button disabled={safeMeetingsPage >= totalMeetingPages - 1} onClick={() => setMeetingsPage(p => p + 1)}
                    className="px-2 py-0.5 text-[10px] font-heading font-semibold rounded border border-[#e0ddd8] disabled:opacity-30 hover:bg-[#f5f4f0]">Next</button>
                </div>
              </div>
            )}
          </div>
        );
        })()}
      </div>

      {/* Agent Insights */}
      <div className="mb-5">
        {insights.length > 0 && <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
            <div className="flex items-center gap-2">
              <span className="text-xs font-heading font-bold text-terminal-text tracking-[0.3px]">Agent Insights</span>
              <span className="text-[9px] font-heading font-bold text-[#5b3a8c] bg-[#f3eef8] px-2 py-0.5 rounded-full uppercase tracking-[0.5px]">New</span>
            </div>
          </div>
          <div>
            {insights.map((item) => (
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
                    <button key={action} onClick={() => handleInsightAction(item.id, action)}
                      className={`px-2.5 py-1 rounded-md text-[10px] font-heading font-semibold transition-opacity ${
                        action === 'Dismiss' || action === 'Snooze'
                          ? 'bg-terminal-panel text-terminal-muted border border-terminal-border hover:bg-[#f5f4f0]'
                          : 'bg-[var(--t-ui-accent)] text-white hover:opacity-90'
                      }`}>{action}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>}
      </div>

      {/* Leads Pipeline (Sheet + HubSpot) */}
      <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden mb-5">
        <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={14} className="text-[var(--t-ui-accent)]" />
            <span className="text-xs font-heading font-bold text-terminal-text tracking-[0.3px]">Leads Pipeline</span>
          </div>
          <div className="flex items-center gap-2">
            {leadsTab === 'hubspot' && hubspotConnected && (
              <a href="https://app.hubspot.com" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] text-[#ff7a59] hover:underline">
                <ExternalLink size={10} /> HubSpot
              </a>
            )}
            {leadsTab === 'sheet' && leadsSheet?.configured && (
              <a href={leadsSheet.sheetUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] text-[var(--t-ui-accent)] hover:underline">
                <ExternalLink size={10} /> {leadsSheet.sheetTitle}
              </a>
            )}
            {(leadsSheet?.configured || hubspotConnected) && (
              <div className="flex rounded-lg border border-[#e0ddd8] overflow-hidden">
                {leadsSheet?.configured && (
                  <button onClick={() => setLeadsTab('sheet')}
                    className={`px-2.5 py-1 text-[10px] font-heading font-semibold transition-colors ${leadsTab === 'sheet' ? 'bg-[var(--t-ui-accent)] text-white' : 'bg-white text-[#6b6b65] hover:bg-[#f5f4f0]'}`}>
                    Sheet
                  </button>
                )}
                {hubspotConnected && (
                  <button onClick={() => setLeadsTab('hubspot')}
                    className={`px-2.5 py-1 text-[10px] font-heading font-semibold transition-colors ${leadsTab === 'hubspot' ? 'bg-[#ff7a59] text-white' : 'bg-white text-[#6b6b65] hover:bg-[#f5f4f0]'}`}>
                    HubSpot
                  </button>
                )}
              </div>
            )}
            {leadsTab === 'sheet' && leadsSheet?.configured && (
              <>
                <button onClick={handleOpenShareModal}
                  className="flex items-center gap-1 text-[10px] text-terminal-muted hover:text-[var(--t-ui-accent)] px-1.5 py-0.5 rounded border border-[#e8e6e2] hover:bg-[var(--t-ui-accent-bg)]"
                  title="Share with team">
                  <Share2 size={10} /> Share
                </button>
                <button onClick={() => setShowLinkModal(true)}
                  className="text-[10px] text-terminal-muted hover:text-terminal-text px-1.5 py-0.5 rounded border border-[#e8e6e2] hover:bg-[#f5f4f0]">
                  Change
                </button>
                <button onClick={handleUnlinkSheet}
                  className="text-[10px] text-terminal-muted hover:text-red-500 px-1 py-0.5 rounded border border-[#e8e6e2] hover:bg-red-50"
                  title="Unlink sheet">
                  <Unlink size={10} />
                </button>
              </>
            )}
            {leadsTab === 'hubspot' && hubspotConnected && (
              <button onClick={async () => {
                await fetch(`${API_BASE}/v1/hubspot/disconnect`, { method: 'POST', headers: getAuthHeaders() });
                setHubspotConnected(false); setHubspotPipeline(null); setLeadsTab('sheet');
              }}
                className="text-[10px] text-terminal-muted hover:text-red-500 px-1 py-0.5 rounded border border-[#e8e6e2] hover:bg-red-50"
                title="Disconnect HubSpot">
                <Unlink size={10} />
              </button>
            )}
            {!leadsSheet?.configured && (
              <button onClick={() => { setShowLinkModal(true); searchDrive('leads'); }}
                className="flex items-center gap-1.5 text-[11px] font-heading font-semibold text-[var(--t-ui-accent)] px-3 py-1 rounded-md border border-[var(--t-ui-accent-border)] bg-[var(--t-ui-accent-bg)] hover:opacity-80">
                <Link2 size={11} /> Link Sheet
              </button>
            )}
            {!hubspotConnected && (
              <button onClick={() => { setShowHubspotModal(true); setHubspotError(''); setHubspotKey(''); window.open('https://app.hubspot.com/api-key', '_blank'); }}
                className="flex items-center gap-1.5 text-[11px] font-heading font-semibold text-[#ff7a59] px-3 py-1 rounded-md border border-[#ffcabc] bg-[#fff5f2] hover:bg-[#ffe8e2]">
                <Link2 size={11} /> Link HubSpot
              </button>
            )}
          </div>
        </div>

        {/* Pending share invitations */}
        {leadsShares.length > 0 && (
          <div className="px-3 py-2 space-y-1.5">
            {leadsShares.map(share => (
              <div key={share.id} className="flex items-center justify-between px-3 py-2 bg-[var(--t-ui-accent-bg)] border border-[var(--t-ui-accent-border)] rounded-lg">
                <div className="flex items-center gap-2 min-w-0">
                  <Share2 size={12} className="text-[var(--t-ui-accent)] shrink-0" />
                  <span className="text-[11px] text-[var(--t-ui-accent)] truncate">
                    <strong>{share.from_user_name || 'A teammate'}</strong> shared "{share.sheet_title}" - Add to your pipeline?
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <button onClick={() => handleAcceptShare(share.id)} disabled={acceptingShare === share.id}
                    className="px-2.5 py-1 text-[10px] font-semibold bg-[var(--t-ui-accent)] text-white rounded-md hover:opacity-90 disabled:opacity-50">
                    {acceptingShare === share.id ? '...' : 'Accept'}
                  </button>
                  <button onClick={() => handleDeclineShare(share.id)}
                    className="px-2.5 py-1 text-[10px] font-semibold text-[#6b6b65] border border-[#e0ddd8] rounded-md hover:bg-[#f5f4f0]">
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Sheet content */}
        {leadsTab === 'sheet' && (
          leadsLoading ? (
            <div className="px-[18px] py-6 text-center text-[#9a9a92] text-[12px]">Loading...</div>
          ) : leadsSheet?.configured && leadsSheet.preview?.length > 0 ? (
            <div>
              {leadsSheet.tabs?.length > 1 && (
                <div className="px-3 pt-2 pb-1 flex items-center gap-1 border-b border-[#f0eeea] overflow-x-auto">
                  {leadsSheet.tabs.map((tab) => (
                    <button key={tab} onClick={() => { setLeadsPage(1); fetchLeadsSheet(tab, 1); }}
                      className={`px-2.5 py-1 text-[10px] font-heading font-semibold rounded-t whitespace-nowrap transition-colors ${
                        tab === leadsSheet.activeTab
                          ? 'bg-[var(--t-ui-accent)] text-white'
                          : 'text-[#6b6b65] hover:bg-[#f5f4f0]'
                      }`}>
                      {tab}
                    </button>
                  ))}
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="bg-[#fafaf8]">
                      {(leadsSheet.headers || []).slice(0, 6).map((h, i) => (
                        <th key={i} className="px-3 py-2 text-left text-[10px] font-heading font-bold text-terminal-muted uppercase tracking-[0.5px] border-b border-[#f0eeea]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {leadsSheet.preview.map((row, i) => (
                      <tr key={i} className="border-b border-[#f0eeea] last:border-b-0 hover:bg-[#fafaf8]">
                        {(leadsSheet.headers || []).slice(0, 6).map((h, j) => (
                          <td key={j} className="px-3 py-1.5 text-terminal-text truncate max-w-[180px]">{row[h] || ''}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {leadsSheet.totalPages > 1 && (
                <div className="px-3 py-2 flex items-center justify-between border-t border-[#f0eeea]">
                  <span className="text-[10px] text-terminal-muted">{leadsSheet.totalRows} rows</span>
                  <div className="flex items-center gap-2">
                    <button disabled={leadsSheet.page <= 1} onClick={() => { const p = leadsSheet.page - 1; setLeadsPage(p); fetchLeadsSheet(leadsSheet.activeTab, p); }}
                      className="px-2 py-0.5 text-[10px] font-heading font-semibold rounded border border-[#e0ddd8] disabled:opacity-30 hover:bg-[#f5f4f0]">
                      Prev
                    </button>
                    <span className="text-[10px] text-terminal-muted">{leadsSheet.page} / {leadsSheet.totalPages}</span>
                    <button disabled={leadsSheet.page >= leadsSheet.totalPages} onClick={() => { const p = leadsSheet.page + 1; setLeadsPage(p); fetchLeadsSheet(leadsSheet.activeTab, p); }}
                      className="px-2 py-0.5 text-[10px] font-heading font-semibold rounded border border-[#e0ddd8] disabled:opacity-30 hover:bg-[#f5f4f0]">
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : !leadsSheet?.configured ? (
            <div className="px-[18px] py-8 text-center">
              <div className="text-[13px] text-[#9a9a92] mb-2">No leads sheet linked</div>
              <div className="text-[11px] text-terminal-muted">Link a Google Sheet to track your leads and pipeline here.</div>
            </div>
          ) : (
            <div className="px-[18px] py-6 text-center text-[#9a9a92] text-[12px]">Sheet linked but no data found</div>
          )
        )}

        {/* HubSpot content */}
        {leadsTab === 'hubspot' && (
          hubspotLoading ? (
            <div className="px-[18px] py-6 text-center text-[#9a9a92] text-[12px]">Loading HubSpot data...</div>
          ) : !hubspotConnected ? (
            <div className="px-[18px] py-8 text-center">
              <div className="text-[13px] text-[#9a9a92] mb-2">HubSpot not connected</div>
              <div className="text-[11px] text-terminal-muted">Connect your HubSpot account to see your CRM pipeline here.</div>
            </div>
          ) : hubspotPipeline && hubspotPipeline.total_deals > 0 ? (
            <div className="px-[18px] py-4">
              <div className="flex items-center gap-6 mb-4">
                <div>
                  <div className="text-[10px] font-heading font-semibold text-terminal-muted uppercase tracking-[0.5px]">Total Deals</div>
                  <div className="text-lg font-heading font-bold text-terminal-text">{hubspotPipeline.total_deals}</div>
                </div>
                <div>
                  <div className="text-[10px] font-heading font-semibold text-terminal-muted uppercase tracking-[0.5px]">Pipeline Value</div>
                  <div className="text-lg font-heading font-bold text-terminal-text">${(hubspotPipeline.total_value || 0).toLocaleString()}</div>
                </div>
              </div>
              {Object.keys(hubspotPipeline.by_stage || {}).length > 0 && (
                <div className="space-y-2">
                  {Object.entries(hubspotPipeline.by_stage).map(([stage, data]) => (
                    <div key={stage} className="flex items-center justify-between py-1.5 border-b border-[#f0eeea] last:border-b-0">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-[#ff7a59]" />
                        <span className="text-[12px] text-terminal-text capitalize">{stage.replace(/([A-Z])/g, ' $1').trim()}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="text-[11px] font-mono text-terminal-muted">{data.count} deal{data.count !== 1 ? 's' : ''}</span>
                        <span className="text-[11px] font-mono text-terminal-text">${(data.value || 0).toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="px-[18px] py-8 text-center">
              <div className="text-[13px] text-[#9a9a92] mb-2">No deals in pipeline</div>
              <div className="text-[11px] text-terminal-muted">Deals from your HubSpot CRM will appear here.</div>
            </div>
          )
        )}
      </div>


      {/* HubSpot CRM Contacts */}
      {hubspotConnected && (() => {
        const HS_INDUSTRIES = ['Renewable Energy', 'Bitcoin mining', 'Bitcoin services', 'Insurance', 'Operations Management', 'SaaS - Web 2', 'SaaS Web 3', 'Real Estate', 'Legal', 'Engineering', 'Electrical Equipment', 'Construction', 'Investment/Finance', 'Other'];
        const HS_REASONS = ['Investment - DevCo', 'Investment - ProjCo', 'Potential IPP Client', 'Advisor', 'Technical Support', 'Potential Ghost Client', 'Marketing Opportunities', 'Friend', 'Other'];
        const HS_MATERIALS = ['General Newsletter', 'Project Update', 'Investment Teaser', 'Investment Deck', 'General Marketing', 'Site Marketing', 'Targeted Sales Email', 'General Question'];
        const doSearch = (overrides = {}) => {
          const q = overrides.query !== undefined ? overrides.query : hsSearch;
          const ind = overrides.industry !== undefined ? overrides.industry : hsIndustryFilter;
          const rea = overrides.reason !== undefined ? overrides.reason : hsReasonFilter;
          const mat = overrides.materials !== undefined ? overrides.materials : hsMaterialsFilter;
          const clf = overrides.classFilter !== undefined ? overrides.classFilter : hsClassFilter;
          fetchHsContacts(clf, null, { query: q, industry: ind, reason: rea, materials: mat });
        };
        return (
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden mb-5">
          {/* Header */}
          <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
            <div className="flex items-center gap-2">
              <span className="text-xs font-heading font-bold text-terminal-text tracking-[0.3px]">CRM Contacts</span>
              {hsClassStats && (
                <span className="text-[10px] font-mono text-terminal-muted">
                  {hsClassStats.classified}/{hsClassStats.total} classified
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-0.5 bg-[#f5f4f0] rounded-lg p-0.5">
                {[
                  { id: 'all', label: 'All' },
                  { id: 'false', label: 'Unclassified' },
                  { id: 'true', label: 'Classified' },
                ].map(f => (
                  <button
                    key={f.id}
                    onClick={() => { setHsClassFilter(f.id); doSearch({ classFilter: f.id }); }}
                    className={`text-[10px] font-heading font-semibold px-2.5 py-1 rounded-md transition-colors ${
                      hsClassFilter === f.id
                        ? 'bg-white text-[var(--t-ui-accent)] shadow-sm'
                        : 'text-[#9a9a92] hover:text-[#6b6b65]'
                    }`}
                  >
                    {f.label}{f.id === 'false' && hsClassStats ? ` (${hsClassStats.unclassified})` : ''}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {/* Search + Filters */}
          <div className="px-[18px] py-2.5 border-b border-[#f0eeea] flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
              <Search size={13} className="text-[#9a9a92] shrink-0" />
              <input
                type="text"
                value={hsSearch}
                onChange={e => setHsSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') doSearch(); }}
                placeholder="Search name, email, company..."
                className="flex-1 text-[11px] py-1 bg-transparent border-none outline-none placeholder:text-[#c5c5bc] text-terminal-text"
              />
              {hsSearch && (
                <button onClick={() => { setHsSearch(''); doSearch({ query: '' }); }} className="text-[#9a9a92] hover:text-terminal-text">
                  <X size={12} />
                </button>
              )}
            </div>
            <select
              value={hsIndustryFilter}
              onChange={e => { setHsIndustryFilter(e.target.value); doSearch({ industry: e.target.value }); }}
              className="text-[10px] px-2 py-1 rounded-md border border-[#e8e6e1] bg-white text-terminal-text appearance-none cursor-pointer"
            >
              <option value="">All Industries</option>
              {HS_INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
            <select
              value={hsReasonFilter}
              onChange={e => { setHsReasonFilter(e.target.value); doSearch({ reason: e.target.value }); }}
              className="text-[10px] px-2 py-1 rounded-md border border-[#e8e6e1] bg-white text-terminal-text appearance-none cursor-pointer"
            >
              <option value="">All Reasons</option>
              {HS_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <select
              value={hsMaterialsFilter}
              onChange={e => { setHsMaterialsFilter(e.target.value); doSearch({ materials: e.target.value }); }}
              className="text-[10px] px-2 py-1 rounded-md border border-[#e8e6e1] bg-white text-terminal-text appearance-none cursor-pointer"
            >
              <option value="">All Materials</option>
              {HS_MATERIALS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            {(hsIndustryFilter || hsReasonFilter || hsMaterialsFilter || hsSearch) && (
              <button
                onClick={() => { setHsSearch(''); setHsIndustryFilter(''); setHsReasonFilter(''); setHsMaterialsFilter(''); setHsClassFilter('all'); fetchHsContacts('all'); }}
                className="text-[10px] font-heading font-semibold text-terminal-red hover:underline"
              >
                Clear
              </button>
            )}
          </div>
          {/* Table */}
          <div className="max-h-[400px] overflow-y-auto">
            {hsContactsLoading ? (
              <div className="px-[18px] py-6 text-center text-[12px] text-[#9a9a92]">Loading contacts...</div>
            ) : hsContacts.length === 0 ? (
              <div className="px-[18px] py-6 text-center text-[12px] text-[#9a9a92]">No contacts found.</div>
            ) : (
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 bg-[#f9f8f6]">
                  <tr className="text-left text-[10px] font-heading font-semibold text-terminal-muted uppercase tracking-[0.5px]">
                    <th className="px-[18px] py-2">Name</th>
                    <th className="px-2 py-2">Company</th>
                    <th className="px-2 py-2">Industry</th>
                    <th className="px-2 py-2">Reason</th>
                    <th className="px-2 py-2">Materials</th>
                  </tr>
                </thead>
                <tbody>
                  {hsContacts.map(c => (
                    <tr key={c.hubspot_id} className="border-t border-[#f0eeea] hover:bg-[#f5f4f0] transition-colors cursor-pointer" onClick={() => setHsContactModal(c)}>
                      <td className="px-[18px] py-2">
                        <div className="font-medium text-terminal-text">{c.name || 'Unknown'}</div>
                        <div className="text-[10px] text-terminal-muted">{c.email}</div>
                      </td>
                      <td className="px-2 py-2 text-terminal-text">{c.company || '-'}</td>
                      <td className="px-2 py-2">
                        {c.industry ? (
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200 cursor-pointer hover:bg-blue-100"
                            onClick={(e) => { e.stopPropagation(); setHsIndustryFilter(c.industry); doSearch({ industry: c.industry }); }}>
                            {c.industry}
                          </span>
                        ) : <span className="text-[#c5c5bc]">-</span>}
                      </td>
                      <td className="px-2 py-2">
                        {c.reason ? (
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 border border-purple-200 cursor-pointer hover:bg-purple-100"
                            onClick={(e) => { e.stopPropagation(); setHsReasonFilter(c.reason); doSearch({ reason: c.reason }); }}>
                            {c.reason}
                          </span>
                        ) : <span className="text-[#c5c5bc]">-</span>}
                      </td>
                      <td className="px-2 py-2">
                        {c.materials ? (
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 border border-emerald-200 cursor-pointer hover:bg-emerald-100"
                            onClick={(e) => { e.stopPropagation(); setHsMaterialsFilter(c.materials); doSearch({ materials: c.materials }); }}>
                            {c.materials}
                          </span>
                        ) : <span className="text-[#c5c5bc]">-</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {hsPaging && (hsPaging.offset + hsPaging.limit) < hsPaging.total && (
            <div className="px-[18px] py-2 border-t border-[#f0eeea] flex justify-center">
              <button
                onClick={() => fetchHsContacts(hsClassFilter, (hsPaging.offset || 0) + (hsPaging.limit || 50), { query: hsSearch, industry: hsIndustryFilter, reason: hsReasonFilter, materials: hsMaterialsFilter })}
                className="text-[11px] font-heading font-semibold text-[var(--t-ui-accent)] hover:underline"
              >
                Load more ({hsContacts.length} / {hsPaging.total})
              </button>
            </div>
          )}
        </div>
        );
      })()}

      {/* Contact Profile Modal */}
      {hsContactModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]" onClick={() => setHsContactModal(null)}>
          <div className="bg-white rounded-2xl shadow-2xl border border-[#e5e5e0] w-full max-w-[520px] mx-4 max-h-[calc(100vh-60px)] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="px-7 pt-6 pb-5 border-b border-[#f0eeea] flex items-start justify-between">
              <div>
                <h3 className="text-[15px] font-heading font-bold text-terminal-text">{hsContactModal.name || 'Unknown Contact'}</h3>
                {hsContactModal.title && <div className="text-[12px] text-terminal-muted mt-0.5">{hsContactModal.title}</div>}
                {hsContactModal.company && <div className="text-[12px] text-terminal-muted">{hsContactModal.company}</div>}
              </div>
              <button onClick={() => setHsContactModal(null)} className="text-[#9a9a92] hover:text-terminal-text p-1">
                <X size={16} />
              </button>
            </div>
            {/* Contact Info */}
            <div className="px-7 py-4 border-b border-[#f0eeea]">
              <div className="grid grid-cols-2 gap-3 text-[11px]">
                {hsContactModal.email && (
                  <div>
                    <div className="text-[9px] font-heading font-semibold text-terminal-muted uppercase tracking-[0.5px] mb-0.5">Email</div>
                    <div className="text-terminal-text">{hsContactModal.email}</div>
                  </div>
                )}
                {hsContactModal.domain && (
                  <div>
                    <div className="text-[9px] font-heading font-semibold text-terminal-muted uppercase tracking-[0.5px] mb-0.5">Domain</div>
                    <div className="text-terminal-text">{hsContactModal.domain}</div>
                  </div>
                )}
                <div>
                  <div className="text-[9px] font-heading font-semibold text-terminal-muted uppercase tracking-[0.5px] mb-0.5">HubSpot ID</div>
                  <div className="text-terminal-text font-mono">{hsContactModal.hubspot_id}</div>
                </div>
                {hsContactModal.confidence != null && (
                  <div>
                    <div className="text-[9px] font-heading font-semibold text-terminal-muted uppercase tracking-[0.5px] mb-0.5">Confidence</div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-[#f0eeea] rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${hsContactModal.confidence >= 70 ? 'bg-emerald-500' : hsContactModal.confidence >= 40 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${hsContactModal.confidence}%` }} />
                      </div>
                      <span className="text-[10px] font-mono text-terminal-muted">{hsContactModal.confidence}%</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
            {/* Classification */}
            <div className="px-7 py-4 border-b border-[#f0eeea]">
              <div className="text-[9px] font-heading font-semibold text-terminal-muted uppercase tracking-[0.5px] mb-2.5">Classification</div>
              <div className="flex flex-wrap gap-2 mb-3">
                {hsContactModal.industry && (
                  <span className="text-[10px] font-mono px-2 py-1 rounded-md bg-blue-50 text-blue-600 border border-blue-200">{hsContactModal.industry}</span>
                )}
                {hsContactModal.reason && (
                  <span className="text-[10px] font-mono px-2 py-1 rounded-md bg-purple-50 text-purple-600 border border-purple-200">{hsContactModal.reason}</span>
                )}
                {hsContactModal.materials && (
                  <span className="text-[10px] font-mono px-2 py-1 rounded-md bg-emerald-50 text-emerald-600 border border-emerald-200">{hsContactModal.materials}</span>
                )}
              </div>
            </div>
            {/* Reasoning */}
            {hsContactModal.reasoning && (
              <div className="px-7 py-4 border-b border-[#f0eeea]">
                <div className="text-[9px] font-heading font-semibold text-terminal-muted uppercase tracking-[0.5px] mb-1.5">Classification Reasoning</div>
                <div className="text-[12px] text-terminal-text leading-relaxed bg-[#f9f8f6] rounded-lg px-4 py-3 border border-[#f0eeea]">
                  {hsContactModal.reasoning}
                </div>
              </div>
            )}
            {/* Classified at */}
            {hsContactModal.classified_at && (
              <div className="px-7 py-3">
                <div className="text-[10px] text-terminal-muted">Classified {new Date(hsContactModal.classified_at + 'Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
              </div>
            )}
          </div>
        </div>
      )}

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

            {/* Footer - open in chat */}
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

      {/* Link Sheet Modal */}
      {showLinkModal && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={() => setShowLinkModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-[480px] max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[#e8e6e2] flex items-center justify-between">
              <span className="text-sm font-heading font-bold text-terminal-text">Link Leads Sheet</span>
              <button onClick={() => setShowLinkModal(false)} className="text-terminal-muted hover:text-terminal-text"><X size={16} /></button>
            </div>
            <div className="p-5">
              <div className="mb-4">
                <label className="text-[11px] font-heading font-semibold text-terminal-muted uppercase tracking-[0.5px] mb-1.5 block">Paste Sheet URL or ID</label>
                <div className="flex gap-2">
                  <input
                    value={linkInput}
                    onChange={e => setLinkInput(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className="flex-1 text-[12px] px-3 py-2 border border-[#e8e6e2] rounded-md focus:outline-none focus:border-[var(--t-ui-accent)]"
                  />
                  <button
                    onClick={() => handleLinkSheet(linkInput)}
                    disabled={!linkInput.trim() || linking}
                    className="px-4 py-2 text-[12px] font-heading font-semibold bg-[var(--t-ui-accent)] text-white rounded-md hover:opacity-90 disabled:opacity-50"
                  >
                    {linking ? '...' : 'Link'}
                  </button>
                </div>
                {linkError && <div className="text-[11px] text-red-500 mt-1">{linkError}</div>}
              </div>
              <div className="border-t border-[#e8e6e2] pt-4">
                <label className="text-[11px] font-heading font-semibold text-terminal-muted uppercase tracking-[0.5px] mb-1.5 block">Or search Google Drive</label>
                <div className="flex gap-2 mb-3">
                  <input
                    value={driveQuery}
                    onChange={e => setDriveQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && searchDrive(driveQuery)}
                    placeholder="Search for spreadsheets..."
                    className="flex-1 text-[12px] px-3 py-2 border border-[#e8e6e2] rounded-md focus:outline-none focus:border-[var(--t-ui-accent)]"
                  />
                  <button
                    onClick={() => searchDrive(driveQuery)}
                    disabled={driveSearching}
                    className="px-3 py-2 text-[12px] border border-[#e8e6e2] rounded-md hover:bg-[#f5f4f0]"
                  >
                    <Search size={13} />
                  </button>
                </div>
                {driveSearching && <div className="text-[11px] text-terminal-muted italic">Searching...</div>}
                {driveResults.length > 0 && (
                  <div className="border border-[#e8e6e2] rounded-md overflow-hidden">
                    {driveResults.map(f => (
                      <button
                        key={f.id}
                        onClick={() => handleLinkSheet(f.id)}
                        disabled={linking}
                        className="w-full flex items-center gap-3 px-3 py-2.5 border-b border-[#f0eeea] last:border-b-0 hover:bg-[#f5f4f0] text-left"
                      >
                        <FileSpreadsheet size={14} className="text-green-600 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-[12px] text-terminal-text font-medium truncate">{f.name}</div>
                          <div className="text-[10px] text-terminal-muted">{f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : ''}</div>
                        </div>
                        <Link2 size={12} className="text-[var(--t-ui-accent)] shrink-0" />
                      </button>
                    ))}
                  </div>
                )}
                {!driveSearching && driveResults.length === 0 && driveQuery && (
                  <div className="text-[11px] text-terminal-muted text-center py-2">No spreadsheets found</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* HubSpot Connect Modal */}
      {showHubspotModal && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={() => setShowHubspotModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-[440px] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[#e8e6e2] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#ff7a59"><path d="M18.16 7.58V4.22a1.74 1.74 0 0 0 1-1.56V2.6A1.74 1.74 0 0 0 17.42.87h-.06a1.74 1.74 0 0 0-1.74 1.74v.06a1.74 1.74 0 0 0 1 1.56v3.32a5.32 5.32 0 0 0-2.38 1.22l-7.9-6.14a2.13 2.13 0 0 0 .06-.52 2.08 2.08 0 1 0-2.08 2.08 2.06 2.06 0 0 0 1.16-.36l7.76 6.04a5.35 5.35 0 0 0 .17 6.16l-2.34 2.34a1.63 1.63 0 0 0-.48-.08 1.68 1.68 0 1 0 1.68 1.68 1.63 1.63 0 0 0-.08-.48l2.3-2.3A5.36 5.36 0 1 0 18.16 7.58zM17.36 16a3.16 3.16 0 1 1 3.16-3.16A3.16 3.16 0 0 1 17.36 16z"/></svg>
                <span className="text-sm font-heading font-bold text-terminal-text">Connect HubSpot</span>
              </div>
              <button onClick={() => setShowHubspotModal(false)} className="text-terminal-muted hover:text-terminal-text"><X size={16} /></button>
            </div>
            <div className="p-5">
              <p className="text-[12px] text-terminal-muted mb-4">
                Enter your HubSpot private app access token to sync your CRM pipeline. You can create one in <a href="https://app.hubspot.com/private-apps" target="_blank" rel="noopener noreferrer" className="text-[#ff7a59] hover:underline">HubSpot Settings &gt; Private Apps</a>.
              </p>
              <label className="text-[11px] font-heading font-semibold text-terminal-muted uppercase tracking-[0.5px] mb-1.5 block">Access Token</label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={hubspotKey}
                  onChange={e => setHubspotKey(e.target.value)}
                  placeholder="pat-na1-..."
                  className="flex-1 text-[12px] px-3 py-2 border border-[#e8e6e2] rounded-md focus:outline-none focus:border-[#ff7a59] font-mono"
                />
                <button
                  onClick={async () => {
                    setHubspotConnecting(true); setHubspotError('');
                    try {
                      const res = await fetch(`${API_BASE}/v1/hubspot/connect`, {
                        method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                        body: JSON.stringify({ apiKey: hubspotKey }),
                      });
                      const data = await res.json();
                      if (!res.ok) { setHubspotError(data.error || 'Failed to connect'); return; }
                      setHubspotConnected(true);
                      setLeadsTab('hubspot');
                      setShowHubspotModal(false);
                      fetch(`${API_BASE}/v1/hubspot/pipeline`, { headers: getAuthHeaders() })
                        .then(r => r.json()).then(p => setHubspotPipeline(p)).catch(() => {});
                    } catch (e) { setHubspotError(e.message); }
                    finally { setHubspotConnecting(false); }
                  }}
                  disabled={!hubspotKey.trim() || hubspotConnecting}
                  className="px-4 py-2 text-[12px] font-heading font-semibold bg-[#ff7a59] text-white rounded-md hover:bg-[#e5694d] disabled:opacity-50"
                >
                  {hubspotConnecting ? '...' : 'Connect'}
                </button>
              </div>
              {hubspotError && <div className="text-[11px] text-red-500 mt-2">{hubspotError}</div>}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => { if (docPreview.url) URL.revokeObjectURL(docPreview.url); setDocPreview(null); }}>
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
                {docPreview.url && (
                  <a href={docPreview.url} download={docPreview.filename || true}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold font-heading rounded-lg border border-[var(--t-border)] bg-white text-[var(--t-ui-accent)] hover:bg-[var(--t-surface-dim)] transition-colors">
                    <Download size={12} /> Download
                  </a>
                )}
                <button onClick={() => { if (docPreview.url) URL.revokeObjectURL(docPreview.url); setDocPreview(null); }} className="w-7 h-7 rounded-lg flex items-center justify-center text-terminal-muted hover:text-terminal-text hover:bg-[var(--t-surface-dim)] transition-colors">
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto">
              {docPreview.loading ? (
                <div className="flex items-center justify-center h-full">
                  <RotateCcw size={20} className="animate-spin text-[var(--t-ui-accent)]" />
                  <span className="ml-2 text-[13px] text-terminal-muted">Loading document...</span>
                </div>
              ) : docPreview.error ? (
                <div className="flex items-center justify-center h-full text-[13px] text-red-500">Failed to load document</div>
              ) : docPreview.type === 'pdf' ? (
                <iframe src={docPreview.url} className="w-full h-full border-0" title={docPreview.title} />
              ) : (
                <div className="p-6 max-w-[700px] mx-auto">
                  <div className="text-[13px] leading-[1.7] text-[#333]">
                    {cleanResultSummary(docPreview.assignment?.result_summary).split('\n').map((line, i) => {
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

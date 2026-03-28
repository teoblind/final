import React, { useState, useEffect, useCallback } from 'react';
import { AlertCircle, Calendar, CheckCircle, ClipboardList, Clock, DollarSign, HardHat, Mic, TrendingUp, UserPlus, Video, Check, X, XCircle, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Mail, FileSpreadsheet, MessageSquare, Paperclip, Pencil, RotateCcw, Save, Link2, ExternalLink, Search, Unlink, Share2, FileText, Download, Archive, Users } from 'lucide-react';
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

const DELTA_COLORS = {
  up: 'text-[#1e3a5f]',
  warn: 'text-terminal-amber',
  flat: 'text-terminal-muted',
};

const URGENCY_BADGE = {
  high: 'bg-red-50 text-terminal-red border-red-200',
  medium: 'bg-amber-50 text-terminal-amber border-amber-200',
  low: 'bg-gray-50 text-terminal-muted border-gray-200',
};

const MEETING_RANGES = [
  { key: 'week', label: '7d' },
  { key: 'month', label: '30d' },
  { key: '90', label: '90d' },
];

export default function DacpCommandDashboard({ onNavigate }) {
  const [stats, setStats] = useState(null);
  const [bids, setBids] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [meetingRange, setMeetingRange] = useState('week');
  const [invitedMeetings, setInvitedMeetings] = useState(new Set());
  const [invitingId, setInvitingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [approvals, setApprovals] = useState([]);
  const [processingApproval, setProcessingApproval] = useState(null);
  const [expandedApproval, setExpandedApproval] = useState(null);
  const [showBidsList, setShowBidsList] = useState(false);
  const [showJobsList, setShowJobsList] = useState(false);
  const [excelPreview, setExcelPreview] = useState(null); // { approvalId, index, data }
  const [loadingExcel, setLoadingExcel] = useState(false);
  const [originalEmail, setOriginalEmail] = useState(null); // { approvalId, data }
  const [loadingOriginal, setLoadingOriginal] = useState(false);
  const [editingApproval, setEditingApproval] = useState(null); // approval ID being edited
  const [editBody, setEditBody] = useState('');
  const [editSender, setEditSender] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  // Leads sheet state
  const [leadsSheet, setLeadsSheet] = useState(null); // { configured, sheetId, sheetTitle, sheetUrl, headers, totalRows, preview }
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkInput, setLinkInput] = useState('');
  const [linkError, setLinkError] = useState('');
  const [linking, setLinking] = useState(false);
  const [driveResults, setDriveResults] = useState([]);
  const [driveSearching, setDriveSearching] = useState(false);
  // Agent assignments state
  const [assignments, setAssignments] = useState([]);
  const [assignmentsLoading, setAssignmentsLoading] = useState(false);
  const [assignmentsPage, setAssignmentsPage] = useState(0);
  const [taskTab, setTaskTab] = useState('suggested'); // 'suggested' | 'active' | 'completed'
  const [processingAssignment, setProcessingAssignment] = useState(null);
  const [sharedAssignments, setSharedAssignments] = useState({});
  const [infoRequests, setInfoRequests] = useState({});
  // Inline assignment chat
  const [chatOpenFor, setChatOpenFor] = useState(null);
  const [chatMessages, setChatMessages] = useState({});
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [driveQuery, setDriveQuery] = useState('');
  // Document preview modal
  const [docPreview, setDocPreview] = useState(null); // { type, url, title, assignment }
  // Share modal state
  const [shareModal, setShareModal] = useState(null); // assignment id
  const [shareUsers, setShareUsers] = useState([]); // tenant users list
  const [shareSearch, setShareSearch] = useState('');
  const [shareSelected, setShareSelected] = useState([]); // selected user ids
  const [shareLoading, setShareLoading] = useState(false);
  const [attachModal, setAttachModal] = useState(null); // assignment id
  const [attachEntities, setAttachEntities] = useState([]);
  const [attachSearch, setAttachSearch] = useState('');
  const [attachTypeFilter, setAttachTypeFilter] = useState('all');
  const [attachLoading, setAttachLoading] = useState(false);

  // Dynamic senders: Coppice (default) + currently logged-in user
  const SENDERS = (() => {
    const senders = [
      { name: 'Coppice', label: 'Coppice (AI Agent)' },
    ];
    try {
      const session = JSON.parse(sessionStorage.getItem('sangha_auth') || '{}');
      const userName = session?.user?.name;
      if (userName && userName !== 'Coppice') {
        senders.push({ name: userName, label: userName });
      }
    } catch {}
    return senders;
  })();

  const fetchLeadsSheet = useCallback(() => {
    setLeadsLoading(true);
    fetch(`${API_BASE}/v1/estimates/leads-sheet`, { headers: getAuthHeaders() })
      .then(r => r.json())
      .then(data => {
        if (data.configured && data.sheetId !== '__unlinked__') setLeadsSheet(data);
        else setLeadsSheet({ configured: false });
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

  const fetchAssignments = useCallback(() => {
    setAssignmentsLoading(true);
    fetch(`${API_BASE}/v1/estimates/assignments`, { headers: getAuthHeaders() })
      .then(r => r.json())
      .then(data => {
        const all = (data.assignments || []).filter(a => a.status !== 'dismissed');
        setAssignments(all);
        // Fetch info requests for active assignments
        const active = all.filter(a => a.status === 'in_progress' && a.job_id);
        for (const a of active) {
          fetchInfoRequests(a.job_id);
        }
      })
      .catch(() => {})
      .finally(() => setAssignmentsLoading(false));
  }, [fetchInfoRequests]);

  const handleConfirmAssignment = useCallback(async (id) => {
    setProcessingAssignment(id);
    try {
      await fetch(`${API_BASE}/v1/estimates/assignments/${id}/confirm`, { method: 'POST', headers: getAuthHeaders() });
      // Optimistic update
      setAssignments(prev => prev.map(a => a.id === id ? { ...a, status: 'in_progress' } : a));
      // Poll for completion
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
      setTimeout(() => clearInterval(poll), 300000); // stop polling after 5 min
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

  const openShareModal = useCallback(async (id) => {
    setShareModal(id);
    setShareSearch('');
    setShareSelected([]);
    try {
      const res = await fetch(`${API_BASE}/v1/estimates/assignments/team-members`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setShareUsers(data.users || []);
      }
    } catch {}
  }, []);

  const handleShareInternal = useCallback(async () => {
    if (!shareModal || shareSelected.length === 0) return;
    try {
      setShareLoading(true);
      const res = await fetch(`${API_BASE}/v1/estimates/assignments/${shareModal}/share-internal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ shared_with: shareSelected }),
      });
      if (res.ok) {
        setSharedAssignments(prev => ({ ...prev, [`internal-${shareModal}`]: 'shared' }));
        setAssignments(prev => prev.map(a => a.id === shareModal ? { ...a, visibility: 'shared' } : a));
        setShareModal(null);
      }
    } catch {} finally {
      setShareLoading(false);
    }
  }, [shareModal, shareSelected]);

  const openAttachModal = useCallback(async (id) => {
    setAttachModal(id);
    setAttachSearch('');
    setAttachTypeFilter('all');
    setAttachEntities([]);
    try {
      const res = await fetch(`${API_BASE}/v1/knowledge/entities?limit=50`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        setAttachEntities(data.entities || data || []);
      }
    } catch {}
  }, []);

  const handleAttachToEntity = useCallback(async (entityId, entityName) => {
    if (!attachModal) return;
    setAttachLoading(true);
    try {
      const res = await fetch(`${API_BASE}/v1/estimates/assignments/${attachModal}/attach-to-entity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ entity_id: entityId }),
      });
      if (res.ok) {
        setAssignments(prev => prev.map(a => {
          if (a.id !== attachModal) return a;
          const existing = a.attached_entity_ids_json ? JSON.parse(a.attached_entity_ids_json) : [];
          if (!existing.includes(entityId)) existing.push(entityId);
          return { ...a, attached_entity_ids_json: JSON.stringify(existing) };
        }));
        setAttachModal(null);
      }
    } catch {} finally {
      setAttachLoading(false);
    }
  }, [attachModal]);

  const handleAssignmentChat = useCallback(async (assignmentId) => {
    if (!chatInput.trim()) return;
    const msg = chatInput.trim();
    setChatInput('');
    setChatMessages(prev => ({
      ...prev,
      [assignmentId]: [...(prev[assignmentId] || []), { role: 'user', text: msg }],
    }));
    setChatLoading(true);
    try {
      const res = await fetch(`${API_BASE}/v1/estimates/assignments/${assignmentId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json();
      if (data.assignment) {
        setAssignments(prev => prev.map(a => a.id === assignmentId ? { ...a, ...data.assignment } : a));
      }
      setChatMessages(prev => ({
        ...prev,
        [assignmentId]: [...(prev[assignmentId] || []), { role: 'agent', text: data.reply || 'Updated.' }],
      }));
    } catch {
      setChatMessages(prev => ({
        ...prev,
        [assignmentId]: [...(prev[assignmentId] || []), { role: 'agent', text: 'Failed to refine. Try again.' }],
      }));
    } finally { setChatLoading(false); }
  }, [chatInput]);

  const handleSaveEdit = useCallback(async (approvalId) => {
    setSavingEdit(true);
    try {
      await fetch(`${API_BASE}/v1/approvals/${approvalId}/update-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ body: editBody }),
      });
      setEditingApproval(null);
      fetchApprovals();
    } catch (err) { console.error('Save failed:', err); }
    finally { setSavingEdit(false); }
  }, [editBody]);

  const handleRewriteForSender = useCallback(async (approvalId, senderName, currentBody) => {
    setRewriting(true);
    try {
      const res = await fetch(`${API_BASE}/v1/approvals/${approvalId}/rewrite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ senderName, currentBody }),
      });
      const data = await res.json();
      if (data.body) {
        setEditBody(data.body);
        setEditingApproval(approvalId);
      }
    } catch (err) { console.error('Rewrite failed:', err); }
    finally { setRewriting(false); }
  }, []);

  const fetchApprovals = () => {
    fetch(`${API_BASE}/v1/approvals?status=pending`, { headers: getAuthHeaders() })
      .then(r => r.json())
      .then(d => setApprovals(d.items || []))
      .catch(() => {});
  };

  useEffect(() => {
    const refreshDashboard = () => {
      const headers = getAuthHeaders();
      Promise.all([
        fetch(`${API_BASE}/v1/estimates/stats`, { headers }).then(r => r.json()).catch(() => ({})),
        fetch(`${API_BASE}/v1/estimates/inbox`, { headers }).then(r => r.json()).catch(() => ({})),
        fetch(`${API_BASE}/v1/meetings?range=${meetingRange}`, { headers }).then(r => r.json()).catch(() => ({})),
        fetch(`${API_BASE}/v1/approvals?status=pending`, { headers }).then(r => r.json()).catch(() => ({})),
      ]).then(([statsRes, inboxRes, meetingsRes, approvalsRes]) => {
        setStats(statsRes.stats || null);
        setBids(inboxRes.bidRequests || []);
        setApprovals(approvalsRes.items || []);
        const mtgs = meetingsRes.meetings || [];
        setMeetings(mtgs);
        const alreadyInvited = new Set();
        for (const m of mtgs) {
          if (m.attendees?.some(a => a.email?.includes('coppice') || a.email?.includes('agent@'))) {
            alreadyInvited.add(m.id);
          }
        }
        if (alreadyInvited.size > 0) setInvitedMeetings(prev => new Set([...prev, ...alreadyInvited]));
      }).catch(console.error).finally(() => setLoading(false));
      fetchAssignments();
    };

    refreshDashboard();
    fetchLeadsSheet();

    // Live polling - refresh every 10 seconds
    const poll = setInterval(refreshDashboard, 10_000);
    return () => clearInterval(poll);
  }, [meetingRange, fetchLeadsSheet, fetchAssignments]);

  const handleApprove = async (id) => {
    setProcessingApproval(id);
    try {
      await fetch(`${API_BASE}/v1/approvals/${id}/approve`, { method: 'POST', headers: getAuthHeaders() });
      fetchApprovals();
    } catch (err) { console.error('Approve failed:', err); }
    finally { setProcessingApproval(null); }
  };

  const handleReject = async (id) => {
    setProcessingApproval(id);
    try {
      await fetch(`${API_BASE}/v1/approvals/${id}/reject`, { method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Rejected by operator' }) });
      fetchApprovals();
    } catch (err) { console.error('Reject failed:', err); }
    finally { setProcessingApproval(null); }
  };

  const metrics = stats ? [
    { label: 'Open RFQs', value: stats.openRfqs, delta: `${stats.totalBidRequests} total`, type: 'up', bar: Math.min((stats.openRfqs / Math.max(stats.totalBidRequests, 1)) * 100, 100), icon: ClipboardList },
    { label: 'Active Bids', value: stats.totalEstimates, delta: `${stats.draftEstimates} draft`, type: 'up', bar: Math.min((stats.totalEstimates / Math.max(stats.totalBidRequests, 1)) * 100, 100), icon: TrendingUp },
    { label: 'Win Rate', value: `${stats.winRate}%`, delta: `${stats.wonJobs}W / ${stats.lostJobs}L`, type: stats.winRate > 50 ? 'up' : 'warn', bar: stats.winRate, icon: TrendingUp },
    { label: 'Active Jobs', value: stats.activeJobs, delta: `${stats.completeJobs} complete`, type: 'flat', bar: Math.min((stats.activeJobs / Math.max(stats.totalJobs, 1)) * 100, 100), icon: HardHat },
    { label: 'Total Revenue', value: `$${(stats.totalRevenue / 1000).toFixed(0)}K`, delta: `${stats.avgMargin}% avg margin`, type: 'up', bar: Math.min(stats.avgMargin * 5, 100), icon: DollarSign },
  ] : [];

  const upcoming = bids
    .filter(b => b.status === 'new' || b.status === 'estimated')
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
    .slice(0, 8);

  // This week's deadlines
  const now = new Date();
  const endOfWeek = new Date(now);
  endOfWeek.setDate(now.getDate() + (7 - now.getDay()));
  const bidsThisWeek = bids.filter(b => {
    const d = new Date(b.due_date);
    return d >= now && d <= endOfWeek;
  });

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

  if (loading) {
    return <div className="flex items-center justify-center py-24"><div className="spinner w-10 h-10" /></div>;
  }

  return (<>
    <div className="p-6 lg:px-7 lg:py-6">
      {/* Top row: Bids Due + Active Jobs - inline expandable */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div
            className="p-5 cursor-pointer hover:bg-[#f5f4f0] transition-colors flex items-center justify-between"
            onClick={() => { setShowBidsList(v => !v); setShowJobsList(false); }}
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-[10px] bg-[#fdf6e8] flex items-center justify-center">
                <ClipboardList size={18} className="text-[#b8860b]" />
              </div>
              <div>
                <div className="text-[10px] font-heading font-bold text-terminal-muted uppercase tracking-[1px]">Bids Due This Week</div>
                <div className="text-2xl font-display text-terminal-text tabular-nums">{bidsThisWeek.length}</div>
              </div>
            </div>
            {bidsThisWeek.length > 0 && (showBidsList ? <ChevronUp size={16} className="text-terminal-muted" /> : <ChevronDown size={16} className="text-terminal-muted" />)}
          </div>
          {showBidsList && bidsThisWeek.length > 0 && (
            <div className="border-t border-[#f0eeea] max-h-[300px] overflow-y-auto">
              {bidsThisWeek.map(bid => (
                <div key={bid.id} className="px-5 py-2.5 border-b border-[#f0eeea] last:border-b-0 hover:bg-[#f9f9f7] cursor-pointer" onClick={() => onNavigate?.('workflow-chat')}>
                  <div className="text-[12px] font-medium text-terminal-text truncate">{bid.gc_name} - {bid.subject}</div>
                  <div className="text-[10px] text-terminal-muted flex gap-3 mt-0.5">
                    <span>Due: {new Date(bid.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    <span className={`font-semibold ${bid.status === 'new' ? 'text-[#b8860b]' : bid.status === 'estimated' ? 'text-[#1a6b3c]' : ''}`}>{bid.status}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {showBidsList && bidsThisWeek.length === 0 && (
            <div className="border-t border-[#f0eeea] px-5 py-4 text-[11px] text-terminal-muted">No bids due this week.</div>
          )}
        </div>

        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div
            className="p-5 cursor-pointer hover:bg-[#f5f4f0] transition-colors flex items-center justify-between"
            onClick={() => { setShowJobsList(v => !v); setShowBidsList(false); }}
          >
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-[10px] bg-[#e8f5ee] flex items-center justify-center">
                <HardHat size={18} className="text-[#1a6b3c]" />
              </div>
              <div>
                <div className="text-[10px] font-heading font-bold text-terminal-muted uppercase tracking-[1px]">Active Jobs</div>
                <div className="text-2xl font-display text-terminal-text tabular-nums">{stats?.activeJobs || 0}</div>
              </div>
            </div>
            {(stats?.activeJobs > 0) && (showJobsList ? <ChevronUp size={16} className="text-terminal-muted" /> : <ChevronDown size={16} className="text-terminal-muted" />)}
          </div>
          {showJobsList && (
            <div className="border-t border-[#f0eeea] px-5 py-4 text-[11px] text-terminal-muted">
              {stats?.activeJobs > 0 ? 'Open the Workflow agent Jobs tab for details.' : 'No active jobs.'}
            </div>
          )}
        </div>
      </div>

      {/* Agent Assignments - top of dashboard for morning review */}
      <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden mb-5">
        <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
          <div className="flex items-center gap-2">
            <ClipboardList size={14} className="text-[#1e3a5f]" />
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
                      ? 'bg-white text-[#1e3a5f] shadow-sm'
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
          return (
          <div>
            {paged.map(a => {
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
                <div key={a.id} className="border-b border-[#f0eeea] last:border-b-0">
                  <div className="flex items-start gap-3 px-[18px] py-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        {a.priority === 'high' && <span className="text-[10px] font-bold text-red-500">HIGH</span>}
                        <span className="text-[13px] font-medium text-terminal-text">{a.title}</span>
                        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border font-semibold uppercase ${catColors[a.category] || catColors.admin}`}>
                          {a.category?.replace('_', ' ')}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#6b6b65] leading-relaxed">{a.description}</div>
                      {a.status === 'proposed' && a.input_fields_json && (() => {
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
                      {a.status === 'completed' && (
                        <div className="mt-1.5 space-y-1.5">
                          {a.result_summary && (
                            <div className="text-[11px] text-emerald-600 bg-emerald-50 px-2 py-1.5 rounded leading-relaxed">
                              {a.result_summary.slice(0, 300)}{a.result_summary.length > 300 ? '...' : ''}
                            </div>
                          )}
                          {(() => {
                            try {
                              const artifacts = JSON.parse(a.output_artifacts_json || '[]');
                              if (!artifacts.length) return null;
                              const artifactOrder = { pdf: 0, docx: 1, gdoc: 2, sheet: 3, document: 2 };
                              const docArtifacts = artifacts
                                .filter(art => art.type !== 'email_draft')
                                .sort((a, b) => (artifactOrder[a.type] ?? 9) - (artifactOrder[b.type] ?? 9));
                              const emailDrafts = artifacts.filter(art => art.type === 'email_draft');
                              return (
                                <>
                                {docArtifacts.length > 0 && (
                                <div className="flex flex-wrap gap-1.5">
                                  {docArtifacts.map((rawArt, i) => {
                                    // Normalize: treat any artifact with a Google Docs URL as gdoc type
                                    const isGoogleUrl = rawArt.url && (rawArt.url.includes('docs.google.com') || rawArt.url.includes('drive.google.com'));
                                    const art = isGoogleUrl && rawArt.type !== 'gdoc' ? { ...rawArt, type: 'gdoc', label: 'Google Docs' } : rawArt;
                                    const href = art.url || (art.path ? `${API_BASE}${art.path}` : '#');
                                    const icon = art.type === 'gdoc' ? <ExternalLink size={10} />
                                      : art.type === 'pdf' ? <FileText size={10} />
                                      : art.type === 'docx' ? <Download size={10} />
                                      : art.type === 'sheet' ? <FileSpreadsheet size={10} />
                                      : art.type === 'email' ? <Mail size={10} />
                                      : <ExternalLink size={10} />;
                                    const openPreview = async (e) => {
                                      if (art.type === 'gdoc') return;
                                      e.preventDefault();
                                      try {
                                        setDocPreview({ type: art.type, url: null, title: a.title, filename: art.filename, assignment: a, loading: true });
                                        const previewUrl = art.path ? `${API_BASE}${art.path}?preview=1` : href;
                                        console.log('[DocPreview] Fetching:', previewUrl, 'type:', art.type);
                                        const resp = await fetch(previewUrl, { headers: getAuthHeaders() });
                                        console.log('[DocPreview] Response:', resp.status, resp.statusText);
                                        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
                                        const blob = await resp.blob();
                                        console.log('[DocPreview] Blob:', blob.size, blob.type);
                                        const blobUrl = URL.createObjectURL(blob);
                                        setDocPreview(prev => prev ? { ...prev, url: blobUrl, loading: false } : null);
                                      } catch (err) {
                                        console.error('[DocPreview] Error:', err);
                                        setDocPreview(prev => prev ? { ...prev, url: null, loading: false, error: true } : null);
                                      }
                                    };
                                    return (
                                      <a
                                        key={i}
                                        href={href}
                                        target={art.type === 'gdoc' ? '_blank' : '_self'}
                                        rel="noopener noreferrer"
                                        onClick={openPreview}
                                        className={`inline-flex items-center gap-1 text-[10px] font-medium px-2.5 py-1.5 rounded-lg border transition-colors cursor-pointer ${
                                          art.type === 'gdoc' ? 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200'
                                          : art.type === 'pdf' ? 'bg-red-50 hover:bg-red-100 text-red-700 border-red-200'
                                          : art.type === 'docx' ? 'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-200'
                                          : 'bg-white hover:bg-blue-50 text-[#1e3a5f] border-[#d0cec8]'
                                        }`}
                                      >
                                        {icon}
                                        {art.label || art.title || art.type}
                                      </a>
                                    );
                                  })}
                                </div>
                                )}
                                {emailDrafts.map((draft, di) => (
                                  <div key={`email-${di}`} className="mt-2 border border-amber-200 bg-amber-50 rounded-lg p-3">
                                    <div className="flex items-center gap-2 mb-1.5">
                                      <Mail size={12} className="text-amber-600" />
                                      <span className="text-[11px] font-semibold text-amber-800">
                                        {draft.status === 'sent' ? 'Email Sent' : draft.status === 'rejected' ? 'Email Rejected' : 'Email Draft — Awaiting Approval'}
                                      </span>
                                    </div>
                                    <div className="text-[10px] text-amber-700 mb-1"><strong>To:</strong> {draft.to}</div>
                                    <div className="text-[10px] text-amber-700 mb-2"><strong>Subject:</strong> {draft.subject}</div>
                                    <div className="text-[10px] text-[#4a4a42] bg-white rounded border border-amber-100 p-2 mb-2 max-h-[120px] overflow-y-auto" dangerouslySetInnerHTML={{ __html: draft.body }} />
                                    {draft.status === 'pending_approval' && (
                                      <div className="flex gap-2">
                                        <button
                                          onClick={async () => {
                                            if (!window.confirm(`Send email to ${draft.to}?`)) return;
                                            try {
                                              const resp = await fetch(`${API_BASE}/v1/estimates/assignments/${a.id}/approve-email`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                                                body: JSON.stringify({ index: draft.index }),
                                              });
                                              if (resp.ok) {
                                                setAssignments(prev => prev.map(x => {
                                                  if (x.id !== a.id) return x;
                                                  const arts = JSON.parse(x.output_artifacts_json || '[]').map(ar =>
                                                    ar.type === 'email_draft' && ar.index === draft.index ? { ...ar, status: 'sent' } : ar
                                                  );
                                                  return { ...x, output_artifacts_json: JSON.stringify(arts) };
                                                }));
                                              }
                                            } catch {}
                                          }}
                                          className="inline-flex items-center gap-1 text-[10px] font-medium px-3 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white transition-colors"
                                        >
                                          <Check size={10} /> Approve & Send
                                        </button>
                                        <button
                                          onClick={async () => {
                                            try {
                                              const resp = await fetch(`${API_BASE}/v1/estimates/assignments/${a.id}/reject-email`, {
                                                method: 'POST',
                                                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                                                body: JSON.stringify({ index: draft.index }),
                                              });
                                              if (resp.ok) {
                                                setAssignments(prev => prev.map(x => {
                                                  if (x.id !== a.id) return x;
                                                  const arts = JSON.parse(x.output_artifacts_json || '[]').map(ar =>
                                                    ar.type === 'email_draft' && ar.index === draft.index ? { ...ar, status: 'rejected' } : ar
                                                  );
                                                  return { ...x, output_artifacts_json: JSON.stringify(arts) };
                                                }));
                                              }
                                            } catch {}
                                          }}
                                          className="inline-flex items-center gap-1 text-[10px] font-medium px-3 py-1.5 rounded-lg bg-white hover:bg-red-50 text-red-600 border border-red-200 transition-colors"
                                        >
                                          <X size={10} /> Reject
                                        </button>
                                      </div>
                                    )}
                                    {draft.status === 'sent' && (
                                      <div className="text-[10px] text-green-600 font-medium"><Check size={10} className="inline" /> Sent {draft.sent_at ? `at ${new Date(draft.sent_at).toLocaleString()}` : ''}</div>
                                    )}
                                    {draft.status === 'rejected' && (
                                      <div className="text-[10px] text-red-500 font-medium"><X size={10} className="inline" /> Rejected</div>
                                    )}
                                  </div>
                                ))}
                                </>
                              );
                            } catch { return null; }
                          })()}
                          {a.thread_id && (
                            <button
                              onClick={() => { window.location.href = `/agent/chat?thread=${a.thread_id}`; }}
                              className="inline-flex items-center gap-1 text-[10px] text-[#1e3a5f] hover:underline"
                            >
                              <MessageSquare size={10} /> View full conversation
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
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
                              onClick={() => { setChatOpenFor(chatOpenFor === a.id ? null : a.id); setChatInput(''); }}
                              className={`p-1 rounded transition-colors ${chatOpenFor === a.id ? 'text-[#1e3a5f] bg-blue-50' : 'text-terminal-muted hover:text-[#1e3a5f]'}`}
                              title="Refine task"
                            >
                              <MessageSquare size={13} />
                            </button>
                            <button
                              onClick={() => handleConfirmAssignment(a.id)}
                              disabled={processingAssignment === a.id || !inputsReady}
                              title={!inputsReady ? 'Fill in required fields to confirm' : ''}
                              className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-heading font-semibold bg-[#1e3a5f] text-white rounded-md hover:bg-[#162d4a] disabled:opacity-50"
                            >
                              <Check size={11} /> Run
                            </button>
                            <button
                              onClick={() => handleDismissAssignment(a.id)}
                              className="p-1 text-terminal-muted hover:text-red-500 rounded"
                              title="Dismiss"
                            >
                              <X size={13} />
                            </button>
                          </>
                        );
                      })()}
                      {a.status === 'in_progress' && (
                        <span className="flex items-center gap-1 text-[11px] text-[#1e3a5f] font-medium">
                          {infoRequests[a.job_id]?.length > 0
                            ? <><AlertCircle size={11} className="text-amber-600" /> Needs input</>
                            : <><RotateCcw size={11} className="animate-spin" /> Working...</>
                          }
                        </span>
                      )}
                      {a.status === 'completed' && (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {a.result_summary?.startsWith('Failed') ? (
                            <>
                              <button
                                onClick={() => handleConfirmAssignment(a.id)}
                                disabled={processingAssignment === a.id}
                                className="flex items-center gap-1 px-2 py-1 text-[11px] font-heading font-semibold bg-[#1e3a5f] text-white rounded-md hover:bg-[#162d4a] disabled:opacity-50"
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
                              {a.visibility === 'shared' && (
                                <button
                                  onClick={async () => {
                                    try {
                                      const res = await fetch(`${API_BASE}/v1/estimates/assignments/${a.id}/unshare`, {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                                      });
                                      if (res.ok) {
                                        setAssignments(prev => prev.map(x => x.id === a.id ? { ...x, visibility: 'private' } : x));
                                        setSharedAssignments(prev => { const n = { ...prev }; delete n[`internal-${a.id}`]; return n; });
                                      }
                                    } catch {}
                                  }}
                                  className="flex items-center gap-1 text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 border border-blue-200 hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors cursor-pointer"
                                  title="Click to unshare"
                                >
                                  <Users size={8} /> Shared <X size={8} />
                                </button>
                              )}
                              <button
                                onClick={() => { localStorage.setItem('coppice_chat_prefill', `Let's discuss the report: "${a.title}"\n\nHere's the summary:\n${(a.result_summary || '').slice(0, 1000)}`); window.location.hash = 'hivemind-chat'; }}
                                className="flex items-center gap-1 px-2 py-1 text-[11px] font-heading font-semibold bg-[#f0f0ec] text-[#6b6b65] rounded-md hover:bg-[#e8e6e1] hover:text-[#1e3a5f] transition-colors"
                                title="Chat about this report"
                              >
                                <MessageSquare size={10} /> Chat
                              </button>
                              <button
                                onClick={() => openShareModal(a.id)}
                                disabled={a.visibility === 'shared'}
                                className="flex items-center gap-1 px-2 py-1 text-[11px] font-heading font-semibold bg-[#f0f0ec] text-[#6b6b65] rounded-md hover:bg-[#e8e6e1] hover:text-[#1e3a5f] disabled:opacity-50 transition-colors"
                                title="Share with team"
                              >
                                <Users size={10} />
                                {a.visibility === 'shared' ? 'Shared' : 'Share'}
                              </button>
                              <button
                                onClick={() => openAttachModal(a.id)}
                                className="flex items-center gap-1 px-2 py-1 text-[11px] font-heading font-semibold bg-[#f0f0ec] text-[#6b6b65] rounded-md hover:bg-[#e8e6e1] hover:text-[#1e3a5f] transition-colors"
                                title="Attach to entity"
                              >
                                <Link2 size={10} /> Attach
                              </button>
                              <button
                                onClick={() => handleArchiveAssignment(a.id)}
                                className="flex items-center gap-1 px-2 py-1 text-[11px] font-heading font-semibold bg-[#f0f0ec] text-[#6b6b65] rounded-md hover:bg-[#e8e6e1] hover:text-amber-600 transition-colors"
                                title="Archive this task"
                              >
                                <Archive size={10} /> Archive
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Info request cards for paused jobs */}
                  {a.status === 'in_progress' && a.job_id && infoRequests[a.job_id]?.length > 0 && (
                    <div className="border-t border-[#f0eeea]">
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
                  {/* Inline chat for refining this assignment */}
                  {chatOpenFor === a.id && a.status === 'proposed' && (
                    <div className="px-[18px] pb-3">
                      <div className="bg-[#f9f8f6] border border-[#e8e6e1] rounded-lg p-3">
                        {(chatMessages[a.id] || []).length > 0 && (
                          <div className="space-y-2 mb-3 max-h-[200px] overflow-y-auto">
                            {(chatMessages[a.id] || []).map((m, i) => (
                              <div key={i} className={`text-[11px] leading-relaxed ${m.role === 'user' ? 'text-terminal-text' : 'text-[#1e3a5f]'}`}>
                                <span className="font-semibold">{m.role === 'user' ? 'You' : 'Coppice'}:</span>{' '}
                                {m.text}
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={chatInput}
                            onChange={e => setChatInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !chatLoading) handleAssignmentChat(a.id); }}
                            placeholder="e.g. Only use 2 of the 3 estimates..."
                            className="flex-1 text-[11px] px-3 py-1.5 border border-[#ddd9d3] rounded-md bg-white focus:outline-none focus:border-[#1e3a5f] placeholder:text-[#b5b5ad]"
                            disabled={chatLoading}
                          />
                          <button
                            onClick={() => handleAssignmentChat(a.id)}
                            disabled={chatLoading || !chatInput.trim()}
                            className="px-3 py-1.5 text-[11px] font-heading font-semibold bg-[#1e3a5f] text-white rounded-md hover:bg-[#162d4a] disabled:opacity-50"
                          >
                            {chatLoading ? 'Refining...' : 'Send'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-[18px] py-2.5 border-t border-[#f0eeea]">
                <span className="text-[11px] text-[#9a9a92]">{safePage * TASKS_PER_PAGE + 1}–{Math.min((safePage + 1) * TASKS_PER_PAGE, visible.length)} of {visible.length}</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setAssignmentsPage(Math.max(0, safePage - 1))}
                    disabled={safePage === 0}
                    className="p-1 rounded hover:bg-[#f0eeea] disabled:opacity-25 transition-colors"
                  >
                    <ChevronLeft size={14} className="text-[#6b6b65]" />
                  </button>
                  <span className="text-[11px] text-[#6b6b65] font-mono px-1">{safePage + 1}/{totalPages}</span>
                  <button
                    onClick={() => setAssignmentsPage(Math.min(totalPages - 1, safePage + 1))}
                    disabled={safePage >= totalPages - 1}
                    className="p-1 rounded hover:bg-[#f0eeea] disabled:opacity-25 transition-colors"
                  >
                    <ChevronRight size={14} className="text-[#6b6b65]" />
                  </button>
                </div>
              </div>
            )}
          </div>
          );
        })()}
      </div>

      {/* Meetings This Week - expanded */}
      <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden mb-5">
        <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-[#1e3a5f]" />
            <span className="text-xs font-heading font-bold text-terminal-text tracking-[0.3px]">Meetings</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-mono text-terminal-muted">{meetings.length} meeting{meetings.length !== 1 ? 's' : ''}</span>
            <div className="flex rounded-lg border border-[#e0ddd8] overflow-hidden">
              {MEETING_RANGES.map(r => (
                <button
                  key={r.key}
                  onClick={() => setMeetingRange(r.key)}
                  className={`px-2.5 py-1 text-[10px] font-heading font-semibold transition-colors ${meetingRange === r.key ? 'bg-[#1e3a5f] text-white' : 'bg-white text-[#6b6b65] hover:bg-[#f5f4f0]'}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {meetings.length === 0 ? (
          <div className="px-[18px] py-8 text-center text-[13px] text-terminal-muted">No meetings this week</div>
        ) : (
          <div>
            {meetings.map((m) => {
              const isInvited = invitedMeetings.has(m.id);
              const isInviting = invitingId === m.id;
              const hasMeetLink = !!m.meetLink;
              const isPast = new Date(m.end || m.start) < new Date();
              return (
                <div key={m.id} className="flex items-center gap-4 px-[18px] py-3 border-b border-[#f0eeea] last:border-b-0 hover:bg-[#f9f9f7] transition-colors">
                  {/* Time */}
                  <div className="w-[72px] shrink-0">
                    <div className="text-[11px] font-heading font-semibold text-[#1e3a5f]">{formatMeetingDay(m.start)}</div>
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

                  {/* Meet link indicator */}
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
                        className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-heading font-semibold text-white bg-[#1e3a5f] hover:bg-[#162d4a] transition-colors disabled:opacity-50 shrink-0"
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
          </div>
        )}
      </div>

      {/* Pending Approvals */}
      {approvals.length > 0 && (
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden mb-5">
          <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
            <div className="flex items-center gap-2">
              <CheckCircle size={14} className="text-[#b8860b]" />
              <span className="text-xs font-heading font-bold text-terminal-text tracking-[0.3px]">Pending Approvals</span>
            </div>
            <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-[#fdf6e8] text-[#b8860b] border border-[#f0d88a]">{approvals.length}</span>
          </div>
          {approvals.map((item) => {
            const payload = item.payload || (item.payload_json ? JSON.parse(item.payload_json) : {});
            const isExpanded = expandedApproval === item.id;
            const isProcessing = processingApproval === item.id;
            return (
              <div key={item.id} className="border-b border-[#f0eeea] last:border-b-0">
                <div className="flex items-center gap-3 px-[18px] py-3 hover:bg-[#f9f9f7] transition-colors">
                  <Mail size={14} className="text-[#1e3a5f] shrink-0" />
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpandedApproval(isExpanded ? null : item.id)}>
                    <div className="text-[13px] font-medium text-terminal-text truncate">{item.title}</div>
                    <div className="text-[11px] text-terminal-muted truncate">{item.description}</div>
                  </div>
                  <button onClick={() => setExpandedApproval(isExpanded ? null : item.id)} className="p-1 text-terminal-muted hover:text-terminal-text shrink-0">
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>
                  <div className="flex gap-1.5 shrink-0">
                    <button
                      onClick={() => handleApprove(item.id)}
                      disabled={isProcessing}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-heading font-semibold text-white bg-[#1a6b3c] hover:bg-[#155e33] transition-colors disabled:opacity-50"
                    >
                      <Check size={10} /> Approve
                    </button>
                    <button
                      onClick={() => handleReject(item.id)}
                      disabled={isProcessing}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-heading font-semibold text-terminal-red bg-red-50 border border-red-200 hover:bg-red-100 transition-colors disabled:opacity-50"
                    >
                      <X size={10} /> Reject
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="px-[18px] pb-4 pt-1 space-y-3">
                    {/* Email header + body */}
                    <div className="bg-[#f9f9f7] border border-[#e8e6e2] rounded-lg overflow-hidden">
                      {(payload.to || payload.subject) && (
                        <div className="px-4 py-2.5 border-b border-[#e8e6e2] bg-[#f5f4f0]">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="text-[10px] font-heading font-semibold text-terminal-muted uppercase">Draft Reply Preview</div>
                            <div className="flex items-center gap-1.5">
                              {editingApproval === item.id ? (
                                <>
                                  <button onClick={() => handleSaveEdit(item.id)} disabled={savingEdit} className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-white bg-[#1a6b3c] hover:bg-[#155e33] disabled:opacity-50">
                                    <Save size={10} /> {savingEdit ? 'Saving...' : 'Save'}
                                  </button>
                                  <button onClick={() => setEditingApproval(null)} className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-[#6b6b65] bg-[#e8e6e2] hover:bg-[#d5d3ce]">
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <button onClick={() => { setEditBody(payload.body || ''); setEditingApproval(item.id); }} className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium text-[#6b6b65] hover:bg-[#e8e6e2]">
                                  <Pencil size={10} /> Edit
                                </button>
                              )}
                            </div>
                          </div>
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
                          {/* Sender dropdown */}
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className="text-[11px] font-medium text-terminal-text">Sign as:</span>
                            <select
                              value={editSender || (payload.body?.match(/^(.+?)(?:\n|$)/m)?.[0]?.trim() === 'Best regards,' ? '' : '')}
                              onChange={(e) => {
                                setEditSender(e.target.value);
                                if (e.target.value) {
                                  handleRewriteForSender(item.id, e.target.value, payload.body || editBody);
                                }
                              }}
                              className="text-[11px] px-2 py-0.5 rounded border border-[#e8e6e2] bg-white text-terminal-text"
                            >
                              <option value="">Select signer...</option>
                              {SENDERS.map(s => (
                                <option key={s.name} value={s.name}>{s.label}</option>
                              ))}
                            </select>
                            {rewriting && <span className="text-[10px] text-terminal-muted italic">Rewriting...</span>}
                          </div>
                        </div>
                      )}
                      <div className="p-4">
                        {editingApproval === item.id ? (
                          <textarea
                            value={editBody}
                            onChange={(e) => setEditBody(e.target.value)}
                            className="w-full min-h-[200px] text-[12px] text-terminal-text leading-relaxed bg-white border border-[#e8e6e2] rounded-md p-3 resize-y focus:outline-none focus:border-[#1e3a5f]"
                          />
                        ) : payload.html ? (
                          <div
                            className="text-[12px] text-terminal-text leading-relaxed [&_table]:w-full [&_table]:border-collapse [&_td]:p-1.5 [&_td]:text-[11px] [&_th]:p-1.5 [&_th]:text-[11px] [&_th]:text-left [&_th]:font-semibold [&_h2]:text-[13px] [&_h2]:font-bold [&_h2]:mb-2 [&_h3]:text-[12px] [&_h3]:font-semibold [&_h3]:mb-1 [&_p]:mb-2 [&_p]:text-[12px]"
                            dangerouslySetInnerHTML={{ __html: payload.html }}
                          />
                        ) : payload.body ? (
                          <div className="text-[12px] text-terminal-text whitespace-pre-wrap leading-relaxed">
                            {payload.body}
                          </div>
                        ) : (
                          <div className="text-[12px] text-terminal-muted">
                            {item.description || 'No preview available'}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Attachments */}
                    {payload.attachments && payload.attachments.length > 0 && (
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-2">
                          {payload.attachments.map((att, i) => (
                            <button
                              key={i}
                              onClick={() => {
                                if (excelPreview?.approvalId === item.id && excelPreview?.index === i) {
                                  setExcelPreview(null);
                                  return;
                                }
                                setLoadingExcel(true);
                                fetch(`${API_BASE}/v1/approvals/${item.id}/attachment/${i}`, { headers: getAuthHeaders() })
                                  .then(r => r.json())
                                  .then(data => {
                                    if (data.sheets) setExcelPreview({ approvalId: item.id, index: i, data });
                                    else setExcelPreview({ approvalId: item.id, index: i, data: null, error: data.error || 'Could not load' });
                                  })
                                  .catch(() => setExcelPreview({ approvalId: item.id, index: i, data: null, error: 'Could not load file' }))
                                  .finally(() => setLoadingExcel(false));
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f5f4f0] border border-[#e8e6e2] rounded-md hover:bg-[#eeedea] transition-colors cursor-pointer"
                            >
                              <FileSpreadsheet size={12} className="text-[#1a6b3c]" />
                              <span className="text-[11px] font-medium text-terminal-text">{att.filename || att.name || 'Attachment'}</span>
                              <ChevronDown size={10} className={`text-terminal-muted transition-transform ${excelPreview?.approvalId === item.id && excelPreview?.index === i ? 'rotate-180' : ''}`} />
                            </button>
                          ))}
                        </div>
                        {/* Excel preview table */}
                        {excelPreview?.approvalId === item.id && excelPreview.data && (
                          <div className="bg-white border border-[#e8e6e2] rounded-lg overflow-hidden max-h-[300px] overflow-y-auto">
                            {excelPreview.data.sheets.map((sheet, si) => (
                              <div key={si}>
                                <div className="px-3 py-1.5 bg-[#f5f4f0] border-b border-[#e8e6e2] text-[10px] font-heading font-semibold text-terminal-muted uppercase">{sheet.name}</div>
                                <table className="w-full text-[11px]">
                                  <tbody>
                                    {sheet.rows.map((row, ri) => (
                                      <tr key={ri} className={ri === 0 ? 'bg-[#1e3a5f] text-white font-semibold' : ri % 2 === 0 ? 'bg-[#fafaf8]' : ''}>
                                        {row.map((cell, ci) => (
                                          <td key={ci} className={`px-2 py-1 border-b border-[#f0eeea] ${ri === 0 ? 'border-[#2a4d73]' : ''}`}>{cell}</td>
                                        ))}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ))}
                          </div>
                        )}
                        {excelPreview?.approvalId === item.id && excelPreview.error && (
                          <div className="text-[11px] text-terminal-muted italic px-2">{excelPreview.error}</div>
                        )}
                        {loadingExcel && excelPreview?.approvalId === item.id && (
                          <div className="text-[11px] text-terminal-muted italic px-2">Loading spreadsheet...</div>
                        )}
                      </div>
                    )}

                    {/* View Original RFQ */}
                    {payload.bidId && (
                      <div>
                        <button
                          onClick={() => {
                            if (originalEmail?.approvalId === item.id) {
                              setOriginalEmail(null);
                              return;
                            }
                            setLoadingOriginal(true);
                            fetch(`${API_BASE}/v1/estimates/inbox/${payload.bidId}`, { headers: getAuthHeaders() })
                              .then(r => r.json())
                              .then(data => {
                                if (data.bidRequest) setOriginalEmail({ approvalId: item.id, data: data.bidRequest });
                                else setOriginalEmail({ approvalId: item.id, data: null, error: 'Could not load original email' });
                              })
                              .catch(() => setOriginalEmail({ approvalId: item.id, data: null, error: 'Could not load original email' }))
                              .finally(() => setLoadingOriginal(false));
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-medium text-[#6b6b65] bg-[#f5f4f0] border border-[#e8e6e2] hover:bg-[#eeedea] transition-colors"
                        >
                          <Mail size={12} />
                          {originalEmail?.approvalId === item.id ? 'Hide Original RFQ' : 'View Original RFQ'}
                          <ChevronDown size={10} className={`transition-transform ${originalEmail?.approvalId === item.id ? 'rotate-180' : ''}`} />
                        </button>
                        {loadingOriginal && originalEmail?.approvalId === item.id && (
                          <div className="text-[11px] text-terminal-muted italic px-2 mt-1">Loading...</div>
                        )}
                        {originalEmail?.approvalId === item.id && originalEmail.data && (
                          <div className="mt-2 bg-white border border-[#e8e6e2] rounded-lg overflow-hidden">
                            <div className="px-4 py-2.5 border-b border-[#e8e6e2] bg-[#f5f4f0]">
                              <div className="text-[10px] font-heading font-semibold text-terminal-muted uppercase mb-1.5">Original RFQ Email</div>
                              <div className="text-[11px] text-[#6b6b65]">
                                <span className="font-medium text-terminal-text">From:</span> {originalEmail.data.from_name || originalEmail.data.from_email}
                                {originalEmail.data.from_name && <span className="text-[#999]"> &lt;{originalEmail.data.from_email}&gt;</span>}
                              </div>
                              <div className="text-[11px] text-[#6b6b65]">
                                <span className="font-medium text-terminal-text">Subject:</span> {originalEmail.data.subject}
                              </div>
                              {originalEmail.data.gc_name && originalEmail.data.gc_name !== originalEmail.data.from_email && (
                                <div className="text-[11px] text-[#6b6b65]">
                                  <span className="font-medium text-terminal-text">GC:</span> {originalEmail.data.gc_name}
                                </div>
                              )}
                              {originalEmail.data.due_date && (
                                <div className="text-[11px] text-[#6b6b65]">
                                  <span className="font-medium text-terminal-text">Due:</span> {new Date(originalEmail.data.due_date).toLocaleDateString()}
                                </div>
                              )}
                            </div>
                            <div className="p-4 text-[12px] text-terminal-text whitespace-pre-wrap leading-relaxed max-h-[300px] overflow-y-auto">
                              {originalEmail.data.body}
                            </div>
                          </div>
                        )}
                        {originalEmail?.approvalId === item.id && originalEmail.error && (
                          <div className="text-[11px] text-terminal-muted italic px-2 mt-1">{originalEmail.error}</div>
                        )}
                      </div>
                    )}

                    {/* Edit in Chat button */}
                    <button
                      onClick={() => {
                        // Store approval context so AgentChat can pre-populate the conversation
                        const context = {
                          approvalId: item.id,
                          title: item.title,
                          description: item.description,
                          type: item.type,
                          payload,
                        };
                        sessionStorage.setItem('dacp_approval_context', JSON.stringify(context));
                        onNavigate?.('hivemind-chat');
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-heading font-semibold text-[#1e3a5f] bg-[#eef3f8] border border-[#c8d8e8] hover:bg-[#dde8f2] transition-colors"
                    >
                      <MessageSquare size={12} />
                      Edit in DACP Agent
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Metrics Strip */}
      {metrics.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 border border-terminal-border rounded-[14px] overflow-hidden mb-5" style={{ gap: '1px', background: 'var(--t-border)' }}>
          {metrics.map((m) => (
            <div key={m.label} className="bg-terminal-panel p-[18px_20px] relative">
              <div className="text-[10px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1.5">{m.label}</div>
              <div className="text-2xl font-display text-terminal-text tabular-nums leading-none">{m.value}</div>
              <div className={`text-[11px] font-mono font-medium mt-1 ${DELTA_COLORS[m.type]}`}>{m.delta}</div>
              <div className="absolute bottom-0 left-5 right-5 h-[3px] rounded-[3px] bg-[#f0eeea] overflow-hidden">
                <div className="h-full rounded-[3px] transition-all duration-1000" style={{ width: `${m.bar}%`, background: '#1e3a5f' }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Leads Sheet */}
      <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden mb-5">
        <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={14} className="text-[#1e3a5f]" />
            <span className="text-xs font-heading font-bold text-terminal-text tracking-[0.3px]">Leads Pipeline</span>
          </div>
          {leadsSheet?.configured ? (
            <div className="flex items-center gap-2">
              <a href={leadsSheet.sheetUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] text-[#1e3a5f] hover:underline">
                <ExternalLink size={10} /> {leadsSheet.sheetTitle}
              </a>
              <button onClick={() => setShowLinkModal(true)}
                className="text-[10px] text-terminal-muted hover:text-terminal-text px-1.5 py-0.5 rounded border border-[#e8e6e2] hover:bg-[#f5f4f0]">
                Change
              </button>
              <button onClick={handleUnlinkSheet}
                className="text-[10px] text-terminal-muted hover:text-red-500 px-1 py-0.5 rounded border border-[#e8e6e2] hover:bg-red-50"
                title="Unlink sheet">
                <Unlink size={10} />
              </button>
            </div>
          ) : (
            <button onClick={() => { setShowLinkModal(true); searchDrive('leads'); }}
              className="flex items-center gap-1.5 text-[11px] font-heading font-semibold text-[#1e3a5f] px-3 py-1 rounded-md border border-[#c8d8e8] bg-[#eef3f8] hover:bg-[#dde8f2]">
              <Link2 size={11} /> Link Sheet
            </button>
          )}
        </div>
        {leadsLoading ? (
          <div className="px-[18px] py-6 text-center text-[#9a9a92] text-[12px]">Loading...</div>
        ) : leadsSheet?.configured && leadsSheet.preview?.length > 0 ? (
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
                {leadsSheet.preview.slice(0, 8).map((row, i) => (
                  <tr key={i} className="border-b border-[#f0eeea] last:border-b-0 hover:bg-[#fafaf8]">
                    {(leadsSheet.headers || []).slice(0, 6).map((h, j) => (
                      <td key={j} className="px-3 py-1.5 text-terminal-text truncate max-w-[180px]">{row[h] || ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {leadsSheet.totalRows > 8 && (
              <div className="px-3 py-2 text-[11px] font-mono text-terminal-muted text-center border-t border-[#f0eeea]">
                + {leadsSheet.totalRows - 8} more rows
                <a href={leadsSheet.sheetUrl} target="_blank" rel="noopener noreferrer" className="ml-2 text-[#1e3a5f] hover:underline">Open in Sheets</a>
              </div>
            )}
          </div>
        ) : !leadsSheet?.configured ? (
          <div className="px-[18px] py-8 text-center">
            <div className="text-[13px] text-[#9a9a92] mb-2">No leads sheet linked</div>
            <div className="text-[11px] text-terminal-muted">Link a Google Sheet to track your GC leads and pipeline here.</div>
          </div>
        ) : (
          <div className="px-[18px] py-6 text-center text-[#9a9a92] text-[12px]">Sheet linked but no data found</div>
        )}
      </div>

      {/* Link Sheet Modal */}
      {showLinkModal && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center" onClick={() => setShowLinkModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-[480px] max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[#e8e6e2] flex items-center justify-between">
              <span className="text-sm font-heading font-bold text-terminal-text">Link Leads Sheet</span>
              <button onClick={() => setShowLinkModal(false)} className="text-terminal-muted hover:text-terminal-text"><X size={16} /></button>
            </div>
            <div className="p-5">
              {/* Paste URL */}
              <div className="mb-4">
                <label className="text-[11px] font-heading font-semibold text-terminal-muted uppercase tracking-[0.5px] mb-1.5 block">Paste Sheet URL or ID</label>
                <div className="flex gap-2">
                  <input
                    value={linkInput}
                    onChange={e => setLinkInput(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    className="flex-1 text-[12px] px-3 py-2 border border-[#e8e6e2] rounded-md focus:outline-none focus:border-[#1e3a5f]"
                  />
                  <button
                    onClick={() => handleLinkSheet(linkInput)}
                    disabled={!linkInput.trim() || linking}
                    className="px-4 py-2 text-[12px] font-heading font-semibold bg-[#1e3a5f] text-white rounded-md hover:bg-[#162d4a] disabled:opacity-50"
                  >
                    {linking ? '...' : 'Link'}
                  </button>
                </div>
                {linkError && <div className="text-[11px] text-red-500 mt-1">{linkError}</div>}
              </div>

              {/* Search Drive */}
              <div className="border-t border-[#e8e6e2] pt-4">
                <label className="text-[11px] font-heading font-semibold text-terminal-muted uppercase tracking-[0.5px] mb-1.5 block">Or search Google Drive</label>
                <div className="flex gap-2 mb-3">
                  <input
                    value={driveQuery}
                    onChange={e => setDriveQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && searchDrive(driveQuery)}
                    placeholder="Search for spreadsheets..."
                    className="flex-1 text-[12px] px-3 py-2 border border-[#e8e6e2] rounded-md focus:outline-none focus:border-[#1e3a5f]"
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
                        <Link2 size={12} className="text-[#1e3a5f] shrink-0" />
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

      {/* Two-column: Bid Deadlines + Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Upcoming Deadlines */}
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
            <span className="text-xs font-heading font-bold text-terminal-text tracking-[0.3px]">Bid Deadlines</span>
            <span className="text-[11px] font-mono text-terminal-muted">{upcoming.length} pending</span>
          </div>
          <div>
            {upcoming.length === 0 ? (
              <div className="px-[18px] py-8 text-center text-[#9a9a92] text-[13px]">No upcoming bid deadlines</div>
            ) : upcoming.map((bid, i) => {
              const days = Math.ceil((new Date(bid.due_date) - new Date()) / (1000 * 60 * 60 * 24));
              const urgClass = days <= 7 ? 'high' : days <= 14 ? 'medium' : 'low';
              return (
                <div key={i} className="flex items-center justify-between px-[18px] py-[9px] border-b border-[#f0eeea] last:border-b-0 text-[13px]">
                  <div className="min-w-0 flex-1">
                    <span className="text-terminal-text truncate block font-medium">{bid.project_name || bid.gc_name}</span>
                    {bid.gc_name && bid.project_name && (
                      <span className="text-[11px] text-terminal-muted">{bid.gc_name}</span>
                    )}
                  </div>
                  <span className={`text-[11px] font-mono px-2 py-0.5 rounded border ${URGENCY_BADGE[urgClass]}`}>
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
            <span className="text-xs font-heading font-bold text-terminal-text tracking-[0.3px]">Summary</span>
            <span className="text-[11px] text-terminal-muted">All time</span>
          </div>
          <div>
            {[
              { label: 'Total Bids', value: stats?.totalBidRequests || 0 },
              { label: 'Estimates', value: stats?.totalEstimates || 0 },
              { label: 'Jobs Won', value: stats?.wonJobs || 0 },
              { label: 'Jobs Lost', value: stats?.lostJobs || 0 },
              { label: 'Avg Margin', value: `${stats?.avgMargin || 0}%`, color: 'text-[#1e3a5f]' },
              { label: 'Win Rate', value: `${stats?.winRate || 0}%`, color: (stats?.winRate || 0) >= 50 ? 'text-[#1e3a5f]' : 'text-terminal-amber' },
            ].map((item, i) => (
              <div key={i} className="flex items-center justify-between px-[18px] py-[9px] border-b border-[#f0eeea] last:border-b-0 text-[13px]">
                <span className="text-[#6b6b65]">{item.label}</span>
                <span className={`font-mono font-semibold tabular-nums ${item.color || 'text-terminal-text'}`}>{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>

    {/* Document Preview Modal */}
    {docPreview && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => { if (docPreview.url) URL.revokeObjectURL(docPreview.url); setDocPreview(null); }}>
        <div className="bg-white rounded-2xl shadow-2xl w-[90vw] max-w-[900px] h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#e8e6e1] bg-[#faf9f7]">
            <div className="flex items-center gap-2.5 min-w-0">
              {docPreview.type === 'pdf' ? <FileText size={16} className="text-red-600 shrink-0" /> : <Download size={16} className="text-indigo-600 shrink-0" />}
              <div className="min-w-0">
                <h3 className="text-[14px] font-bold text-[#111110] font-heading truncate">{docPreview.title}</h3>
                <span className="text-[11px] text-[#9a9a92] uppercase">{docPreview.type === 'pdf' ? 'PDF Document' : 'Word Document'}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {docPreview.url && (
                <a
                  href={docPreview.url}
                  download={docPreview.filename || true}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold font-heading rounded-lg border border-[#e8e6e1] bg-white text-[#1e3a5f] hover:bg-[#f0f0ec] transition-colors"
                >
                  <Download size={12} /> Download
                </a>
              )}
              <button onClick={() => { if (docPreview.url) URL.revokeObjectURL(docPreview.url); setDocPreview(null); }} className="w-7 h-7 rounded-lg flex items-center justify-center text-[#9a9a92] hover:text-[#111110] hover:bg-[#f0f0ec] transition-colors">
                <X size={16} />
              </button>
            </div>
          </div>
          {/* Content */}
          <div className="flex-1 overflow-auto">
            {docPreview.loading ? (
              <div className="flex items-center justify-center h-full">
                <RotateCcw size={20} className="animate-spin text-[#1e3a5f]" />
                <span className="ml-2 text-[13px] text-[#6b6b65]">Loading document...</span>
              </div>
            ) : docPreview.error ? (
              <div className="flex items-center justify-center h-full text-[13px] text-red-500">Failed to load document</div>
            ) : (docPreview.type === 'pdf' || docPreview.type === 'docx') && docPreview.url ? (
              <iframe src={docPreview.url} className="w-full h-full border-0" title={docPreview.title} />
            ) : (
              <div className="p-6 max-w-[700px] mx-auto">
                <div className="prose prose-sm max-w-none text-[13px] leading-[1.7] text-[#333]">
                  {(docPreview.assignment?.result_summary || '').split('\n').map((line, i) => {
                    if (line.startsWith('# ')) return <h1 key={i} className="text-[18px] font-bold text-[#1e3a5f] mt-6 mb-2 font-heading">{line.slice(2)}</h1>;
                    if (line.startsWith('## ')) return <h2 key={i} className="text-[15px] font-bold text-[#1e3a5f] mt-5 mb-1.5 font-heading">{line.slice(3)}</h2>;
                    if (line.startsWith('### ')) return <h3 key={i} className="text-[13px] font-bold text-[#1e3a5f] mt-4 mb-1 font-heading">{line.slice(4)}</h3>;
                    if (line.startsWith('- ')) return <li key={i} className="ml-4 text-[12px] text-[#444] mb-0.5">{line.slice(2)}</li>;
                    if (line.startsWith('**') && line.endsWith('**')) return <p key={i} className="font-semibold text-[#1e3a5f] mt-2">{line.replace(/\*\*/g, '')}</p>;
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

    {/* Share Modal */}
    {shareModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShareModal(null)}>
        <div className="bg-white rounded-2xl shadow-2xl w-[400px] max-h-[500px] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#e8e6e1] bg-[#faf9f7]">
            <div className="flex items-center gap-2">
              <Users size={16} className="text-[#1e3a5f]" />
              <h3 className="text-[14px] font-bold text-[#111110] font-heading">Share with team</h3>
            </div>
            <button onClick={() => setShareModal(null)} className="w-7 h-7 rounded-lg flex items-center justify-center text-[#9a9a92] hover:text-[#111110] hover:bg-[#f0f0ec] transition-colors">
              <X size={16} />
            </button>
          </div>
          <div className="px-5 py-3 border-b border-[#e8e6e1]">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9a9a92]" />
              <input
                type="text"
                value={shareSearch}
                onChange={e => setShareSearch(e.target.value)}
                placeholder="Search members..."
                className="w-full pl-9 pr-3 py-2 text-[12px] bg-[#f5f5f0] border border-[#e8e6e1] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#1e3a5f] text-[#333]"
              />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-2">
            {shareUsers
              .filter(u => {
                if (!shareSearch) return true;
                const q = shareSearch.toLowerCase();
                return (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q);
              })
              .map(u => (
                <label key={u.id} className="flex items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-[#f5f5f0] cursor-pointer transition-colors">
                  <input
                    type="checkbox"
                    checked={shareSelected.includes(u.id)}
                    onChange={e => {
                      if (e.target.checked) setShareSelected(prev => [...prev, u.id]);
                      else setShareSelected(prev => prev.filter(id => id !== u.id));
                    }}
                    className="w-4 h-4 rounded border-[#d4d4cf] text-[#1e3a5f] focus:ring-[#1e3a5f]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-[#111110] truncate">{u.name || u.email}</div>
                    {u.name && <div className="text-[11px] text-[#9a9a92] truncate">{u.email}</div>}
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#f0f0ec] text-[#6b6b65] uppercase font-semibold">{u.role}</span>
                </label>
              ))}
            {shareUsers.length === 0 && (
              <div className="text-center text-[12px] text-[#9a9a92] py-6">Loading members...</div>
            )}
          </div>
          <div className="px-5 py-3 border-t border-[#e8e6e1] bg-[#faf9f7] flex items-center justify-between">
            <span className="text-[11px] text-[#9a9a92]">{shareSelected.length} selected</span>
            <button
              onClick={handleShareInternal}
              disabled={shareSelected.length === 0 || shareLoading}
              className="px-4 py-2 text-[12px] font-semibold font-heading rounded-lg bg-[#1e3a5f] text-white hover:bg-[#2a4a6f] disabled:opacity-50 transition-colors"
            >
              {shareLoading ? 'Sharing...' : 'Share'}
            </button>
          </div>
        </div>
      </div>
    )}
    {attachModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setAttachModal(null)}>
        <div className="bg-white rounded-2xl shadow-2xl w-[400px] max-h-[500px] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#e8e6e1] bg-[#faf9f7]">
            <div className="flex items-center gap-2">
              <Link2 size={16} className="text-[#1e3a5f]" />
              <h3 className="text-[14px] font-bold text-[#111110] font-heading">Attach to entity</h3>
            </div>
            <button onClick={() => setAttachModal(null)} className="w-7 h-7 rounded-lg flex items-center justify-center text-[#9a9a92] hover:text-[#111110] hover:bg-[#f0f0ec] transition-colors">
              <X size={16} />
            </button>
          </div>
          <div className="px-5 py-3 border-b border-[#e8e6e1]">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9a9a92]" />
              <input
                type="text"
                value={attachSearch}
                onChange={e => setAttachSearch(e.target.value)}
                placeholder="Search entities..."
                className="w-full pl-9 pr-3 py-2 text-[12px] bg-[#f5f5f0] border border-[#e8e6e1] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#1e3a5f] text-[#333]"
                autoFocus
              />
            </div>
          </div>
          <div className="flex gap-1 px-5 py-2 border-b border-[#e8e6e1]">
            {['all', 'company', 'site', 'project', 'person'].map(t => (
              <button
                key={t}
                onClick={() => setAttachTypeFilter(t)}
                className={`px-2 py-1 text-[10px] font-semibold rounded-md transition-colors capitalize ${
                  attachTypeFilter === t ? 'bg-[#1e3a5f] text-white' : 'bg-[#f0f0ec] text-[#6b6b65] hover:bg-[#e8e6e1]'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-2">
            {(() => {
              const currentAssignment = assignments.find(x => x.id === attachModal);
              const matchText = ((currentAssignment?.title || '') + ' ' + (currentAssignment?.description || '')).toLowerCase();
              const attachedIds = currentAssignment?.attached_entity_ids_json ? JSON.parse(currentAssignment.attached_entity_ids_json) : [];

              const filtered = attachEntities.filter(e => {
                if (attachTypeFilter !== 'all' && e.entity_type !== attachTypeFilter) return false;
                if (!attachSearch) return true;
                const q = attachSearch.toLowerCase();
                return (e.name || '').toLowerCase().includes(q) || (e.entity_type || '').toLowerCase().includes(q);
              });

              // Score entities by relevance to task title/description
              const scored = filtered.map(e => {
                const name = (e.name || '').toLowerCase();
                const words = name.split(/\s+/).filter(w => w.length > 2);
                let score = 0;
                if (matchText.includes(name)) score += 10; // full name match
                for (const w of words) {
                  if (matchText.includes(w)) score += 3; // partial word match
                }
                return { ...e, _score: score };
              });

              const recommended = scored.filter(e => e._score >= 3).sort((a, b) => b._score - a._score);
              const recommendedIds = new Set(recommended.map(e => e.id));
              const rest = scored.filter(e => !recommendedIds.has(e.id));

              const renderEntity = (e) => {
                const alreadyAttached = attachedIds.includes(e.id);
                return (
                  <button
                    key={e.id}
                    onClick={() => !alreadyAttached && handleAttachToEntity(e.id, e.name)}
                    disabled={alreadyAttached || attachLoading}
                    className={`w-full text-left flex items-center gap-3 px-2 py-2.5 rounded-lg transition-colors ${alreadyAttached ? 'opacity-50 cursor-default' : 'hover:bg-[#f5f5f0] cursor-pointer'}`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-[#f0f0ec] flex items-center justify-center text-[#6b6b65] shrink-0">
                      {e.entity_type === 'company' ? <HardHat size={14} /> : e.entity_type === 'site' ? <TrendingUp size={14} /> : e.entity_type === 'project' ? <ClipboardList size={14} /> : <UserPlus size={14} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-semibold text-[#111110] truncate">{e.name}</div>
                      <div className="text-[10px] text-[#9a9a92] capitalize">{e.entity_type}</div>
                    </div>
                    {alreadyAttached ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 font-semibold">Attached</span>
                    ) : (
                      <Link2 size={12} className="text-[#c5c5bc] shrink-0" />
                    )}
                  </button>
                );
              };

              return (
                <>
                  {recommended.length > 0 && !attachSearch && (
                    <>
                      <div className="text-[10px] font-bold text-[#1e3a5f] uppercase tracking-wider px-2 pt-1 pb-1.5">Recommended</div>
                      {recommended.map(renderEntity)}
                      {rest.length > 0 && <div className="border-t border-[#e8e6e1] my-2" />}
                      {rest.length > 0 && <div className="text-[10px] font-bold text-[#9a9a92] uppercase tracking-wider px-2 pt-1 pb-1.5">All entities</div>}
                    </>
                  )}
                  {rest.map(renderEntity)}
                  {attachSearch && filtered.length === 0 && (
                    <div className="text-center text-[12px] text-[#9a9a92] py-4">No matching entities</div>
                  )}
                  {filtered.length === 0 && !attachSearch && attachEntities.length === 0 && (
                    <div className="text-center text-[12px] text-[#9a9a92] py-6">Loading entities...</div>
                  )}
                </>
              );
            })()}
          </div>
        </div>
      </div>
    )}
  </>);
}

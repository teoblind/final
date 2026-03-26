import React, { useState, useEffect, useCallback } from 'react';
import { Calendar, CheckCircle, ClipboardList, Clock, DollarSign, HardHat, Mic, TrendingUp, UserPlus, Video, Check, X, ChevronDown, ChevronUp, Mail, FileSpreadsheet, MessageSquare, Paperclip, Pencil, RotateCcw, Save, Link2, ExternalLink, Search, Unlink } from 'lucide-react';

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
  const [processingAssignment, setProcessingAssignment] = useState(null);
  // Inline assignment chat
  const [chatOpenFor, setChatOpenFor] = useState(null);
  const [chatMessages, setChatMessages] = useState({});
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [driveQuery, setDriveQuery] = useState('');

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

  const fetchAssignments = useCallback(() => {
    setAssignmentsLoading(true);
    fetch(`${API_BASE}/v1/estimates/assignments`, { headers: getAuthHeaders() })
      .then(r => r.json())
      .then(data => setAssignments((data.assignments || []).filter(a => a.status !== 'dismissed')))
      .catch(() => {})
      .finally(() => setAssignmentsLoading(false));
  }, []);

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

  const handleDismissAssignment = useCallback(async (id) => {
    try {
      await fetch(`${API_BASE}/v1/estimates/assignments/${id}/dismiss`, { method: 'POST', headers: getAuthHeaders() });
      setAssignments(prev => prev.filter(a => a.id !== id));
    } catch {}
  }, []);

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

    // Live polling — refresh every 10 seconds
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

  return (
    <div className="p-6 lg:px-7 lg:py-6 font-body">
      {/* Top row: Bids Due + Active Jobs — inline expandable */}
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
                  <div className="text-[12px] font-medium text-terminal-text truncate">{bid.gc_name} — {bid.subject}</div>
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

      {/* Agent Assignments — top of dashboard for morning review */}
      <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden mb-5">
        <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
          <div className="flex items-center gap-2">
            <ClipboardList size={14} className="text-[#1e3a5f]" />
            <span className="text-xs font-heading font-bold text-terminal-text tracking-[0.3px]">Suggested Tasks</span>
            {assignments.filter(a => a.status === 'proposed').length > 0 && (
              <span className="text-[10px] font-mono bg-[#1e3a5f] text-white px-1.5 py-0.5 rounded-full font-semibold">
                {assignments.filter(a => a.status === 'proposed').length}
              </span>
            )}
          </div>
        </div>
        {assignments.filter(a => a.status !== 'dismissed').length === 0 ? (
          <div className="px-[18px] py-5 text-center">
            <div className="text-[12px] text-[#9a9a92] mb-1">No pending tasks</div>
            <div className="text-[11px] text-terminal-muted">Coppice generates new tasks every morning at 3 AM based on your pipeline.</div>
          </div>
        ) : (
          <div>
            {assignments.filter(a => a.status !== 'dismissed').map(a => {
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
                              return (
                                <div className="flex flex-wrap gap-1.5">
                                  {artifacts.map((art, i) => (
                                    <a
                                      key={i}
                                      href={art.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border bg-white hover:bg-blue-50 transition-colors text-[#1e3a5f] border-[#d0cec8]"
                                    >
                                      {art.type === 'sheet' ? <FileSpreadsheet size={10} /> : art.type === 'email' ? <Mail size={10} /> : <ExternalLink size={10} />}
                                      {art.title || art.type}
                                    </a>
                                  ))}
                                </div>
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
                      {a.status === 'proposed' && (
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
                            disabled={processingAssignment === a.id}
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
                      )}
                      {a.status === 'in_progress' && (
                        <span className="flex items-center gap-1 text-[11px] text-[#1e3a5f] font-medium">
                          <RotateCcw size={11} className="animate-spin" /> Working...
                        </span>
                      )}
                      {a.status === 'completed' && (
                        <span className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
                          <CheckCircle size={11} /> Done
                        </span>
                      )}
                    </div>
                  </div>
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
          </div>
        )}
      </div>

      {/* Meetings This Week — expanded */}
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
  );
}

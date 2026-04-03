import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AlertCircle, Calendar, CheckCircle, ClipboardList, Clock, DollarSign, HardHat, Mic, TrendingUp, UserPlus, Video, Check, X, XCircle, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Mail, FileSpreadsheet, MessageSquare, Paperclip, Pencil, RotateCcw, Save, Link2, ExternalLink, Search, Unlink, Share2, FileText, Download, Archive, Users, BarChart3, Activity, Volume2, Zap, Globe } from 'lucide-react';
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

// ─── Meeting Audio Player (Fireflies-style) ─────────────────────────────────
function MeetingAudioPlayer({ src }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) audioRef.current.pause(); else audioRef.current.play();
    setPlaying(!playing);
  };
  const seek = (e) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    audioRef.current.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration;
  };
  const cycleSpeed = () => {
    const speeds = [1, 1.5, 2];
    const next = speeds[(speeds.indexOf(speed) + 1) % speeds.length];
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };
  const fmt = (s) => `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;

  return (
    <div className="flex items-center gap-3">
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
        onEnded={() => setPlaying(false)}
      />
      <button onClick={toggle} className="w-9 h-9 rounded-full bg-[#7c3aed] text-white flex items-center justify-center hover:opacity-80 transition-opacity shrink-0">
        {playing ? (
          <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor"><rect x="1" y="1" width="3" height="12" rx="1"/><rect x="8" y="1" width="3" height="12" rx="1"/></svg>
        ) : (
          <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor"><path d="M1 1.5v11l10-5.5z"/></svg>
        )}
      </button>
      <div className="flex-1">
        <div className="relative h-2 bg-[#e0ddd8] rounded-full cursor-pointer group" onClick={seek}>
          <div className="absolute h-full bg-[#7c3aed] rounded-full transition-all" style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%' }} />
          <div className="absolute w-3 h-3 bg-[#7c3aed] rounded-full -top-0.5 opacity-0 group-hover:opacity-100 transition-opacity" style={{ left: duration ? `calc(${(currentTime / duration) * 100}% - 6px)` : '0' }} />
        </div>
      </div>
      <span className="text-[11px] font-mono text-[#6b6b65] tabular-nums w-24 text-right shrink-0">{fmt(currentTime)} / {fmt(duration)}</span>
      <button onClick={cycleSpeed} className="text-[11px] font-bold text-[#6b6b65] bg-[#e0ddd8] px-2 py-1 rounded-md hover:bg-[#d0cdc8] transition-colors shrink-0">{speed}x</button>
    </div>
  );
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

const SERVICE_META = {
  whisper: { name: 'Whisper', icon: Mic, desc: 'Transcription' },
  apollo: { name: 'Apollo', icon: UserPlus, desc: 'Lead Enrichment' },
  elevenlabs: { name: 'ElevenLabs', icon: Volume2, desc: 'Voice Synthesis' },
  perplexity: { name: 'Perplexity', icon: Search, desc: 'Web Research' },
  fireflies: { name: 'Fireflies', icon: Video, desc: 'Meeting Import' },
  recall: { name: 'Recall.ai', icon: Mic, desc: 'Meeting Bot' },
  apify: { name: 'LinkedIn', icon: Users, desc: 'Profile Scraping' },
};

export default function DacpCommandDashboard({ onNavigate }) {
  const [stats, setStats] = useState(null);
  const [bids, setBids] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [meetingRange, setMeetingRange] = useState('week');
  const [invitedMeetings, setInvitedMeetings] = useState(new Set());
  const [invitingId, setInvitingId] = useState(null);
  const [meetingDetail, setMeetingDetail] = useState(null); // knowledge entry detail popup
  const [meetingDetailLoading, setMeetingDetailLoading] = useState(false);
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
  const [leadsSheet, setLeadsSheet] = useState(null); // { configured, sheetId, sheetTitle, sheetUrl, headers, totalRows, preview, tabs, activeTab, page, totalPages }
  const [leadsLoading, setLeadsLoading] = useState(false);
  const [leadsPage, setLeadsPage] = useState(1);
  const [leadsActiveTab, setLeadsActiveTab] = useState(null);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [linkInput, setLinkInput] = useState('');
  const [linkError, setLinkError] = useState('');
  const [linking, setLinking] = useState(false);
  const [driveResults, setDriveResults] = useState([]);
  const [driveSearching, setDriveSearching] = useState(false);
  // Leads sharing state
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
  const [leadsTab, setLeadsTab] = useState('sheet'); // 'sheet' | 'hubspot'
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
  // Task detail popup
  const [taskDetail, setTaskDetail] = useState(null); // assignment object or null
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
  // Context sources for task detail
  const [contextEntries, setContextEntries] = useState([]);
  const [contextLoading, setContextLoading] = useState(false);
  // Team action items
  const [actionItems, setActionItems] = useState([]);
  // Usage metering
  const [usageData, setUsageData] = useState(null);
  const [quotaData, setQuotaData] = useState(null);

  // Available sender email accounts (fetched from backend)
  const [sendersList, setSendersList] = useState([]);
  useEffect(() => {
    fetch(`${API_BASE}/v1/approvals/senders`, { headers: getAuthHeaders() })
      .then(r => r.json())
      .then(d => setSendersList(d.senders || []))
      .catch(() => {});
  }, []);

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
        // Fetch pending shares
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

  const handleRewriteForSender = useCallback(async (approvalId, senderEmail, currentBody) => {
    setRewriting(true);
    const sender = sendersList.find(s => s.email === senderEmail);
    const senderName = sender?.name || senderEmail.split('@')[0];
    try {
      // Save sender to approval payload
      await fetch(`${API_BASE}/v1/approvals/${approvalId}/update-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ senderEmail, senderName }),
      });
      // Rewrite body for new sender
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
      fetchApprovals();
    } catch (err) { console.error('Rewrite failed:', err); }
    finally { setRewriting(false); }
  }, [sendersList]);

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
      // Fetch action items
      fetch(`${API_BASE}/v1/knowledge/action-items?status=all&limit=30`, { headers })
        .then(r => r.ok ? r.json() : []).then(items => setActionItems(items)).catch(() => setActionItems([]));
      // Fetch usage summary
      fetch(`${API_BASE}/v1/usage/summary`, { headers })
        .then(r => r.ok ? r.json() : null).then(data => { if (data) setUsageData(data); }).catch(() => {});
      // Fetch service quotas
      fetch(`${API_BASE}/v1/usage/quotas`, { headers })
        .then(r => r.ok ? r.json() : null).then(data => { if (data) setQuotaData(data); }).catch(() => {});
    };

    refreshDashboard();
    fetchLeadsSheet();
    fetch(`${API_BASE}/v1/hubspot/status`, { headers: getAuthHeaders() })
      .then(r => r.json()).then(d => {
        setHubspotConnected(!!d.configured);
        if (d.configured) {
          setHubspotLoading(true);
          fetch(`${API_BASE}/v1/hubspot/pipeline`, { headers: getAuthHeaders() })
            .then(r => r.json()).then(p => setHubspotPipeline(p)).catch(() => {})
            .finally(() => setHubspotLoading(false));
          // Auto-select hubspot tab if no sheet is configured
          if (!leadsSheet?.configured) setLeadsTab('hubspot');
        }
      }).catch(() => {});

    // Live polling - refresh every 10 seconds
    const poll = setInterval(refreshDashboard, 10_000);
    return () => clearInterval(poll);
  }, [meetingRange, fetchLeadsSheet, fetchAssignments]);

  // Fetch context sources when task detail opens
  useEffect(() => {
    if (!taskDetail?.id) { setContextEntries([]); return; }
    setContextLoading(true);
    fetch(`${API_BASE}/v1/estimates/assignments/${taskDetail.id}/context`, { headers: getAuthHeaders() })
      .then(r => r.json())
      .then(d => setContextEntries(d.entries || []))
      .catch(() => setContextEntries([]))
      .finally(() => setContextLoading(false));
  }, [taskDetail?.id]);

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

  const handleToggleActionItem = useCallback(async (id) => {
    const item = actionItems.find(a => a.id === id);
    if (!item) return;
    const newStatus = item.status === 'completed' ? 'open' : 'completed';
    setActionItems(prev => prev.map(a => a.id === id ? { ...a, status: newStatus } : a));
    try {
      await fetch(`${API_BASE}/v1/knowledge/action-items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch {}
  }, [actionItems]);

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

  const handleOpenMeetingDetail = async (meeting) => {
    setMeetingDetailLoading(true);
    try {
      // Search knowledge entries for a meeting matching this title
      const q = encodeURIComponent(meeting.title);
      const res = await fetch(`${API_BASE}/v1/knowledge/search?q=${q}&type=meeting`, { headers: getAuthHeaders() });
      if (res.ok) {
        const data = await res.json();
        const entries = data.results || data.entries || data || [];
        if (entries.length > 0) {
          // Fetch full detail
          const detailRes = await fetch(`${API_BASE}/v1/knowledge/entries/${entries[0].id}`, { headers: getAuthHeaders() });
          if (detailRes.ok) {
            const detail = await detailRes.json();
            setMeetingDetail({ ...detail, calendarEvent: meeting });
            setMeetingDetailLoading(false);
            return;
          }
        }
      }
      // No transcript found - show stub
      setMeetingDetail({ calendarEvent: meeting, noTranscript: true });
    } catch { setMeetingDetail(null); }
    finally { setMeetingDetailLoading(false); }
  };

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

      {/* Usage Metering Card */}
      {usageData && (() => {
        const s = usageData.summary || {};
        const budget = usageData.budget || {};
        const byDay = usageData.by_day || [];
        const byUser = [...(usageData.by_user || [])].sort((a, b) => (b.cost_cents || 0) - (a.cost_cents || 0));
        const maxDayCost = Math.max(...byDay.map(d => d.cost_cents || 0), 1);
        const totalTokens = (s.total_input_tokens || 0) + (s.total_output_tokens || 0);
        const fmtTokens = totalTokens >= 1_000_000 ? `${(totalTokens / 1_000_000).toFixed(1)}M` : totalTokens >= 1_000 ? `${(totalTokens / 1_000).toFixed(0)}K` : `${totalTokens}`;
        const monthLabel = usageData.month ? new Date(usageData.month + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '';
        const pctUsed = budget.pct_used || 0;
        const barColor = pctUsed >= 100 ? 'bg-red-500' : pctUsed >= (budget.alert_threshold_pct || 80) ? 'bg-amber-500' : 'bg-[#1e3a5f]';
        return (
          <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden mb-5">
            {/* Header */}
            <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
              <div className="flex items-center gap-2">
                <Activity size={14} className="text-[#1e3a5f]" />
                <span className="text-xs font-heading font-bold text-terminal-text tracking-[0.3px]">Usage</span>
              </div>
              <span className="text-[11px] text-terminal-muted font-mono">{monthLabel}</span>
            </div>
            <div className="px-[18px] py-4">
              {/* Main stat + sub-stats */}
              <div className="flex items-end gap-4 mb-4">
                <div className="text-[28px] font-display font-bold text-terminal-text tabular-nums leading-none">
                  ${((s.total_cost_cents || 0) / 100).toFixed(2)}
                </div>
                <div className="flex items-center gap-4 pb-1">
                  <span className="text-[11px] text-terminal-muted"><span className="font-mono tabular-nums">{s.total_requests || 0}</span> requests</span>
                  <span className="text-[11px] text-terminal-muted"><span className="font-mono tabular-nums">{s.tasks_run || 0}</span> tasks</span>
                  <span className="text-[11px] text-terminal-muted"><span className="font-mono tabular-nums">{fmtTokens}</span> tokens</span>
                </div>
              </div>
              {/* Daily sparkline */}
              {byDay.length > 0 && (
                <div className="mb-4">
                  <div className="text-[10px] font-bold text-[#9a9a92] uppercase tracking-wider mb-2">Daily Cost</div>
                  <div className="flex items-end gap-[2px] h-[40px]">
                    {byDay.map((d, i) => {
                      const h = Math.max(2, Math.round(((d.cost_cents || 0) / maxDayCost) * 36));
                      return (
                        <div
                          key={i}
                          title={`${d.day}: $${((d.cost_cents || 0) / 100).toFixed(2)} (${d.requests} req)`}
                          className="flex-1 rounded-sm bg-[#1e3a5f] hover:bg-[#2a5080] transition-colors cursor-default"
                          style={{ height: `${h}px`, minWidth: '4px', maxWidth: '20px' }}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
              {/* Per-user breakdown */}
              {byUser.length > 0 && (
                <div className="mb-4">
                  <div className="text-[10px] font-bold text-[#9a9a92] uppercase tracking-wider mb-1.5">By User</div>
                  <div className="space-y-1">
                    {byUser.map((u, i) => (
                      <div key={i} className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-terminal-text truncate max-w-[200px]">{u.user_id}</span>
                        <div className="flex items-center gap-4">
                          <span className="text-terminal-muted tabular-nums">{u.requests} req</span>
                          <span className="text-terminal-text font-semibold tabular-nums">${((u.cost_cents || 0) / 100).toFixed(2)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Budget indicator */}
              {budget.monthly_limit_cents > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-bold text-[#9a9a92] uppercase tracking-wider">Budget</span>
                    <span className="text-[10px] text-terminal-muted font-mono tabular-nums">
                      ${((s.total_cost_cents || 0) / 100).toFixed(2)} / ${(budget.monthly_limit_cents / 100).toFixed(2)}
                      {' '}({pctUsed}%)
                    </span>
                  </div>
                  <div className="w-full h-[6px] bg-[#f0eeea] rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.min(pctUsed, 100)}%` }} />
                  </div>
                  {pctUsed >= 100 && (
                    <div className="text-[10px] text-red-500 font-semibold mt-1">
                      {budget.enforce_limit ? 'Limit reached - requests blocked' : 'Over budget (soft limit)'}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Service Quotas Card */}
      {quotaData?.quotas?.length > 0 && (
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden mb-5">
          {/* Header */}
          <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
            <div className="flex items-center gap-2">
              <Zap size={14} className="text-[#1e3a5f]" />
              <span className="text-xs font-heading font-bold text-terminal-text tracking-[0.3px]">Services</span>
            </div>
            {quotaData.total_overage_cents > 0 && (
              <span className="text-[11px] font-mono font-semibold text-red-500 tabular-nums">
                Overage: ${(quotaData.total_overage_cents / 100).toFixed(2)}
              </span>
            )}
          </div>
          <div className="px-[18px] py-4">
            {/* Quota grid - 2 cols desktop, 1 col mobile */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {quotaData.quotas.map((q) => {
                const meta = SERVICE_META[q.service] || { name: q.service, icon: Globe, desc: '' };
                const Icon = meta.icon;
                const barColor = q.overage ? 'bg-purple-500'
                  : q.pct_used >= 90 ? 'bg-red-500'
                  : q.pct_used >= 70 ? 'bg-amber-500'
                  : 'bg-[#1e3a5f]';
                const barWidth = q.overage ? 100 : Math.min(q.pct_used, 100);
                return (
                  <div key={q.service} className="bg-[#faf9f7] border border-[#eae8e4] rounded-[10px] px-3.5 py-3">
                    {/* Top row: icon+name ... usage fraction */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Icon size={13} className="text-[#6b6b65]" />
                        <span className="text-[12px] font-heading font-semibold text-terminal-text">{meta.name}</span>
                      </div>
                      <span className="text-[11px] font-mono tabular-nums text-terminal-muted">
                        {q.used_this_month} / {q.monthly_allotment} {q.unit}
                      </span>
                    </div>
                    {/* Progress bar */}
                    <div className="w-full h-[6px] bg-[#e8e6e2] rounded-full overflow-hidden mb-1.5">
                      <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${barWidth}%` }} />
                    </div>
                    {/* Bottom row: overage rate or overage cost */}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-[#9a9a92]">
                        ${(q.overage_rate_cents / 100).toFixed(2)}/{q.unit === 'minutes' ? 'min' : q.unit === 'leads' ? 'lead' : q.unit} overage
                      </span>
                      {q.overage && q.overage_cost_cents > 0 && (
                        <span className="text-[10px] font-mono font-semibold text-red-500 tabular-nums">
                          +${(q.overage_cost_cents / 100).toFixed(2)} overage
                        </span>
                      )}
                      {!q.overage && (
                        <span className="text-[10px] font-mono text-[#9a9a92] tabular-nums">{q.pct_used}%</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Team Action Items + Approval Queue */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4 mb-5">
        {/* Team Action Items */}
        {(() => {
          const openCount = actionItems.filter(a => a.status !== 'completed').length;
          const ASSIGNEE_META = {
            Danny: { full: 'Danny', role: 'CEO', color: '#1e3a5f' },
            Marcel: { full: 'Marcel', role: 'COO', color: '#5b3a8c' },
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
                  <div className="py-5 text-center">
                    <Users size={24} className="mx-auto text-[#d1d1cb] mb-2" />
                    <div className="text-[12px] text-[#9a9a92] mb-1">No action items</div>
                    <div className="text-[11px] text-terminal-muted">Action items from meetings and agents will appear here.</div>
                  </div>
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
              <div className="py-5 text-center">
                <CheckCircle size={24} className="mx-auto text-[#d1d1cb] mb-2" />
                <div className="text-[12px] text-[#9a9a92] mb-1">No pending approvals</div>
                <div className="text-[11px] text-terminal-muted">Agent actions requiring your review will appear here.</div>
              </div>
            ) : approvals.map((item) => {
              const payload = item.payload || (item.payload_json ? JSON.parse(item.payload_json) : {});
              const isExpanded = expandedApproval === item.id;
              const isProcessing = processingApproval === item.id;
              // Generate description from payload if none provided
              let itemDesc = item.description || item.desc || '';
              if (!itemDesc) {
                if (item.type === 'email_draft' || payload.to) {
                  itemDesc = payload.to ? `Email to ${payload.to}` : '';
                  if (payload.subject) itemDesc += itemDesc ? ` - ${payload.subject}` : payload.subject;
                } else if (payload.subject) {
                  itemDesc = payload.subject;
                } else if (item.type === 'estimate') {
                  itemDesc = 'Estimate ready for review';
                } else if (item.type === 'report') {
                  itemDesc = 'Report ready for review';
                }
              }
              return (
                <div key={item.id} className="border-b border-[#f0eeea] last:border-b-0">
                  <div
                    className="flex items-start gap-3 px-[18px] py-3 hover:bg-[#f5f4f0] transition-colors cursor-pointer"
                    onClick={() => setExpandedApproval(isExpanded ? null : item.id)}
                  >
                    <span
                      className="w-7 h-7 rounded-[7px] flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5"
                      style={{ background: item.icon?.bg || '#f5f4f0', color: item.icon?.color || '#6b6b65' }}
                    >
                      {item.icon?.letter || 'A'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-terminal-text leading-[1.4]">{item.title}</div>
                      <div className="text-[11px] text-terminal-muted mt-0.5">{itemDesc}</div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[9px] font-heading font-bold uppercase tracking-[0.5px] px-1.5 py-[1px] rounded border bg-[#f5f4f0] text-terminal-muted border-[#e5e5e0]">{item.agentLabel || (item.agentId || 'agent').charAt(0).toUpperCase() + (item.agentId || 'agent').slice(1)}</span>
                        <span className="text-[10px] font-mono text-[#c5c5bc] tabular-nums">{item.time || (item.createdAt ? new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '')}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                      <button onClick={(e) => { e.stopPropagation(); handleApprove(item.id); }} disabled={isProcessing} className="px-2.5 py-1 rounded-md text-[10px] font-heading font-semibold bg-[var(--t-ui-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50">Approve</button>
                      <button onClick={(e) => { e.stopPropagation(); handleReject(item.id); }} disabled={isProcessing} className="px-2.5 py-1 rounded-md text-[10px] font-heading font-semibold bg-terminal-panel text-terminal-red border border-terminal-border hover:bg-red-50 transition-colors disabled:opacity-50">Reject</button>
                      {isExpanded ? <ChevronUp size={14} className="text-terminal-muted ml-1" /> : <ChevronDown size={14} className="text-terminal-muted ml-1" />}
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="px-[18px] pb-4 pt-1 space-y-3">
                      {/* Email header + body */}
                      <div className="bg-[#f9f9f7] border border-[#e8e6e2] rounded-lg overflow-hidden">
                        {(payload.to || payload.subject || item.type === 'email_draft') && (
                          <div className="px-4 py-2.5 border-b border-[#e8e6e2] bg-[#f5f4f0]">
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="text-[10px] font-heading font-semibold text-terminal-muted uppercase">Draft Preview</div>
                              <div className="flex items-center gap-1.5">
                                {savingEdit && editingApproval === item.id && <span className="text-[10px] text-terminal-muted italic">Saving...</span>}
                                <Pencil size={10} className="text-terminal-muted" />
                                <span className="text-[10px] text-terminal-muted">Click body to edit</span>
                              </div>
                            </div>
                            {/* Editable To field */}
                            <div className="flex items-center gap-2 text-[11px] text-[#6b6b65]">
                              <span className="font-medium text-terminal-text shrink-0">To:</span>
                              <input
                                type="email"
                                defaultValue={payload.to || ''}
                                placeholder="Enter recipient email..."
                                onClick={(e) => e.stopPropagation()}
                                onBlur={(e) => {
                                  const newTo = e.target.value.trim();
                                  if (newTo !== (payload.to || '')) {
                                    fetch(`${API_BASE}/v1/approvals/${item.id}/update-draft`, {
                                      method: 'POST',
                                      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ to: newTo }),
                                    }).catch(() => {});
                                  }
                                }}
                                className={`flex-1 px-2 py-0.5 rounded border bg-white text-terminal-text text-[11px] ${!payload.to ? 'border-amber-400 ring-1 ring-amber-200' : 'border-[#e8e6e2]'}`}
                              />
                              {payload.apolloContact && (
                                <span className="text-[9px] font-semibold text-green-700 bg-green-50 px-1.5 py-0.5 rounded border border-green-200">APOLLO VERIFIED</span>
                              )}
                            </div>
                            {!payload.to && (
                              <div className="text-[10px] text-amber-600 mt-1 flex items-center gap-1">
                                <AlertCircle size={10} /> No contact email found - enter manually or search Apollo
                              </div>
                            )}
                            {payload.subject && (
                              <div className="text-[11px] text-[#6b6b65] mt-1">
                                <span className="font-medium text-terminal-text">Subject:</span> {payload.subject}
                              </div>
                            )}
                            {/* Sender dropdown */}
                            <div className="flex items-center gap-2 mt-1.5">
                              <span className="text-[11px] font-medium text-terminal-text">Send from:</span>
                              <select
                                value={editSender || payload.senderEmail || ''}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  setEditSender(e.target.value);
                                  if (e.target.value) {
                                    handleRewriteForSender(item.id, e.target.value, payload.body || editBody);
                                  }
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="text-[11px] px-2 py-0.5 rounded border border-[#e8e6e2] bg-white text-terminal-text"
                              >
                                <option value="">Select sender...</option>
                                {sendersList.map(s => (
                                  <option key={s.email} value={s.email}>
                                    {s.personal ? `${s.name} (${s.email}) - Personal` : `${s.name} (${s.email})`}
                                  </option>
                                ))}
                              </select>
                              {!sendersList.some(s => s.personal) && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const token = localStorage.getItem('auth_token') || (() => { try { return JSON.parse(sessionStorage.getItem('sangha_auth'))?.tokens?.accessToken; } catch { return null; } })();
                                    if (!token) return;
                                    const scopes = 'openid,email,profile,gmail.readonly,gmail.send,gmail.compose,gmail.modify';
                                    const url = `${window.location.origin}/api/v1/auth/google/integrate?scopes=${encodeURIComponent(scopes)}&source=personal-gmail&token=${encodeURIComponent(token)}`;
                                    const popup = window.open(url, 'oauth-popup', 'width=600,height=700,scrollbars=yes');
                                    const handleMsg = (evt) => {
                                      if (evt.data?.type === 'oauth-integration-success' && evt.data?.source === 'personal-gmail') {
                                        window.removeEventListener('message', handleMsg);
                                        // Refresh senders list
                                        fetch(`${API_BASE}/v1/approvals/senders`, { headers: getAuthHeaders() })
                                          .then(r => r.json())
                                          .then(d => setSendersList(d.senders || []))
                                          .catch(() => {});
                                      }
                                    };
                                    window.addEventListener('message', handleMsg);
                                  }}
                                  className="text-[10px] px-2 py-0.5 rounded border border-dashed border-[#1e3a5f] text-[#1e3a5f] hover:bg-[#1e3a5f]/5 transition-colors"
                                >
                                  + Connect Personal Email
                                </button>
                              )}
                              {rewriting && <span className="text-[10px] text-terminal-muted italic">Rewriting...</span>}
                            </div>
                          </div>
                        )}
                        <div
                          className="p-4 text-[12px] text-terminal-text leading-relaxed cursor-text focus-within:ring-1 focus-within:ring-[#1e3a5f] focus-within:bg-white rounded-b-lg transition-colors [&_table]:w-full [&_table]:border-collapse [&_td]:p-1.5 [&_td]:text-[11px] [&_th]:p-1.5 [&_th]:text-[11px] [&_th]:text-left [&_th]:font-semibold [&_h2]:text-[13px] [&_h2]:font-bold [&_h2]:mb-2 [&_h3]:text-[12px] [&_h3]:font-semibold [&_h3]:mb-1 [&_p]:mb-2 [&_p]:text-[12px]"
                          contentEditable
                          suppressContentEditableWarning
                          onClick={(e) => e.stopPropagation()}
                          onFocus={() => {
                            if (editingApproval !== item.id) {
                              setEditBody(payload.body || '');
                              setEditingApproval(item.id);
                            }
                          }}
                          onBlur={(e) => {
                            const newText = e.target.innerText;
                            if (newText !== (payload.body || '')) {
                              setEditBody(newText);
                              // Auto-save on blur
                              setSavingEdit(true);
                              fetch(`${API_BASE}/v1/approvals/${item.id}/update-draft`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                                body: JSON.stringify({ body: newText }),
                              }).then(() => fetchApprovals()).catch(err => console.error('Auto-save failed:', err)).finally(() => setSavingEdit(false));
                            }
                            setEditingApproval(null);
                          }}
                          dangerouslySetInnerHTML={{ __html: payload.html || (payload.body ? payload.body.replace(/\n/g, '<br>') : (item.description || 'No preview available')) }}
                        />
                      </div>

                      {/* Attachments */}
                      {payload.attachments && payload.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {payload.attachments.map((att, i) => (
                            <button
                              key={i}
                              onClick={(e) => {
                                e.stopPropagation();
                                setLoadingExcel(true);
                                fetch(`${API_BASE}/v1/approvals/${item.id}/attachment/${i}`, { headers: getAuthHeaders() })
                                  .then(r => r.json())
                                  .then(data => {
                                    if (data.sheets) setExcelPreview({ approvalId: item.id, index: i, data, filename: att.filename || att.name || 'Attachment' });
                                    else setExcelPreview({ approvalId: item.id, index: i, data: null, error: data.error || 'Could not load', filename: att.filename || att.name });
                                  })
                                  .catch(() => setExcelPreview({ approvalId: item.id, index: i, data: null, error: 'Could not load file', filename: att.filename || att.name }))
                                  .finally(() => setLoadingExcel(false));
                              }}
                              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#f5f4f0] border border-[#e8e6e2] rounded-md hover:bg-[#eeedea] transition-colors cursor-pointer"
                            >
                              <FileSpreadsheet size={12} className="text-[#1a6b3c]" />
                              <span className="text-[11px] font-medium text-terminal-text">{att.filename || att.name || 'Attachment'}</span>
                              <ExternalLink size={10} className="text-terminal-muted" />
                            </button>
                          ))}
                        </div>
                      )}

                      {/* View Original RFQ */}
                      {payload.bidId && (
                        <div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
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
                        onClick={(e) => {
                          e.stopPropagation();
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
                      <div
                        className="cursor-pointer hover:bg-[#f5f4f0] -mx-1 px-1 rounded transition-colors"
                        onClick={() => setTaskDetail(a)}
                      >
                        <div className="flex items-center gap-2 mb-0.5">
                          {a.priority === 'high' && <span className="text-[10px] font-bold text-red-500">HIGH</span>}
                          <span className="text-[13px] font-medium text-terminal-text">{a.title}</span>
                          <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border font-semibold uppercase ${catColors[a.category] || catColors.admin}`}>
                            {a.category?.replace('_', ' ')}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#6b6b65] leading-relaxed">{a.description}</div>
                      </div>
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
                          {a.result_summary && (() => {
                            const isFailed = /^(Failed|Error|Execution failed|Resume failed|Could not|Failed to authenticate)/i.test(a.result_summary) || /\berror\b.*\b(401|403|500|authentication|credentials)\b/i.test(a.result_summary);
                            return (
                              <div className={`text-[11px] px-2 py-1.5 rounded leading-relaxed ${isFailed ? 'text-red-600 bg-red-50' : 'text-emerald-600 bg-emerald-50'}`}>
                                {a.result_summary.slice(0, 300)}{a.result_summary.length > 300 ? '...' : ''}
                              </div>
                            );
                          })()}
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
                                        {draft.status === 'sent' ? 'Email Sent' : draft.status === 'rejected' ? 'Email Rejected' : 'Email Draft - Awaiting Approval'}
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
                        // Check if this proposed task has a pre-loaded email draft
                        let hasPreloadedDraft = false;
                        try {
                          const preArts = JSON.parse(a.output_artifacts_json || '[]');
                          hasPreloadedDraft = preArts.some(art => art.type === 'email_draft');
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
                            {hasPreloadedDraft ? (
                              <button
                                onClick={() => setAssignments(prev => prev.map(x => x.id === a.id ? { ...x, _showDraft: !x._showDraft } : x))}
                                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-heading font-semibold bg-amber-500 text-white rounded-md hover:bg-amber-600"
                              >
                                <Mail size={11} /> Draft Email
                              </button>
                            ) : (
                              <button
                                onClick={() => handleConfirmAssignment(a.id)}
                                disabled={processingAssignment === a.id || !inputsReady}
                                title={!inputsReady ? 'Fill in required fields to confirm' : ''}
                                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-heading font-semibold bg-[#1e3a5f] text-white rounded-md hover:bg-[#162d4a] disabled:opacity-50"
                              >
                                <Check size={11} /> Run
                              </button>
                            )}
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
                          {(a.result_summary && /^(Failed|Error|Execution failed|Resume failed|Google Sheet creation hit a permissions error|Could not)/i.test(a.result_summary)) ? (
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
                              {a.cost_cents > 0 && (
                                <span className="text-[10px] text-terminal-muted font-mono tabular-nums">${(a.cost_cents / 100).toFixed(2)}</span>
                              )}
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
                  {/* Pre-loaded email draft for outreach tasks */}
                  {a._showDraft && a.status === 'proposed' && (() => {
                    try {
                      const preArts = JSON.parse(a.output_artifacts_json || '[]');
                      const drafts = preArts.filter(art => art.type === 'email_draft');
                      if (drafts.length === 0) return null;
                      return drafts.map((draft, di) => (
                        <div key={`pre-draft-${di}`} className="mx-[18px] mb-3 border border-amber-200 bg-amber-50 rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <Mail size={12} className="text-amber-600" />
                            <span className="text-[11px] font-semibold text-amber-800">
                              {draft.status === 'sent' ? 'Email Sent' : draft.status === 'rejected' ? 'Email Rejected' : 'Email Draft - Review & Send'}
                            </span>
                          </div>
                          <div className="space-y-1.5 mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-semibold text-amber-700 w-12">To:</span>
                              <input type="text" defaultValue={draft.to} className="flex-1 text-[11px] px-2 py-1 border border-amber-200 rounded bg-white focus:outline-none focus:border-amber-400"
                                onChange={e => {
                                  const arts = JSON.parse(a.output_artifacts_json || '[]');
                                  const d = arts.find(ar => ar.type === 'email_draft' && ar.index === draft.index);
                                  if (d) d.to = e.target.value;
                                  setAssignments(prev => prev.map(x => x.id === a.id ? { ...x, output_artifacts_json: JSON.stringify(arts) } : x));
                                }} />
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] font-semibold text-amber-700 w-12">Subject:</span>
                              <input type="text" defaultValue={draft.subject} className="flex-1 text-[11px] px-2 py-1 border border-amber-200 rounded bg-white focus:outline-none focus:border-amber-400"
                                onChange={e => {
                                  const arts = JSON.parse(a.output_artifacts_json || '[]');
                                  const d = arts.find(ar => ar.type === 'email_draft' && ar.index === draft.index);
                                  if (d) d.subject = e.target.value;
                                  setAssignments(prev => prev.map(x => x.id === a.id ? { ...x, output_artifacts_json: JSON.stringify(arts) } : x));
                                }} />
                            </div>
                          </div>
                          <div className="text-[11px] text-[#4a4a42] bg-white rounded border border-amber-100 p-2.5 mb-2.5 max-h-[200px] overflow-y-auto [&_p]:mb-2 [&_p:last-child]:mb-0" contentEditable suppressContentEditableWarning
                            dangerouslySetInnerHTML={{ __html: draft.body }}
                            onBlur={e => {
                              const arts = JSON.parse(a.output_artifacts_json || '[]');
                              const d = arts.find(ar => ar.type === 'email_draft' && ar.index === draft.index);
                              if (d) d.body = e.target.innerHTML;
                              setAssignments(prev => prev.map(x => x.id === a.id ? { ...x, output_artifacts_json: JSON.stringify(arts) } : x));
                            }} />
                          {draft.status === 'pending_approval' && (
                            <div className="flex gap-2">
                              <button
                                onClick={async () => {
                                  // Save updated artifacts to backend first, then approve
                                  try {
                                    await fetch(`${API_BASE}/v1/estimates/assignments/${a.id}`, {
                                      method: 'PATCH',
                                      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
                                      body: JSON.stringify({ output_artifacts_json: a.output_artifacts_json, status: 'completed' }),
                                    });
                                    if (!window.confirm(`Send email to ${draft.to}?`)) return;
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
                                        return { ...x, status: 'completed', output_artifacts_json: JSON.stringify(arts), _showDraft: false };
                                      }));
                                    }
                                  } catch (err) { console.error('Send failed:', err); }
                                }}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold px-4 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 text-white transition-colors"
                              >
                                <Check size={11} /> Approve & Send
                              </button>
                              <button
                                onClick={() => setAssignments(prev => prev.map(x => x.id === a.id ? { ...x, _showDraft: false } : x))}
                                className="inline-flex items-center gap-1 text-[11px] font-medium px-3 py-1.5 rounded-lg bg-white hover:bg-gray-50 text-terminal-muted border border-[#e8e6e1] transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          )}
                          {draft.status === 'sent' && (
                            <div className="text-[10px] text-green-600 font-medium"><Check size={10} className="inline" /> Sent {draft.sent_at ? `at ${new Date(draft.sent_at).toLocaleString()}` : ''}</div>
                          )}
                        </div>
                      ));
                    } catch { return null; }
                  })()}
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
                <div key={m.id} onClick={() => isPast && handleOpenMeetingDetail(m)} className={`flex items-center gap-4 px-[18px] py-3 border-b border-[#f0eeea] last:border-b-0 hover:bg-[#f9f9f7] transition-colors ${isPast ? 'cursor-pointer' : ''}`}>
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

      {/* Leads Pipeline */}
      <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden mb-5">
        <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
          <div className="flex items-center gap-2">
            <FileSpreadsheet size={14} className="text-[#1e3a5f]" />
            <span className="text-xs font-heading font-bold text-terminal-text tracking-[0.3px]">Leads Pipeline</span>
          </div>
          <div className="flex items-center gap-2">
            {/* Active tab external link - comes first */}
            {leadsTab === 'hubspot' && hubspotConnected && (
              <a href="https://app.hubspot.com" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] text-[#ff7a59] hover:underline">
                <ExternalLink size={10} /> HubSpot
              </a>
            )}
            {leadsTab === 'sheet' && leadsSheet?.configured && (
              <a href={leadsSheet.sheetUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-[11px] text-[#1e3a5f] hover:underline">
                <ExternalLink size={10} /> {leadsSheet.sheetTitle}
              </a>
            )}
            {/* Source tabs */}
            {(leadsSheet?.configured || hubspotConnected) && (
              <div className="flex rounded-lg border border-[#e0ddd8] overflow-hidden">
                {leadsSheet?.configured && (
                  <button onClick={() => setLeadsTab('sheet')}
                    className={`px-2.5 py-1 text-[10px] font-heading font-semibold transition-colors ${leadsTab === 'sheet' ? 'bg-[#1e3a5f] text-white' : 'bg-white text-[#6b6b65] hover:bg-[#f5f4f0]'}`}>
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
            {/* Tab-specific action buttons */}
            {leadsTab === 'sheet' && leadsSheet?.configured && (
              <>
                <button onClick={handleOpenShareModal}
                  className="flex items-center gap-1 text-[10px] text-terminal-muted hover:text-[#1e3a5f] px-1.5 py-0.5 rounded border border-[#e8e6e2] hover:bg-[#eef3f8]"
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
            {/* Link buttons for unconnected sources */}
            {!leadsSheet?.configured && (
              <button onClick={() => { setShowLinkModal(true); searchDrive('leads'); }}
                className="flex items-center gap-1.5 text-[11px] font-heading font-semibold text-[#1e3a5f] px-3 py-1 rounded-md border border-[#c8d8e8] bg-[#eef3f8] hover:bg-[#dde8f2]">
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
              <div key={share.id} className="flex items-center justify-between px-3 py-2 bg-[#eef3f8] border border-[#c8d8e8] rounded-lg">
                <div className="flex items-center gap-2 min-w-0">
                  <Share2 size={12} className="text-[#1e3a5f] shrink-0" />
                  <span className="text-[11px] text-[#1e3a5f] truncate">
                    <strong>{share.from_user_name || 'A teammate'}</strong> shared "{share.sheet_title}" - Add to your pipeline?
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-2">
                  <button onClick={() => handleAcceptShare(share.id)} disabled={acceptingShare === share.id}
                    className="px-2.5 py-1 text-[10px] font-semibold bg-[#1e3a5f] text-white rounded-md hover:bg-[#162d4a] disabled:opacity-50">
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
              {/* Sheet tabs */}
              {leadsSheet.tabs?.length > 1 && (
                <div className="px-3 pt-2 pb-1 flex items-center gap-1 border-b border-[#f0eeea] overflow-x-auto">
                  {leadsSheet.tabs.map((tab) => (
                    <button key={tab} onClick={() => { setLeadsPage(1); fetchLeadsSheet(tab, 1); }}
                      className={`px-2.5 py-1 text-[10px] font-heading font-semibold rounded-t whitespace-nowrap transition-colors ${
                        tab === leadsSheet.activeTab
                          ? 'bg-[#1e3a5f] text-white'
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
              {/* Pagination */}
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
              <div className="text-[11px] text-terminal-muted">Link a Google Sheet to track your GC leads and pipeline here.</div>
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
                      // Fetch pipeline data
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

    {/* Task Detail Modal */}
    {taskDetail && (() => {
      const a = taskDetail;
      const catColors = {
        follow_up: 'bg-blue-50 text-blue-600 border-blue-200',
        estimate: 'bg-emerald-50 text-emerald-600 border-emerald-200',
        outreach: 'bg-purple-50 text-purple-600 border-purple-200',
        admin: 'bg-gray-50 text-gray-600 border-gray-200',
        research: 'bg-amber-50 text-amber-600 border-amber-200',
        analysis: 'bg-indigo-50 text-indigo-600 border-indigo-200',
        document: 'bg-rose-50 text-rose-600 border-rose-200',
      };
      let sources = [];
      try { sources = JSON.parse(a.context_json || '[]'); } catch {}
      let artifacts = [];
      try { artifacts = JSON.parse(a.output_artifacts_json || '[]'); } catch {}
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setTaskDetail(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[560px] max-h-[80vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="px-5 py-4 border-b border-[#e8e6e1] bg-[#faf9f7]">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0 pr-4">
                  <div className="flex items-center gap-2 mb-1">
                    {a.priority === 'high' && <span className="text-[10px] font-bold text-red-500 bg-red-50 px-1.5 py-0.5 rounded">HIGH</span>}
                    {a.priority === 'medium' && <span className="text-[10px] font-bold text-amber-500 bg-amber-50 px-1.5 py-0.5 rounded">MED</span>}
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border font-semibold uppercase ${catColors[a.category] || catColors.admin}`}>
                      {a.category?.replace('_', ' ')}
                    </span>
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border font-semibold ${
                      a.status === 'proposed' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
                      a.status === 'in_progress' || a.status === 'confirmed' ? 'bg-blue-50 text-blue-600 border-blue-200' :
                      a.status === 'completed' ? 'bg-emerald-50 text-emerald-600 border-emerald-200' :
                      'bg-gray-50 text-gray-600 border-gray-200'
                    }`}>{a.status?.replace('_', ' ')}</span>
                    {a.status === 'completed' && a.cost_cents > 0 && (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-gray-50 text-gray-500 border border-gray-200 tabular-nums">${(a.cost_cents / 100).toFixed(2)}</span>
                    )}
                  </div>
                  <h3 className="text-[15px] font-bold text-[#111110] font-heading leading-snug">{a.title}</h3>
                </div>
                <button onClick={() => setTaskDetail(null)} className="w-7 h-7 rounded-lg flex items-center justify-center text-[#9a9a92] hover:text-[#111110] hover:bg-[#f0f0ec] transition-colors shrink-0">
                  <X size={16} />
                </button>
              </div>
            </div>
            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {/* Description */}
              <div>
                <div className="text-[10px] font-bold text-[#9a9a92] uppercase tracking-wider mb-1">Description</div>
                <div className="text-[13px] text-[#333] leading-relaxed">{a.description}</div>
              </div>
              {/* Action Prompt (what the agent will do) */}
              {a.action_prompt && (
                <div>
                  <div className="text-[10px] font-bold text-[#9a9a92] uppercase tracking-wider mb-1">Execution Plan</div>
                  <div className="text-[12px] text-[#555] leading-relaxed bg-[#f5f4f0] rounded-lg px-3 py-2.5 whitespace-pre-wrap">{a.action_prompt}</div>
                </div>
              )}
              {/* Expected Output (for proposed/active tasks - detect from action_prompt) */}
              {a.status !== 'completed' && a.action_prompt && (() => {
                const prompt = (a.action_prompt || '').toLowerCase();
                const outputs = [];
                // Only match explicit output verbs - "create a PDF", "produce a PDF", "generate a PDF", "as a PDF", "save as PDF"
                if (/\b(create|produce|generate|export|save|deliver)\b.{0,20}\bpdf\b/.test(prompt) || /\bas a pdf\b/.test(prompt))
                  outputs.push({ icon: <FileText size={14} className="text-red-500" />, label: 'PDF Document', bg: 'bg-red-50 border-red-200' });
                if (/\b(create|produce|generate|save)\b.{0,20}\bgoogle doc\b/.test(prompt) || /\bas a google doc\b/.test(prompt) || /\bsave the google doc\b/.test(prompt))
                  outputs.push({ icon: <FileText size={14} className="text-blue-500" />, label: 'Google Doc', bg: 'bg-blue-50 border-blue-200' });
                if (/\b(create|produce|generate|build)\b.{0,20}\b(spreadsheet|google sheet|excel)\b/.test(prompt) || /\bas a (spreadsheet|csv|excel)\b/.test(prompt))
                  outputs.push({ icon: <FileSpreadsheet size={14} className="text-green-600" />, label: 'Spreadsheet', bg: 'bg-green-50 border-green-200' });
                if (/\b(draft|compose|write)\b.{0,20}\b(email|e-mail)\b/.test(prompt) || /\bdraft the.{0,30}email\b/.test(prompt))
                  outputs.push({ icon: <Mail size={14} className="text-amber-500" />, label: 'Email Draft', bg: 'bg-amber-50 border-amber-200' });
                if (/\b(create|produce|generate|build)\b.{0,20}\b(presentation|deck|slides)\b/.test(prompt))
                  outputs.push({ icon: <ExternalLink size={14} className="text-purple-500" />, label: 'Presentation', bg: 'bg-purple-50 border-purple-200' });
                if (outputs.length === 0 && /\b(create|produce|generate|write)\b.{0,20}\b(report|analysis|one-pager|memo)\b/.test(prompt))
                  outputs.push({ icon: <FileText size={14} className="text-indigo-500" />, label: 'Report', bg: 'bg-indigo-50 border-indigo-200' });
                if (outputs.length === 0) return null;
                return (
                  <div>
                    <div className="text-[10px] font-bold text-[#9a9a92] uppercase tracking-wider mb-1.5">Expected Output</div>
                    <div className="flex flex-wrap gap-2">
                      {outputs.map((o, i) => (
                        <div key={i} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${o.bg} text-[12px] font-medium text-[#333]`}>
                          {o.icon}
                          <span>{o.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
              {/* Sources / Context */}
              {sources.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold text-[#9a9a92] uppercase tracking-wider mb-1">Data Sources</div>
                  <div className="space-y-1">
                    {sources.map((s, i) => (
                      <div key={i} className="flex items-center gap-2 text-[12px] text-[#555]">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#1e3a5f] shrink-0" />
                        <span>{s.name || s.type || JSON.stringify(s)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Context Sources (knowledge entries) */}
              {contextLoading && (
                <div className="flex items-center gap-2 text-[11px] text-[#9a9a92]">
                  <RotateCcw size={12} className="animate-spin" /> Loading context sources...
                </div>
              )}
              {!contextLoading && contextEntries.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold text-[#9a9a92] uppercase tracking-wider mb-2">Context Sources</div>
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {contextEntries.map(entry => {
                      const typeColors = {
                        email: 'bg-amber-50 text-amber-700',
                        document: 'bg-blue-50 text-blue-700',
                        'meeting-transcript': 'bg-purple-50 text-purple-700',
                        note: 'bg-green-50 text-green-700',
                      };
                      const typeIcons = { email: Mail, document: FileText, 'meeting-transcript': Mic, note: ClipboardList };
                      const TypeIcon = typeIcons[entry.type] || FileText;
                      return (
                        <div key={entry.id} className="bg-[#f9f8f5] border border-[#e8e6e1] rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-1">
                            <TypeIcon size={12} className="text-[#6b6b65] shrink-0" />
                            <span className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded ${typeColors[entry.type] || 'bg-[#e8e6e1] text-[#6b6b65]'}`}>{entry.type?.replace('-', ' ')}</span>
                            <span className="text-[11px] font-semibold text-[#111110] truncate flex-1">{entry.title}</span>
                          </div>
                          {entry.summary && (
                            <div className="text-[10px] text-[#6b6b65] line-clamp-2 mt-1">{entry.summary}</div>
                          )}
                          {!entry.summary && entry.content_preview && (
                            <div className="text-[10px] text-[#6b6b65] line-clamp-2 mt-1">{entry.content_preview.slice(0, 200)}</div>
                          )}
                          <div className="text-[9px] text-[#9a9a92] mt-1.5 flex items-center gap-2">
                            {entry.source && <span>{entry.source}</span>}
                            {entry.source && entry.recorded_at && <span>-</span>}
                            {entry.recorded_at && <span>{new Date(entry.recorded_at).toLocaleDateString()}</span>}
                            {entry.source_agent && <span className="ml-auto opacity-60">via {entry.source_agent}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* Result (if completed) */}
              {a.result_summary && (() => {
                const isFailed = /^(Failed|Error|Execution failed|Resume failed|Could not|Failed to authenticate)/i.test(a.result_summary) || /\berror\b.*\b(401|403|500|authentication|credentials)\b/i.test(a.result_summary);
                return (
                  <div>
                    <div className="text-[10px] font-bold text-[#9a9a92] uppercase tracking-wider mb-1">Result</div>
                    <div className={`text-[12px] leading-relaxed rounded-lg px-3 py-2.5 whitespace-pre-wrap ${isFailed ? 'text-red-600 bg-red-50' : 'text-[#333] bg-emerald-50'}`}>{a.result_summary}</div>
                  </div>
                );
              })()}
              {/* Artifacts */}
              {artifacts.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold text-[#9a9a92] uppercase tracking-wider mb-1">Deliverables</div>
                  <div className="space-y-1.5">
                    {artifacts.map((art, i) => {
                      const href = art.url || (art.path ? `${API_BASE}${art.path}` : '#');
                      return (
                        <a key={i} href={href} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#e8e6e1] hover:bg-[#f5f4f0] transition-colors text-[12px] text-[#1e3a5f] font-medium">
                          <ExternalLink size={12} className="shrink-0" />
                          <span className="truncate">{art.label || art.filename || art.type}</span>
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}
              {/* Metadata */}
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-[#9a9a92] pt-2 border-t border-[#f0eeea]">
                {a.created_at && <span>Created: {new Date(a.created_at).toLocaleDateString()}</span>}
                {a.confirmed_at && <span>Started: {new Date(a.confirmed_at).toLocaleDateString()}</span>}
                {a.completed_at && <span>Completed: {new Date(a.completed_at).toLocaleDateString()}</span>}
                {a.agent_id && <span>Agent: {a.agent_id}</span>}
                {a.cost_cents > 0 && <span>Cost: ${(a.cost_cents / 100).toFixed(2)}</span>}
              </div>
            </div>
            {/* Footer actions */}
            <div className="px-5 py-3 border-t border-[#e8e6e1] bg-[#faf9f7] flex items-center justify-between">
              <div className="text-[10px] text-[#9a9a92] font-mono">{a.id}</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => { localStorage.setItem('coppice_chat_prefill', `Let's discuss this task: "${a.title}"\n\nDescription: ${a.description}\n${a.action_prompt ? `\nExecution plan: ${a.action_prompt.slice(0, 500)}` : ''}`); window.location.hash = 'hivemind-chat'; setTaskDetail(null); }}
                  className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-heading font-semibold bg-[#f0f0ec] text-[#6b6b65] rounded-md hover:bg-[#e8e6e1] hover:text-[#1e3a5f] transition-colors"
                ><MessageSquare size={11} /> Chat</button>
                {a.status === 'proposed' && (
                  <>
                    <button
                      onClick={() => { handleDismissAssignment(a.id); setTaskDetail(null); }}
                      className="px-3 py-1.5 text-[11px] font-heading font-semibold text-[#9a9a92] hover:text-red-500 rounded-md hover:bg-red-50 transition-colors"
                    >Dismiss</button>
                    <button
                      onClick={() => { handleConfirmAssignment(a.id); setTaskDetail(null); }}
                      disabled={processingAssignment === a.id}
                      className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-heading font-semibold bg-[#1e3a5f] text-white rounded-md hover:bg-[#162d4a] disabled:opacity-50"
                    ><Check size={11} /> Run Task</button>
                  </>
                )}
                {a.status === 'completed' && a.thread_id && (
                  <button
                    onClick={() => { localStorage.setItem('open_thread_id', a.thread_id); window.location.hash = 'hivemind-chat'; setTaskDetail(null); }}
                    className="flex items-center gap-1 px-3 py-1.5 text-[11px] font-heading font-semibold bg-[#1e3a5f] text-white rounded-md hover:bg-[#162d4a]"
                  ><MessageSquare size={11} /> View Thread</button>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    })()}

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

    {/* Meeting Detail Modal - Fireflies-style split panel */}
    {meetingDetail && (() => {
      const SPKR_COLORS = ['#1a6b3c', '#2563eb', '#7c3aed', '#b8860b', '#c0392b', '#0891b2'];
      const SPKR_BG = ['#edf7f0', '#eff6ff', '#f5f0ff', '#fdf6e8', '#fef2f2', '#ecfeff'];
      const SEC_STYLES = {
        'summary': { border: '#1a6b3c', bg: '#edf7f0', label: '#1a6b3c' },
        'key points': { border: '#2563eb', bg: '#eff6ff', label: '#2563eb' },
        'action items': { border: '#7c3aed', bg: '#f5f0ff', label: '#7c3aed' },
        'decisions made': { border: '#b8860b', bg: '#fdf6e8', label: '#b8860b' },
      };
      let utterances = [];
      try { utterances = meetingDetail.transcript_json ? (typeof meetingDetail.transcript_json === 'string' ? JSON.parse(meetingDetail.transcript_json) : meetingDetail.transcript_json) : []; } catch { utterances = []; }
      const speakers = [...new Set(utterances.map(u => u.speaker))].filter(Boolean);
      const spkrIdx = {}; speakers.forEach((s, i) => { spkrIdx[s] = i; });
      const hasDiarized = utterances.length > 0;
      const hasAudio = !!meetingDetail.audio_url;
      const fmtTime = (s) => { const m = Math.floor(s / 60); const sec = Math.floor(s % 60); return `${m}:${sec.toString().padStart(2, '0')}`; };

      // Parse summary into sections
      const parseSummary = (text) => {
        if (!text) return [];
        const sections = []; const lines = text.split('\n'); let cur = null;
        for (const line of lines) {
          const hm = line.match(/^##\s+(.+)/);
          if (hm) { if (cur) sections.push(cur); cur = { title: hm[1].trim(), lines: [] }; }
          else if (cur && line.trim()) cur.lines.push(line);
        }
        if (cur) sections.push(cur);
        return sections;
      };
      const summarySections = parseSummary(meetingDetail.summary || meetingDetail.content);

      return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setMeetingDetail(null)}>
        <div className={`bg-white rounded-2xl shadow-2xl ${hasDiarized ? 'w-[1100px]' : 'w-[700px]'} max-h-[90vh] flex flex-col overflow-hidden`} onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="px-6 py-4 border-b border-[#e8e6e1] bg-[#faf9f7]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-[#f0edf7] flex items-center justify-center">
                  <Mic size={16} className="text-[#7c3aed]" />
                </div>
                <div>
                  <h3 className="text-[15px] font-bold text-[#111110] font-heading">{meetingDetail.title || meetingDetail.calendarEvent?.title || 'Meeting'}</h3>
                  <div className="flex items-center gap-3 mt-0.5">
                    {(meetingDetail.recorded_at || meetingDetail.calendarEvent?.start) && (
                      <span className="text-[11px] text-[#9a9a92]">{new Date(meetingDetail.recorded_at || meetingDetail.calendarEvent?.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                    )}
                    {meetingDetail.duration_seconds && (
                      <span className="text-[11px] text-[#9a9a92]">{Math.round(meetingDetail.duration_seconds / 60)} min</span>
                    )}
                    {meetingDetail.source && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#f0edf7] text-[#7c3aed] font-semibold">{meetingDetail.source === 'local-capture' ? 'Desktop App' : meetingDetail.source === 'calendar-poll' ? 'Coppice Bot' : meetingDetail.source}</span>
                    )}
                    {speakers.length > 0 && (
                      <span className="text-[11px] text-[#9a9a92]">+{speakers.length} speakers</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {hasAudio && (
                  <a href={`${API_BASE}${meetingDetail.audio_url}`} download className="w-8 h-8 rounded-lg flex items-center justify-center text-[#9a9a92] hover:text-[#111110] hover:bg-[#f0f0ec] transition-colors" title="Download audio">
                    <Download size={16} />
                  </a>
                )}
                {meetingDetail.drive_url && (
                  <a href={meetingDetail.drive_url} target="_blank" rel="noopener noreferrer" className="w-8 h-8 rounded-lg flex items-center justify-center text-[#9a9a92] hover:text-[#111110] hover:bg-[#f0f0ec] transition-colors" title="Open in Drive">
                    <ExternalLink size={16} />
                  </a>
                )}
                <button onClick={() => setMeetingDetail(null)} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#9a9a92] hover:text-[#111110] hover:bg-[#f0f0ec] transition-colors">
                  <X size={18} />
                </button>
              </div>
            </div>
          </div>

          {meetingDetail.noTranscript ? (
            <div className="px-6 py-12 text-center">
              <Mic size={32} className="mx-auto mb-3 text-[#d4d4cf]" />
              <p className="text-[14px] font-semibold text-[#333] mb-1">No transcript available</p>
              <p className="text-[12px] text-[#9a9a92]">Invite Coppice to future meetings or use the desktop app to record and transcribe automatically.</p>
            </div>
          ) : (
            <>
              {/* Split body */}
              <div className={`flex-1 overflow-hidden flex ${hasDiarized ? '' : 'flex-col'}`}>
                {/* Left: Summary + Action Items */}
                <div className={`${hasDiarized ? 'w-[55%] border-r border-[#e8e6e1]' : 'w-full'} overflow-y-auto`}>
                  <div className="p-5 space-y-4">
                    {/* Structured summary sections */}
                    {summarySections.length > 0 ? (
                      <div className="space-y-3">
                        {summarySections.map((section, i) => {
                          const key = section.title.toLowerCase();
                          const styles = SEC_STYLES[key] || { border: '#9a9a92', bg: '#f5f4f0', label: '#6b6b65' };
                          return (
                            <div key={i} className="rounded-[10px] p-[14px_16px] border-l-[3px]" style={{ borderLeftColor: styles.border, background: styles.bg }}>
                              <div className="text-[10px] font-bold tracking-[0.8px] uppercase mb-2 font-heading" style={{ color: styles.label }}>{section.title}</div>
                              <div className="space-y-1.5">
                                {section.lines.map((line, j) => {
                                  const trimmed = line.replace(/^[-*]\s*/, '').replace(/^- \[ \]\s*/, '').trim();
                                  if (!trimmed) return null;
                                  const isBullet = /^[-*]\s/.test(line.trim()) || /^- \[/.test(line.trim());
                                  const parts = trimmed.split(/(\*\*[^*]+\*\*)/);
                                  return (
                                    <div key={j} className="flex items-start gap-2 text-[13px] leading-relaxed">
                                      {isBullet && <div className="w-[3px] h-[3px] rounded-full shrink-0 mt-[8px]" style={{ background: styles.border }} />}
                                      <div className="text-[#333]">
                                        {parts.map((part, k) =>
                                          part.startsWith('**') && part.endsWith('**')
                                            ? <span key={k} className="font-semibold">{part.slice(2, -2)}</span>
                                            : <span key={k}>{part}</span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : meetingDetail.summary ? (
                      <div className="bg-[#f5f4f0] rounded-[10px] p-[14px_16px] border-l-[3px] border-l-[#1a6b3c]">
                        <div className="text-[10px] font-bold text-[#1a6b3c] tracking-[0.8px] uppercase mb-1.5 font-heading">AI Summary</div>
                        <div className="text-[13px] text-[#333] leading-relaxed whitespace-pre-wrap">{meetingDetail.summary}</div>
                      </div>
                    ) : null}

                    {/* Action Items */}
                    {meetingDetail.action_items?.length > 0 && (
                      <div>
                        <h4 className="text-[11px] font-bold font-heading text-[#6b6b65] uppercase tracking-[0.8px] mb-2">Action Items</h4>
                        <div className="space-y-1.5">
                          {meetingDetail.action_items.map((item, i) => (
                            <div key={i} className="flex items-start gap-2">
                              <div className={`w-4 h-4 mt-0.5 rounded border flex items-center justify-center shrink-0 ${item.status === 'done' ? 'bg-[#1a6b3c] border-[#1a6b3c]' : 'border-[#d4d4cf]'}`}>
                                {item.status === 'done' && <Check size={10} className="text-white" />}
                              </div>
                              <div>
                                <span className="text-[12px] text-[#333]">{item.title || item.description}</span>
                                {item.assignee && <span className="text-[10px] text-[#9a9a92] ml-2">@{item.assignee}</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Entities */}
                    {meetingDetail.entities?.length > 0 && (
                      <div>
                        <h4 className="text-[11px] font-bold font-heading text-[#6b6b65] uppercase tracking-[0.8px] mb-2">People & Companies</h4>
                        <div className="flex flex-wrap gap-1.5">
                          {meetingDetail.entities.map((e, i) => (
                            <span key={i} className="px-2 py-1 rounded-lg bg-[#f5f4f0] text-[11px] text-[#444] font-medium">{e.name}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Plain transcript fallback (no diarized JSON) */}
                    {!hasDiarized && (meetingDetail.transcript || meetingDetail.content) && (
                      <div>
                        <h4 className="text-[11px] font-bold font-heading text-[#6b6b65] uppercase tracking-[0.8px] mb-2">Transcript</h4>
                        <div className="bg-[#f9f9f7] rounded-lg p-4 max-h-[300px] overflow-y-auto">
                          <pre className="text-[12px] text-[#444] leading-[1.8] whitespace-pre-wrap font-mono">{meetingDetail.transcript || meetingDetail.content}</pre>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: Diarized transcript panel */}
                {hasDiarized && (
                  <div className="w-[45%] flex flex-col overflow-hidden">
                    {/* Speaker legend */}
                    <div className="px-4 py-3 border-b border-[#f0eeea] bg-[#faf9f7]">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-bold text-[#6b6b65] tracking-[0.8px] uppercase font-heading">Transcript</span>
                        <span className="text-[10px] text-[#9a9a92]">{utterances.length} segments</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {speakers.map((s, i) => (
                          <span key={s} className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md" style={{ background: SPKR_BG[i % SPKR_BG.length], color: SPKR_COLORS[i % SPKR_COLORS.length] }}>
                            <span className="w-2 h-2 rounded-full" style={{ background: SPKR_COLORS[i % SPKR_COLORS.length] }} />
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                    {/* Scrollable utterances */}
                    <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1">
                      {utterances.map((u, i) => {
                        const idx = spkrIdx[u.speaker] ?? speakers.length;
                        const color = SPKR_COLORS[idx % SPKR_COLORS.length];
                        return (
                          <div key={i} className="flex gap-3 py-2 px-2 rounded-lg hover:bg-[#fafaf8] transition-colors" style={{ borderLeft: `3px solid transparent` }}>
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 mt-0.5" style={{ background: color }}>
                              {(u.speaker || '?').split(/\s+/).map(w => w[0]?.toUpperCase()).join('').slice(0, 2)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="text-[11px] font-bold" style={{ color }}>{u.speaker}</span>
                                <span className="text-[10px] font-mono text-[#9a9a92]">{fmtTime(u.start)}</span>
                              </div>
                              <div className="text-[13px] text-[#333] leading-relaxed">{u.text}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Audio player bar */}
              {hasAudio && (() => {
                const audioSrc = `${API_BASE}${meetingDetail.audio_url}`;
                return (
                  <div className="border-t border-[#e8e6e1] bg-[#faf9f7] px-5 py-3">
                    <MeetingAudioPlayer src={audioSrc} />
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </div>
      );
    })()}

    {/* Leads Share Modal */}
    {showShareModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowShareModal(false)}>
        <div className="bg-white rounded-2xl shadow-2xl w-[400px] max-h-[500px] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#e8e6e1] bg-[#faf9f7]">
            <div className="flex items-center gap-2">
              <Share2 size={16} className="text-[#1e3a5f]" />
              <h3 className="text-[14px] font-bold text-[#111110] font-heading">Share leads sheet</h3>
            </div>
            <button onClick={() => setShowShareModal(false)} className="w-7 h-7 rounded-lg flex items-center justify-center text-[#9a9a92] hover:text-[#111110] hover:bg-[#f0f0ec] transition-colors">
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-3">
            {shareTeam.length === 0 && (
              <div className="text-center text-[12px] text-[#9a9a92] py-6">Loading team members...</div>
            )}
            {shareTeam.map(u => (
              <label key={u.id} className="flex items-center gap-3 px-2 py-2.5 rounded-lg hover:bg-[#f5f5f0] cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={leadsShareSelected.includes(u.id)}
                  onChange={e => {
                    if (e.target.checked) setLeadsShareSelected(prev => [...prev, u.id]);
                    else setLeadsShareSelected(prev => prev.filter(id => id !== u.id));
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
          </div>
          <div className="px-5 py-3 border-t border-[#e8e6e1] bg-[#faf9f7] flex items-center justify-between">
            <span className="text-[11px] text-[#9a9a92]">{leadsShareSelected.length} selected</span>
            <button
              onClick={handleShareSheet}
              disabled={leadsShareSelected.length === 0 || leadsShareLoading}
              className="px-4 py-2 text-[12px] font-semibold font-heading rounded-lg bg-[#1e3a5f] text-white hover:bg-[#2a4a6f] disabled:opacity-50 transition-colors"
            >
              {leadsShareLoading ? 'Sharing...' : 'Share'}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* Task Share Modal */}
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

    {/* Excel Preview Modal */}
    {excelPreview && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setExcelPreview(null)}>
        <div className="bg-white rounded-2xl shadow-2xl w-[800px] max-h-[85vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#e8e6e1] bg-[#faf9f7]">
            <div className="flex items-center gap-2">
              <FileSpreadsheet size={16} className="text-[#1a6b3c]" />
              <h3 className="text-[14px] font-bold text-[#111110] font-heading truncate max-w-[600px]">{excelPreview.filename || 'Spreadsheet Preview'}</h3>
            </div>
            <button onClick={() => setExcelPreview(null)} className="w-7 h-7 rounded-lg flex items-center justify-center text-[#9a9a92] hover:text-[#111110] hover:bg-[#f0f0ec] transition-colors">
              <X size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-auto">
            {loadingExcel && (
              <div className="flex items-center justify-center py-12">
                <div className="text-[13px] text-terminal-muted">Loading spreadsheet...</div>
              </div>
            )}
            {excelPreview.error && (
              <div className="flex items-center justify-center py-12">
                <div className="text-[13px] text-terminal-muted">{excelPreview.error}</div>
              </div>
            )}
            {excelPreview.data?.sheets?.map((sheet, si) => (
              <div key={si}>
                {excelPreview.data.sheets.length > 1 && (
                  <div className="px-4 py-2 bg-[#f5f4f0] border-b border-[#e8e6e2] text-[11px] font-heading font-semibold text-terminal-muted uppercase">{sheet.name}</div>
                )}
                <table className="w-full text-[12px]">
                  <tbody>
                    {sheet.rows.map((row, ri) => (
                      <tr key={ri} className={ri === 0 ? 'bg-[#1e3a5f] text-white font-semibold sticky top-0' : ri % 2 === 0 ? 'bg-[#fafaf8]' : 'bg-white'}>
                        {row.map((cell, ci) => (
                          <td key={ci} className={`px-3 py-1.5 border-b border-[#f0eeea] whitespace-nowrap ${ri === 0 ? 'border-[#2a4d73] py-2' : ''}`}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      </div>
    )}
  </>);
}

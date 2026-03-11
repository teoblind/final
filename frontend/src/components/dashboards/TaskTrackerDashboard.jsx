/**
 * Task Tracker Dashboard — Background agent jobs with progress tracking,
 * agent-to-user messaging, and key vault management.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  ListChecks, Play, CheckCircle, AlertTriangle, Clock, MessageSquare,
  Key, Plus, Trash2, Eye, EyeOff, ChevronDown, ChevronUp, Send, Loader
} from 'lucide-react';
import api from '../../lib/hooks/useApi';

// ─── Status helpers ──────────────────────────────────────────────────────────

const STATUS_CONFIG = {
  pending: { label: 'Pending', color: '#9a9a92', bg: '#f5f4f0', icon: Clock },
  running: { label: 'Running', color: '#3b82f6', bg: '#eef3f9', icon: Play },
  paused: { label: 'Needs Input', color: '#d97706', bg: '#fef3cd', icon: MessageSquare },
  completed: { label: 'Completed', color: '#1a6b3c', bg: '#edf7f0', icon: CheckCircle },
  failed: { label: 'Failed', color: '#c0392b', bg: '#fbeae8', icon: AlertTriangle },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold" style={{ background: cfg.bg, color: cfg.color }}>
      <Icon size={11} />
      {cfg.label}
    </span>
  );
}

// ─── Job Card ────────────────────────────────────────────────────────────────

function JobCard({ job, onSelect }) {
  const pct = job.progress_pct || 0;
  const isActive = job.status === 'running' || job.status === 'paused';

  return (
    <button
      onClick={() => onSelect(job.id)}
      className="w-full text-left bg-white border border-[#e8e6e1] rounded-xl p-4 hover:border-[#3b82f6]/40 transition-all"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-[13px] font-bold text-[#111110] truncate">{job.title}</h3>
          {job.description && <p className="text-[11px] text-[#9a9a92] mt-0.5 truncate">{job.description}</p>}
        </div>
        <StatusBadge status={job.status} />
      </div>
      {isActive && (
        <div className="mt-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-[#9a9a92]">{job.progress_message || 'Working...'}</span>
            <span className="text-[10px] font-mono font-bold text-[#3b82f6]">{pct}%</span>
          </div>
          <div className="w-full h-1.5 bg-[#f0eeea] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pct}%`, background: job.status === 'paused' ? '#d97706' : '#3b82f6' }}
            />
          </div>
        </div>
      )}
      <div className="flex items-center gap-3 mt-2 text-[10px] text-[#c5c5bc]">
        <span>{job.agent_id || 'hivemind'}</span>
        <span>·</span>
        <span>{new Date(job.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </button>
  );
}

// ─── Job Detail Panel ────────────────────────────────────────────────────────

function JobDetail({ jobId, onBack }) {
  const [job, setJob] = useState(null);
  const [messages, setMessages] = useState([]);
  const [reply, setReply] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchJob = useCallback(async () => {
    try {
      const res = await api.get(`/v1/jobs/${jobId}`);
      setJob(res.data.job);
      setMessages(res.data.messages || []);
    } catch (err) {
      console.error('Failed to fetch job:', err);
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => { fetchJob(); }, [fetchJob]);

  // Poll for updates when job is active
  useEffect(() => {
    if (!job || (job.status !== 'running' && job.status !== 'paused')) return;
    const interval = setInterval(fetchJob, 3000);
    return () => clearInterval(interval);
  }, [job?.status, fetchJob]);

  const handleReply = async (pendingMsgId) => {
    if (!reply.trim()) return;
    try {
      await api.post(`/v1/jobs/${jobId}/messages`, { respondToId: pendingMsgId, content: reply.trim() });
      setReply('');
      fetchJob();
    } catch (err) {
      console.error('Reply failed:', err);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-20"><Loader size={24} className="animate-spin text-[#3b82f6]" /></div>;
  if (!job) return <div className="text-center text-[#9a9a92] py-20">Job not found</div>;

  const pendingRequest = messages.find(m => m.message_type === 'request' && !m.response);
  const pct = job.progress_pct || 0;

  return (
    <div>
      {/* Header */}
      <button onClick={onBack} className="text-[11px] text-[#3b82f6] font-semibold mb-3 hover:underline">← Back to all tasks</button>
      <div className="bg-white border border-[#e8e6e1] rounded-xl p-5 mb-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-[16px] font-bold text-[#111110]">{job.title}</h2>
            {job.description && <p className="text-[12px] text-[#9a9a92] mt-0.5">{job.description}</p>}
          </div>
          <StatusBadge status={job.status} />
        </div>
        {(job.status === 'running' || job.status === 'paused') && (
          <div className="mt-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-[#6b6b65]">{job.progress_message || 'Working...'}</span>
              <span className="text-[11px] font-mono font-bold text-[#3b82f6]">{pct}%</span>
            </div>
            <div className="w-full h-2 bg-[#f0eeea] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${pct}%`, background: job.status === 'paused' ? '#d97706' : '#3b82f6' }}
              />
            </div>
          </div>
        )}
        {job.error_message && (
          <div className="mt-3 px-3 py-2 bg-[#fbeae8] border border-[#f5c6cb] rounded-lg text-[12px] text-[#c0392b]">{job.error_message}</div>
        )}
        {job.result && (
          <div className="mt-3 px-3 py-2 bg-[#edf7f0] border border-[#c8e6c9] rounded-lg text-[12px] text-[#1a6b3c]">
            {job.result.driveUrl ? (
              <a href={job.result.driveUrl} target="_blank" rel="noopener noreferrer" className="underline font-semibold">View result in Google Drive →</a>
            ) : (
              <span>Job completed successfully</span>
            )}
          </div>
        )}
      </div>

      {/* Agent needs input */}
      {pendingRequest && (
        <div className="bg-[#fef3cd] border border-[#d97706]/30 rounded-xl p-4 mb-4">
          <div className="flex items-start gap-2 mb-3">
            <MessageSquare size={16} className="text-[#d97706] mt-0.5" />
            <div>
              <p className="text-[12px] font-bold text-[#92600a]">Agent needs your input</p>
              <p className="text-[12px] text-[#92600a] mt-1">{pendingRequest.content}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <input
              value={reply}
              onChange={e => setReply(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleReply(pendingRequest.id)}
              placeholder="Type your response..."
              className="flex-1 px-3 py-2 border border-[#d97706]/30 rounded-lg text-[12px] outline-none focus:border-[#d97706]"
            />
            <button
              onClick={() => handleReply(pendingRequest.id)}
              className="px-4 py-2 bg-[#d97706] text-white rounded-lg text-[12px] font-semibold hover:bg-[#b45309] flex items-center gap-1"
            >
              <Send size={12} /> Reply
            </button>
          </div>
        </div>
      )}

      {/* Message log */}
      <div className="bg-white border border-[#e8e6e1] rounded-xl p-4">
        <h3 className="text-[13px] font-bold text-[#111110] mb-3">Activity Log</h3>
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {messages.map(m => (
            <div key={m.id} className={`flex gap-2 text-[11px] ${m.role === 'user' ? 'justify-end' : ''}`}>
              <div className={`max-w-[80%] px-3 py-2 rounded-lg ${
                m.role === 'user'
                  ? 'bg-[#3b82f6] text-white'
                  : m.message_type === 'request'
                    ? 'bg-[#fef3cd] text-[#92600a] border border-[#d97706]/20'
                    : m.message_type === 'warning'
                      ? 'bg-[#fbeae8] text-[#c0392b]'
                      : 'bg-[#f5f4f0] text-[#333330]'
              }`}>
                <p>{m.content}</p>
                {m.response && <p className="mt-1 opacity-60 text-[10px]">↳ You replied: {m.response}</p>}
                <span className="block mt-1 opacity-40 text-[9px]">{new Date(m.created_at).toLocaleTimeString()}</span>
              </div>
            </div>
          ))}
          {messages.length === 0 && <p className="text-[#c5c5bc] text-center py-4">No activity yet</p>}
        </div>
      </div>
    </div>
  );
}

// ─── Key Vault ───────────────────────────────────────────────────────────────

function KeyVault() {
  const [keys, setKeys] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newKey, setNewKey] = useState({ service: '', keyName: 'default', keyValue: '' });
  const [revealedKeys, setRevealedKeys] = useState(new Set());

  useEffect(() => {
    api.get('/v1/jobs/keys/list').then(res => setKeys(res.data?.keys || [])).catch(() => {});
  }, []);

  const addKey = async () => {
    if (!newKey.service || !newKey.keyValue) return;
    try {
      await api.post('/v1/jobs/keys', newKey);
      setShowAdd(false);
      setNewKey({ service: '', keyName: 'default', keyValue: '' });
      const res = await api.get('/v1/jobs/keys/list');
      setKeys(res.data?.keys || []);
    } catch (err) {
      console.error('Add key failed:', err);
    }
  };

  const deleteKey = async (id) => {
    try {
      await api.delete(`/v1/jobs/keys/${id}`);
      setKeys(prev => prev.filter(k => k.id !== id));
    } catch (err) {
      console.error('Delete key failed:', err);
    }
  };

  return (
    <div className="bg-white border border-[#e8e6e1] rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Key size={16} className="text-[#6b6b65]" />
          <h3 className="text-[14px] font-bold text-[#111110]">API Key Vault</h3>
        </div>
        <button onClick={() => setShowAdd(!showAdd)} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-[#3b82f6] text-white hover:bg-[#2563eb] flex items-center gap-1">
          <Plus size={12} /> Add Key
        </button>
      </div>

      {showAdd && (
        <div className="bg-[#f9f9f7] border border-[#e8e6e1] rounded-lg p-3 mb-4 space-y-2">
          <div className="flex gap-2">
            <input value={newKey.service} onChange={e => setNewKey({ ...newKey, service: e.target.value })}
              placeholder="Service (e.g. ercot, fred)" className="flex-1 px-3 py-2 border border-[#e8e6e1] rounded-lg text-[12px] outline-none focus:border-[#3b82f6]" />
            <input value={newKey.keyName} onChange={e => setNewKey({ ...newKey, keyName: e.target.value })}
              placeholder="Key name" className="w-[120px] px-3 py-2 border border-[#e8e6e1] rounded-lg text-[12px] outline-none focus:border-[#3b82f6]" />
          </div>
          <div className="flex gap-2">
            <input value={newKey.keyValue} onChange={e => setNewKey({ ...newKey, keyValue: e.target.value })}
              placeholder="API key value" type="password" className="flex-1 px-3 py-2 border border-[#e8e6e1] rounded-lg text-[12px] font-mono outline-none focus:border-[#3b82f6]" />
            <button onClick={addKey} className="px-4 py-2 bg-[#1a6b3c] text-white rounded-lg text-[12px] font-semibold hover:bg-[#155d33]">Save</button>
            <button onClick={() => setShowAdd(false)} className="px-3 py-2 border border-[#e8e6e1] rounded-lg text-[12px] text-[#9a9a92] hover:bg-[#f5f4f0]">Cancel</button>
          </div>
        </div>
      )}

      {keys.length > 0 ? (
        <div className="space-y-2">
          {keys.map(k => (
            <div key={k.id} className="flex items-center justify-between py-2 px-3 bg-[#f9f9f7] rounded-lg">
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-bold text-[#3b82f6] bg-[#eef3f9] px-2 py-0.5 rounded uppercase">{k.service}</span>
                <span className="text-[11px] text-[#6b6b65]">{k.key_name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[#c5c5bc]">Added by {k.added_by}</span>
                <button onClick={() => deleteKey(k.id)} className="p-1 text-[#c5c5bc] hover:text-[#c0392b]"><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-[#c5c5bc] text-center py-4">No API keys stored. Keys added here are available to agents for data tasks.</p>
      )}
    </div>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────

export default function TaskTrackerDashboard() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedJob, setSelectedJob] = useState(null);
  const [filter, setFilter] = useState('all');
  const [pendingCount, setPendingCount] = useState(0);

  const fetchJobs = useCallback(async () => {
    try {
      const [jobsRes, reqRes] = await Promise.all([
        api.get('/v1/jobs'),
        api.get('/v1/jobs/pending-requests'),
      ]);
      setJobs(jobsRes.data?.jobs || []);
      setPendingCount((reqRes.data?.requests || []).length);
    } catch (err) {
      console.error('Failed to fetch jobs:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  // Poll for active jobs
  useEffect(() => {
    const hasActive = jobs.some(j => j.status === 'running' || j.status === 'paused');
    if (!hasActive) return;
    const interval = setInterval(fetchJobs, 5000);
    return () => clearInterval(interval);
  }, [jobs, fetchJobs]);

  const filtered = filter === 'all' ? jobs : jobs.filter(j => j.status === filter);
  const activeJobs = jobs.filter(j => j.status === 'running' || j.status === 'paused');
  const completedJobs = jobs.filter(j => j.status === 'completed');
  const failedJobs = jobs.filter(j => j.status === 'failed');

  if (selectedJob) {
    return (
      <div className="p-6 lg:px-8 lg:py-6 max-w-[900px]">
        <JobDetail jobId={selectedJob} onBack={() => { setSelectedJob(null); fetchJobs(); }} />
      </div>
    );
  }

  return (
    <div className="p-6 lg:px-8 lg:py-6 max-w-[1000px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[20px] font-bold text-[#111110]">Agent Tasks</h1>
          <p className="text-[12px] text-[#9a9a92] mt-0.5">Long-running agent jobs, progress tracking, and API key management</p>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="bg-white border border-[#e8e6e1] rounded-xl px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.5px] text-[#9a9a92] mb-1">Active</p>
          <p className="text-[20px] font-bold text-[#3b82f6]">{activeJobs.length}</p>
        </div>
        <div className="bg-white border border-[#e8e6e1] rounded-xl px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.5px] text-[#9a9a92] mb-1">Needs Input</p>
          <p className="text-[20px] font-bold text-[#d97706]">{pendingCount}</p>
        </div>
        <div className="bg-white border border-[#e8e6e1] rounded-xl px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.5px] text-[#9a9a92] mb-1">Completed</p>
          <p className="text-[20px] font-bold text-[#1a6b3c]">{completedJobs.length}</p>
        </div>
        <div className="bg-white border border-[#e8e6e1] rounded-xl px-4 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.5px] text-[#9a9a92] mb-1">Failed</p>
          <p className="text-[20px] font-bold text-[#c0392b]">{failedJobs.length}</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4">
        {[
          { id: 'all', label: `All (${jobs.length})` },
          { id: 'running', label: `Running (${activeJobs.length})` },
          { id: 'paused', label: `Needs Input (${jobs.filter(j => j.status === 'paused').length})` },
          { id: 'completed', label: `Done (${completedJobs.length})` },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`px-4 py-[7px] rounded-lg text-[11px] font-semibold border transition-colors ${
              filter === f.id ? 'bg-[#3b82f6] text-white border-[#3b82f6]' : 'bg-white text-[#9a9a92] border-[#e8e6e1] hover:bg-[#f5f4f0]'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Job list */}
      {loading ? (
        <div className="flex items-center justify-center py-20"><Loader size={24} className="animate-spin text-[#3b82f6]" /></div>
      ) : filtered.length > 0 ? (
        <div className="space-y-3 mb-8">
          {filtered.map(job => (
            <JobCard key={job.id} job={job} onSelect={setSelectedJob} />
          ))}
        </div>
      ) : (
        <div className="bg-white border border-[#e8e6e1] rounded-xl py-12 text-center mb-8">
          <ListChecks size={32} className="mx-auto text-[#e8e6e1] mb-3" />
          <p className="text-[13px] text-[#9a9a92]">No agent tasks yet</p>
          <p className="text-[11px] text-[#c5c5bc] mt-1">When you ask an agent to run a long task (data pulls, report generation), it'll appear here</p>
        </div>
      )}

      {/* Key Vault */}
      <KeyVault />
    </div>
  );
}

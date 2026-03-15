import React, { useState, useEffect, useCallback } from 'react';
import { Shield, Plus, X, AlertTriangle, Clock } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

function getToken() {
  return localStorage.getItem('coppice_token') || '';
}

function headers() {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` };
}

export default function EmailSecurityPanel() {
  const [senders, setSenders] = useState([]);
  const [securityLog, setSecurityLog] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  const fetchSenders = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/tenant/email-security/trusted-senders`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setSenders(data.trustedSenders || []);
      }
    } catch {}
  }, []);

  const fetchLog = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/tenant/email-security/log?limit=50`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        setSecurityLog(data.securityLog || []);
      }
    } catch {}
  }, []);

  useEffect(() => {
    Promise.all([fetchSenders(), fetchLog()]).finally(() => setLoading(false));
  }, [fetchSenders, fetchLog]);

  const handleAdd = async () => {
    const val = input.trim();
    if (!val || !val.includes('@')) {
      setError('Must contain @ (e.g. user@company.com or @company.com)');
      return;
    }
    setError('');
    setAdding(true);

    const isDomain = val.startsWith('@');
    const body = isDomain
      ? { domain: val.slice(1), trustLevel: 'trusted' }
      : { email: val, trustLevel: 'trusted' };

    try {
      const res = await fetch(`${API_BASE}/v1/tenant/email-security/trusted-senders`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setInput('');
        await fetchSenders();
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to add');
      }
    } catch {
      setError('Network error');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await fetch(`${API_BASE}/v1/tenant/email-security/trusted-senders/${id}`, {
        method: 'DELETE',
        headers: headers(),
      });
      await fetchSenders();
    } catch {}
  };

  const domains = senders.filter(s => s.domain);
  const emails = senders.filter(s => s.email);

  const fmtDate = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-terminal-muted text-[13px]">
        Loading email security settings...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Trusted Senders */}
      <div className="bg-terminal-panel border border-terminal-border rounded-[14px] p-6">
        <div className="flex items-center gap-3 mb-[18px]">
          <div className="w-9 h-9 rounded-[10px] flex items-center justify-center bg-blue-50 text-blue-600">
            <Shield size={18} />
          </div>
          <div>
            <div className="text-[16px] font-semibold text-terminal-text">Trusted Senders</div>
            <div className="text-[12px] text-terminal-muted mt-px">
              Emails from these addresses or domains get automatic responses from your agent.
            </div>
          </div>
        </div>

        {/* Add input */}
        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={input}
            onChange={e => { setInput(e.target.value); setError(''); }}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            placeholder="email@company.com or @domain.com"
            className="flex-1 px-3.5 py-2.5 border-[1.5px] border-terminal-border rounded-[10px] text-[13px] text-terminal-text bg-[#f5f4f0] outline-none focus:border-[#1e3a5f] focus:bg-terminal-panel transition-all placeholder:text-[#c5c5bc]"
          />
          <button
            onClick={handleAdd}
            disabled={adding}
            className="px-5 py-2.5 rounded-[10px] text-[13px] font-semibold transition-colors bg-[#1e3a5f] text-white hover:bg-[#2a5080] disabled:opacity-50 flex items-center gap-1.5"
          >
            <Plus size={14} />
            Add
          </button>
        </div>
        {error && <div className="text-[12px] text-red-500 mb-3">{error}</div>}

        {/* Sender pills */}
        {senders.length === 0 ? (
          <div className="text-[13px] text-terminal-muted py-4 text-center border border-dashed border-terminal-border rounded-[10px]">
            No trusted senders yet. Add a domain or email address above.
          </div>
        ) : (
          <div className="space-y-3">
            {domains.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold text-terminal-muted uppercase tracking-[0.5px] mb-2">Domains</div>
                <div className="flex flex-wrap gap-2">
                  {domains.map(s => (
                    <span
                      key={s.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#f5f4f0] border border-terminal-border rounded-full text-[12px] text-terminal-text font-medium"
                    >
                      @{s.domain}
                      <button
                        onClick={() => handleDelete(s.id)}
                        className="text-terminal-muted hover:text-red-500 transition-colors"
                      >
                        <X size={13} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {emails.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold text-terminal-muted uppercase tracking-[0.5px] mb-2">Emails</div>
                <div className="flex flex-wrap gap-2">
                  {emails.map(s => (
                    <span
                      key={s.id}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#f5f4f0] border border-terminal-border rounded-full text-[12px] text-terminal-text font-medium"
                    >
                      {s.email}
                      <button
                        onClick={() => handleDelete(s.id)}
                        className="text-terminal-muted hover:text-red-500 transition-colors"
                      >
                        <X size={13} />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Security Log */}
      <div className="bg-terminal-panel border border-terminal-border rounded-[14px] p-6">
        <div className="flex items-center gap-3 mb-[18px]">
          <div className="w-9 h-9 rounded-[10px] flex items-center justify-center bg-amber-50 text-amber-600">
            <AlertTriangle size={18} />
          </div>
          <div>
            <div className="text-[16px] font-semibold text-terminal-text">Security Log</div>
            <div className="text-[12px] text-terminal-muted mt-px">
              Blocked and flagged emails in the last 7 days.
            </div>
          </div>
        </div>

        {securityLog.length === 0 ? (
          <div className="text-[13px] text-terminal-muted py-4 text-center border border-dashed border-terminal-border rounded-[10px]">
            No security events in the last 7 days.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-terminal-border">
                  <th className="text-left py-2 px-2 font-semibold text-terminal-muted">Timestamp</th>
                  <th className="text-left py-2 px-2 font-semibold text-terminal-muted">From</th>
                  <th className="text-left py-2 px-2 font-semibold text-terminal-muted">Subject</th>
                  <th className="text-left py-2 px-2 font-semibold text-terminal-muted">Reason</th>
                  <th className="text-left py-2 px-2 font-semibold text-terminal-muted">Status</th>
                </tr>
              </thead>
              <tbody>
                {securityLog.map((entry, i) => (
                  <tr key={entry.id || i} className="border-b border-[#f0eeea] last:border-b-0">
                    <td className="py-2 px-2 text-terminal-muted whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        <Clock size={11} />
                        {fmtDate(entry.created_at)}
                      </div>
                    </td>
                    <td className="py-2 px-2 text-terminal-text">{entry.sender_email || '—'}</td>
                    <td className="py-2 px-2 text-terminal-text truncate max-w-[200px]">{entry.subject || '—'}</td>
                    <td className="py-2 px-2">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                        entry.reason === 'spoofed' ? 'bg-red-50 text-red-600' :
                        entry.reason === 'spam' ? 'bg-amber-50 text-amber-600' :
                        'bg-gray-100 text-gray-500'
                      }`}>
                        {entry.reason || 'unknown'}
                      </span>
                    </td>
                    <td className="py-2 px-2">
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                        entry.verdict === 'blocked' ? 'bg-red-50 text-red-600' :
                        'bg-amber-50 text-amber-600'
                      }`}>
                        {entry.verdict || 'flagged'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

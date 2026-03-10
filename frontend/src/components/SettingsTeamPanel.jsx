import React, { useState, useEffect } from 'react';
import { Users, UserPlus, Trash2, ChevronDown, X, Copy, Check } from 'lucide-react';
import { useAuth } from './auth/AuthContext';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

async function authFetch(path, opts = {}) {
  const session = JSON.parse(sessionStorage.getItem('sangha_auth') || '{}');
  const token = session?.tokens?.accessToken;
  const res = await fetch(`${API_BASE}/v1/tenant${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...opts.headers,
    },
  });
  return res;
}

function timeAgo(dateStr) {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

const ASSIGNABLE_ROLES = ['admin', 'member', 'operator', 'viewer'];

export default function SettingsTeamPanel() {
  const { user: currentUser, hasPermission } = useAuth();
  const canManage = hasPermission('manageUsers');
  const isOwner = currentUser?.role === 'owner';

  const [users, setUsers] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [seatCount, setSeatCount] = useState(0);
  const [seatLimit, setSeatLimit] = useState(999);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [usersRes, invRes, tenantRes] = await Promise.all([
        authFetch('/users'),
        authFetch('/invitations'),
        authFetch('/'),
      ]);
      if (usersRes.ok) {
        const d = await usersRes.json();
        setUsers(d.users || []);
      }
      if (invRes.ok) {
        const d = await invRes.json();
        setInvitations((d.invitations || []).filter(i => i.status === 'pending'));
      }
      if (tenantRes.ok) {
        const d = await tenantRes.json();
        setSeatCount(d.tenant?.seatCount || 0);
        setSeatLimit(d.tenant?.seatLimit || 999);
      }
    } catch (err) {
      console.error('Failed to load team data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (canManage) fetchData(); }, [canManage]);

  const handleRoleChange = async (userId, newRole) => {
    const res = await authFetch(`/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ role: newRole }),
    });
    if (res.ok) fetchData();
  };

  const handleRemoveUser = async (userId, userName) => {
    if (!confirm(`Remove ${userName} from the team? This action cannot be undone.`)) return;
    const res = await authFetch(`/users/${userId}`, { method: 'DELETE' });
    if (res.ok) fetchData();
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    setInviteLoading(true);
    setInviteResult(null);
    try {
      const res = await authFetch('/users/invite', {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInviteResult({ error: data.message || data.error || 'Failed to invite' });
        return;
      }
      const inviteLink = `${window.location.origin}/login?invite=${data.invitation.token}&email=${encodeURIComponent(inviteEmail)}`;
      setInviteResult({ link: inviteLink });
      setInviteEmail('');
      fetchData();
    } catch (err) {
      setInviteResult({ error: err.message });
    } finally {
      setInviteLoading(false);
    }
  };

  const handleRevokeInvite = async (id) => {
    const res = await authFetch(`/invitations/${id}`, { method: 'DELETE' });
    if (res.ok) fetchData();
  };

  const copyLink = (link) => {
    navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!canManage) return null;

  return (
    <div className="bg-terminal-panel border border-terminal-border rounded-[14px] p-6 mb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-[10px] flex items-center justify-center bg-blue-50 text-blue-700">
            <Users size={18} />
          </div>
          <div>
            <div className="text-[16px] font-semibold text-terminal-text">Team</div>
            <div className="text-[12px] text-terminal-muted mt-px">Manage users and roles</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-bold px-3 py-1 rounded-lg tracking-[0.3px] bg-[#f5f4f0] text-terminal-muted">
            {seatCount} of {seatLimit} seats
          </span>
          {(isOwner || canManage) && seatCount < seatLimit && (
            <button
              onClick={() => { setShowInvite(!showInvite); setInviteResult(null); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              <UserPlus size={14} />
              Invite
            </button>
          )}
          {seatCount >= seatLimit && (
            <span className="text-[11px] text-amber-600 font-medium">Upgrade to add more</span>
          )}
        </div>
      </div>

      {/* Invite Form */}
      {showInvite && (
        <div className="mb-5 p-4 bg-[#f5f4f0] border border-terminal-border rounded-xl">
          <form onSubmit={handleInvite} className="flex items-end gap-3">
            <div className="flex-1">
              <label className="block text-[11px] font-semibold text-terminal-text mb-1.5 uppercase tracking-wide">Email</label>
              <input
                type="email" required value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@company.com"
                className="w-full px-3.5 py-2.5 border-[1.5px] border-terminal-border rounded-[10px] text-[13px] text-terminal-text bg-white outline-none focus:border-blue-500 transition-all"
              />
            </div>
            <div className="w-32">
              <label className="block text-[11px] font-semibold text-terminal-text mb-1.5 uppercase tracking-wide">Role</label>
              <select
                value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}
                className="w-full px-3 py-2.5 border-[1.5px] border-terminal-border rounded-[10px] text-[13px] text-terminal-text bg-white outline-none focus:border-blue-500"
              >
                {ASSIGNABLE_ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
              </select>
            </div>
            <button
              type="submit" disabled={inviteLoading}
              className="px-4 py-2.5 rounded-[10px] text-[13px] font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {inviteLoading ? 'Sending...' : 'Send Invite'}
            </button>
          </form>

          {inviteResult?.error && (
            <div className="mt-3 px-3 py-2 rounded-lg bg-red-50 text-red-700 text-[12px] border border-red-100">
              {inviteResult.error}
            </div>
          )}
          {inviteResult?.link && (
            <div className="mt-3 px-3 py-2 rounded-lg bg-green-50 text-green-800 text-[12px] border border-green-100">
              <div className="font-semibold mb-1">Invite link created</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-[11px] bg-white px-2 py-1 rounded border border-green-200 truncate">{inviteResult.link}</code>
                <button onClick={() => copyLink(inviteResult.link)} className="p-1 hover:bg-green-100 rounded transition-colors">
                  {copied ? <Check size={14} className="text-green-700" /> : <Copy size={14} className="text-green-600" />}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Users Table */}
      {loading ? (
        <div className="text-center py-8 text-[13px] text-terminal-muted">Loading team...</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {['Name', 'Email', 'Role', 'Last Login', ''].map(h => (
                  <th key={h} className="text-[10px] font-bold text-terminal-muted uppercase tracking-[0.8px] text-left px-2.5 py-2 border-b border-terminal-border">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-[#f0eeea] last:border-b-0">
                  <td className="text-[13px] font-medium text-terminal-text px-2.5 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[11px] font-bold shrink-0">
                        {u.name?.charAt(0)?.toUpperCase() || '?'}
                      </div>
                      {u.name}
                      {u.id === currentUser?.id && (
                        <span className="text-[10px] text-terminal-muted font-normal">(you)</span>
                      )}
                    </div>
                  </td>
                  <td className="text-[12px] font-mono text-terminal-muted px-2.5 py-2.5">{u.email}</td>
                  <td className="px-2.5 py-2.5">
                    {(isOwner || (canManage && u.role !== 'owner')) && u.id !== currentUser?.id ? (
                      <select
                        value={u.role}
                        onChange={(e) => handleRoleChange(u.id, e.target.value)}
                        className="text-[12px] px-2 py-1 border border-terminal-border rounded-lg bg-white text-terminal-text outline-none focus:border-blue-500"
                      >
                        {u.role === 'owner' && <option value="owner">Owner</option>}
                        {ASSIGNABLE_ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                      </select>
                    ) : (
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${
                        u.role === 'owner' ? 'bg-purple-50 text-purple-700' :
                        u.role === 'admin' ? 'bg-blue-50 text-blue-700' :
                        u.role === 'member' ? 'bg-green-50 text-green-700' :
                        'bg-gray-50 text-gray-600'
                      }`}>
                        {u.role.charAt(0).toUpperCase() + u.role.slice(1)}
                      </span>
                    )}
                  </td>
                  <td className="text-[12px] text-terminal-muted px-2.5 py-2.5">
                    {timeAgo(u.last_login)}
                  </td>
                  <td className="px-2.5 py-2.5 text-right">
                    {isOwner && u.id !== currentUser?.id && (
                      <button
                        onClick={() => handleRemoveUser(u.id, u.name)}
                        className="p-1.5 rounded-lg hover:bg-red-50 text-terminal-muted hover:text-red-600 transition-colors"
                        title="Remove user"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <div className="mt-5 pt-4 border-t border-terminal-border">
          <div className="text-[12px] font-bold text-terminal-muted uppercase tracking-wide mb-3">Pending Invitations</div>
          <div className="space-y-2">
            {invitations.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between px-3 py-2.5 bg-[#f5f4f0] rounded-lg">
                <div>
                  <span className="text-[13px] text-terminal-text">{inv.email}</span>
                  <span className="text-[11px] text-terminal-muted ml-2">
                    {inv.role} · expires {new Date(inv.expires_at).toLocaleDateString()}
                  </span>
                </div>
                <button
                  onClick={() => handleRevokeInvite(inv.id)}
                  className="text-[11px] text-red-500 hover:text-red-700 font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

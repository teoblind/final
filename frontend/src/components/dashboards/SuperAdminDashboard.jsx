import React, { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import {
  LayoutDashboard, Users, Building2, DollarSign, Activity,
  Settings, FileText, Heart, LogOut, Trash2, KeyRound, MoreVertical,
  RefreshCw, Server, Database, Shield, Globe, HardDrive,
  CheckCircle, AlertTriangle, XCircle, Eye, RotateCcw, Terminal,
  Search, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Radio
} from 'lucide-react';
import api from '../../lib/hooks/useApi';
import { useAuth } from '../auth/AuthContext';
import CoppiceLogo from '../ui/CoppiceLogo';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const FILE_BASE = window.location.hostname.includes('localhost') ? 'http://localhost:3002' : '';

// ─── Sidebar ────────────────────────────────────────────────────────────────

const NAV = [
  { section: 'Overview', items: [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'tenants', label: 'Tenants', icon: Building2 },
    { id: 'users', label: 'Users', icon: Users },
  ]},
  { section: 'Monitoring', items: [
    { id: 'spend', label: 'API Spend', icon: DollarSign },
    { id: 'logs', label: 'API Logs', icon: Activity },
    { id: 'health', label: 'System Health', icon: Heart },
  ]},
  { section: 'Platform', items: [
    { id: 'settings', label: 'Settings', icon: Settings },
    { id: 'demos', label: 'Demo Requests', icon: FileText, count: 0 },
  ]},
];

function Sidebar({ activeTab, setActiveTab, user, logout }) {
  return (
    <aside className="w-[220px] bg-[#111110] min-h-screen flex flex-col shrink-0">
      {/* Brand */}
      <div className="flex items-center gap-2.5 px-[22px] py-5">
        <CoppiceLogo color="#111110" size={32} />
        <span className="text-[14px] font-bold text-white tracking-[0.5px] font-heading">Coppice</span>
        <span className="text-[8px] font-bold text-white/30 bg-white/[0.06] px-1.5 py-0.5 rounded ml-1 uppercase tracking-[1px] font-heading">Admin</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2.5 py-2 space-y-4">
        {NAV.map((group) => (
          <div key={group.section}>
            <p className="text-[9px] font-bold uppercase tracking-[1.5px] text-white/20 px-3 mb-1.5 font-heading">{group.section}</p>
            {group.items.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-[9px] rounded-lg text-[12px] font-medium transition-all mb-0.5 ${
                  activeTab === item.id
                    ? 'text-[#3b82f6] bg-[rgba(59,130,246,0.08)]'
                    : 'text-white/40 hover:text-white/70 hover:bg-white/[0.04]'
                }`}
              >
                <item.icon size={16} />
                <span className="flex-1">{item.label}</span>
                {item.count != null && (
                  <span className="text-[10px] font-mono">{item.count}</span>
                )}
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="border-t border-white/[0.06] px-3 py-3">
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <div className="w-8 h-8 rounded-lg bg-[#7c3aed] flex items-center justify-center text-[11px] font-bold text-white">
            {user?.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'A'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold text-white truncate">{user?.name || 'Admin'}</p>
            <p className="text-[10px] text-white/30 truncate">Super Admin</p>
          </div>
          <button onClick={logout} className="text-white/40 hover:text-white/80" title="Logout">
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}

// ─── Main Export ─────────────────────────────────────────────────────────────

// Hash routing helper
function useHashRoute(defaultTab) {
  const getTab = () => (window.location.hash.replace('#/', '') || defaultTab);
  const [tab, setTabState] = useState(getTab);

  useEffect(() => {
    const onHash = () => setTabState(getTab());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const setTab = (id) => {
    window.location.hash = `#/${id}`;
    setTabState(id);
  };

  return [tab, setTab];
}

export default function SuperAdminDashboard() {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useHashRoute('dashboard');

  useEffect(() => { document.title = 'Coppice Admin'; }, []);

  return (
    <div className="min-h-screen bg-[#fafaf8] flex" style={{ fontFamily: "'Instrument Sans', sans-serif" }}>
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} user={user} logout={logout} />
      <main className="flex-1 overflow-y-auto">
        {activeTab === 'dashboard' && <DashboardPage />}
        {activeTab === 'tenants' && <TenantsPage />}
        {activeTab === 'users' && <UsersPage />}
        {activeTab === 'spend' && <ApiSpendPage />}
        {activeTab === 'logs' && <ApiLogsPage />}
        {activeTab === 'health' && <SystemHealthPage />}
        {activeTab === 'settings' && <SettingsPage />}
        {activeTab === 'demos' && <DemoRequestsPage />}
      </main>
    </div>
  );
}

// ─── Dashboard Page ─────────────────────────────────────────────────────────

function DashboardPage() {
  const [tenants, setTenants] = useState([]);
  const [users, setUsers] = useState([]);
  const [usage, setUsage] = useState(null);
  const [byTenant, setByTenant] = useState([]);
  const [loading, setLoading] = useState(true);
  const [recentLogs, setRecentLogs] = useState([]);
  const [actionMenu, setActionMenu] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [resetResult, setResetResult] = useState(null);
  const [emailHealth, setEmailHealth] = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [reauthingTenant, setReauthingTenant] = useState(null);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const [tenantRes, usageRes, tenantUsageRes] = await Promise.all([
          api.get('/v1/admin/tenants'),
          api.get('/v1/admin/usage?period=30'),
          api.get('/v1/admin/usage/by-tenant?period=30'),
        ]);

        const tenantList = tenantRes.data?.tenants || tenantRes.data || [];
        setTenants(tenantList);

        const allUsers = [];
        for (const t of tenantList) {
          try {
            const uRes = await api.get(`/v1/admin/tenants/${t.id}/users`);
            const uList = uRes.data?.users || [];
            allUsers.push(...uList.map(u => ({ ...u, tenantName: t.name })));
          } catch { /* skip */ }
        }
        setUsers(allUsers);
        setUsage(usageRes.data);
        setByTenant(tenantUsageRes.data?.tenants || []);

        // Fetch recent logs
        try {
          const logsRes = await api.get('/v1/admin/usage/recent-logs');
          setRecentLogs(logsRes.data?.logs || []);
        } catch { /* skip */ }

        // Fetch email health
        try {
          const healthRes = await api.get('/v1/admin/email/health');
          setEmailHealth(healthRes.data);
        } catch { /* skip */ }
      } catch (err) {
        console.error('Failed to load admin data:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  // Listen for re-auth popup success
  useEffect(() => {
    const handler = (event) => {
      if (event.data?.type === 'email-reauth-success') {
        setReauthingTenant(null);
        api.post('/v1/admin/email/health/refresh').then(res => setEmailHealth(res.data)).catch(() => {});
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const handleDeleteUser = async (userId) => {
    try {
      await api.delete(`/v1/admin/users/${userId}`);
      setUsers(prev => prev.filter(u => u.id !== userId));
      setConfirmDelete(null);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to delete user');
    }
  };

  const handleResetPassword = async (userId) => {
    try {
      const res = await api.post(`/v1/admin/users/${userId}/reset-password`);
      setResetResult({ userId, password: res.data.temporaryPassword, email: res.data.message });
      setActionMenu(null);
      setTimeout(() => setResetResult(null), 15000);
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to reset password');
    }
  };

  const fmtTokens = (n) => {
    if (n == null) return '--';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
  };

  const fmtCost = (n) => {
    if (n == null || n === 0) return '$0.00';
    if (n < 0.01) return `$${n.toFixed(4)}`;
    return `$${n.toFixed(2)}`;
  };

  if (loading) {
    return <div className="flex items-center justify-center py-32"><div className="spinner w-10 h-10" /></div>;
  }

  const summary = usage?.summary || {};
  const byDay = usage?.byDay || [];
  const totalCost = summary.totalCost || 0;
  const avgPerDay = byDay.length > 0 ? totalCost / byDay.length : 0;

  // Build tenant cost map
  const tenantCostMap = {};
  for (const t of byTenant) {
    tenantCostMap[t.tenantId] = t;
  }

  return (
    <div className="p-6 lg:px-8 lg:py-6 max-w-[1200px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#111110] font-heading">Platform Dashboard</h1>
          <p className="text-[13px] text-[#9a9a92] mt-0.5">Coppice Super Admin - All tenants, all metrics</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => alert('Report export started.')} className="px-4 py-2 rounded-[10px] text-[12px] font-semibold border border-[#e8e6e1] bg-white text-[#6b6b65] hover:bg-[#f5f4f0] font-heading">
            Export Report
          </button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5 mb-6">
        <KPI label="Total Tenants" value={tenants.length} sub={tenants.map(t => t.name).join(' + ') || '--'} />
        <KPI label="Total Users" value={users.length} sub={`across ${tenants.length} tenants`} />
        <KPI label="MRR" value="$0" sub="Pre-revenue (pilot)" />
        <KPI label="API Spend (MTD)" value={fmtCost(totalCost)} sub={`${fmtCost(avgPerDay)}/day avg`} />
        <KPI label="Gross Margin" value={'\u2014'} sub="No revenue yet" />
      </div>

      {/* Tenant Cards */}
      <Section title="Tenants">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          {tenants.map((t) => {
            const tUsage = tenantCostMap[t.id] || {};
            const tUsers = users.filter(u => u.tenant_id === t.id);
            return (
              <TenantCard
                key={t.id}
                tenant={t}
                userCount={tUsers.length || t.userCount || 0}
                cost={tUsage.cost || 0}
                requests={tUsage.requests || 0}
                fmtCost={fmtCost}
              />
            );
          })}
        </div>
      </Section>

      {/* Email Integration Health */}
      {emailHealth && emailHealth.tokens?.length > 0 && (
        <Section title="Email Integration Health">
          <div className="flex items-center justify-end mb-3 -mt-2">
            <button
              onClick={async () => {
                setHealthLoading(true);
                try {
                  const res = await api.post('/v1/admin/email/health/refresh');
                  setEmailHealth(res.data);
                } catch {}
                setHealthLoading(false);
              }}
              disabled={healthLoading}
              className="text-[10px] font-semibold px-2.5 py-1 rounded-md bg-[#f0eeea] text-[#6b6b65] hover:text-[#111110] transition-colors disabled:opacity-50"
            >
              {healthLoading ? 'Checking...' : 'Refresh'}
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {emailHealth.tokens.map((t) => {
              const borderClass = t.status !== 'healthy'
                ? 'border-[#f5c2c7] bg-[#fef2f2]'
                : t.expiryWarning === 'critical'
                  ? 'border-[#f5c2c7] bg-[#fef6f0]'
                  : t.expiryWarning === 'warning'
                    ? 'border-[#f0d9a0] bg-[#fffef5]'
                    : 'border-[#d1e7dd] bg-[#f8fdf9]';
              return (
                <div key={t.label} className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${borderClass}`}>
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                    t.status === 'healthy' ? 'bg-[#1a6b3c]' : 'bg-[#c0392b] animate-pulse'
                  }`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold text-[#111110] truncate">{t.label}</p>
                    <p className={`text-[10px] ${t.status === 'healthy' ? 'text-[#1a6b3c]' : 'text-[#c0392b]'}`}>
                      {t.status === 'healthy' ? 'Token valid' : 'Token dead - needs re-auth'}
                    </p>
                    {t.status === 'healthy' && t.expiresInDays != null && (
                      <p className={`text-[9px] mt-0.5 ${
                        t.expiryWarning === 'critical' ? 'text-[#c0392b] font-semibold'
                          : t.expiryWarning === 'warning' ? 'text-[#d4a017]'
                          : 'text-[#6b6b65]'
                      }`}>
                        Expires in ~{t.expiresInDays}d
                      </p>
                    )}
                    {t.isEnvVar && (
                      <p className="text-[9px] text-[#6b6b65] mt-0.5">Env var - manual re-auth</p>
                    )}
                    {t.error && t.status !== 'healthy' && (
                      <p className="text-[9px] text-[#6b6b65] truncate mt-0.5">{t.error}</p>
                    )}
                  </div>
                  {!t.isEnvVar && (
                    <button
                      onClick={() => {
                        setReauthingTenant(t.tenantId);
                        const jwt = localStorage.getItem('accessToken') || localStorage.getItem('token');
                        window.open(
                          `/api/v1/admin/email/reauth/start?tenantId=${encodeURIComponent(t.tenantId)}&token=${encodeURIComponent(jwt)}`,
                          'reauth',
                          'width=600,height=700'
                        );
                      }}
                      className={`text-[9px] font-semibold px-2 py-1 rounded-md flex-shrink-0 transition-colors ${
                        t.status !== 'healthy' || t.expiryWarning === 'critical'
                          ? 'bg-[#c0392b] text-white hover:bg-[#a93226]'
                          : 'bg-[#f0eeea] text-[#6b6b65] hover:text-[#111110]'
                      }`}
                    >
                      {reauthingTenant === t.tenantId ? 'Waiting...' : 'Re-Auth'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* API Spend */}
      <Section title={`API Spend - ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`}>
        {usage?.byModel?.length > 0 ? (
          <div className="bg-white border border-[#e8e6e1] rounded-2xl overflow-hidden">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr>
                  {['Model', 'Calls', 'Input Tokens', 'Output Tokens', 'Cost'].map((h) => (
                    <th key={h} className="text-left px-3.5 py-2.5 bg-[#f5f4f0] border-b border-[#e8e6e1] font-bold text-[#6b6b65] text-[10px] uppercase tracking-[0.5px] font-heading">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {usage.byModel.map((row) => (
                  <tr key={row.model} className="hover:bg-[#f5f4f0]">
                    <td className="px-3.5 py-2.5 border-b border-[#f0eeea]">
                      <ModelBadge model={row.model} />
                    </td>
                    <td className="px-3.5 py-2.5 border-b border-[#f0eeea] font-mono text-[11px]">{row.requests}</td>
                    <td className="px-3.5 py-2.5 border-b border-[#f0eeea] font-mono text-[11px]">{fmtTokens(row.input_tokens)}</td>
                    <td className="px-3.5 py-2.5 border-b border-[#f0eeea] font-mono text-[11px]">{fmtTokens(row.output_tokens)}</td>
                    <td className="px-3.5 py-2.5 border-b border-[#f0eeea] font-mono text-[11px] font-bold">{fmtCost(calcModelCost(row))}</td>
                  </tr>
                ))}
                <tr className="bg-[#f5f4f0] font-bold">
                  <td colSpan={4} className="px-3.5 py-2.5 text-right pr-5">Total MTD</td>
                  <td className="px-3.5 py-2.5 font-mono text-[14px] text-[#1e3a5f]">{fmtCost(totalCost)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyCard>No API usage data this month</EmptyCard>
        )}
      </Section>

      {/* All Users */}
      <Section title="All Users">
        {resetResult && (
          <div className="mb-3 bg-[#edf7f0] border border-[#c8e6c9] rounded-xl px-4 py-3 flex items-center justify-between">
            <div>
              <span className="text-[12px] font-semibold text-[#1a6b3c]">{resetResult.email}</span>
              <span className="text-[12px] text-[#1a6b3c] ml-2">New password: <code className="bg-white px-1.5 py-0.5 rounded font-mono text-[11px] font-bold">{resetResult.password}</code></span>
            </div>
            <button onClick={() => setResetResult(null)} className="text-[#1a6b3c]/50 hover:text-[#1a6b3c] text-[11px]">Dismiss</button>
          </div>
        )}
        <div className="bg-white border border-[#e8e6e1] rounded-2xl px-5 py-3">
          {users.length === 0 ? (
            <div className="py-8 text-center text-[#c5c5bc] text-[14px]">No users found</div>
          ) : (
            users.map((u) => (
              <div key={u.id} className="flex items-center gap-3 py-3 border-b border-[#f0eeea] last:border-b-0">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-bold text-white shrink-0"
                  style={{ background: avatarColor(u.name || u.email) }}
                >
                  {initials(u.name || u.email)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-[#111110]">{u.name || '--'}</div>
                  <div className="text-[11px] text-[#9a9a92] font-mono">{u.email}</div>
                </div>
                <div className="text-[11px] text-[#9a9a92]">{u.tenantName || u.tenant_id}</div>
                <div className="text-right mr-2">
                  <RoleBadge role={u.role} />
                  <div className="text-[10px] text-[#c5c5bc] mt-1">
                    {u.last_login ? formatLastLogin(u.last_login) : 'Never logged in'}
                  </div>
                </div>
                {/* Action menu */}
                <div className="relative">
                  <button
                    onClick={() => setActionMenu(actionMenu === u.id ? null : u.id)}
                    className="p-1.5 rounded-lg hover:bg-[#f5f4f0] text-[#9a9a92] hover:text-[#333]"
                  >
                    <MoreVertical size={14} />
                  </button>
                  {actionMenu === u.id && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setActionMenu(null)} />
                      <div className="absolute right-0 top-8 z-50 bg-white border border-[#e8e6e1] rounded-xl shadow-lg py-1.5 w-[180px]">
                        <button
                          onClick={() => { setActionMenu(null); handleResetPassword(u.id); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-[#333] hover:bg-[#f5f4f0]"
                        >
                          <KeyRound size={13} className="text-[#6b6b65]" />
                          Reset Password
                        </button>
                        <button
                          onClick={() => { setActionMenu(null); setConfirmDelete(u); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-[#c0392b] hover:bg-[#fbeae8]"
                        >
                          <Trash2 size={13} />
                          Remove User
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </Section>

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setConfirmDelete(null)}>
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-[16px] font-bold text-[#111110] mb-2 font-heading">Remove User</h3>
            <p className="text-[13px] text-[#6b6b65] mb-4">
              Are you sure you want to remove <strong>{confirmDelete.name || confirmDelete.email}</strong>? This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDelete(null)} className="px-4 py-2 rounded-lg text-[12px] font-semibold border border-[#e8e6e1] bg-white text-[#6b6b65] hover:bg-[#f5f4f0]">Cancel</button>
              <button onClick={() => handleDeleteUser(confirmDelete.id)} className="px-4 py-2 rounded-lg text-[12px] font-semibold bg-[#c0392b] text-white hover:bg-[#a93226]">Remove</button>
            </div>
          </div>
        </div>
      )}

      {/* Opus Report Usage */}
      <OpusUsageCard />

      {/* Recent API Calls */}
      <Section title="Recent API Calls">
        {recentLogs.length > 0 ? (
          <div className="bg-white border border-[#e8e6e1] rounded-2xl px-5 py-3">
            {recentLogs.map((log, i) => (
              <div key={i} className="flex items-center gap-2.5 py-2 border-b border-[#f0eeea] last:border-b-0 text-[11px]">
                <span className="font-mono text-[10px] text-[#c5c5bc] w-[70px] shrink-0">{formatTime(log.created_at)}</span>
                <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${
                  (log.tenant_id || '').includes('dacp') ? 'bg-[#eef3f9] text-[#1e3a5f]' : 'bg-[#edf7f0] text-[#1a6b3c]'
                }`}>
                  {(log.tenant_id || '').includes('dacp') ? 'DACP' : 'Sangha'}
                </span>
                <ModelBadge model={log.model} small />
                <span className="flex-1 text-[#333330] truncate">{log.content?.slice(0, 80) || 'Chat message'}...</span>
                <span className="font-mono text-[10px] text-[#6b6b65] w-[50px] text-right shrink-0">{fmtCost(log.cost)}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyCard>No recent API calls logged</EmptyCard>
        )}
      </Section>
    </div>
  );
}

// ─── Opus Usage Card ─────────────────────────────────────────────────────────

function OpusUsageCard() {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get('/v1/admin/usage/opus').then(res => setData(res.data)).catch(() => {});
  }, []);

  if (!data) return null;

  const totalMonthly = data.tenants.reduce((s, t) => s + t.monthlyCount, 0);
  const opusCostPerReport = 0.50; // rough estimate per report

  return (
    <Section title="Opus Report Usage">
      <div className="bg-white border border-[#e8e6e1] rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-lg bg-[#7c3aed]/10 flex items-center justify-center">
            <FileText size={16} className="text-[#7c3aed]" />
          </div>
          <div>
            <p className="text-[14px] font-bold text-[#111110] font-heading">Opus 4.6 Reports - {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</p>
            <p className="text-[11px] text-[#9a9a92]">{totalMonthly} reports generated · ~${(totalMonthly * opusCostPerReport).toFixed(2)} estimated spend</p>
          </div>
        </div>
        {data.tenants.length > 0 ? (
          <div className="space-y-2">
            {data.tenants.map(t => (
              <div key={t.tenantId} className="flex items-center justify-between py-2 px-3 bg-[#f9f9f7] rounded-lg">
                <div>
                  <span className="text-[12px] font-semibold text-[#111110]">{t.tenantName}</span>
                  <span className="text-[10px] text-[#9a9a92] ml-2">Today: {t.dailyCount}/{t.limitPerDay}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[12px] font-mono font-bold text-[#7c3aed]">{t.monthlyCount}</span>
                  <span className="text-[10px] text-[#9a9a92]">this month</span>
                  <div className={`w-2 h-2 rounded-full ${t.dailyCount >= t.limitPerDay ? 'bg-[#c0392b]' : 'bg-[#1a6b3c]'}`} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[12px] text-[#c5c5bc] text-center py-3">No Opus reports generated this month</p>
        )}
      </div>
    </Section>
  );
}

// ─── Tenants Page ────────────────────────────────────────────────────────────

function TenantsPage() {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('/v1/admin/tenants');
        setTenants(res.data?.tenants || res.data || []);
      } catch (err) { console.error('Failed to load tenants:', err); }
      finally { setLoading(false); }
    })();
  }, []);

  if (loading) return <div className="flex items-center justify-center py-32"><div className="spinner w-10 h-10" /></div>;

  return (
    <div className="p-6 lg:px-8 lg:py-6 max-w-[1200px]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#111110] font-heading">Tenants</h1>
          <p className="text-[13px] text-[#9a9a92] mt-0.5">{tenants.length} organization{tenants.length !== 1 ? 's' : ''} on the platform</p>
        </div>
        <button className="px-4 py-2 rounded-[10px] text-[12px] font-semibold bg-[#3b82f6] text-white hover:bg-[#2563eb] font-heading">+ Add Tenant</button>
      </div>

      {tenants.length === 0 ? (
        <EmptyCard>No tenants found</EmptyCard>
      ) : (
        <div className="bg-white border border-[#e8e6e1] rounded-2xl overflow-hidden">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {['Tenant', 'Slug', 'Plan', 'Status', 'Users', 'Sites', 'Created'].map(h => (
                  <th key={h} className="text-left px-4 py-3 bg-[#f5f4f0] border-b border-[#e8e6e1] font-bold text-[#6b6b65] text-[10px] uppercase tracking-[0.5px] font-heading">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tenants.filter(t => t.slug !== 'admin').map(t => {
                const isDACP = (t.id || '').includes('dacp');
                return (
                  <tr key={t.id} className="hover:bg-[#f5f4f0] cursor-pointer">
                    <td className="px-4 py-3.5 border-b border-[#f0eeea]">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-bold text-white" style={{ background: isDACP ? '#1e3a5f' : '#1a6b3c' }}>
                          {isDACP ? 'D' : 'S'}
                        </div>
                        <div>
                          <div className="font-semibold text-[13px] text-[#111110]">{t.name}</div>
                          <div className="text-[10px] text-[#9a9a92] font-mono">{t.slug}.coppice.ai</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 border-b border-[#f0eeea] font-mono text-[11px] text-[#6b6b65]">{t.slug}</td>
                    <td className="px-4 py-3.5 border-b border-[#f0eeea]">
                      <span className="text-[10px] font-bold py-[2px] px-2 rounded bg-[#fdf6e8] text-[#b8860b] uppercase">{t.plan || 'trial'}</span>
                    </td>
                    <td className="px-4 py-3.5 border-b border-[#f0eeea]">
                      <span className="flex items-center gap-1 text-[11px]">
                        <span className="w-1.5 h-1.5 rounded-full bg-[#2dd478]" />
                        <span className="text-[#6b6b65]">{t.status || 'active'}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3.5 border-b border-[#f0eeea] font-mono text-[13px] font-bold">{t.userCount || 0}</td>
                    <td className="px-4 py-3.5 border-b border-[#f0eeea] font-mono text-[13px]">{t.siteCount || 0}</td>
                    <td className="px-4 py-3.5 border-b border-[#f0eeea] text-[11px] text-[#9a9a92]">{t.created_at ? new Date(t.created_at).toLocaleDateString() : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Users Page ──────────────────────────────────────────────────────────────

function UsersPage() {
  const [users, setUsers] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionMenu, setActionMenu] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [resetResult, setResetResult] = useState(null);
  const [filterTenant, setFilterTenant] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const tenantRes = await api.get('/v1/admin/tenants');
        const tenantList = tenantRes.data?.tenants || tenantRes.data || [];
        setTenants(tenantList);

        const allUsers = [];
        for (const t of tenantList) {
          try {
            const uRes = await api.get(`/v1/admin/tenants/${t.id}/users`);
            const uList = uRes.data?.users || [];
            allUsers.push(...uList.map(u => ({ ...u, tenantName: t.name })));
          } catch { /* skip */ }
        }
        setUsers(allUsers);
      } catch (err) { console.error('Failed to load users:', err); }
      finally { setLoading(false); }
    })();
  }, []);

  const handleDeleteUser = async (userId) => {
    try {
      await api.delete(`/v1/admin/users/${userId}`);
      setUsers(prev => prev.filter(u => u.id !== userId));
      setConfirmDelete(null);
    } catch (err) { alert(err.response?.data?.error || 'Failed to delete user'); }
  };

  const handleResetPassword = async (userId) => {
    try {
      const res = await api.post(`/v1/admin/users/${userId}/reset-password`);
      setResetResult({ userId, password: res.data.temporaryPassword, email: res.data.message });
      setActionMenu(null);
      setTimeout(() => setResetResult(null), 15000);
    } catch (err) { alert(err.response?.data?.error || 'Failed to reset password'); }
  };

  const filtered = filterTenant ? users.filter(u => u.tenant_id === filterTenant) : users;

  if (loading) return <div className="flex items-center justify-center py-32"><div className="spinner w-10 h-10" /></div>;

  return (
    <div className="p-6 lg:px-8 lg:py-6 max-w-[1200px]">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[22px] font-bold text-[#111110] font-heading">Users</h1>
          <p className="text-[13px] text-[#9a9a92] mt-0.5">{users.length} user{users.length !== 1 ? 's' : ''} across {tenants.length} tenants</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={filterTenant} onChange={e => setFilterTenant(e.target.value)}
            className="px-3 py-2 border border-[#e8e6e1] rounded-lg text-[11px] bg-white text-[#333] outline-none">
            <option value="">All Tenants</option>
            {tenants.filter(t => t.slug !== 'admin').map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
      </div>

      {resetResult && (
        <div className="mb-3 bg-[#edf7f0] border border-[#c8e6c9] rounded-xl px-4 py-3 flex items-center justify-between">
          <div>
            <span className="text-[12px] font-semibold text-[#1a6b3c]">{resetResult.email}</span>
            <span className="text-[12px] text-[#1a6b3c] ml-2">New password: <code className="bg-white px-1.5 py-0.5 rounded font-mono text-[11px] font-bold">{resetResult.password}</code></span>
          </div>
          <button onClick={() => setResetResult(null)} className="text-[#1a6b3c]/50 hover:text-[#1a6b3c] text-[11px]">Dismiss</button>
        </div>
      )}

      <div className="bg-white border border-[#e8e6e1] rounded-2xl overflow-hidden">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr>
              {['User', 'Email', 'Tenant', 'Role', 'Status', 'Last Login', ''].map(h => (
                <th key={h} className="text-left px-4 py-3 bg-[#f5f4f0] border-b border-[#e8e6e1] font-bold text-[#6b6b65] text-[10px] uppercase tracking-[0.5px] font-heading">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} className="py-12 text-center text-[#c5c5bc] text-[14px]">No users found</td></tr>
            ) : filtered.map(u => (
              <tr key={u.id} className="hover:bg-[#f5f4f0]">
                <td className="px-4 py-3 border-b border-[#f0eeea]">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold text-white" style={{ background: avatarColor(u.name || u.email) }}>
                      {initials(u.name || u.email)}
                    </div>
                    <span className="font-semibold text-[13px] text-[#111110]">{u.name || '-'}</span>
                  </div>
                </td>
                <td className="px-4 py-3 border-b border-[#f0eeea] font-mono text-[11px] text-[#6b6b65]">{u.email}</td>
                <td className="px-4 py-3 border-b border-[#f0eeea] text-[11px] text-[#9a9a92]">{u.tenantName || u.tenant_id}</td>
                <td className="px-4 py-3 border-b border-[#f0eeea]"><RoleBadge role={u.role} /></td>
                <td className="px-4 py-3 border-b border-[#f0eeea]">
                  <span className={`text-[10px] font-bold py-[2px] px-2 rounded uppercase ${u.status === 'active' ? 'bg-[#edf7f0] text-[#1a6b3c]' : 'bg-[#f5f4f0] text-[#9a9a92]'}`}>
                    {u.status || 'invited'}
                  </span>
                </td>
                <td className="px-4 py-3 border-b border-[#f0eeea] text-[11px] text-[#9a9a92]">
                  {u.last_login ? formatLastLogin(u.last_login) : 'Never'}
                </td>
                <td className="px-4 py-3 border-b border-[#f0eeea]">
                  <div className="relative">
                    <button onClick={() => setActionMenu(actionMenu === u.id ? null : u.id)}
                      className="p-1.5 rounded-lg hover:bg-[#f5f4f0] text-[#9a9a92] hover:text-[#333]">
                      <MoreVertical size={14} />
                    </button>
                    {actionMenu === u.id && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setActionMenu(null)} />
                        <div className="absolute right-0 top-8 z-50 bg-white border border-[#e8e6e1] rounded-xl shadow-lg py-1.5 w-[180px]">
                          <button onClick={() => { setActionMenu(null); handleResetPassword(u.id); }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-[#333] hover:bg-[#f5f4f0]">
                            <KeyRound size={13} className="text-[#6b6b65]" /> Reset Password
                          </button>
                          <button onClick={() => { setActionMenu(null); setConfirmDelete(u); }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-[#c0392b] hover:bg-[#fbeae8]">
                            <Trash2 size={13} /> Remove User
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setConfirmDelete(null)}>
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-[16px] font-bold text-[#111110] mb-2 font-heading">Remove User</h3>
            <p className="text-[13px] text-[#6b6b65] mb-4">
              Are you sure you want to remove <strong>{confirmDelete.name || confirmDelete.email}</strong>? This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setConfirmDelete(null)} className="px-4 py-2 rounded-lg text-[12px] font-semibold border border-[#e8e6e1] bg-white text-[#6b6b65] hover:bg-[#f5f4f0]">Cancel</button>
              <button onClick={() => handleDeleteUser(confirmDelete.id)} className="px-4 py-2 rounded-lg text-[12px] font-semibold bg-[#c0392b] text-white hover:bg-[#a93226]">Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-Components ─────────────────────────────────────────────────────────

function KPI({ label, value, sub }) {
  return (
    <div className="bg-white border border-[#e8e6e1] rounded-[14px] p-[18px]">
      <div className="text-[11px] text-[#9a9a92] font-semibold mb-1.5 font-heading">{label}</div>
      <div className="text-[28px] font-bold text-[#111110] leading-none font-display">{value}</div>
      <div className="text-[11px] text-[#c5c5bc] font-semibold mt-1 font-mono">{sub}</div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-7">
      <h2 className="text-[16px] font-bold text-[#111110] mb-3.5 font-heading">{title}</h2>
      {children}
    </div>
  );
}

function TenantCard({ tenant, userCount, cost, requests, fmtCost }) {
  const isDACP = (tenant.id || '').includes('dacp');
  const color = isDACP ? '#1e3a5f' : '#1a6b3c';
  const letter = isDACP ? 'D' : 'S';
  const slug = isDACP ? 'dacp.coppice.ai' : 'sangha.coppice.ai';

  return (
    <div className="bg-white border border-[#e8e6e1] rounded-2xl p-5 hover:border-[#1e3a5f] hover:shadow-[0_4px_16px_rgba(0,0,0,0.04)] transition-all cursor-pointer">
      {/* Header */}
      <div className="flex items-center justify-between mb-3.5">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-[10px] flex items-center justify-center text-[13px] font-bold text-white" style={{ background: color }}>
            {letter}
          </div>
          <div>
            <div className="text-[15px] font-bold text-[#111110] font-heading">{tenant.name}</div>
            <div className="text-[11px] text-[#9a9a92] font-mono">{slug}</div>
          </div>
        </div>
        <div className="flex items-center gap-1 text-[11px] font-semibold text-[#b8860b]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#b8860b]" />
          Pilot
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-2 mb-3.5">
        <div className="text-center">
          <div className="font-mono text-[16px] font-bold text-[#111110]">{userCount}</div>
          <div className="text-[9px] text-[#9a9a92] uppercase tracking-[0.5px] font-heading">Users</div>
        </div>
        <div className="text-center">
          <div className="font-mono text-[16px] font-bold text-[#111110]">{requests}</div>
          <div className="text-[9px] text-[#9a9a92] uppercase tracking-[0.5px] font-heading">API Calls</div>
        </div>
        <div className="text-center">
          <div className="font-mono text-[16px] font-bold text-[#111110]">{tenant.siteCount || 0}</div>
          <div className="text-[9px] text-[#9a9a92] uppercase tracking-[0.5px] font-heading">Sites</div>
        </div>
        <div className="text-center">
          <div className="font-mono text-[16px] font-bold text-[#111110]">{tenant.workloadCount || 0}</div>
          <div className="text-[9px] text-[#9a9a92] uppercase tracking-[0.5px] font-heading">Workloads</div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-[#f0eeea]">
        <div>
          <div className="font-mono text-[14px] font-bold text-[#1e3a5f]">$0/mo</div>
          <div className="text-[10px] text-[#c5c5bc]">Pilot rate</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[12px] text-[#9a9a92]">{fmtCost(cost)} API cost (MTD)</div>
        </div>
      </div>
    </div>
  );
}

function ModelBadge({ model, small }) {
  const m = (model || '').toLowerCase();
  let label, cls;
  if (m.includes('haiku')) { label = 'Haiku'; cls = 'bg-[#f0f0ff] text-[#6366f1]'; }
  else if (m.includes('opus')) { label = 'Opus'; cls = 'bg-[#f3f0ff] text-[#7c3aed]'; }
  else if (m.includes('sonar') || m.includes('perplexity')) { label = 'Sonar'; cls = 'bg-[#fdf6e8] text-[#b8860b]'; }
  else { label = 'Sonnet'; cls = 'bg-[#eef3f9] text-[#1e3a5f]'; }

  const sz = small ? 'text-[8px] py-[1px] px-1.5' : 'text-[9px] py-[2px] px-2';
  return <span className={`font-bold rounded-[5px] uppercase tracking-[0.3px] ${sz} ${cls}`}>{label}</span>;
}

function RoleBadge({ role }) {
  const r = (role || '').toLowerCase();
  let cls = 'bg-[#f5f4f0] text-[#9a9a92]';
  let label = role;
  if (r === 'sangha_admin') { cls = 'bg-[#f3f0ff] text-[#7c3aed]'; label = 'Admin'; }
  else if (r === 'sangha_underwriter') { cls = 'bg-[#f3f0ff] text-[#7c3aed]'; label = 'Underwriter'; }
  else if (r === 'owner') { cls = 'bg-[#eef3f9] text-[#1e3a5f]'; label = 'Owner'; }
  else if (r === 'admin') { cls = 'bg-[#eef3f9] text-[#1e3a5f]'; label = 'Admin'; }
  else if (r === 'operator') { cls = 'bg-[#edf7f0] text-[#1a6b3c]'; label = 'Operator'; }
  else if (r === 'viewer') { cls = 'bg-[#f5f4f0] text-[#9a9a92]'; label = 'Viewer'; }
  return <span className={`text-[10px] font-bold py-[2px] px-2 rounded-[5px] uppercase ${cls}`}>{label}</span>;
}

function EmptyCard({ children }) {
  return (
    <div className="bg-white border border-[#e8e6e1] rounded-2xl py-8 text-center text-[#c5c5bc] text-[14px]">
      {children}
    </div>
  );
}

// ─── API Logs Page ──────────────────────────────────────────────────────────

function ApiLogsPage() {
  const [logs, setLogs] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ tenant_id: '', model: '', search: '' });
  const [expandedRow, setExpandedRow] = useState(null);
  const limit = 25;

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (filters.tenant_id) params.set('tenant_id', filters.tenant_id);
      if (filters.model) params.set('model', filters.model);
      if (filters.search) params.set('search', filters.search);
      const res = await api.get(`/v1/admin/usage/logs?${params}`);
      setLogs(res.data?.logs || []);
      setTotal(res.data?.total || 0);
      setTotalPages(res.data?.totalPages || 1);
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    } finally {
      setLoading(false);
    }
  }, [page, filters]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  // Auto-refresh every 15s
  useEffect(() => {
    const iv = setInterval(fetchLogs, 15000);
    return () => clearInterval(iv);
  }, [fetchLogs]);

  const fmtCost = (n) => {
    if (n == null || n === 0) return '$0.00';
    if (n < 0.01) return `$${n.toFixed(4)}`;
    return `$${n.toFixed(3)}`;
  };
  const fmtTokens = (n) => {
    if (!n) return '\u2014';
    return n.toLocaleString();
  };

  return (
    <div className="p-6 lg:px-8 lg:py-6 max-w-[1200px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[20px] font-bold text-[#111110] font-heading">API Logs</h1>
          <p className="text-[12px] text-[#9a9a92] mt-0.5">Every API call across all tenants and agents - real-time</p>
        </div>
        <div className="flex gap-2 items-center">
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-[#1a6b3c] bg-[#edf7f0] border border-[rgba(26,107,60,0.15)] px-3 py-1.5 rounded-lg">
            <div className="w-1.5 h-1.5 rounded-full bg-[#1a6b3c] animate-pulse" /> Live
          </div>
          <button className="px-4 py-2 rounded-[10px] text-[12px] font-semibold border border-[#e8e6e1] bg-white text-[#6b6b65] hover:bg-[#f5f4f0] font-heading">
            Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <FilterGroup label="Tenant">
          <select className="px-2.5 py-1.5 border border-[#e8e6e1] rounded-lg text-[11px] bg-white text-[#333] outline-none focus:border-[#3b82f6]"
            value={filters.tenant_id} onChange={e => { setFilters(f => ({ ...f, tenant_id: e.target.value })); setPage(1); }}>
            <option value="">All Tenants</option>
            <option value="default">Sangha Renewables</option>
            <option value="dacp-construction-001">DACP Construction</option>
          </select>
        </FilterGroup>
        <FilterGroup label="Model">
          <select className="px-2.5 py-1.5 border border-[#e8e6e1] rounded-lg text-[11px] bg-white text-[#333] outline-none focus:border-[#3b82f6]"
            value={filters.model} onChange={e => { setFilters(f => ({ ...f, model: e.target.value })); setPage(1); }}>
            <option value="">All Models</option>
            <option value="haiku">Haiku</option>
            <option value="sonnet">Sonnet</option>
            <option value="opus">Opus</option>
            <option value="sonar">Perplexity Sonar</option>
          </select>
        </FilterGroup>
        <div className="flex-1" />
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9a9a92]" />
          <input
            className="pl-7 pr-3 py-1.5 border border-[#e8e6e1] rounded-lg text-[11px] bg-white text-[#333] w-[200px] outline-none focus:border-[#3b82f6]"
            placeholder="Search by action or user..."
            value={filters.search}
            onChange={e => { setFilters(f => ({ ...f, search: e.target.value })); setPage(1); }}
          />
        </div>
        <span className="text-[11px] font-mono text-[#9a9a92]">{total.toLocaleString()} calls</span>
      </div>

      {/* Log Table */}
      <div className="bg-white border border-[#e8e6e1] rounded-2xl overflow-hidden">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr>
              {['Time', 'Tenant', 'Model', 'Agent / Action', 'Input', 'Output', 'Cost', 'Latency'].map(h => (
                <th key={h} className="text-left px-3.5 py-2.5 bg-[#f5f4f0] border-b border-[#e8e6e1] font-bold text-[#6b6b65] text-[9px] uppercase tracking-[0.5px] sticky top-0 z-[2] font-heading">{h}</th>
              ))}
              <th className="w-[30px] bg-[#f5f4f0] border-b border-[#e8e6e1]" />
            </tr>
          </thead>
          <tbody>
            {loading && logs.length === 0 ? (
              <tr><td colSpan={9} className="py-12 text-center text-[#c5c5bc] text-[14px]">Loading...</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={9} className="py-12 text-center text-[#c5c5bc] text-[14px]">No API logs found</td></tr>
            ) : logs.map((log, i) => {
              const isExpanded = expandedRow === i;
              const isDACP = (log.tenant_id || '').includes('dacp');
              return (
                <React.Fragment key={i}>
                  <tr className="hover:bg-[rgba(0,0,0,0.015)] cursor-pointer" onClick={() => setExpandedRow(isExpanded ? null : i)}>
                    <td className="px-3.5 py-2.5 border-b border-[#f0eeea] font-mono text-[10px] text-[#9a9a92] whitespace-nowrap">{formatTime(log.created_at)}</td>
                    <td className="px-3.5 py-2.5 border-b border-[#f0eeea]">
                      <span className={`text-[8px] font-bold py-[2px] px-2 rounded ${isDACP ? 'bg-[#eef3f9] text-[#1e3a5f]' : 'bg-[#edf7f0] text-[#1a6b3c]'}`}>
                        {isDACP ? 'DACP' : 'Sangha'}
                      </span>
                    </td>
                    <td className="px-3.5 py-2.5 border-b border-[#f0eeea]"><ModelBadge model={log.model} small /></td>
                    <td className="px-3.5 py-2.5 border-b border-[#f0eeea]">
                      <span className="font-semibold">{log.agent_id || 'Hivemind'}</span>
                      <span className="text-[#9a9a92] ml-1.5">{(log.content || '').slice(0, 60)}{(log.content || '').length > 60 ? '...' : ''}</span>
                    </td>
                    <td className="px-3.5 py-2.5 border-b border-[#f0eeea] font-mono text-[10px]">{fmtTokens(log.input_tokens)}</td>
                    <td className="px-3.5 py-2.5 border-b border-[#f0eeea] font-mono text-[10px]">{fmtTokens(log.output_tokens)}</td>
                    <td className="px-3.5 py-2.5 border-b border-[#f0eeea] font-mono text-[10px] font-semibold text-[#3b82f6]">{fmtCost(log.cost)}</td>
                    <td className="px-3.5 py-2.5 border-b border-[#f0eeea] font-mono text-[10px] text-[#6b6b65]">-</td>
                    <td className="px-3.5 py-2.5 border-b border-[#f0eeea] text-[#c5c5bc] text-[10px]">
                      {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td colSpan={9} className="bg-[#f5f4f0] border-b border-[#e8e6e1] px-4 py-3">
                        <div className="grid grid-cols-3 gap-3">
                          <div className="bg-white border border-[#f0eeea] rounded-[10px] p-3">
                            <div className="text-[9px] font-bold text-[#9a9a92] uppercase tracking-[0.5px] mb-1.5">Metadata</div>
                            <div className="font-mono text-[10px] text-[#333] leading-relaxed">
                              <div>Tenant: {log.tenant_id}</div>
                              <div>Agent: {log.agent_id || 'default'}</div>
                              <div>User: {log.user_id || '-'}</div>
                              <div>Time: {log.created_at}</div>
                            </div>
                          </div>
                          <div className="bg-white border border-[#f0eeea] rounded-[10px] p-3">
                            <div className="text-[9px] font-bold text-[#9a9a92] uppercase tracking-[0.5px] mb-1.5">Tokens</div>
                            <div className="font-mono text-[10px] text-[#333] leading-relaxed">
                              <div>Model: {log.model || '-'}</div>
                              <div>Input: {(log.input_tokens || 0).toLocaleString()} tokens</div>
                              <div>Output: {(log.output_tokens || 0).toLocaleString()} tokens</div>
                              <div>Cost: {fmtCost(log.cost)}</div>
                            </div>
                          </div>
                          <div className="bg-white border border-[#f0eeea] rounded-[10px] p-3">
                            <div className="text-[9px] font-bold text-[#9a9a92] uppercase tracking-[0.5px] mb-1.5">Response (truncated)</div>
                            <div className="font-mono text-[10px] text-[#333] leading-relaxed max-h-[100px] overflow-y-auto whitespace-pre-wrap">
                              {(log.content || '').slice(0, 300)}{(log.content || '').length > 300 ? '...' : ''}
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-[#e8e6e1]">
            <span className="text-[11px] text-[#9a9a92]">
              Showing {((page - 1) * limit) + 1}–{Math.min(page * limit, total)} of {total.toLocaleString()} calls
            </span>
            <div className="flex gap-1">
              <PaginationBtn disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={13} /></PaginationBtn>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let p;
                if (totalPages <= 5) p = i + 1;
                else if (page <= 3) p = i + 1;
                else if (page >= totalPages - 2) p = totalPages - 4 + i;
                else p = page - 2 + i;
                return <PaginationBtn key={p} active={p === page} onClick={() => setPage(p)}>{p}</PaginationBtn>;
              })}
              {totalPages > 5 && page < totalPages - 2 && (
                <>
                  <span className="px-1.5 text-[11px] text-[#c5c5bc]">...</span>
                  <PaginationBtn onClick={() => setPage(totalPages)}>{totalPages}</PaginationBtn>
                </>
              )}
              <PaginationBtn disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight size={13} /></PaginationBtn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FilterGroup({ label, children }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] font-bold text-[#9a9a92] uppercase tracking-[0.5px] font-heading">{label}</span>
      {children}
    </div>
  );
}

function PaginationBtn({ children, active, disabled, onClick }) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      className={`w-8 h-8 rounded-lg border text-[11px] font-semibold flex items-center justify-center transition-colors ${
        active ? 'bg-[#3b82f6] text-white border-[#3b82f6]'
        : disabled ? 'bg-white text-[#c5c5bc] border-[#e8e6e1] cursor-default opacity-40'
        : 'bg-white text-[#6b6b65] border-[#e8e6e1] hover:bg-[#f5f4f0] cursor-pointer'
      }`}
    >
      {children}
    </button>
  );
}

// ─── API Spend Page ─────────────────────────────────────────────────────────

const PERIOD_OPTIONS = [
  { label: 'Today', value: '1' },
  { label: '7 Days', value: '7' },
  { label: 'This Month', value: String(new Date().getDate()) },
  { label: 'Last Month', value: '30' },
  { label: 'All Time', value: '365' },
];

const MODEL_COLORS = { haiku: '#a5b4fc', sonnet: '#3b82f6', opus: '#7c3aed', perplexity: '#d97706' };

function ApiSpendPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(String(new Date().getDate()));

  const fetchSpend = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/v1/admin/usage/spend?period=${period}`);
      setData(res.data);
    } catch (err) {
      console.error('Failed to fetch spend:', err);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { fetchSpend(); }, [fetchSpend]);

  const fmtCost = (n) => {
    if (n == null || n === 0) return '$0.00';
    if (n < 0.01) return `$${n.toFixed(4)}`;
    return `$${n.toFixed(2)}`;
  };
  const fmtTokens = (n) => {
    if (!n) return '0';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
  };

  const summary = data?.summary || {};
  const byModel = data?.byModel || [];
  const byDay = data?.byDay || [];
  const byTenant = data?.byTenant || [];
  const totalRequests = summary.totalRequests || 0;
  const totalCost = summary.totalCost || 0;

  // Prepare chart data
  const chartData = byDay.map(d => ({
    day: d.day.slice(5),
    haiku: d.models?.haiku || 0,
    sonnet: d.models?.sonnet || 0,
    opus: d.models?.opus || 0,
    perplexity: d.models?.perplexity || 0,
  }));

  // Model costs for legend
  const modelCosts = {};
  for (const m of byModel) {
    const key = (m.model || '').toLowerCase().includes('haiku') ? 'haiku'
      : (m.model || '').toLowerCase().includes('opus') ? 'opus'
      : (m.model || '').toLowerCase().includes('sonar') || (m.model || '').toLowerCase().includes('perplexity') ? 'perplexity'
      : 'sonnet';
    modelCosts[key] = (modelCosts[key] || 0) + (m.cost || 0);
  }

  return (
    <div className="p-6 lg:px-8 lg:py-6 max-w-[1200px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[20px] font-bold text-[#111110] font-heading">API Spend</h1>
          <p className="text-[12px] text-[#9a9a92] mt-0.5">Cost analytics across all models, tenants, and agents</p>
        </div>
        <div className="flex gap-2">
          <button className="px-4 py-2 rounded-[10px] text-[12px] font-semibold border border-[#e8e6e1] bg-white text-[#6b6b65] hover:bg-[#f5f4f0] font-heading">Export CSV</button>
        </div>
      </div>

      {/* Period Selector */}
      <div className="flex gap-1 mb-5">
        {PERIOD_OPTIONS.map(p => (
          <button key={p.value} onClick={() => setPeriod(p.value)}
            className={`px-4 py-[7px] rounded-lg text-[11px] font-semibold border transition-colors font-heading ${
              period === p.value ? 'bg-[#3b82f6] text-white border-[#3b82f6]' : 'bg-white text-[#9a9a92] border-[#e8e6e1] hover:bg-[#f5f4f0]'
            }`}>
            {p.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-32"><div className="spinner w-10 h-10" /></div>
      ) : (
        <>
          {/* KPI Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <KPI label="Total Spend (MTD)" value={fmtCost(totalCost)} sub={`${summary.daysElapsed || 0} days into ${new Date().toLocaleDateString('en-US', { month: 'long' })}`} />
            <KPI label="Projected Monthly" value={fmtCost(summary.projectedMonthly || 0)} sub={`Based on ${fmtCost(summary.avgPerDay || 0)}/day avg`} />
            <KPI label="Total API Calls" value={totalRequests.toLocaleString()} sub={`${Math.round(totalRequests / Math.max(1, summary.daysElapsed || 1))}/day avg`} />
            <SpendKPI label="Cost Per Call" value={fmtCost(summary.costPerCall || 0)} sub="Weighted average" valueColor="#1a6b3c" />
          </div>

          {/* Daily Chart */}
          {chartData.length > 0 && (
            <div className="bg-white border border-[#e8e6e1] rounded-2xl p-5 mb-6">
              <h3 className="text-[14px] font-bold text-[#111110] mb-3 font-heading">
                Daily Spend - {new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={chartData} barGap={1}>
                  <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#c5c5bc', fontFamily: 'JetBrains Mono, monospace' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 9, fill: '#c5c5bc', fontFamily: 'JetBrains Mono, monospace' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(2)}`} width={50} />
                  <Tooltip formatter={(v) => `$${Number(v).toFixed(4)}`} contentStyle={{ fontSize: 11, borderRadius: 10, border: '1px solid #e8e6e1' }} />
                  <Bar dataKey="haiku" stackId="a" fill="#a5b4fc" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="sonnet" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="opus" stackId="a" fill="#7c3aed" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="perplexity" stackId="a" fill="#d97706" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex gap-4 justify-center mt-3">
                {Object.entries(MODEL_COLORS).map(([key, color]) => (
                  <div key={key} className="flex items-center gap-1.5 text-[10px] text-[#9a9a92]">
                    <div className="w-2 h-2 rounded-sm" style={{ background: color }} />
                    {key.charAt(0).toUpperCase() + key.slice(1)} ({fmtCost(modelCosts[key] || 0)})
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Breakdown Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 mb-6">
            {/* By Model */}
            <BreakdownCard title="By Model">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr>
                    {['Model', 'Calls', '% of Total', 'Cost'].map(h => (
                      <th key={h} className="text-left px-4 py-2 bg-[#f5f4f0] border-b border-[#e8e6e1] font-bold text-[#6b6b65] text-[9px] uppercase tracking-[0.5px] font-heading">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {byModel.map(m => {
                    const pct = totalRequests > 0 ? ((m.requests / totalRequests) * 100).toFixed(1) : '0';
                    return (
                      <tr key={m.model} className="hover:bg-[#f5f4f0]">
                        <td className="px-4 py-2 border-b border-[#f0eeea]"><ModelBadge model={m.model} /></td>
                        <td className="px-4 py-2 border-b border-[#f0eeea] font-mono text-[11px]">{m.requests}</td>
                        <td className="px-4 py-2 border-b border-[#f0eeea]">
                          <span className="font-mono text-[11px]">{pct}%</span>
                          <div className="w-full h-[5px] rounded-full bg-[#f0eeea] mt-1 overflow-hidden">
                            <div className="h-full rounded-full bg-[#3b82f6]" style={{ width: `${pct}%` }} />
                          </div>
                        </td>
                        <td className="px-4 py-2 border-b border-[#f0eeea] font-mono text-[11px] font-bold">{fmtCost(m.cost)}</td>
                      </tr>
                    );
                  })}
                  <tr className="bg-[#f5f4f0] font-bold">
                    <td colSpan={3} className="px-4 py-2 text-right pr-6">Total</td>
                    <td className="px-4 py-2 font-mono text-[14px] text-[#3b82f6]">{fmtCost(totalCost)}</td>
                  </tr>
                </tbody>
              </table>
            </BreakdownCard>

            {/* By Tenant */}
            <BreakdownCard title="By Tenant">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr>
                    {['Tenant', 'Calls', 'API Cost'].map(h => (
                      <th key={h} className="text-left px-4 py-2 bg-[#f5f4f0] border-b border-[#e8e6e1] font-bold text-[#6b6b65] text-[9px] uppercase tracking-[0.5px] font-heading">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {byTenant.map(t => {
                    const isDACP = (t.tenantId || '').includes('dacp');
                    return (
                      <tr key={t.tenantId} className="hover:bg-[#f5f4f0]">
                        <td className="px-4 py-2 border-b border-[#f0eeea]">
                          <span className={`text-[8px] font-bold py-[2px] px-2 rounded mr-1.5 ${isDACP ? 'bg-[#eef3f9] text-[#1e3a5f]' : 'bg-[#edf7f0] text-[#1a6b3c]'}`}>
                            {isDACP ? 'DACP' : 'Sangha'}
                          </span>
                          {t.tenantName}
                        </td>
                        <td className="px-4 py-2 border-b border-[#f0eeea] font-mono text-[11px]">{t.requests}</td>
                        <td className="px-4 py-2 border-b border-[#f0eeea] font-mono text-[11px] font-bold">{fmtCost(t.cost)}</td>
                      </tr>
                    );
                  })}
                  <tr className="bg-[#f5f4f0] font-bold">
                    <td colSpan={2} className="px-4 py-2 text-right pr-6">Total</td>
                    <td className="px-4 py-2 font-mono text-[14px] text-[#3b82f6]">{fmtCost(totalCost)}</td>
                  </tr>
                </tbody>
              </table>
            </BreakdownCard>

            {/* Unit Economics */}
            <BreakdownCard title="Unit Economics">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr>
                    {['Metric', 'Value'].map(h => (
                      <th key={h} className="text-left px-4 py-2 bg-[#f5f4f0] border-b border-[#e8e6e1] font-bold text-[#6b6b65] text-[9px] uppercase tracking-[0.5px] font-heading">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="hover:bg-[#f5f4f0]"><td className="px-4 py-2 border-b border-[#f0eeea]">Cost per chat message (avg)</td><td className="px-4 py-2 border-b border-[#f0eeea] font-mono text-[11px] font-bold">{fmtCost(summary.costPerCall || 0)}</td></tr>
                  <tr className="hover:bg-[#f5f4f0]"><td className="px-4 py-2 border-b border-[#f0eeea]">Avg daily spend</td><td className="px-4 py-2 border-b border-[#f0eeea] font-mono text-[11px] font-bold">{fmtCost(summary.avgPerDay || 0)}</td></tr>
                  <tr className="hover:bg-[#f5f4f0]"><td className="px-4 py-2 border-b border-[#f0eeea]">Projected monthly cost</td><td className="px-4 py-2 border-b border-[#f0eeea] font-mono text-[11px] font-bold text-[#3b82f6]">{fmtCost(summary.projectedMonthly || 0)}</td></tr>
                  {byTenant.length > 0 && (
                    <tr className="hover:bg-[#f5f4f0]"><td className="px-4 py-2 border-b border-[#f0eeea] font-bold">Cost to serve per tenant/month</td><td className="px-4 py-2 border-b border-[#f0eeea] font-mono text-[14px] font-bold text-[#3b82f6]">{fmtCost((summary.projectedMonthly || 0) / byTenant.length)}</td></tr>
                  )}
                </tbody>
              </table>
            </BreakdownCard>
          </div>
        </>
      )}
    </div>
  );
}

function SpendKPI({ label, value, sub, valueColor }) {
  return (
    <div className="bg-white border border-[#e8e6e1] rounded-[14px] p-[18px]">
      <div className="text-[11px] text-[#9a9a92] font-semibold mb-1.5 font-heading">{label}</div>
      <div className="text-[28px] font-bold leading-none font-display" style={{ color: valueColor || '#111110' }}>{value}</div>
      <div className="text-[11px] text-[#c5c5bc] font-semibold mt-1 font-mono">{sub}</div>
    </div>
  );
}

function BreakdownCard({ title, children }) {
  return (
    <div className="bg-white border border-[#e8e6e1] rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-[#f0eeea]">
        <h3 className="text-[14px] font-bold text-[#111110] font-heading">{title}</h3>
      </div>
      {children}
    </div>
  );
}

// ─── Settings Page ──────────────────────────────────────────────────────────

function SettingsPage() {
  const [tab, setTab] = useState('general');
  const [health, setHealth] = useState(null);

  useEffect(() => {
    api.get('/v1/admin/system/health').then(res => setHealth(res.data)).catch(() => {});
  }, []);

  const envVars = health?.envVars || [];
  const services = health?.services || {};

  const TABS = [
    { id: 'general', label: 'General' },
    { id: 'api', label: 'API Keys' },
    { id: 'models', label: 'Model Routing' },
    { id: 'tenants', label: 'Tenant Defaults' },
    { id: 'email', label: 'Email' },
    { id: 'danger', label: 'Danger Zone' },
  ];

  return (
    <div className="p-6 lg:px-8 lg:py-6 max-w-[800px]">
      <div className="mb-5">
        <h1 className="text-[20px] font-bold text-[#111110] font-heading">Settings</h1>
        <p className="text-[12px] text-[#9a9a92] mt-0.5">Platform configuration - API keys, model routing, tenant defaults, and system settings</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[#e8e6e1] mb-6">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-5 py-2.5 text-[12px] font-semibold border-b-2 transition-colors font-heading ${
              tab === t.id ? 'text-[#3b82f6] border-[#3b82f6]' : 'text-[#9a9a92] border-transparent hover:text-[#333]'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* General */}
      {tab === 'general' && (
        <>
          <SettingsSection title="Platform" desc="Core platform settings that apply to all tenants.">
            <SettingsCard>
              <SettingRow label="Platform Name" desc="Shown in browser titles and email footers">
                <input className="px-3 py-2 border border-[#e8e6e1] rounded-lg text-[12px] w-[280px] outline-none focus:border-[#3b82f6]" defaultValue="Coppice" />
              </SettingRow>
              <SettingRow label="Base Domain" desc="Root domain for tenant subdomains">
                <input className="px-3 py-2 border border-[#e8e6e1] rounded-lg text-[12px] font-mono w-[280px] outline-none focus:border-[#3b82f6]" defaultValue="coppice.ai" />
              </SettingRow>
              <SettingRow label="Admin Email" desc="Receives system alerts, demo requests, and error notifications">
                <input className="px-3 py-2 border border-[#e8e6e1] rounded-lg text-[12px] font-mono w-[280px] outline-none focus:border-[#3b82f6]" defaultValue="teo@zhan.capital" />
              </SettingRow>
              <SettingRow label="Registration" desc="Allow new tenants to self-register" last>
                <ToggleSwitch />
              </SettingRow>
            </SettingsCard>
          </SettingsSection>
          <SettingsSection title="VPS / Infrastructure">
            <SettingsCard>
              <SettingRow label="VPS IP">
                <input className="px-3 py-2 border border-[#e8e6e1] rounded-lg text-[12px] font-mono w-[280px] bg-[#f5f4f0] text-[#9a9a92]" value={services.vps?.ip || '104.238.162.227'} readOnly />
              </SettingRow>
              <SettingRow label="Backend Port">
                <input className="px-3 py-2 border border-[#e8e6e1] rounded-lg text-[12px] font-mono w-[80px] text-center outline-none focus:border-[#3b82f6]" defaultValue={services.backend?.port || '3002'} />
              </SettingRow>
              <SettingRow label="SSL Mode" last>
                <select className="px-3 py-2 border border-[#e8e6e1] rounded-lg text-[12px] bg-white outline-none cursor-pointer">
                  <option>Cloudflare Flexible</option>
                  <option>Cloudflare Full</option>
                  <option>Cloudflare Full (Strict)</option>
                </select>
              </SettingRow>
            </SettingsCard>
          </SettingsSection>
        </>
      )}

      {/* API Keys */}
      {tab === 'api' && (
        <SettingsSection title="API Keys" desc="Manage API keys for all external services. Keys are encrypted at rest.">
          <SettingsCard>
            {envVars.filter(v => !['JWT_SECRET', 'PORT', 'NODE_ENV'].includes(v.key)).map((v, i, arr) => (
              <SettingRow key={v.key} label={v.key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/Api /g, 'API ').replace(/Jwt /g, 'JWT ')} last={i === arr.length - 1}>
                <div className="flex items-center gap-2">
                  <input className="px-3 py-2 border border-[#e8e6e1] rounded-lg text-[11px] font-mono w-[220px] outline-none focus:border-[#3b82f6]"
                    defaultValue={v.masked || ''} placeholder="Enter key..." style={v.set ? { color: '#c5c5bc', letterSpacing: '1px' } : {}} />
                  <span className={`text-[10px] font-semibold px-2.5 py-[3px] rounded-md ${v.set ? 'bg-[#edf7f0] text-[#1a6b3c]' : 'bg-[#fbeae8] text-[#c0392b]'}`}>
                    {v.set ? 'Set' : 'Not Set'}
                  </span>
                </div>
              </SettingRow>
            ))}
          </SettingsCard>
        </SettingsSection>
      )}

      {/* Model Routing */}
      {tab === 'models' && (
        <SettingsSection title="Model Routing" desc="Configure which model handles each task type. Affects cost and quality.">
          <SettingsCard>
            {[
              { label: 'Chat - Intent Classification', desc: 'Determine which agent should handle a user message', model: 'haiku' },
              { label: 'Chat - Response Generation', desc: 'Generate conversational responses and agent outputs', model: 'sonnet' },
              { label: 'Estimating - Generate Estimate', desc: 'Create bid estimates from pricing table and scope', model: 'sonnet' },
              { label: 'Email - Draft Generation', desc: 'Write outreach and response emails', model: 'sonnet' },
              { label: 'Lead Engine - Parse Results', desc: 'Extract structured data from search results', model: 'haiku' },
              { label: 'Lead Engine - Web Search', desc: 'Discover prospects and find contact information', model: 'sonar' },
              { label: 'Reports - Section Writing', desc: 'Generate report prose from structured data', model: 'opus' },
              { label: 'Knowledge - Document Processing', desc: 'Summarize and index uploaded documents', model: 'haiku' },
            ].map((item, i, arr) => (
              <SettingRow key={item.label} label={item.label} desc={item.desc} last={false}>
                <select className="px-3 py-2 border border-[#e8e6e1] rounded-lg text-[12px] bg-white outline-none cursor-pointer"
                  defaultValue={item.model}>
                  <option value="haiku">Haiku 4.5</option>
                  <option value="sonnet">Sonnet 4</option>
                  <option value="opus">Opus 4.6</option>
                  {item.model === 'sonar' && <option value="sonar">Perplexity Sonar</option>}
                </select>
              </SettingRow>
            ))}
            <SettingRow label="Max Opus Reports / Day" desc="Per-tenant daily limit on Opus report generation. Override per-tenant in Tenant settings." last>
              <input className="px-3 py-2 border border-[#e8e6e1] rounded-lg text-[12px] font-mono w-[60px] text-center outline-none focus:border-[#3b82f6]" defaultValue="1" type="number" min="0" />
            </SettingRow>
          </SettingsCard>
        </SettingsSection>
      )}

      {/* Tenant Defaults */}
      {tab === 'tenants' && (
        <SettingsSection title="Tenant Defaults" desc="Default settings applied when creating new tenants. Can be overridden per tenant.">
          <SettingsCard>
            <SettingRow label="Default Operating Mode" desc="Copilot = human approves actions. Autonomous = bot acts independently.">
              <select className="px-3 py-2 border border-[#e8e6e1] rounded-lg text-[12px] bg-white outline-none cursor-pointer">
                <option>Copilot</option>
                <option>Autonomous</option>
              </select>
            </SettingRow>
            <SettingRow label="Max Seats" desc="Default user limit per tenant">
              <input className="px-3 py-2 border border-[#e8e6e1] rounded-lg text-[12px] font-mono w-[60px] text-center outline-none focus:border-[#3b82f6]" defaultValue="5" />
            </SettingRow>
            <SettingRow label="Lead Engine - Enabled" desc="Enable Lead Engine agent for new tenants">
              <ToggleSwitch defaultOn />
            </SettingRow>
            <SettingRow label="Lead Engine - Max Emails/Day" desc="Rate limit on outbound emails per tenant">
              <input className="px-3 py-2 border border-[#e8e6e1] rounded-lg text-[12px] font-mono w-[60px] text-center outline-none focus:border-[#3b82f6]" defaultValue="10" />
            </SettingRow>
            <SettingRow label="API Spend Cap" desc="Alert when tenant exceeds this monthly API spend">
              <input className="px-3 py-2 border border-[#e8e6e1] rounded-lg text-[12px] font-mono w-[100px] outline-none focus:border-[#3b82f6]" defaultValue="$50.00" />
            </SettingRow>
            <SettingRow label="Max Opus Reports / Day" desc="Default daily Opus report limit for new tenants">
              <input className="px-3 py-2 border border-[#e8e6e1] rounded-lg text-[12px] font-mono w-[60px] text-center outline-none focus:border-[#3b82f6]" defaultValue="1" type="number" min="0" />
            </SettingRow>
            <SettingRow label="Audit Trail Retention" desc="How long to keep audit log entries" last>
              <select className="px-3 py-2 border border-[#e8e6e1] rounded-lg text-[12px] bg-white outline-none cursor-pointer">
                <option>30 days</option>
                <option>90 days</option>
                <option>1 year</option>
                <option>Forever</option>
              </select>
            </SettingRow>
          </SettingsCard>
        </SettingsSection>
      )}

      {/* Email */}
      {tab === 'email' && (
        <SettingsSection title="Email Configuration" desc="Outbound email settings for all agent communications.">
          <SettingsCard>
            <SettingRow label="Sender Email" desc="Gmail account used for outbound emails">
              <input className="px-3 py-2 border border-[#e8e6e1] rounded-lg text-[12px] font-mono w-[240px] outline-none focus:border-[#3b82f6]" defaultValue="agent@zhan.coppice.ai" />
            </SettingRow>
            <SettingRow label="Global Rate Limit" desc="Maximum emails per hour across all tenants">
              <input className="px-3 py-2 border border-[#e8e6e1] rounded-lg text-[12px] font-mono w-[60px] text-center outline-none focus:border-[#3b82f6]" defaultValue="30" />
            </SettingRow>
            <SettingRow label="Email Footer" desc="Appended to every outbound email">
              <input className="px-3 py-2 border border-[#e8e6e1] rounded-lg text-[12px] w-[240px] outline-none focus:border-[#3b82f6]" defaultValue="Powered by Coppice" />
            </SettingRow>
            <SettingRow label="BCC Admin on Outreach" desc="Send a copy of all outreach emails to admin" last>
              <ToggleSwitch />
            </SettingRow>
          </SettingsCard>
        </SettingsSection>
      )}

      {/* Danger Zone */}
      {tab === 'danger' && (
        <div className="bg-white border-2 border-[rgba(192,57,43,0.2)] rounded-2xl p-5">
          <h3 className="text-[14px] font-bold text-[#c0392b] mb-1 font-heading">Danger Zone</h3>
          <p className="text-[12px] text-[#9a9a92] mb-4">These actions are irreversible. Proceed with caution.</p>
          <div className="flex gap-2">
            <button className="px-4 py-2 rounded-[10px] text-[12px] font-semibold bg-[#c0392b] text-white border border-[#c0392b] hover:bg-[#a93226] font-heading">Reset All Demo Data</button>
            <button className="px-4 py-2 rounded-[10px] text-[12px] font-semibold bg-[#c0392b] text-white border border-[#c0392b] hover:bg-[#a93226] font-heading">Purge API Logs</button>
            <button className="px-4 py-2 rounded-[10px] text-[12px] font-semibold bg-[#c0392b] text-white border border-[#c0392b] hover:bg-[#a93226] font-heading">Delete Tenant</button>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsSection({ title, desc, children }) {
  return (
    <div className="mb-7">
      <h2 className="text-[15px] font-bold text-[#111110] mb-1 font-heading">{title}</h2>
      {desc && <p className="text-[12px] text-[#9a9a92] mb-4">{desc}</p>}
      {children}
    </div>
  );
}

function SettingsCard({ children }) {
  return <div className="bg-white border border-[#e8e6e1] rounded-2xl overflow-hidden">{children}</div>;
}

function SettingRow({ label, desc, last, children }) {
  return (
    <div className={`flex items-center justify-between px-5 py-3.5 ${last ? '' : 'border-b border-[#f0eeea]'}`}>
      <div className="flex-1 min-w-0 mr-4">
        <div className="text-[13px] font-semibold text-[#111110]">{label}</div>
        {desc && <div className="text-[11px] text-[#9a9a92] mt-0.5 leading-snug">{desc}</div>}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function ToggleSwitch({ defaultOn = false }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <button
      onClick={() => setOn(!on)}
      className={`w-11 h-6 rounded-full relative transition-colors ${on ? 'bg-[#1a6b3c]' : 'bg-[#e8e6e1]'}`}
    >
      <div className={`w-5 h-5 rounded-full bg-white shadow-sm absolute top-0.5 transition-transform ${on ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
    </button>
  );
}

// ─── System Health Page ──────────────────────────────────────────────────────

function SystemHealthPage() {
  const [health, setHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);

  const fetchHealth = useCallback(async () => {
    try {
      const res = await api.get('/v1/admin/system/health');
      setHealth(res.data);
      setLastRefresh(new Date());
    } catch (err) {
      console.error('Failed to fetch health:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchHealth(); }, [fetchHealth]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(fetchHealth, 30000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  if (loading) {
    return <div className="flex items-center justify-center py-32"><div className="spinner w-10 h-10" /></div>;
  }

  const services = health?.services || {};
  const pm2 = health?.pm2 || [];
  const envVars = health?.envVars || [];

  const allOp = health?.allOperational !== false;
  const serviceList = [
    { key: 'backend', icon: Server, color: '#1a6b3c', metrics: [
      { label: 'Port', value: services.backend?.port },
      { label: 'Node', value: services.backend?.nodeVersion },
      { label: 'Uptime', value: services.backend?.uptime ? formatUptime(services.backend.uptime) : '--' },
    ], usage: services.backend?.heapUsedMB && services.backend?.heapTotalMB ? {
      label: 'Heap Memory', used: services.backend.heapUsedMB, total: services.backend.heapTotalMB, unit: 'MB'
    } : null },
    { key: 'database', icon: Database, color: '#7c3aed', metrics: [
      { label: 'Engine', value: services.database?.engine || 'better-sqlite3' },
      { label: 'Size', value: services.database?.fileSizeMB ? `${services.database.fileSizeMB} MB` : '--' },
      { label: 'Journal', value: services.database?.journalMode || 'WAL' },
    ], usage: null },
    { key: 'nginx', icon: Shield, color: '#0ea5e9', metrics: [
      { label: 'PID', value: services.nginx?.pid || '--' },
      { label: 'Type', value: services.nginx?.type || 'Reverse Proxy' },
    ], usage: null },
    { key: 'vps', icon: HardDrive, color: '#b8860b', metrics: [
      { label: 'IP', value: services.vps?.ip || '104.238.162.227' },
      { label: 'OS', value: services.vps?.os || '--' },
      { label: 'Cost', value: services.vps?.monthlyCost ? `$${services.vps.monthlyCost}/mo` : '$1.94/mo' },
      { label: 'CPU', value: services.vps?.vcpus ? `${services.vps.vcpus} vCPU` : '--' },
    ], usage: services.vps?.ram ? {
      label: 'RAM', used: services.backend?.memoryMB || 0, total: services.vps.ram, unit: 'MB'
    } : null },
    { key: 'cloudflare', icon: Globe, color: '#1e3a5f', metrics: [
      { label: 'Domains', value: (services.cloudflare?.domains || []).length },
      { label: 'SSL', value: 'Active' },
    ], usage: null },
    { key: 'tunnel', icon: Terminal, color: '#8b5cf6', metrics: [
      { label: 'Host', value: `${services.tunnel?.host || '127.0.0.1'}:${services.tunnel?.port || 2222}` },
      { label: 'Target', value: services.tunnel?.target || 'Mac (claude CLI)' },
      { label: 'CLI Enabled', value: services.tunnel?.cliEnabled ? 'Yes' : 'No' },
      ...(services.tunnel?.oauth ? [
        { label: 'OAuth', value: services.tunnel.oauth.valid
          ? `Valid (${services.tunnel.oauth.remainingHours}h left)`
          : 'EXPIRED' },
        ...(services.tunnel.oauth.message ? [{ label: 'Alert', value: services.tunnel.oauth.message }] : []),
      ] : []),
    ], usage: null },
  ];

  return (
    <div className="p-6 lg:px-8 lg:py-6 max-w-[1200px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold text-[#111110] font-heading">System Health</h1>
          <p className="text-[13px] text-[#9a9a92] mt-0.5">
            Real-time infrastructure monitoring
            {lastRefresh && <span className="ml-2 text-[11px]">· Updated {lastRefresh.toLocaleTimeString()}</span>}
          </p>
        </div>
        <button
          onClick={() => { setLoading(true); fetchHealth(); }}
          className="flex items-center gap-1.5 px-4 py-2 rounded-[10px] text-[12px] font-semibold border border-[#e8e6e1] bg-white text-[#6b6b65] hover:bg-[#f5f4f0] transition-colors"
        >
          <RefreshCw size={13} />
          Refresh
        </button>
      </div>

      {/* Status Banner */}
      <div className={`rounded-2xl px-5 py-4 mb-6 flex items-center gap-3 ${
        allOp ? 'bg-[#edf7f0] border border-[#c8e6c9]' : 'bg-[#fbeae8] border border-[#f5c6cb]'
      }`}>
        <div className="relative">
          <div className={`w-3 h-3 rounded-full ${allOp ? 'bg-[#1a6b3c]' : 'bg-[#c0392b]'}`} />
          <div className={`absolute inset-0 w-3 h-3 rounded-full animate-ping ${allOp ? 'bg-[#1a6b3c]' : 'bg-[#c0392b]'} opacity-30`} />
        </div>
        <span className={`text-[14px] font-bold ${allOp ? 'text-[#1a6b3c]' : 'text-[#c0392b]'}`}>
          {allOp ? 'All Systems Operational' : 'System Issue Detected'}
        </span>
        <span className={`text-[12px] ml-auto ${allOp ? 'text-[#1a6b3c]/60' : 'text-[#c0392b]/60'}`}>
          {Object.keys(services).length} services monitored
        </span>
      </div>

      {/* OAuth Token Warning */}
      {services.tunnel?.oauth && (!services.tunnel.oauth.valid || services.tunnel.oauth.remainingHours < 2) && (
        <div className="rounded-2xl px-5 py-4 mb-4 flex items-center gap-3 bg-[#fdf6e8] border border-[#f0d68a]">
          <AlertTriangle size={18} className="text-[#b8860b] flex-shrink-0" />
          <div>
            <span className="text-[13px] font-bold text-[#b8860b]">
              {!services.tunnel.oauth.valid
                ? 'Claude Max OAuth Token Expired'
                : `OAuth Token Expires in ${services.tunnel.oauth.remainingHours}h`}
            </span>
            <p className="text-[11px] text-[#b8860b]/70 mt-0.5">
              {!services.tunnel.oauth.valid
                ? 'Agent tasks will fail. Run a Claude Code session on the Mac to refresh, then the wrapper script will auto-update the cached token.'
                : 'Token will expire soon. Start a Claude Code session on the Mac to refresh it automatically.'}
            </p>
          </div>
        </div>
      )}

      {/* Service Cards Grid */}
      <Section title="Services">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {serviceList.map((svc) => {
            const data = services[svc.key] || {};
            const status = data.status || 'unknown';
            return (
              <ServiceCard
                key={svc.key}
                name={data.name || svc.key}
                type={data.type || ''}
                icon={svc.icon}
                iconColor={svc.color}
                status={status}
                metrics={svc.metrics}
                usage={svc.usage}
              />
            );
          })}
        </div>
      </Section>

      {/* PM2 Processes */}
      {pm2.length > 0 && (
        <Section title="PM2 Processes">
          <div className="bg-white border border-[#e8e6e1] rounded-2xl overflow-hidden">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr>
                  {['ID', 'Name', 'Mode', 'PID', 'Status', 'CPU', 'Memory', 'Uptime', 'Restarts'].map(h => (
                    <th key={h} className="text-left px-3.5 py-2.5 bg-[#f5f4f0] border-b border-[#e8e6e1] font-bold text-[#6b6b65] text-[10px] uppercase tracking-[0.5px] font-heading">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pm2.map(p => (
                  <tr key={p.pm_id} className="hover:bg-[#f5f4f0]">
                    <td className="px-3.5 py-2.5 border-b border-[#f0eeea] font-mono text-[11px]">{p.pm_id}</td>
                    <td className="px-3.5 py-2.5 border-b border-[#f0eeea] font-semibold">{p.name}</td>
                    <td className="px-3.5 py-2.5 border-b border-[#f0eeea] font-mono text-[11px] text-[#9a9a92]">{p.mode}</td>
                    <td className="px-3.5 py-2.5 border-b border-[#f0eeea] font-mono text-[11px]">{p.pid}</td>
                    <td className="px-3.5 py-2.5 border-b border-[#f0eeea]">
                      <Pm2StatusBadge status={p.status} />
                    </td>
                    <td className="px-3.5 py-2.5 border-b border-[#f0eeea] font-mono text-[11px]">{p.cpu}%</td>
                    <td className="px-3.5 py-2.5 border-b border-[#f0eeea] font-mono text-[11px]">{(p.memory / (1024 * 1024)).toFixed(1)} MB</td>
                    <td className="px-3.5 py-2.5 border-b border-[#f0eeea] font-mono text-[11px]">{formatUptime(Math.floor(p.uptime / 1000))}</td>
                    <td className="px-3.5 py-2.5 border-b border-[#f0eeea] font-mono text-[11px]">
                      <span className={p.restarts > 0 ? 'text-[#b8860b] font-semibold' : 'text-[#9a9a92]'}>{p.restarts}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Environment Variables */}
      <Section title="Environment Variables">
        <div className="bg-white border border-[#e8e6e1] rounded-2xl overflow-hidden">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                {['Variable', 'Status', 'Value'].map(h => (
                  <th key={h} className="text-left px-3.5 py-2.5 bg-[#f5f4f0] border-b border-[#e8e6e1] font-bold text-[#6b6b65] text-[10px] uppercase tracking-[0.5px] font-heading">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {envVars.map(v => (
                <tr key={v.key} className="hover:bg-[#f5f4f0]">
                  <td className="px-3.5 py-2.5 border-b border-[#f0eeea] font-mono text-[11px] font-semibold">{v.key}</td>
                  <td className="px-3.5 py-2.5 border-b border-[#f0eeea]">
                    {v.set ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#1a6b3c] bg-[#edf7f0] px-2 py-[2px] rounded-[5px]">
                        <CheckCircle size={10} /> Set
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#9a9a92] bg-[#f5f4f0] px-2 py-[2px] rounded-[5px]">
                        <XCircle size={10} /> Not Set
                      </span>
                    )}
                  </td>
                  <td className="px-3.5 py-2.5 border-b border-[#f0eeea] font-mono text-[11px] text-[#9a9a92]">
                    {v.masked || '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* System Info */}
      <Section title="Runtime">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          <MiniStat label="Platform" value={health?.system?.platform || '--'} />
          <MiniStat label="Architecture" value={health?.system?.arch || '--'} />
          <MiniStat label="Node.js" value={health?.system?.nodeVersion || '--'} />
          <MiniStat label="Process ID" value={health?.system?.pid || '--'} />
        </div>
      </Section>
    </div>
  );
}

function ServiceCard({ name, type, icon: Icon, iconColor, status, metrics, usage }) {
  const statusConfig = {
    healthy: { label: 'Healthy', cls: 'bg-[#edf7f0] text-[#1a6b3c]', dot: 'bg-[#1a6b3c]' },
    warning: { label: 'Warning', cls: 'bg-[#fdf6e8] text-[#b8860b]', dot: 'bg-[#b8860b]' },
    down: { label: 'Down', cls: 'bg-[#fbeae8] text-[#c0392b]', dot: 'bg-[#c0392b]' },
    unknown: { label: 'Unknown', cls: 'bg-[#f5f4f0] text-[#9a9a92]', dot: 'bg-[#9a9a92]' },
  };
  const st = statusConfig[status] || statusConfig.unknown;

  return (
    <div className="bg-white border border-[#e8e6e1] rounded-[14px] p-4 hover:border-[#d0cfc8] transition-colors">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${iconColor}12` }}>
            <Icon size={16} style={{ color: iconColor }} />
          </div>
          <div>
            <div className="text-[13px] font-bold text-[#111110] font-heading">{name}</div>
            <div className="text-[10px] text-[#9a9a92]">{type}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
          <span className={`text-[10px] font-bold py-[2px] px-2 rounded-[5px] font-mono ${st.cls}`}>{st.label}</span>
        </div>
      </div>

      {/* Metrics */}
      <div className="space-y-1.5 mb-3">
        {metrics.map(m => (
          <div key={m.label} className="flex justify-between text-[11px]">
            <span className="text-[#9a9a92]">{m.label}</span>
            <span className="font-mono font-semibold text-[10px] text-[#111110]">{m.value ?? '--'}</span>
          </div>
        ))}
      </div>

      {/* Usage Bar */}
      {usage && (
        <div className="mt-2 pt-2 border-t border-[#f0eeea]">
          <div className="flex justify-between text-[10px] mb-1">
            <span className="text-[#9a9a92]">{usage.label}</span>
            <span className="font-mono font-semibold text-[#6b6b65]">{usage.used}/{usage.total} {usage.unit}</span>
          </div>
          <div className="w-full h-1.5 bg-[#f0eeea] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(100, (usage.used / usage.total) * 100)}%`,
                background: (usage.used / usage.total) > 0.8 ? '#c0392b' : (usage.used / usage.total) > 0.6 ? '#b8860b' : '#1a6b3c',
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Pm2StatusBadge({ status }) {
  const s = (status || '').toLowerCase();
  let cls = 'bg-[#f5f4f0] text-[#9a9a92]';
  if (s === 'online') cls = 'bg-[#edf7f0] text-[#1a6b3c]';
  else if (s === 'stopping' || s === 'launching') cls = 'bg-[#fdf6e8] text-[#b8860b]';
  else if (s === 'errored' || s === 'stopped') cls = 'bg-[#fbeae8] text-[#c0392b]';
  return <span className={`text-[10px] font-bold py-[2px] px-2 rounded-[5px] uppercase font-mono ${cls}`}>{status}</span>;
}

function MiniStat({ label, value }) {
  return (
    <div className="bg-white border border-[#e8e6e1] rounded-[14px] p-4">
      <div className="text-[10px] text-[#9a9a92] font-semibold uppercase tracking-[0.5px] mb-1 font-heading">{label}</div>
      <div className="font-mono text-[14px] font-bold text-[#111110]">{value}</div>
    </div>
  );
}

// ─── Demo Requests Page ─────────────────────────────────────────────────────

function DemoRequestsPage() {
  return (
    <div className="p-6 lg:px-8 lg:py-6 max-w-[1200px]">
      <h1 className="text-[22px] font-bold text-[#111110] mb-6 font-heading">Demo Requests</h1>
      <EmptyCard>No demo requests yet. They'll show up here when someone fills out the form on coppice.ai.</EmptyCard>
    </div>
  );
}

function PlaceholderPage({ title }) {
  return (
    <div className="p-6 lg:px-8 lg:py-6 max-w-[1200px]">
      <h1 className="text-[22px] font-bold text-[#111110] mb-6 font-heading">{title}</h1>
      <EmptyCard>Coming soon</EmptyCard>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const MODEL_PRICING = {
  sonnet: { input: 3, output: 15 },
  haiku: { input: 0.80, output: 4 },
  opus: { input: 15, output: 75 },
};

function calcModelCost(row) {
  const m = (row.model || '').toLowerCase();
  let pricing = MODEL_PRICING.sonnet;
  if (m.includes('haiku')) pricing = MODEL_PRICING.haiku;
  else if (m.includes('opus')) pricing = MODEL_PRICING.opus;
  return ((row.input_tokens || 0) / 1_000_000) * pricing.input + ((row.output_tokens || 0) / 1_000_000) * pricing.output;
}

function initials(name) {
  return (name || '').split(/[\s@.]/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = ['#1e3a5f', '#1a6b3c', '#7c3aed', '#b8860b', '#c0392b', '#0ea5e9'];
function avatarColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function formatLastLogin(dateStr) {
  if (!dateStr) return 'Never';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  if (diffMs < 60000) return 'Online now';
  if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
  if (diffMs < 86400000) return `Today, ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatUptime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

function formatTime(dateStr) {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  if (diffMs > 86400000) return 'Yesterday';
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

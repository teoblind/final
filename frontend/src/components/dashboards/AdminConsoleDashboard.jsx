import React, { useState, useEffect, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../../lib/hooks/useApi';

const PERIODS = [
  { label: '7d', value: '7' },
  { label: '30d', value: '30' },
  { label: '90d', value: '90' },
];

export default function AdminConsoleDashboard() {
  const [period, setPeriod] = useState('30');
  const [tenants, setTenants] = useState([]);
  const [users, setUsers] = useState([]);
  const [usage, setUsage] = useState(null);
  const [byTenant, setByTenant] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [emailHealth, setEmailHealth] = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [reauthingTenant, setReauthingTenant] = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [tenantRes, usageRes, tenantUsageRes] = await Promise.all([
        api.get('/v1/admin/tenants'),
        api.get(`/v1/admin/usage?period=${period}`),
        api.get(`/v1/admin/usage/by-tenant?period=${period}`),
      ]);

      const tenantList = tenantRes.data?.tenants || tenantRes.data || [];
      setTenants(tenantList);

      // Collect all users from each tenant
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
      setError(null);

      // Fetch email token health (non-blocking)
      try {
        const healthRes = await api.get('/v1/admin/email/health');
        setEmailHealth(healthRes.data);
      } catch { /* non-critical */ }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load admin data');
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Listen for re-auth popup success
  useEffect(() => {
    const handler = (event) => {
      if (event.data?.type === 'email-reauth-success') {
        setReauthingTenant(null);
        // Refresh health data after re-auth
        api.post('/v1/admin/email/health/refresh').then(res => setEmailHealth(res.data)).catch(() => {});
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const fmtTokens = (n) => {
    if (n == null) return '--';
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
  };

  const fmtCost = (n) => {
    if (n == null) return '--';
    return `$${n.toFixed(4)}`;
  };

  if (loading) {
    return (
      <div className="p-6">
        <div className="flex items-center justify-center py-24">
          <div className="spinner w-10 h-10" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="flex flex-col items-center justify-center py-24 text-terminal-red">
          <p className="text-lg font-semibold mb-2">Admin Console Error</p>
          <p className="text-sm text-terminal-muted">{error}</p>
        </div>
      </div>
    );
  }

  const summary = usage?.summary || {};
  const byDay = usage?.byDay || [];

  return (
    <div className="p-6 lg:px-7 lg:py-6">
      {/* Header + Period */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-terminal-text">Admin Console</h2>
          <p className="text-xs text-terminal-muted mt-0.5">
            {tenants.length} tenants &middot; {users.length} users
          </p>
        </div>
        <div className="flex gap-1.5">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={`px-3 py-1.5 text-[12px] rounded-lg font-semibold transition-colors ${
                period === p.value
                  ? 'bg-[#1e3a5f] text-white'
                  : 'bg-terminal-panel border border-terminal-border text-terminal-muted hover:text-terminal-text'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Requests" value={summary.totalRequests?.toLocaleString() ?? '0'} />
        <StatCard label="Input Tokens" value={fmtTokens(summary.totalInputTokens)} />
        <StatCard label="Output Tokens" value={fmtTokens(summary.totalOutputTokens)} />
        <StatCard label="Estimated Cost" value={fmtCost(summary.totalCost)} accent />
      </div>

      {/* Email Token Health */}
      {emailHealth && emailHealth.tokens?.length > 0 && (
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px]">
              Email Integration Health
            </h3>
            <div className="flex items-center gap-3">
              {emailHealth.lastChecked && (
                <span className="text-[10px] text-terminal-muted">
                  Checked {new Date(emailHealth.lastChecked).toLocaleTimeString()}
                </span>
              )}
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
                className="text-[10px] font-semibold px-2.5 py-1 rounded-md bg-[#f0eeea] text-terminal-muted hover:text-terminal-text transition-colors disabled:opacity-50"
              >
                {healthLoading ? 'Checking...' : 'Refresh'}
              </button>
            </div>
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
                <div
                  key={t.label}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${borderClass}`}
                >
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                    t.status === 'healthy' ? 'bg-[#1a6b3c]' : 'bg-[#c0392b] animate-pulse'
                  }`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold text-terminal-text truncate">{t.label}</p>
                    <p className={`text-[10px] ${t.status === 'healthy' ? 'text-[#1a6b3c]' : 'text-[#c0392b]'}`}>
                      {t.status === 'healthy' ? 'Token valid' : 'Token dead - needs re-auth'}
                    </p>
                    {/* Expiry countdown */}
                    {t.status === 'healthy' && t.expiresInDays != null && (
                      <p className={`text-[9px] mt-0.5 ${
                        t.expiryWarning === 'critical' ? 'text-[#c0392b] font-semibold'
                          : t.expiryWarning === 'warning' ? 'text-[#d4a017]'
                          : 'text-terminal-muted'
                      }`}>
                        Expires in ~{t.expiresInDays}d
                      </p>
                    )}
                    {t.isEnvVar && (
                      <p className="text-[9px] text-terminal-muted mt-0.5">Env var - manual re-auth</p>
                    )}
                    {t.error && t.status !== 'healthy' && (
                      <p className="text-[9px] text-terminal-muted truncate mt-0.5">{t.error}</p>
                    )}
                  </div>
                  {/* Re-Auth button */}
                  {!t.isEnvVar && (
                    <button
                      onClick={() => {
                        setReauthingTenant(t.tenantId);
                        const session = JSON.parse(sessionStorage.getItem('coppice_session') || '{}');
                        const jwt = session?.tokens?.accessToken || localStorage.getItem('accessToken') || localStorage.getItem('token');
                        window.open(
                          `/api/v1/admin/email/reauth/start?tenantId=${encodeURIComponent(t.tenantId)}&token=${encodeURIComponent(jwt)}`,
                          'reauth',
                          'width=600,height=700'
                        );
                      }}
                      className={`text-[9px] font-semibold px-2 py-1 rounded-md flex-shrink-0 transition-colors ${
                        t.status !== 'healthy' || t.expiryWarning === 'critical'
                          ? 'bg-[#c0392b] text-white hover:bg-[#a93226]'
                          : 'bg-[#f0eeea] text-terminal-muted hover:text-terminal-text'
                      }`}
                    >
                      {reauthingTenant === t.tenantId ? 'Waiting...' : 'Re-Auth'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Two-column: Chart + By-Model */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4 mb-6">
        {/* Daily Chart */}
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] p-5">
          <h3 className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px] mb-4">
            Requests Per Day
          </h3>
          {byDay.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={byDay}>
                <XAxis
                  dataKey="day"
                  tick={{ fill: '#9a9a92', fontSize: 10 }}
                  tickFormatter={(v) => v.slice(5)}
                  axisLine={{ stroke: '#e8e6e1' }}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: '#9a9a92', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={30}
                />
                <Tooltip
                  contentStyle={{ background: '#fff', border: '1px solid #e8e6e1', borderRadius: 10, fontSize: 12, fontFamily: 'Instrument Sans, sans-serif' }}
                  labelStyle={{ color: '#6b6b65' }}
                  formatter={(value, name) => {
                    if (name === 'requests') return [value, 'Requests'];
                    return [fmtTokens(value), name === 'input_tokens' ? 'Input' : 'Output'];
                  }}
                />
                <Bar dataKey="requests" fill="#1e3a5f" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[180px] text-terminal-muted text-sm">No data for this period</div>
          )}
        </div>

        {/* By Model */}
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] p-5">
          <h3 className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px] mb-4">
            By Model
          </h3>
          {usage?.byModel?.length > 0 ? (
            <div className="space-y-3">
              {usage.byModel.map((row) => {
                const total = (row.input_tokens || 0) + (row.output_tokens || 0);
                const maxTokens = Math.max(...usage.byModel.map(r => (r.input_tokens || 0) + (r.output_tokens || 0)), 1);
                const pct = (total / maxTokens) * 100;
                return (
                  <div key={row.model}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[12px] font-medium text-terminal-text truncate max-w-[200px]">{row.model || 'unknown'}</span>
                      <span className="text-[11px] text-terminal-muted tabular-nums">{row.requests} req</span>
                    </div>
                    <div className="h-1.5 bg-[#f0eeea] rounded-full overflow-hidden">
                      <div className="h-full bg-[#1e3a5f] rounded-full transition-all duration-500" style={{ width: `${Math.max(pct, 2)}%` }} />
                    </div>
                    <div className="flex justify-between mt-0.5">
                      <span className="text-[10px] text-terminal-muted">{fmtTokens(row.input_tokens)} in</span>
                      <span className="text-[10px] text-terminal-muted">{fmtTokens(row.output_tokens)} out</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center justify-center h-[180px] text-terminal-muted text-sm">No data</div>
          )}
        </div>
      </div>

      {/* Two-column: Spend by Tenant + Users */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Spend by Tenant */}
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#f0eeea] flex items-center justify-between">
            <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Spend by Tenant</span>
            <span className="text-[11px] text-terminal-muted">{byTenant.length} tenants</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-[#f0eeea] text-[10px] text-terminal-muted uppercase tracking-[0.5px]">
                  <th className="px-5 py-2 text-left font-bold">Tenant</th>
                  <th className="px-5 py-2 text-right font-bold">Requests</th>
                  <th className="px-5 py-2 text-right font-bold">Tokens</th>
                  <th className="px-5 py-2 text-right font-bold">Cost</th>
                </tr>
              </thead>
              <tbody>
                {byTenant.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-5 py-8 text-center text-terminal-muted text-[13px]">
                      No usage data for this period
                    </td>
                  </tr>
                ) : (
                  byTenant.map((t) => (
                    <tr key={t.tenantId} className="border-b border-[#f0eeea] last:border-b-0 hover:bg-[#f5f4f0] transition-colors">
                      <td className="px-5 py-2.5 text-terminal-text font-medium">{t.tenantName}</td>
                      <td className="px-5 py-2.5 text-right text-terminal-text tabular-nums">{t.requests.toLocaleString()}</td>
                      <td className="px-5 py-2.5 text-right text-terminal-muted tabular-nums">{fmtTokens(t.inputTokens + t.outputTokens)}</td>
                      <td className="px-5 py-2.5 text-right font-semibold text-[#1e3a5f] tabular-nums">{fmtCost(t.cost)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Users */}
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-[#f0eeea] flex items-center justify-between">
            <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Users</span>
            <span className="text-[11px] text-terminal-muted">{users.length} total</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-[#f0eeea] text-[10px] text-terminal-muted uppercase tracking-[0.5px]">
                  <th className="px-5 py-2 text-left font-bold">Name</th>
                  <th className="px-5 py-2 text-left font-bold">Email</th>
                  <th className="px-5 py-2 text-left font-bold">Tenant</th>
                  <th className="px-5 py-2 text-left font-bold">Role</th>
                  <th className="px-5 py-2 text-left font-bold">Status</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-8 text-center text-terminal-muted text-[13px]">
                      No users found
                    </td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr key={u.id} className="border-b border-[#f0eeea] last:border-b-0 hover:bg-[#f5f4f0] transition-colors">
                      <td className="px-5 py-2.5 text-terminal-text font-medium">{u.name || '--'}</td>
                      <td className="px-5 py-2.5 text-terminal-muted">{u.email}</td>
                      <td className="px-5 py-2.5 text-terminal-muted">{u.tenantName || u.tenant_id}</td>
                      <td className="px-5 py-2.5">
                        <RoleBadge role={u.role} />
                      </td>
                      <td className="px-5 py-2.5">
                        <StatusBadge status={u.status} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Small Components ───────────────────────────────────────────────────────

function StatCard({ label, value, accent }) {
  return (
    <div className="bg-terminal-panel border border-terminal-border rounded-[14px] p-5">
      <p className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px] mb-1.5">
        {label}
      </p>
      <p className={`text-2xl font-bold tabular-nums ${accent ? 'text-[#1e3a5f]' : 'text-terminal-text'}`}>{value}</p>
    </div>
  );
}

function RoleBadge({ role }) {
  const r = (role || '').toLowerCase();
  if (r.includes('admin')) {
    return <span className="text-[9px] font-bold uppercase tracking-[0.3px] px-2 py-[3px] rounded-md bg-[#eef3f9] text-[#1e3a5f]">{role}</span>;
  }
  return <span className="text-[9px] font-bold uppercase tracking-[0.3px] px-2 py-[3px] rounded-md bg-[#f5f4f0] text-terminal-muted">{role}</span>;
}

function StatusBadge({ status }) {
  const s = (status || '').toLowerCase();
  if (s === 'active') {
    return <span className="text-[9px] font-bold uppercase tracking-[0.3px] px-2 py-[3px] rounded-md bg-[#edf7f0] text-[#1a6b3c]">Active</span>;
  }
  if (s === 'suspended' || s === 'disabled') {
    return <span className="text-[9px] font-bold uppercase tracking-[0.3px] px-2 py-[3px] rounded-md bg-[#fbeae8] text-[#c0392b]">{status}</span>;
  }
  return <span className="text-[9px] font-bold uppercase tracking-[0.3px] px-2 py-[3px] rounded-md bg-[#f5f4f0] text-terminal-muted">{status || 'Unknown'}</span>;
}

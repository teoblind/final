import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle, BarChart3, Building2, CheckCircle, ChevronDown, ChevronRight,
  ChevronUp, ClipboardList, DollarSign, FileCheck, HardHat, Shield,
  TrendingUp, Truck, Users, XCircle, Megaphone, Clock, AlertCircle, Activity
} from 'lucide-react';

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

const SEVERITY_STYLES = {
  critical: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', dot: 'bg-red-500', badge: 'bg-red-100 text-red-700' },
  high: { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', dot: 'bg-orange-500', badge: 'bg-orange-100 text-orange-700' },
  medium: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', dot: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700' },
  low: { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-600', dot: 'bg-gray-400', badge: 'bg-gray-100 text-gray-600' },
};

const HEALTH_COLORS = {
  good: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', ring: 'text-emerald-500' },
  warning: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', ring: 'text-amber-500' },
  danger: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', ring: 'text-red-500' },
};

function getHealthLevel(score) {
  if (score >= 75) return 'good';
  if (score >= 50) return 'warning';
  return 'danger';
}

function HealthRing({ score, size = 56 }) {
  const level = getHealthLevel(score);
  const colors = HEALTH_COLORS[level];
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#e5e7eb" strokeWidth="4" />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor"
          strokeWidth="4" strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
          className={`${colors.ring} transition-all duration-700`} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={`text-sm font-bold tabular-nums ${colors.text}`}>{score}</span>
      </div>
    </div>
  );
}

function DepartmentCard({ title, icon: Icon, iconBg, iconColor, health, stats, redFlagCount, expanded, onToggle, onNavigate, chatTab, children }) {
  const level = getHealthLevel(health);
  const colors = HEALTH_COLORS[level];

  return (
    <div className={`bg-terminal-panel border rounded-[14px] overflow-hidden transition-all ${
      redFlagCount > 0 ? 'border-orange-200' : 'border-terminal-border'
    }`}>
      <div className="p-5 cursor-pointer hover:bg-[#f5f4f0] transition-colors" onClick={onToggle}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-[10px] ${iconBg} flex items-center justify-center`}>
              <Icon size={18} className={iconColor} />
            </div>
            <div>
              <div className="text-[13px] font-heading font-semibold text-terminal-text">{title}</div>
              {redFlagCount > 0 && (
                <div className="text-[10px] font-semibold text-orange-600 mt-0.5">{redFlagCount} alert{redFlagCount > 1 ? 's' : ''}</div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <HealthRing score={health} size={44} />
            {expanded ? <ChevronUp size={16} className="text-terminal-muted" /> : <ChevronDown size={16} className="text-terminal-muted" />}
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-3 gap-3">
          {stats.map((s, i) => (
            <div key={i} className="text-center">
              <div className="text-lg font-display font-bold text-terminal-text tabular-nums">{s.value}</div>
              <div className="text-[9px] font-heading font-bold text-terminal-muted uppercase tracking-[0.5px]">{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[#f0eeea]">
          {children}
          {chatTab && (
            <div className="px-5 py-3 border-t border-[#f0eeea]">
              <button
                onClick={(e) => { e.stopPropagation(); onNavigate?.(chatTab); }}
                className="text-[11px] font-heading font-semibold text-[#1e3a5f] hover:underline flex items-center gap-1.5"
              >
                <ChevronRight size={12} /> Open {title} Agent
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CeoDashboard({ onNavigate }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState({});
  const [showAllFlags, setShowAllFlags] = useState(false);

  const fetchDashboard = useCallback(() => {
    fetch(`${API_BASE}/v1/ceo/dashboard`, { headers: getAuthHeaders() })
      .then(r => r.json())
      .then(d => setData(d))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchDashboard();
    const poll = setInterval(fetchDashboard, 15_000);
    return () => clearInterval(poll);
  }, [fetchDashboard]);

  const toggleExpand = (dept) => setExpanded(prev => ({ ...prev, [dept]: !prev[dept] }));

  if (loading) {
    return <div className="flex items-center justify-center py-24"><div className="spinner w-10 h-10" /></div>;
  }

  if (!data) {
    return <div className="flex items-center justify-center py-24 text-terminal-muted text-sm">Failed to load dashboard.</div>;
  }

  const { stats, redFlags, health } = data;
  const criticalFlags = redFlags.filter(f => f.severity === 'critical' || f.severity === 'high');
  const displayFlags = showAllFlags ? redFlags : redFlags.slice(0, 6);
  const flagsByDept = {};
  for (const f of redFlags) {
    flagsByDept[f.department] = (flagsByDept[f.department] || 0) + 1;
  }

  const fmtDollars = (v) => {
    if (v >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(1)}B`;
    if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
    return `$${v.toLocaleString()}`;
  };

  return (
    <div className="p-6 lg:px-7 lg:py-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-heading font-bold text-terminal-text tracking-tight">CEO Command Center</h1>
          <p className="text-[11px] text-terminal-muted mt-0.5">All departments reporting. Last updated {new Date(data.fetchedAt).toLocaleTimeString()}.</p>
        </div>
        <div className="flex items-center gap-3">
          <HealthRing score={health.overall} size={64} />
          <div className="text-right">
            <div className="text-[10px] font-heading font-bold text-terminal-muted uppercase tracking-[1px]">Overall Health</div>
            <div className={`text-sm font-semibold ${HEALTH_COLORS[getHealthLevel(health.overall)].text}`}>
              {health.overall >= 75 ? 'Good' : health.overall >= 50 ? 'Needs Attention' : 'Critical'}
            </div>
          </div>
        </div>
      </div>

      {/* Red Flags Panel */}
      {redFlags.length > 0 && (
        <div className={`mb-6 rounded-[14px] border overflow-hidden ${
          criticalFlags.length > 0 ? 'bg-red-50/50 border-red-200' : 'bg-amber-50/50 border-amber-200'
        }`}>
          <div className="px-5 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <AlertTriangle size={16} className={criticalFlags.length > 0 ? 'text-red-600' : 'text-amber-600'} />
              <span className={`text-[12px] font-heading font-bold ${criticalFlags.length > 0 ? 'text-red-700' : 'text-amber-700'}`}>
                {redFlags.length} Red Flag{redFlags.length > 1 ? 's' : ''} Detected
              </span>
              {criticalFlags.length > 0 && (
                <span className="text-[10px] font-bold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                  {criticalFlags.length} CRITICAL/HIGH
                </span>
              )}
            </div>
            {redFlags.length > 6 && (
              <button onClick={() => setShowAllFlags(v => !v)} className="text-[10px] font-semibold text-terminal-muted hover:text-terminal-text">
                {showAllFlags ? 'Show Less' : `Show All (${redFlags.length})`}
              </button>
            )}
          </div>
          <div className="border-t border-red-100">
            {displayFlags.map((flag, i) => {
              const s = SEVERITY_STYLES[flag.severity] || SEVERITY_STYLES.medium;
              return (
                <div key={i} className={`px-5 py-2.5 border-b last:border-b-0 border-red-100/50 flex items-start gap-3 ${s.bg}`}>
                  <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${s.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${s.badge}`}>{flag.department}</span>
                      <span className={`text-[11px] font-semibold ${s.text}`}>{flag.title}</span>
                    </div>
                    <p className="text-[10px] text-terminal-muted mt-0.5 truncate">{flag.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Top-Level KPI Tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="bg-terminal-panel border border-terminal-border rounded-[12px] p-4">
          <div className="text-[9px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1">Pipeline Value</div>
          <div className="text-xl font-display font-bold text-terminal-text tabular-nums">{fmtDollars(stats.estimating.totalPipelineValue)}</div>
          <div className="text-[10px] text-[#1a6b3c] font-semibold">{stats.estimating.activeBids} active bids</div>
        </div>
        <div className="bg-terminal-panel border border-terminal-border rounded-[12px] p-4">
          <div className="text-[9px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1">Active Jobs</div>
          <div className="text-xl font-display font-bold text-terminal-text tabular-nums">{stats.estimating.activeJobs}</div>
          <div className="text-[10px] text-terminal-muted">{fmtDollars(stats.estimating.totalJobValue)} total value</div>
        </div>
        <div className="bg-terminal-panel border border-terminal-border rounded-[12px] p-4">
          <div className="text-[9px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1">Pumping Revenue (30d)</div>
          <div className="text-xl font-display font-bold text-terminal-text tabular-nums">{fmtDollars(stats.pumping.revenue30d)}</div>
          <div className={`text-[10px] font-semibold ${stats.pumping.overdueInvoices > 0 ? 'text-red-600' : 'text-[#1a6b3c]'}`}>
            {stats.pumping.overdueInvoices > 0 ? `${stats.pumping.overdueInvoices} overdue invoices` : 'All invoices current'}
          </div>
        </div>
        <div className="bg-terminal-panel border border-terminal-border rounded-[12px] p-4">
          <div className="text-[9px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1">BD Pipeline</div>
          <div className="text-xl font-display font-bold text-terminal-text tabular-nums">{fmtDollars(stats.marketing.totalPipelineValue)}</div>
          <div className="text-[10px] text-terminal-muted">{stats.marketing.qualifiedLeads} qualified leads</div>
        </div>
      </div>

      {/* Department Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Estimating */}
        <DepartmentCard
          title="Estimating"
          icon={ClipboardList}
          iconBg="bg-[#fdf6e8]"
          iconColor="text-[#b8860b]"
          health={health.estimating}
          redFlagCount={flagsByDept.estimating || 0}
          expanded={expanded.estimating}
          onToggle={() => toggleExpand('estimating')}
          onNavigate={onNavigate}
          chatTab="workflow-chat"
          stats={[
            { label: 'Open RFQs', value: stats.estimating.pendingBids },
            { label: 'Avg Margin', value: `${stats.estimating.avgMargin.toFixed(1)}%` },
            { label: 'Completed', value: stats.estimating.completedJobs },
          ]}
        >
          <div className="px-5 py-3 space-y-2">
            <div className="flex justify-between text-[11px]">
              <span className="text-terminal-muted">Total bid requests</span>
              <span className="font-semibold text-terminal-text">{stats.estimating.totalBids}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-terminal-muted">Pipeline value</span>
              <span className="font-semibold text-terminal-text">{fmtDollars(stats.estimating.totalPipelineValue)}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-terminal-muted">Active jobs value</span>
              <span className="font-semibold text-terminal-text">{fmtDollars(stats.estimating.totalJobValue)}</span>
            </div>
            {stats.estimating.overdueItems > 0 && (
              <div className="flex justify-between text-[11px]">
                <span className="text-red-600 font-semibold">Overdue bid responses</span>
                <span className="font-bold text-red-600">{stats.estimating.overdueItems}</span>
              </div>
            )}
          </div>
        </DepartmentCard>

        {/* Concrete Pumping */}
        <DepartmentCard
          title="Concrete Pumping"
          icon={Truck}
          iconBg="bg-[#e8eef5]"
          iconColor="text-[#1e3a5f]"
          health={health.pumping}
          redFlagCount={flagsByDept.pumping || 0}
          expanded={expanded.pumping}
          onToggle={() => toggleExpand('pumping')}
          onNavigate={onNavigate}
          chatTab="pumping-chat"
          stats={[
            { label: 'Scheduled', value: stats.pumping.scheduledJobs },
            { label: 'Revenue (30d)', value: fmtDollars(stats.pumping.revenue30d) },
            { label: 'Equipment', value: `${stats.pumping.availableEquipment}/${stats.pumping.totalEquipment}` },
          ]}
        >
          <div className="px-5 py-3 space-y-2">
            <div className="flex justify-between text-[11px]">
              <span className="text-terminal-muted">Completed jobs (30d)</span>
              <span className="font-semibold text-terminal-text">{stats.pumping.completedJobs30d}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-terminal-muted">Equipment in maintenance</span>
              <span className={`font-semibold ${stats.pumping.maintenanceEquipment > 0 ? 'text-amber-600' : 'text-terminal-text'}`}>{stats.pumping.maintenanceEquipment}</span>
            </div>
            {stats.pumping.overdueInvoices > 0 && (
              <div className="flex justify-between text-[11px]">
                <span className="text-red-600 font-semibold">Overdue invoices</span>
                <span className="font-bold text-red-600">{stats.pumping.overdueInvoices} ({fmtDollars(stats.pumping.overdueAmount)})</span>
              </div>
            )}
            {stats.pumping.pendingInvoices > 0 && (
              <div className="flex justify-between text-[11px]">
                <span className="text-amber-600 font-semibold">Not yet invoiced</span>
                <span className="font-bold text-amber-600">{stats.pumping.pendingInvoices} jobs</span>
              </div>
            )}
          </div>
        </DepartmentCard>

        {/* Marketing */}
        <DepartmentCard
          title="Marketing & BD"
          icon={Megaphone}
          iconBg="bg-[#f0e8f5]"
          iconColor="text-[#7c3aed]"
          health={health.marketing}
          redFlagCount={flagsByDept.marketing || 0}
          expanded={expanded.marketing}
          onToggle={() => toggleExpand('marketing')}
          onNavigate={onNavigate}
          chatTab="marketing-chat"
          stats={[
            { label: 'Total Leads', value: stats.marketing.totalLeads },
            { label: 'Response Rate', value: `${stats.marketing.responseRate}%` },
            { label: 'Campaigns', value: stats.marketing.activeCampaigns },
          ]}
        >
          <div className="px-5 py-3 space-y-2">
            <div className="flex justify-between text-[11px]">
              <span className="text-terminal-muted">New leads</span>
              <span className="font-semibold text-terminal-text">{stats.marketing.newLeads}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-terminal-muted">Qualified leads</span>
              <span className="font-semibold text-[#1a6b3c]">{stats.marketing.qualifiedLeads}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-terminal-muted">Proposals sent</span>
              <span className="font-semibold text-terminal-text">{stats.marketing.proposalsSent}</span>
            </div>
            <div className="flex justify-between text-[11px]">
              <span className="text-terminal-muted">Pipeline value</span>
              <span className="font-semibold text-terminal-text">{fmtDollars(stats.marketing.totalPipelineValue)}</span>
            </div>
            {stats.marketing.staleLeads > 0 && (
              <div className="flex justify-between text-[11px]">
                <span className="text-amber-600 font-semibold">Stale leads (no response)</span>
                <span className="font-bold text-amber-600">{stats.marketing.staleLeads}</span>
              </div>
            )}
          </div>
        </DepartmentCard>

        {/* Compliance */}
        <DepartmentCard
          title="Compliance & Safety"
          icon={Shield}
          iconBg="bg-[#e8f5ee]"
          iconColor="text-[#1a6b3c]"
          health={health.compliance}
          redFlagCount={flagsByDept.compliance || 0}
          expanded={expanded.compliance}
          onToggle={() => toggleExpand('compliance')}
          onNavigate={onNavigate}
          chatTab="compliance-chat"
          stats={[
            { label: 'Active Items', value: stats.compliance.activeItems },
            { label: 'Expiring Soon', value: stats.compliance.expiringSoon },
            { label: 'Open Incidents', value: stats.compliance.openIncidents },
          ]}
        >
          <div className="px-5 py-3 space-y-2">
            <div className="flex justify-between text-[11px]">
              <span className="text-terminal-muted">Total tracked items</span>
              <span className="font-semibold text-terminal-text">{stats.compliance.totalItems}</span>
            </div>
            {stats.compliance.expired > 0 && (
              <div className="flex justify-between text-[11px]">
                <span className="text-red-600 font-bold">EXPIRED ITEMS</span>
                <span className="font-bold text-red-600">{stats.compliance.expired}</span>
              </div>
            )}
            {stats.compliance.expiringSoon > 0 && (
              <div className="flex justify-between text-[11px]">
                <span className="text-amber-600 font-semibold">Expiring within 60 days</span>
                <span className="font-bold text-amber-600">{stats.compliance.expiringSoon}</span>
              </div>
            )}
            {stats.compliance.highSeverityOpen > 0 && (
              <div className="flex justify-between text-[11px]">
                <span className="text-red-600 font-semibold">High-severity incidents open</span>
                <span className="font-bold text-red-600">{stats.compliance.highSeverityOpen}</span>
              </div>
            )}

            {/* Upcoming renewals */}
            {stats.compliance.upcomingRenewals?.length > 0 && (
              <div className="mt-3 pt-2 border-t border-[#f0eeea]">
                <div className="text-[10px] font-heading font-bold text-terminal-muted uppercase tracking-[0.5px] mb-1.5">Upcoming Renewals</div>
                {stats.compliance.upcomingRenewals.slice(0, 4).map((item, i) => (
                  <div key={i} className="flex items-center justify-between py-1">
                    <div className="text-[10px] text-terminal-text truncate flex-1">{item.name}</div>
                    <div className={`text-[10px] font-semibold ${item.status === 'expiring_soon' ? 'text-amber-600' : 'text-terminal-muted'}`}>
                      {item.expiry_date}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Expired items detail */}
            {stats.compliance.expiredItems?.length > 0 && (
              <div className="mt-3 pt-2 border-t border-red-100">
                <div className="text-[10px] font-heading font-bold text-red-600 uppercase tracking-[0.5px] mb-1.5">Expired - Action Required</div>
                {stats.compliance.expiredItems.map((item, i) => (
                  <div key={i} className="flex items-center justify-between py-1">
                    <div className="text-[10px] text-red-700 truncate flex-1">{item.name}</div>
                    <div className="text-[10px] font-bold text-red-600">Expired {item.expiry_date}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DepartmentCard>
      </div>
    </div>
  );
}

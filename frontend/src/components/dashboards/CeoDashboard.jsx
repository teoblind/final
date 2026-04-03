import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle, BarChart3, Building2, CheckCircle, ChevronDown, ChevronRight,
  ChevronUp, ClipboardList, DollarSign, FileCheck, HardHat, Shield,
  TrendingUp, Truck, Users, XCircle, Megaphone, Clock, AlertCircle, Activity,
  Mail, FileText, Calendar, ArrowRight, Eye, X,
  Star, ArrowLeft, Briefcase, MapPin, Map, Plus, Minus, Navigation,
  ExternalLink, Check, Trash2, GripVertical
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
  const [bidFunnel, setBidFunnel] = useState(null);
  const [newsletterLeads, setNewsletterLeads] = useState(null);
  const [newsletters, setNewsletters] = useState(null);
  const [selectedNewsletter, setSelectedNewsletter] = useState(null);
  const [newsletterHtml, setNewsletterHtml] = useState('');
  const [gcProfiles, setGcProfiles] = useState(null);
  const [selectedGc, setSelectedGc] = useState(null);
  const [gcDetail, setGcDetail] = useState(null);
  const [gcDetailLoading, setGcDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('departments'); // departments | funnel | leads | newsletters | gc-profiles | sales-trips

  // Sales Trips state
  const [salesTrips, setSalesTrips] = useState(null);
  const [tripSuggestions, setTripSuggestions] = useState(null);
  const [gcOffices, setGcOffices] = useState(null);
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [showCreateTrip, setShowCreateTrip] = useState(false);
  const [newTripName, setNewTripName] = useState('');
  const [newTripDate, setNewTripDate] = useState('');
  const [newTripStops, setNewTripStops] = useState([]);
  const [suggestionsExpanded, setSuggestionsExpanded] = useState(true);
  const [expandedTalkingPoints, setExpandedTalkingPoints] = useState({});
  const [tripDetailLoading, setTripDetailLoading] = useState(false);
  const [creatingTrip, setCreatingTrip] = useState(false);

  const fetchDashboard = useCallback(() => {
    fetch(`${API_BASE}/v1/ceo/dashboard`, { headers: getAuthHeaders() })
      .then(r => r.json())
      .then(d => setData(d))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const fetchBidFunnel = useCallback(() => {
    fetch(`${API_BASE}/v1/ceo/bid-funnel`, { headers: getAuthHeaders() })
      .then(r => r.json())
      .then(d => setBidFunnel(d))
      .catch(console.error);
  }, []);

  const fetchNewsletterLeads = useCallback(() => {
    fetch(`${API_BASE}/v1/ceo/newsletter-leads`, { headers: getAuthHeaders() })
      .then(r => r.json())
      .then(d => setNewsletterLeads(d))
      .catch(console.error);
  }, []);

  const fetchNewsletters = useCallback(() => {
    fetch(`${API_BASE}/v1/ceo/newsletters`, { headers: getAuthHeaders() })
      .then(r => r.json())
      .then(d => setNewsletters(d))
      .catch(console.error);
  }, []);

  const openNewsletter = useCallback((id) => {
    setSelectedNewsletter(id);
    fetch(`${API_BASE}/v1/ceo/newsletters/${id}`, { headers: getAuthHeaders() })
      .then(r => r.json())
      .then(d => setNewsletterHtml(d.content || ''))
      .catch(console.error);
  }, []);

  const fetchGcProfiles = useCallback(() => {
    fetch(`${API_BASE}/v1/ceo/gc-profiles`, { headers: getAuthHeaders() })
      .then(r => r.json())
      .then(d => setGcProfiles(d))
      .catch(console.error);
  }, []);

  const openGcProfile = useCallback((gcName) => {
    setSelectedGc(gcName);
    setGcDetailLoading(true);
    fetch(`${API_BASE}/v1/ceo/gc-profiles/${encodeURIComponent(gcName)}`, { headers: getAuthHeaders() })
      .then(r => r.json())
      .then(d => { setGcDetail(d); setGcDetailLoading(false); })
      .catch(e => { console.error(e); setGcDetailLoading(false); });
  }, []);

  const fetchSalesTrips = useCallback(() => {
    fetch(`${API_BASE}/v1/ceo/sales-trips`, { headers: getAuthHeaders() })
      .then(r => r.json())
      .then(d => setSalesTrips(d))
      .catch(console.error);
  }, []);

  const fetchTripSuggestions = useCallback(() => {
    fetch(`${API_BASE}/v1/ceo/sales-trips/suggestions`, { headers: getAuthHeaders() })
      .then(r => r.json())
      .then(d => setTripSuggestions(d))
      .catch(console.error);
  }, []);

  const fetchGcOffices = useCallback(() => {
    fetch(`${API_BASE}/v1/ceo/gc-offices`, { headers: getAuthHeaders() })
      .then(r => r.json())
      .then(d => setGcOffices(d))
      .catch(console.error);
  }, []);

  const openTripDetail = useCallback((tripId) => {
    setTripDetailLoading(true);
    fetch(`${API_BASE}/v1/ceo/sales-trips/${tripId}`, { headers: getAuthHeaders() })
      .then(r => r.json())
      .then(d => { setSelectedTrip(d); setTripDetailLoading(false); })
      .catch(e => { console.error(e); setTripDetailLoading(false); });
  }, []);

  const createTrip = useCallback(() => {
    if (!newTripName.trim() || !newTripDate) return;
    setCreatingTrip(true);
    fetch(`${API_BASE}/v1/ceo/sales-trips`, {
      method: 'POST',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newTripName.trim(),
        date: newTripDate,
        stops: newTripStops.map((s, i) => ({ gc_name: s.gc_name, office_id: s.id, order: i + 1 })),
      }),
    })
      .then(r => r.json())
      .then(() => {
        setShowCreateTrip(false);
        setNewTripName('');
        setNewTripDate('');
        setNewTripStops([]);
        fetchSalesTrips();
      })
      .catch(console.error)
      .finally(() => setCreatingTrip(false));
  }, [newTripName, newTripDate, newTripStops, fetchSalesTrips]);

  const toggleStopVisited = useCallback((tripId, stopIndex, visited) => {
    const trip = selectedTrip;
    if (!trip) return;
    const updatedStops = (trip.stops || []).map((s, i) =>
      i === stopIndex ? { ...s, visited } : s
    );
    fetch(`${API_BASE}/v1/ceo/sales-trips/${tripId}`, {
      method: 'PUT',
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...trip, stops: updatedStops }),
    })
      .then(r => r.json())
      .then(d => setSelectedTrip(d))
      .catch(console.error);
  }, [selectedTrip]);

  useEffect(() => {
    fetchDashboard();
    fetchBidFunnel();
    fetchNewsletterLeads();
    fetchNewsletters();
    fetchGcProfiles();
    fetchSalesTrips();
    fetchTripSuggestions();
    fetchGcOffices();
    const poll = setInterval(fetchDashboard, 15_000);
    return () => clearInterval(poll);
  }, [fetchDashboard, fetchBidFunnel, fetchNewsletterLeads, fetchNewsletters, fetchGcProfiles, fetchSalesTrips, fetchTripSuggestions, fetchGcOffices]);

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

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-5 bg-[#f5f4f0] rounded-[10px] p-1">
        {[
          { id: 'departments', label: 'Departments', icon: Building2 },
          { id: 'funnel', label: 'Bid Funnel', icon: BarChart3 },
          { id: 'gc-profiles', label: 'GC Profiles', icon: Briefcase },
          { id: 'leads', label: 'Newsletter Leads', icon: Mail },
          { id: 'newsletters', label: 'Newsletters', icon: FileText },
          { id: 'sales-trips', label: 'Sales Trips', icon: MapPin },
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-[8px] text-[11px] font-heading font-semibold transition-all ${
              activeTab === tab.id
                ? 'bg-white text-terminal-text shadow-sm'
                : 'text-terminal-muted hover:text-terminal-text'
            }`}
          >
            <tab.icon size={13} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Department Cards */}
      {activeTab === 'departments' && <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
      </div>}

      {/* Bid Funnel Tab */}
      {activeTab === 'funnel' && (
        <div className="space-y-4">
          {!bidFunnel ? (
            <div className="flex items-center justify-center py-12 text-terminal-muted text-sm">Loading bid funnel...</div>
          ) : (
            <>
              {/* Funnel Summary Row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-terminal-panel border border-terminal-border rounded-[12px] p-4">
                  <div className="text-[9px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1">Total Bids</div>
                  <div className="text-xl font-display font-bold text-terminal-text tabular-nums">{bidFunnel.total}</div>
                </div>
                <div className="bg-terminal-panel border border-terminal-border rounded-[12px] p-4">
                  <div className="text-[9px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1">Active Jobs</div>
                  <div className="text-xl font-display font-bold text-terminal-text tabular-nums">{bidFunnel.activeJobs}</div>
                </div>
                <div className="bg-terminal-panel border border-terminal-border rounded-[12px] p-4">
                  <div className="text-[9px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1">Total Pipeline</div>
                  <div className="text-xl font-display font-bold text-terminal-text tabular-nums">{fmtDollars(bidFunnel.totalPipeline)}</div>
                </div>
                <div className="bg-terminal-panel border border-terminal-border rounded-[12px] p-4">
                  <div className="text-[9px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1">Statuses</div>
                  <div className="text-xl font-display font-bold text-terminal-text tabular-nums">{Object.keys(bidFunnel.byStatus || {}).length}</div>
                </div>
              </div>

              {/* Status Breakdown */}
              <div className="bg-terminal-panel border border-terminal-border rounded-[14px] p-5">
                <h3 className="text-[13px] font-heading font-semibold text-terminal-text mb-4">By Status</h3>
                <div className="space-y-2">
                  {Object.entries(bidFunnel.byStatus || {}).sort((a, b) => b[1] - a[1]).map(([status, count]) => {
                    const pct = bidFunnel.total > 0 ? (count / bidFunnel.total) * 100 : 0;
                    const statusColors = {
                      new: '#6366f1', reviewing: '#f59e0b', estimated: '#3b82f6', sent: '#8b5cf6',
                      awarded: '#10b981', declined: '#ef4444', lost: '#9ca3af', expired: '#dc2626',
                    };
                    const color = statusColors[status] || '#64748b';
                    return (
                      <div key={status} className="flex items-center gap-3">
                        <div className="w-24 text-[11px] font-semibold text-terminal-text capitalize">{status}</div>
                        <div className="flex-1 h-6 bg-[#f5f4f0] rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
                        </div>
                        <div className="w-10 text-right text-[12px] font-bold text-terminal-text tabular-nums">{count}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Size Buckets */}
              <div className="bg-terminal-panel border border-terminal-border rounded-[14px] p-5">
                <h3 className="text-[13px] font-heading font-semibold text-terminal-text mb-4">By Project Size</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {(bidFunnel.bySizeBucket || []).map((bucket, i) => (
                    <div key={i} className="text-center p-3 bg-[#f5f4f0] rounded-[10px]">
                      <div className="text-[10px] font-heading font-bold text-terminal-muted uppercase mb-1">{bucket.label}</div>
                      <div className="text-lg font-display font-bold text-terminal-text tabular-nums">{bucket.count}</div>
                      <div className="text-[10px] text-[#1a6b3c] font-semibold">{bucket.bidOn} bid on</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Monthly Trend */}
              {Object.keys(bidFunnel.byMonth || {}).length > 0 && (
                <div className="bg-terminal-panel border border-terminal-border rounded-[14px] p-5">
                  <h3 className="text-[13px] font-heading font-semibold text-terminal-text mb-4">Monthly Activity</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="border-b border-terminal-border">
                          <th className="text-left py-2 font-heading font-bold text-terminal-muted uppercase tracking-[0.5px]">Month</th>
                          <th className="text-right py-2 font-heading font-bold text-terminal-muted uppercase tracking-[0.5px]">Received</th>
                          <th className="text-right py-2 font-heading font-bold text-terminal-muted uppercase tracking-[0.5px]">Bid On</th>
                          <th className="text-right py-2 font-heading font-bold text-terminal-muted uppercase tracking-[0.5px]">Awarded</th>
                          <th className="text-right py-2 font-heading font-bold text-terminal-muted uppercase tracking-[0.5px]">Win Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(bidFunnel.byMonth).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12).map(([month, d]) => (
                          <tr key={month} className="border-b border-[#f0eeea]">
                            <td className="py-2 font-semibold text-terminal-text">{month}</td>
                            <td className="py-2 text-right tabular-nums">{d.total}</td>
                            <td className="py-2 text-right tabular-nums text-[#1e3a5f] font-semibold">{d.bidOn}</td>
                            <td className="py-2 text-right tabular-nums text-[#1a6b3c] font-semibold">{d.awarded}</td>
                            <td className="py-2 text-right tabular-nums font-semibold">
                              {d.bidOn > 0 ? `${Math.round((d.awarded / d.bidOn) * 100)}%` : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Recent Bids */}
              {bidFunnel.recentBids?.length > 0 && (
                <div className="bg-terminal-panel border border-terminal-border rounded-[14px] p-5">
                  <h3 className="text-[13px] font-heading font-semibold text-terminal-text mb-4">Recent Bid Requests</h3>
                  <div className="space-y-2">
                    {bidFunnel.recentBids.map((bid, i) => (
                      <div key={i} className="flex items-center justify-between py-2 border-b border-[#f0eeea] last:border-0">
                        <div className="flex-1 min-w-0">
                          <div className="text-[12px] font-semibold text-terminal-text truncate">{bid.subject || 'Untitled'}</div>
                          <div className="text-[10px] text-terminal-muted">{bid.gcName} - Due: {bid.dueDate || 'N/A'}</div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {bid.estimateValue && (
                            <span className="text-[11px] font-bold text-terminal-text tabular-nums">{fmtDollars(bid.estimateValue)}</span>
                          )}
                          <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${
                            bid.status === 'awarded' ? 'bg-emerald-100 text-emerald-700' :
                            bid.status === 'sent' ? 'bg-purple-100 text-purple-700' :
                            bid.status === 'estimated' ? 'bg-blue-100 text-blue-700' :
                            bid.status === 'declined' || bid.status === 'lost' ? 'bg-red-100 text-red-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>{bid.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* GC Profiles Tab */}
      {activeTab === 'gc-profiles' && (
        <div className="space-y-4">
          {selectedGc ? (
            // ─── GC Detail View ──────────────────────────────────────────
            <div>
              <button
                onClick={() => { setSelectedGc(null); setGcDetail(null); }}
                className="flex items-center gap-1.5 text-[11px] font-heading font-semibold text-terminal-muted hover:text-terminal-text mb-3"
              >
                <ArrowLeft size={12} /> Back to all GCs
              </button>

              {gcDetailLoading ? (
                <div className="flex items-center justify-center py-12 text-terminal-muted text-sm">Loading GC profile...</div>
              ) : gcDetail ? (
                <div className="space-y-4">
                  {/* GC Header */}
                  <div className="bg-terminal-panel border border-terminal-border rounded-[14px] p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-[12px] bg-[#e8eef5] flex items-center justify-center">
                          <Building2 size={20} className="text-[#1e3a5f]" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h2 className="text-[16px] font-heading font-bold text-terminal-text">{gcDetail.gc_name}</h2>
                            {gcDetail.is_known_gc && (
                              <span className="text-[9px] font-bold bg-[#fdf6e8] text-[#b8860b] px-2 py-0.5 rounded-full border border-[#f0e0b0]">
                                <Star size={9} className="inline mr-0.5 -mt-px" />KNOWN GC
                              </span>
                            )}
                          </div>
                          {gcDetail.contact_emails?.length > 0 && (
                            <div className="text-[11px] text-terminal-muted mt-0.5">
                              {gcDetail.contact_emails.join(', ')}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Summary Stats Row */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
                      <div className="text-center p-3 bg-[#f5f4f0] rounded-[10px]">
                        <div className="text-[9px] font-heading font-bold text-terminal-muted uppercase tracking-[0.5px] mb-1">Total Bids</div>
                        <div className="text-lg font-display font-bold text-terminal-text tabular-nums">{gcDetail.summary.total_bids}</div>
                      </div>
                      <div className="text-center p-3 bg-[#f5f4f0] rounded-[10px]">
                        <div className="text-[9px] font-heading font-bold text-terminal-muted uppercase tracking-[0.5px] mb-1">Responded</div>
                        <div className="text-lg font-display font-bold text-[#1e3a5f] tabular-nums">{gcDetail.summary.bids_responded}</div>
                      </div>
                      <div className="text-center p-3 bg-[#f5f4f0] rounded-[10px]">
                        <div className="text-[9px] font-heading font-bold text-terminal-muted uppercase tracking-[0.5px] mb-1">Awarded</div>
                        <div className="text-lg font-display font-bold text-[#1a6b3c] tabular-nums">{gcDetail.summary.bids_awarded}</div>
                      </div>
                      <div className="text-center p-3 bg-[#f5f4f0] rounded-[10px]">
                        <div className="text-[9px] font-heading font-bold text-terminal-muted uppercase tracking-[0.5px] mb-1">Win Rate</div>
                        <div className="text-lg font-display font-bold text-terminal-text tabular-nums">{gcDetail.summary.win_rate}%</div>
                      </div>
                      <div className="text-center p-3 bg-[#f5f4f0] rounded-[10px]">
                        <div className="text-[9px] font-heading font-bold text-terminal-muted uppercase tracking-[0.5px] mb-1">Avg Bid Size</div>
                        <div className="text-lg font-display font-bold text-terminal-text tabular-nums">{fmtDollars(gcDetail.summary.avg_bid_size)}</div>
                      </div>
                    </div>

                    {/* Value Summary */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                      <div className="flex justify-between text-[11px] p-2">
                        <span className="text-terminal-muted">Total estimate value</span>
                        <span className="font-semibold text-terminal-text">{fmtDollars(gcDetail.summary.total_estimate_value)}</span>
                      </div>
                      <div className="flex justify-between text-[11px] p-2">
                        <span className="text-terminal-muted">Total job value</span>
                        <span className="font-semibold text-terminal-text">{fmtDollars(gcDetail.summary.total_job_value)}</span>
                      </div>
                      <div className="flex justify-between text-[11px] p-2">
                        <span className="text-terminal-muted">Active jobs</span>
                        <span className="font-semibold text-terminal-text">{gcDetail.summary.active_jobs}</span>
                      </div>
                      <div className="flex justify-between text-[11px] p-2">
                        <span className="text-terminal-muted">Avg margin</span>
                        <span className="font-semibold text-terminal-text">{gcDetail.summary.avg_margin > 0 ? `${gcDetail.summary.avg_margin.toFixed(1)}%` : '-'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Bid History Table */}
                  <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
                    <div className="px-5 py-3 border-b border-terminal-border">
                      <h3 className="text-[13px] font-heading font-semibold text-terminal-text">Bid History</h3>
                      <p className="text-[10px] text-terminal-muted mt-0.5">{gcDetail.bid_history?.length || 0} bid requests from this GC</p>
                    </div>
                    {gcDetail.bid_history?.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-[11px]">
                          <thead>
                            <tr className="border-b border-terminal-border bg-[#f5f4f0]">
                              <th className="text-left px-5 py-2.5 font-heading font-bold text-terminal-muted uppercase tracking-[0.5px]">Project</th>
                              <th className="text-left px-3 py-2.5 font-heading font-bold text-terminal-muted uppercase tracking-[0.5px]">Status</th>
                              <th className="text-left px-3 py-2.5 font-heading font-bold text-terminal-muted uppercase tracking-[0.5px]">Due Date</th>
                              <th className="text-right px-5 py-2.5 font-heading font-bold text-terminal-muted uppercase tracking-[0.5px]">Est. Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {gcDetail.bid_history.map((bid, i) => (
                              <tr key={i} className="border-b border-[#f0eeea] last:border-0 hover:bg-[#f5f4f0]/50">
                                <td className="px-5 py-2.5">
                                  <div className="font-semibold text-terminal-text truncate max-w-[300px]">{bid.subject || bid.project_name || 'Untitled'}</div>
                                  {bid.from_name && <div className="text-[10px] text-terminal-muted">{bid.from_name}</div>}
                                </td>
                                <td className="px-3 py-2.5">
                                  <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${
                                    bid.status === 'awarded' ? 'bg-emerald-100 text-emerald-700' :
                                    bid.status === 'sent' ? 'bg-purple-100 text-purple-700' :
                                    bid.status === 'estimated' ? 'bg-blue-100 text-blue-700' :
                                    bid.status === 'new' ? 'bg-indigo-100 text-indigo-700' :
                                    bid.status === 'reviewing' ? 'bg-amber-100 text-amber-700' :
                                    bid.status === 'declined' || bid.status === 'lost' ? 'bg-red-100 text-red-700' :
                                    'bg-gray-100 text-gray-600'
                                  }`}>{bid.status}</span>
                                </td>
                                <td className="px-3 py-2.5 text-terminal-muted">{bid.due_date || '-'}</td>
                                <td className="px-5 py-2.5 text-right font-semibold text-terminal-text tabular-nums">
                                  {bid.estimate_value ? fmtDollars(bid.estimate_value) : '-'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="px-5 py-8 text-center text-terminal-muted text-sm">No bid requests from this GC.</div>
                    )}
                  </div>

                  {/* Jobs Table */}
                  <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
                    <div className="px-5 py-3 border-b border-terminal-border">
                      <h3 className="text-[13px] font-heading font-semibold text-terminal-text">Jobs</h3>
                      <p className="text-[10px] text-terminal-muted mt-0.5">{gcDetail.jobs?.length || 0} jobs with this GC</p>
                    </div>
                    {gcDetail.jobs?.length > 0 ? (
                      <div className="overflow-x-auto">
                        <table className="w-full text-[11px]">
                          <thead>
                            <tr className="border-b border-terminal-border bg-[#f5f4f0]">
                              <th className="text-left px-5 py-2.5 font-heading font-bold text-terminal-muted uppercase tracking-[0.5px]">Project</th>
                              <th className="text-left px-3 py-2.5 font-heading font-bold text-terminal-muted uppercase tracking-[0.5px]">Type</th>
                              <th className="text-left px-3 py-2.5 font-heading font-bold text-terminal-muted uppercase tracking-[0.5px]">Status</th>
                              <th className="text-right px-3 py-2.5 font-heading font-bold text-terminal-muted uppercase tracking-[0.5px]">Bid Amount</th>
                              <th className="text-right px-3 py-2.5 font-heading font-bold text-terminal-muted uppercase tracking-[0.5px]">Margin</th>
                              <th className="text-left px-5 py-2.5 font-heading font-bold text-terminal-muted uppercase tracking-[0.5px]">Dates</th>
                            </tr>
                          </thead>
                          <tbody>
                            {gcDetail.jobs.map((job, i) => (
                              <tr key={i} className="border-b border-[#f0eeea] last:border-0 hover:bg-[#f5f4f0]/50">
                                <td className="px-5 py-2.5">
                                  <div className="font-semibold text-terminal-text truncate max-w-[250px]">{job.project_name || 'Untitled'}</div>
                                  {job.location && <div className="text-[10px] text-terminal-muted">{job.location}</div>}
                                </td>
                                <td className="px-3 py-2.5 text-terminal-muted capitalize">{job.project_type || '-'}</td>
                                <td className="px-3 py-2.5">
                                  <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${
                                    job.status === 'active' ? 'bg-blue-100 text-blue-700' :
                                    job.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                                    job.status === 'on_hold' ? 'bg-amber-100 text-amber-700' :
                                    'bg-gray-100 text-gray-600'
                                  }`}>{job.status}</span>
                                </td>
                                <td className="px-3 py-2.5 text-right font-semibold text-terminal-text tabular-nums">
                                  {job.bid_amount ? fmtDollars(job.bid_amount) : '-'}
                                </td>
                                <td className="px-3 py-2.5 text-right tabular-nums">
                                  {job.margin_pct != null ? (
                                    <span className={`font-semibold ${job.margin_pct >= 15 ? 'text-[#1a6b3c]' : job.margin_pct >= 8 ? 'text-terminal-text' : 'text-red-600'}`}>
                                      {job.margin_pct.toFixed(1)}%
                                    </span>
                                  ) : '-'}
                                </td>
                                <td className="px-5 py-2.5 text-terminal-muted text-[10px]">
                                  {job.start_date && <div>Start: {job.start_date}</div>}
                                  {job.end_date && <div>End: {job.end_date}</div>}
                                  {!job.start_date && !job.end_date && '-'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="px-5 py-8 text-center text-terminal-muted text-sm">No jobs with this GC yet.</div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center py-12 text-terminal-muted text-sm">GC profile not found.</div>
              )}
            </div>
          ) : (
            // ─── GC List View ────────────────────────────────────────────
            <>
              {!gcProfiles ? (
                <div className="flex items-center justify-center py-12 text-terminal-muted text-sm">Loading GC profiles...</div>
              ) : (
                <>
                  {/* Summary Row */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-terminal-panel border border-terminal-border rounded-[12px] p-4">
                      <div className="text-[9px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1">Total GCs</div>
                      <div className="text-xl font-display font-bold text-terminal-text tabular-nums">{gcProfiles.total || 0}</div>
                    </div>
                    <div className="bg-terminal-panel border border-terminal-border rounded-[12px] p-4">
                      <div className="text-[9px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1">Known GCs</div>
                      <div className="text-xl font-display font-bold text-[#b8860b] tabular-nums">
                        {(gcProfiles.profiles || []).filter(p => p.is_known_gc).length}
                      </div>
                    </div>
                    <div className="bg-terminal-panel border border-terminal-border rounded-[12px] p-4">
                      <div className="text-[9px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1">Total Bids</div>
                      <div className="text-xl font-display font-bold text-terminal-text tabular-nums">
                        {(gcProfiles.profiles || []).reduce((sum, p) => sum + p.total_bids, 0)}
                      </div>
                    </div>
                    <div className="bg-terminal-panel border border-terminal-border rounded-[12px] p-4">
                      <div className="text-[9px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1">Total Value</div>
                      <div className="text-xl font-display font-bold text-terminal-text tabular-nums">
                        {fmtDollars((gcProfiles.profiles || []).reduce((sum, p) => sum + p.total_value, 0))}
                      </div>
                    </div>
                  </div>

                  {/* GC Table */}
                  <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
                    <div className="px-5 py-3 border-b border-terminal-border">
                      <h3 className="text-[13px] font-heading font-semibold text-terminal-text">General Contractors</h3>
                      <p className="text-[10px] text-terminal-muted mt-0.5">Sorted by total bids received - click to view full profile</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="border-b border-terminal-border bg-[#f5f4f0]">
                            <th className="text-left px-5 py-2.5 font-heading font-bold text-terminal-muted uppercase tracking-[0.5px]">GC Name</th>
                            <th className="text-right px-3 py-2.5 font-heading font-bold text-terminal-muted uppercase tracking-[0.5px]">Bids</th>
                            <th className="text-right px-3 py-2.5 font-heading font-bold text-terminal-muted uppercase tracking-[0.5px]">Responded</th>
                            <th className="text-right px-3 py-2.5 font-heading font-bold text-terminal-muted uppercase tracking-[0.5px]">Awarded</th>
                            <th className="text-right px-3 py-2.5 font-heading font-bold text-terminal-muted uppercase tracking-[0.5px]">Total Value</th>
                            <th className="text-left px-5 py-2.5 font-heading font-bold text-terminal-muted uppercase tracking-[0.5px]">Last Bid</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(gcProfiles.profiles || []).map((gc, i) => (
                            <tr
                              key={i}
                              onClick={() => openGcProfile(gc.gc_name)}
                              className="border-b border-[#f0eeea] last:border-0 cursor-pointer hover:bg-[#f5f4f0] transition-colors"
                            >
                              <td className="px-5 py-3">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-terminal-text">{gc.gc_name}</span>
                                  {gc.is_known_gc && (
                                    <span className="text-[8px] font-bold bg-[#fdf6e8] text-[#b8860b] px-1.5 py-0.5 rounded-full border border-[#f0e0b0] shrink-0">
                                      <Star size={8} className="inline mr-0.5 -mt-px" />KNOWN
                                    </span>
                                  )}
                                </div>
                                {gc.gc_email && <div className="text-[10px] text-terminal-muted">{gc.gc_email}</div>}
                              </td>
                              <td className="px-3 py-3 text-right font-semibold text-terminal-text tabular-nums">{gc.total_bids}</td>
                              <td className="px-3 py-3 text-right tabular-nums text-[#1e3a5f] font-semibold">{gc.bids_responded}</td>
                              <td className="px-3 py-3 text-right tabular-nums">
                                {gc.bids_awarded > 0 ? (
                                  <span className="font-semibold text-[#1a6b3c]">{gc.bids_awarded}</span>
                                ) : (
                                  <span className="text-terminal-muted">0</span>
                                )}
                              </td>
                              <td className="px-3 py-3 text-right font-semibold text-terminal-text tabular-nums">
                                {gc.total_value > 0 ? fmtDollars(gc.total_value) : '-'}
                              </td>
                              <td className="px-5 py-3 text-terminal-muted">{gc.last_bid_date || '-'}</td>
                            </tr>
                          ))}
                          {(!gcProfiles.profiles || gcProfiles.profiles.length === 0) && (
                            <tr>
                              <td colSpan={6} className="px-5 py-8 text-center text-terminal-muted text-sm">
                                No GC data yet. GCs appear when bid requests are received.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Newsletter Leads Tab */}
      {activeTab === 'leads' && (
        <div className="space-y-4">
          {!newsletterLeads ? (
            <div className="flex items-center justify-center py-12 text-terminal-muted text-sm">Loading newsletter leads...</div>
          ) : (
            <>
              {/* Lead Summary */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: 'Total', value: newsletterLeads.summary?.total || 0, color: 'text-terminal-text' },
                  { label: 'Pending', value: newsletterLeads.summary?.pending || 0, color: 'text-amber-600' },
                  { label: 'In Progress', value: newsletterLeads.summary?.inProgress || 0, color: 'text-blue-600' },
                  { label: 'Completed', value: newsletterLeads.summary?.completed || 0, color: 'text-emerald-600' },
                  { label: 'Stale (>7d)', value: newsletterLeads.summary?.stale || 0, color: 'text-red-600' },
                  { label: 'Email Drafts', value: newsletterLeads.summary?.withEmailDrafts || 0, color: 'text-purple-600' },
                ].map((s, i) => (
                  <div key={i} className="bg-terminal-panel border border-terminal-border rounded-[12px] p-4 text-center">
                    <div className="text-[9px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1">{s.label}</div>
                    <div className={`text-xl font-display font-bold tabular-nums ${s.color}`}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* Lead List */}
              <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
                <div className="px-5 py-3 border-b border-terminal-border">
                  <h3 className="text-[13px] font-heading font-semibold text-terminal-text">Newsletter-Generated Tasks</h3>
                  <p className="text-[10px] text-terminal-muted mt-0.5">Sorted by status (pending first) then age</p>
                </div>
                <div className="divide-y divide-[#f0eeea]">
                  {(newsletterLeads.leads || []).slice(0, 30).map((lead, i) => (
                    <div key={i} className="px-5 py-3 flex items-start gap-3">
                      <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                        lead.status === 'proposed' ? (lead.ageDays > 7 ? 'bg-red-500' : 'bg-amber-500') :
                        lead.status === 'in_progress' ? 'bg-blue-500' :
                        lead.status === 'completed' ? 'bg-emerald-500' : 'bg-gray-400'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-semibold text-terminal-text truncate">{lead.title}</span>
                          {lead.hasEmailDraft && (
                            <span className="text-[9px] font-bold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded shrink-0">
                              <Mail size={9} className="inline mr-0.5" />DRAFT
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-terminal-muted mt-0.5 truncate">{lead.description}</div>
                        <div className="flex items-center gap-3 mt-1">
                          <span className={`text-[9px] font-bold uppercase ${
                            lead.priority === 'high' ? 'text-red-600' :
                            lead.priority === 'medium' ? 'text-amber-600' : 'text-gray-500'
                          }`}>{lead.priority}</span>
                          <span className="text-[9px] text-terminal-muted">{lead.category}</span>
                          {lead.emailDraftTo && (
                            <span className="text-[9px] text-terminal-muted">To: {lead.emailDraftTo}</span>
                          )}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={`text-[11px] font-bold tabular-nums ${
                          lead.ageDays > 7 ? 'text-red-600' : lead.ageDays > 3 ? 'text-amber-600' : 'text-terminal-muted'
                        }`}>
                          {lead.ageDays === 0 ? 'Today' : `${lead.ageDays}d ago`}
                        </div>
                        <div className={`text-[9px] font-bold uppercase mt-0.5 ${
                          lead.status === 'proposed' ? 'text-amber-600' :
                          lead.status === 'in_progress' ? 'text-blue-600' :
                          lead.status === 'completed' ? 'text-emerald-600' : 'text-gray-500'
                        }`}>{lead.status}</div>
                      </div>
                    </div>
                  ))}
                  {(!newsletterLeads.leads || newsletterLeads.leads.length === 0) && (
                    <div className="px-5 py-8 text-center text-terminal-muted text-sm">No newsletter leads yet. Leads appear after the daily newsletter generates tasks.</div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Newsletters Tab */}
      {activeTab === 'newsletters' && (
        <div className="space-y-4">
          {selectedNewsletter ? (
            <div>
              <button
                onClick={() => { setSelectedNewsletter(null); setNewsletterHtml(''); }}
                className="flex items-center gap-1.5 text-[11px] font-heading font-semibold text-terminal-muted hover:text-terminal-text mb-3"
              >
                <ChevronDown size={12} className="rotate-90" /> Back to list
              </button>
              <div className="bg-white border border-terminal-border rounded-[14px] overflow-hidden">
                {newsletterHtml ? (
                  <div
                    className="newsletter-preview"
                    dangerouslySetInnerHTML={{ __html: newsletterHtml }}
                    style={{ maxHeight: '80vh', overflowY: 'auto' }}
                  />
                ) : (
                  <div className="flex items-center justify-center py-12 text-terminal-muted text-sm">Loading newsletter...</div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
              <div className="px-5 py-3 border-b border-terminal-border">
                <h3 className="text-[13px] font-heading font-semibold text-terminal-text">Newsletter History</h3>
                <p className="text-[10px] text-terminal-muted mt-0.5">Last 30 newsletters</p>
              </div>
              <div className="divide-y divide-[#f0eeea]">
                {(newsletters || []).map((nl, i) => (
                  <div
                    key={i}
                    onClick={() => openNewsletter(nl.id)}
                    className="px-5 py-3 flex items-center justify-between cursor-pointer hover:bg-[#f5f4f0] transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-semibold text-terminal-text">{nl.title}</div>
                      <div className="text-[10px] text-terminal-muted mt-0.5 truncate">{nl.summary}</div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-[10px] text-terminal-muted">{new Date(nl.createdAt).toLocaleDateString()}</div>
                      <Eye size={14} className="text-terminal-muted" />
                    </div>
                  </div>
                ))}
                {(!newsletters || newsletters.length === 0) && (
                  <div className="px-5 py-8 text-center text-terminal-muted text-sm">No newsletters yet.</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Sales Trips Tab */}
      {activeTab === 'sales-trips' && (
        <div className="space-y-4">
          {!salesTrips ? (
            <div className="flex items-center justify-center py-12 text-terminal-muted text-sm">Loading sales trips...</div>
          ) : selectedTrip && !showCreateTrip ? (
            /* ─── Trip Detail View ─────────────────────────────────── */
            <div>
              <button
                onClick={() => setSelectedTrip(null)}
                className="flex items-center gap-1.5 text-[11px] font-heading font-semibold text-terminal-muted hover:text-terminal-text mb-3"
              >
                <ArrowLeft size={12} /> Back to all trips
              </button>

              {tripDetailLoading ? (
                <div className="flex items-center justify-center py-12 text-terminal-muted text-sm">Loading trip details...</div>
              ) : (
                <div className="space-y-4">
                  {/* Trip Header */}
                  <div className="bg-terminal-panel border border-terminal-border rounded-[14px] p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <div className="flex items-center gap-2.5">
                          <h2 className="text-[16px] font-heading font-bold text-terminal-text">{selectedTrip.name}</h2>
                          <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${
                            selectedTrip.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                            selectedTrip.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                            'bg-amber-100 text-amber-700'
                          }`}>{(selectedTrip.status || 'planned').replace('_', ' ')}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-[11px] text-terminal-muted flex items-center gap-1">
                            <Calendar size={11} /> {selectedTrip.date ? new Date(selectedTrip.date).toLocaleDateString() : 'No date set'}
                          </span>
                          <span className="text-[11px] text-terminal-muted flex items-center gap-1">
                            <MapPin size={11} /> {(selectedTrip.stops || []).length} stop{(selectedTrip.stops || []).length !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>
                      {selectedTrip.route_url && (
                        <a
                          href={selectedTrip.route_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 px-4 py-2.5 rounded-[10px] text-[11px] font-heading font-bold text-white transition-colors hover:opacity-90"
                          style={{ backgroundColor: '#1e3a5f' }}
                        >
                          <Navigation size={13} />
                          Open in Google Maps
                          <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                  </div>

                  {/* Stops List */}
                  <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
                    <div className="px-5 py-3 border-b border-terminal-border">
                      <h3 className="text-[13px] font-heading font-semibold text-terminal-text">Route Stops</h3>
                      <p className="text-[10px] text-terminal-muted mt-0.5">Ordered by route - check off as you visit</p>
                    </div>
                    <div className="divide-y divide-[#f0eeea]">
                      {(selectedTrip.stops || []).map((stop, i) => (
                        <div key={i} className="px-5 py-4">
                          <div className="flex items-start gap-3">
                            {/* Order Number */}
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold tabular-nums ${
                              stop.visited ? 'bg-emerald-100 text-emerald-700' : 'bg-[#e8eef5] text-[#1e3a5f]'
                            }`}>
                              {stop.visited ? <Check size={13} /> : i + 1}
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-[12px] font-semibold text-terminal-text">{stop.gc_name}</span>
                                {stop.is_known_gc && (
                                  <span className="text-[8px] font-bold bg-[#fdf6e8] text-[#b8860b] px-1.5 py-0.5 rounded-full border border-[#f0e0b0] shrink-0">
                                    <Star size={8} className="inline mr-0.5 -mt-px" />KNOWN
                                  </span>
                                )}
                              </div>
                              {stop.office_address && (
                                <div className="text-[10px] text-terminal-muted mt-0.5 flex items-center gap-1">
                                  <MapPin size={10} className="shrink-0" /> {stop.office_address}
                                </div>
                              )}
                              {stop.duration_estimate && (
                                <div className="text-[10px] text-terminal-muted mt-0.5 flex items-center gap-1">
                                  <Clock size={10} className="shrink-0" /> Est. {stop.duration_estimate}
                                </div>
                              )}

                              {/* Talking Points */}
                              {stop.talking_points?.length > 0 && (
                                <div className="mt-2">
                                  <button
                                    onClick={() => setExpandedTalkingPoints(prev => ({ ...prev, [i]: !prev[i] }))}
                                    className="flex items-center gap-1 text-[10px] font-heading font-semibold text-[#1e3a5f] hover:underline"
                                  >
                                    {expandedTalkingPoints[i] ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                                    Talking Points ({stop.talking_points.length})
                                  </button>
                                  {expandedTalkingPoints[i] && (
                                    <ul className="mt-1.5 ml-3 space-y-1">
                                      {stop.talking_points.map((pt, j) => (
                                        <li key={j} className="text-[10px] text-terminal-text flex items-start gap-1.5">
                                          <span className="text-terminal-muted mt-0.5 shrink-0">-</span>
                                          <span>{pt}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              )}

                              {/* Notes */}
                              {stop.notes && (
                                <div className="mt-2 text-[10px] text-terminal-muted italic">
                                  Note: {stop.notes}
                                </div>
                              )}
                            </div>

                            {/* Visited Checkbox */}
                            <button
                              onClick={() => toggleStopVisited(selectedTrip.id, i, !stop.visited)}
                              className={`shrink-0 w-6 h-6 rounded-[6px] border-2 flex items-center justify-center transition-colors ${
                                stop.visited
                                  ? 'bg-emerald-500 border-emerald-500 text-white'
                                  : 'border-gray-300 hover:border-[#1e3a5f]'
                              }`}
                            >
                              {stop.visited && <Check size={12} />}
                            </button>
                          </div>
                        </div>
                      ))}
                      {(!selectedTrip.stops || selectedTrip.stops.length === 0) && (
                        <div className="px-5 py-8 text-center text-terminal-muted text-sm">No stops added to this trip yet.</div>
                      )}
                    </div>
                  </div>

                  {/* Trip Summary */}
                  {(selectedTrip.total_stops || selectedTrip.estimated_distance || selectedTrip.estimated_duration) && (
                    <div className="bg-terminal-panel border border-terminal-border rounded-[14px] p-5">
                      <h3 className="text-[13px] font-heading font-semibold text-terminal-text mb-3">Trip Summary</h3>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="text-center p-3 bg-[#f5f4f0] rounded-[10px]">
                          <div className="text-[9px] font-heading font-bold text-terminal-muted uppercase tracking-[0.5px] mb-1">Total Stops</div>
                          <div className="text-lg font-display font-bold text-terminal-text tabular-nums">{selectedTrip.total_stops || (selectedTrip.stops || []).length}</div>
                        </div>
                        {selectedTrip.estimated_distance && (
                          <div className="text-center p-3 bg-[#f5f4f0] rounded-[10px]">
                            <div className="text-[9px] font-heading font-bold text-terminal-muted uppercase tracking-[0.5px] mb-1">Est. Distance</div>
                            <div className="text-lg font-display font-bold text-terminal-text tabular-nums">{selectedTrip.estimated_distance}</div>
                          </div>
                        )}
                        {selectedTrip.estimated_duration && (
                          <div className="text-center p-3 bg-[#f5f4f0] rounded-[10px]">
                            <div className="text-[9px] font-heading font-bold text-terminal-muted uppercase tracking-[0.5px] mb-1">Est. Duration</div>
                            <div className="text-lg font-display font-bold text-terminal-text tabular-nums">{selectedTrip.estimated_duration}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* ─── Trip List View + Create ──────────────────────────── */
            <>
              {/* Summary Row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-terminal-panel border border-terminal-border rounded-[12px] p-4">
                  <div className="text-[9px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1">Total Trips</div>
                  <div className="text-xl font-display font-bold text-terminal-text tabular-nums">{salesTrips.total || (salesTrips.trips || []).length}</div>
                </div>
                <div className="bg-terminal-panel border border-terminal-border rounded-[12px] p-4">
                  <div className="text-[9px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1">Planned</div>
                  <div className="text-xl font-display font-bold text-amber-600 tabular-nums">
                    {(salesTrips.trips || []).filter(t => t.status === 'planned').length}
                  </div>
                </div>
                <div className="bg-terminal-panel border border-terminal-border rounded-[12px] p-4">
                  <div className="text-[9px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1">Completed</div>
                  <div className="text-xl font-display font-bold text-emerald-600 tabular-nums">
                    {(salesTrips.trips || []).filter(t => t.status === 'completed').length}
                  </div>
                </div>
                <div className="bg-terminal-panel border border-terminal-border rounded-[12px] p-4">
                  <div className="text-[9px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1">GC Offices Mapped</div>
                  <div className="text-xl font-display font-bold text-[#1e3a5f] tabular-nums">
                    {gcOffices ? (gcOffices.offices || gcOffices || []).length : 0}
                  </div>
                </div>
              </div>

              {/* Smart Suggestions Panel */}
              <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
                <div
                  className="px-5 py-3 flex items-center justify-between cursor-pointer hover:bg-[#f5f4f0] transition-colors"
                  onClick={() => setSuggestionsExpanded(v => !v)}
                >
                  <div>
                    <h3 className="text-[13px] font-heading font-semibold text-terminal-text flex items-center gap-2">
                      <Activity size={13} className="text-[#1e3a5f]" />
                      Suggested Visits
                    </h3>
                    <p className="text-[10px] text-terminal-muted mt-0.5">GCs you should visit based on bid history, prequal status, and recent leads</p>
                  </div>
                  {suggestionsExpanded ? <ChevronUp size={14} className="text-terminal-muted" /> : <ChevronDown size={14} className="text-terminal-muted" />}
                </div>
                {suggestionsExpanded && (
                  <div className="border-t border-[#f0eeea] divide-y divide-[#f0eeea]">
                    {tripSuggestions && (tripSuggestions.suggestions || tripSuggestions || []).length > 0 ? (
                      (tripSuggestions.suggestions || tripSuggestions || []).map((sug, i) => {
                        const priorityStyles = {
                          high: 'bg-red-100 text-red-700',
                          medium: 'bg-amber-100 text-amber-700',
                          low: 'bg-gray-100 text-gray-600',
                        };
                        return (
                          <div key={i} className="px-5 py-3 flex items-start gap-3">
                            <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                              sug.priority === 'high' ? 'bg-red-500' :
                              sug.priority === 'medium' ? 'bg-amber-500' : 'bg-gray-400'
                            }`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-[12px] font-semibold text-terminal-text">{sug.gc_name}</span>
                                {sug.is_known_gc && (
                                  <span className="text-[8px] font-bold bg-[#fdf6e8] text-[#b8860b] px-1.5 py-0.5 rounded-full border border-[#f0e0b0] shrink-0">
                                    <Star size={8} className="inline mr-0.5 -mt-px" />KNOWN
                                  </span>
                                )}
                                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${priorityStyles[sug.priority] || priorityStyles.low}`}>
                                  {sug.priority}
                                </span>
                              </div>
                              <div className="text-[10px] text-terminal-muted mt-0.5">{sug.reason}</div>
                              {sug.office_address && (
                                <div className="text-[10px] text-terminal-muted mt-0.5 flex items-center gap-1">
                                  <MapPin size={9} className="shrink-0" /> {sug.office_address}
                                </div>
                              )}
                            </div>
                            <button
                              onClick={() => {
                                setNewTripStops(prev => {
                                  if (prev.find(s => s.gc_name === sug.gc_name)) return prev;
                                  return [...prev, { gc_name: sug.gc_name, id: sug.office_id, office_address: sug.office_address }];
                                });
                                if (!showCreateTrip) setShowCreateTrip(true);
                              }}
                              className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] text-[10px] font-heading font-semibold text-[#1e3a5f] bg-[#e8eef5] hover:bg-[#d5dfed] transition-colors"
                            >
                              <Plus size={10} /> Add to Trip
                            </button>
                          </div>
                        );
                      })
                    ) : (
                      <div className="px-5 py-8 text-center text-terminal-muted text-sm">
                        {tripSuggestions ? 'No visit suggestions at this time.' : 'Loading suggestions...'}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Plan New Trip Button + Create Form */}
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-heading font-semibold text-terminal-text">
                  {showCreateTrip ? 'Plan New Trip' : 'Trips'}
                </h3>
                <button
                  onClick={() => setShowCreateTrip(v => !v)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[10px] font-heading font-bold text-white transition-colors hover:opacity-90"
                  style={{ backgroundColor: '#1e3a5f' }}
                >
                  {showCreateTrip ? <><X size={10} /> Cancel</> : <><Plus size={10} /> Plan New Trip</>}
                </button>
              </div>

              {showCreateTrip && (
                <div className="bg-terminal-panel border border-terminal-border rounded-[14px] p-5 space-y-4">
                  {/* Trip Name */}
                  <div>
                    <label className="text-[10px] font-heading font-bold text-terminal-muted uppercase tracking-[0.5px] block mb-1.5">Trip Name</label>
                    <input
                      type="text"
                      value={newTripName}
                      onChange={e => setNewTripName(e.target.value)}
                      placeholder="e.g. Gulf Coast GC Visits"
                      className="w-full px-3 py-2 rounded-[8px] border border-terminal-border bg-white text-[12px] text-terminal-text placeholder:text-terminal-muted/50 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
                    />
                  </div>

                  {/* Date */}
                  <div>
                    <label className="text-[10px] font-heading font-bold text-terminal-muted uppercase tracking-[0.5px] block mb-1.5">Date</label>
                    <input
                      type="date"
                      value={newTripDate}
                      onChange={e => setNewTripDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-[8px] border border-terminal-border bg-white text-[12px] text-terminal-text focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
                    />
                  </div>

                  {/* GC Office Selector */}
                  <div>
                    <label className="text-[10px] font-heading font-bold text-terminal-muted uppercase tracking-[0.5px] block mb-1.5">Add Stops</label>
                    <div className="flex gap-2">
                      <select
                        id="gc-office-select"
                        className="flex-1 px-3 py-2 rounded-[8px] border border-terminal-border bg-white text-[12px] text-terminal-text focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 focus:border-[#1e3a5f]"
                        defaultValue=""
                        onChange={e => {
                          const offices = gcOffices?.offices || gcOffices || [];
                          const office = offices.find(o => String(o.id) === e.target.value);
                          if (office && !newTripStops.find(s => s.gc_name === office.gc_name && s.id === office.id)) {
                            setNewTripStops(prev => [...prev, { gc_name: office.gc_name, id: office.id, office_address: office.address }]);
                          }
                          e.target.value = '';
                        }}
                      >
                        <option value="" disabled>Select a GC office...</option>
                        {(gcOffices?.offices || gcOffices || []).map((o, i) => (
                          <option key={i} value={o.id}>{o.gc_name} - {o.address || 'No address'}</option>
                        ))}
                      </select>
                      <button
                        onClick={() => {
                          if (!tripSuggestions) return;
                          const suggestions = tripSuggestions.suggestions || tripSuggestions || [];
                          const highPriority = suggestions.filter(s => s.priority === 'high');
                          const toAdd = highPriority.length > 0 ? highPriority : suggestions.slice(0, 3);
                          setNewTripStops(prev => {
                            const existing = new Set(prev.map(s => s.gc_name));
                            const newOnes = toAdd.filter(s => !existing.has(s.gc_name)).map(s => ({
                              gc_name: s.gc_name, id: s.office_id, office_address: s.office_address,
                            }));
                            return [...prev, ...newOnes];
                          });
                        }}
                        className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-[8px] text-[10px] font-heading font-semibold text-[#1e3a5f] bg-[#e8eef5] hover:bg-[#d5dfed] transition-colors"
                      >
                        <Activity size={10} /> Add from Suggestions
                      </button>
                    </div>
                  </div>

                  {/* Added Stops */}
                  {newTripStops.length > 0 && (
                    <div>
                      <label className="text-[10px] font-heading font-bold text-terminal-muted uppercase tracking-[0.5px] block mb-1.5">
                        Stops ({newTripStops.length})
                      </label>
                      <div className="space-y-1.5">
                        {newTripStops.map((stop, i) => (
                          <div key={i} className="flex items-center gap-2 px-3 py-2 bg-[#f5f4f0] rounded-[8px]">
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => {
                                  if (i === 0) return;
                                  setNewTripStops(prev => {
                                    const arr = [...prev];
                                    [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
                                    return arr;
                                  });
                                }}
                                disabled={i === 0}
                                className={`p-0.5 rounded ${i === 0 ? 'text-gray-300' : 'text-terminal-muted hover:text-terminal-text'}`}
                              >
                                <ChevronUp size={10} />
                              </button>
                              <button
                                onClick={() => {
                                  if (i === newTripStops.length - 1) return;
                                  setNewTripStops(prev => {
                                    const arr = [...prev];
                                    [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
                                    return arr;
                                  });
                                }}
                                disabled={i === newTripStops.length - 1}
                                className={`p-0.5 rounded ${i === newTripStops.length - 1 ? 'text-gray-300' : 'text-terminal-muted hover:text-terminal-text'}`}
                              >
                                <ChevronDown size={10} />
                              </button>
                            </div>
                            <div className="w-5 h-5 rounded-full bg-[#e8eef5] flex items-center justify-center text-[9px] font-bold text-[#1e3a5f] tabular-nums shrink-0">
                              {i + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="text-[11px] font-semibold text-terminal-text">{stop.gc_name}</span>
                              {stop.office_address && (
                                <span className="text-[10px] text-terminal-muted ml-2">{stop.office_address}</span>
                              )}
                            </div>
                            <button
                              onClick={() => setNewTripStops(prev => prev.filter((_, idx) => idx !== i))}
                              className="shrink-0 p-1 text-terminal-muted hover:text-red-600 transition-colors"
                            >
                              <Trash2 size={11} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Submit */}
                  <div className="flex justify-end">
                    <button
                      onClick={createTrip}
                      disabled={!newTripName.trim() || !newTripDate || creatingTrip}
                      className="flex items-center gap-1.5 px-5 py-2.5 rounded-[10px] text-[11px] font-heading font-bold text-white transition-colors disabled:opacity-40 hover:opacity-90"
                      style={{ backgroundColor: '#1e3a5f' }}
                    >
                      {creatingTrip ? (
                        <><Clock size={12} /> Creating...</>
                      ) : (
                        <><MapPin size={12} /> Create Trip</>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Trip List */}
              {!showCreateTrip && (
                <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
                  <div className="px-5 py-3 border-b border-terminal-border">
                    <p className="text-[10px] text-terminal-muted">Click a trip to view route details and manage stops</p>
                  </div>
                  <div className="divide-y divide-[#f0eeea]">
                    {(salesTrips.trips || []).map((trip, i) => (
                      <div
                        key={i}
                        onClick={() => openTripDetail(trip.id)}
                        className="px-5 py-3 flex items-center justify-between cursor-pointer hover:bg-[#f5f4f0] transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[12px] font-semibold text-terminal-text">{trip.name}</span>
                            <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${
                              trip.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                              trip.status === 'in_progress' ? 'bg-blue-100 text-blue-700' :
                              'bg-amber-100 text-amber-700'
                            }`}>{(trip.status || 'planned').replace('_', ' ')}</span>
                          </div>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="text-[10px] text-terminal-muted flex items-center gap-1">
                              <Calendar size={9} /> {trip.date ? new Date(trip.date).toLocaleDateString() : 'No date'}
                            </span>
                            <span className="text-[10px] text-terminal-muted flex items-center gap-1">
                              <MapPin size={9} /> {trip.stop_count || 0} stop{(trip.stop_count || 0) !== 1 ? 's' : ''}
                            </span>
                            {trip.created_at && (
                              <span className="text-[10px] text-terminal-muted">
                                Created {new Date(trip.created_at).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>
                        <ChevronRight size={14} className="text-terminal-muted shrink-0" />
                      </div>
                    ))}
                    {(!salesTrips.trips || salesTrips.trips.length === 0) && (
                      <div className="px-5 py-8 text-center text-terminal-muted text-sm">
                        No sales trips yet. Click "Plan New Trip" to create your first route.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

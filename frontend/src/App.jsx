import React, { Component, useState, useEffect, Suspense, lazy } from 'react';
import {
  Menu, X, Bell, FileText, TrendingUp, Activity,
  DollarSign, Settings, Hammer, BarChart3, LogOut, User, Shield, Umbrella, Bot,
  Zap, ChevronLeft, LayoutDashboard, MessageSquare, Mic, Mail, FileIcon,
  HardHat, ClipboardList, FileCheck, Search, FolderOpen, ListChecks, Presentation, Phone, Building2,
  ChevronsUpDown, Check, Building
} from 'lucide-react';

// Auth
import { AuthProvider, useAuth } from './components/auth/AuthContext';
import { TenantProvider, useTenant } from './contexts/TenantContext';
import CoppiceLogo from './components/ui/CoppiceLogo';

// Error boundary to prevent blank white screens on uncaught render errors
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Caught:', error, info);
    // Auto-reload on stale chunk errors (happens after deploy when old JS hashes are gone)
    if (error?.message?.includes('Failed to fetch dynamically imported module') ||
        error?.message?.includes('Importing a module script failed')) {
      const key = '_err_reload';
      const last = sessionStorage.getItem(key);
      // Only auto-reload once per session to avoid infinite loops
      if (!last || Date.now() - Number(last) > 10000) {
        sessionStorage.setItem(key, String(Date.now()));
        window.location.reload();
        return;
      }
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-terminal-bg flex items-center justify-center p-8">
          <div className="text-center max-w-md">
            <p className="text-lg font-bold text-terminal-red mb-2">Something went wrong</p>
            <p className="text-sm text-terminal-muted mb-4">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="px-4 py-2 bg-terminal-panel border border-terminal-border rounded text-sm text-terminal-text hover:border-terminal-green"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Lazy-load tab content for performance
const LoginPage = lazy(() => import('./components/auth/LoginPage'));
const ChangePasswordModal = lazy(() => import('./components/auth/ChangePasswordModal'));
const SetPasswordModal = lazy(() => import('./components/auth/SetPasswordModal'));
const OnboardingWizard = lazy(() => import('./components/auth/OnboardingWizard'));
const OperationsDashboard = lazy(() => import('./components/dashboards/OperationsDashboard'));
const MacroDashboard = lazy(() => import('./components/dashboards/MacroDashboard'));
const PartnerDashboard = lazy(() => import('./components/dashboards/PartnerDashboard'));
const LPDashboard = lazy(() => import('./components/dashboards/LPDashboard'));
const AdminConsoleDashboard = lazy(() => import('./components/dashboards/AdminConsoleDashboard'));
const SuperAdminDashboard = lazy(() => import('./components/dashboards/SuperAdminDashboard'));
const CorrelationPanel = lazy(() => import('./components/panels/macro/CorrelationPanel'));
const AlertsPanel = lazy(() => import('./components/AlertsPanel'));
const NotesPanel = lazy(() => import('./components/NotesPanel'));
const LiquidityPanel = lazy(() => import('./components/LiquidityPanel'));
const SettingsPanel = lazy(() => import('./components/SettingsPanel'));
const InsuranceDashboard = lazy(() => import('./components/dashboards/InsuranceDashboard'));
const BotsDashboard = lazy(() => import('./components/dashboards/BotsDashboard'));
const LeadEngineWorkspace = lazy(() => import('./components/dashboards/LeadEngineWorkspace'));
const CommandDashboard = lazy(() => import('./components/dashboards/CommandDashboard'));
const CurtailmentDashboard = lazy(() => import('./components/dashboards/CurtailmentDashboard'));
const PoolRoutingDashboard = lazy(() => import('./components/dashboards/PoolRoutingDashboard'));
const ReportingDashboard = lazy(() => import('./components/dashboards/ReportingDashboard'));
const MeetingsDashboard = lazy(() => import('./components/dashboards/MeetingsDashboard'));
const DacpCommandDashboard = lazy(() => import('./components/dashboards/DacpCommandDashboard'));
// CeoDashboard will be a separate app/interface - not loaded here
const DacpEstimatingDashboard = lazy(() => import('./components/dashboards/DacpEstimatingDashboard'));
const DacpPricingDashboard = lazy(() => import('./components/dashboards/DacpPricingDashboard'));
const DacpJobsDashboard = lazy(() => import('./components/dashboards/DacpJobsDashboard'));
const TaskTrackerDashboard = lazy(() => import('./components/dashboards/TaskTrackerDashboard'));
const DacpFieldReportsDashboard = lazy(() => import('./components/dashboards/DacpFieldReportsDashboard'));
const DacpSettingsPanel = lazy(() => import('./components/DacpSettingsPanel'));
const AuditTrailDashboard = lazy(() => import('./components/dashboards/AuditTrailDashboard'));
const FilesDashboard = lazy(() => import('./components/dashboards/FilesDashboard'));
const AccountingDashboard = lazy(() => import('./components/dashboards/AccountingDashboard'));
const AgentChat = lazy(() => import('./components/chat/AgentChat'));
const FieldReporterChat = lazy(() => import('./components/chat/FieldReporterChat'));
const ScopeAnalyzerChat = lazy(() => import('./components/chat/ScopeAnalyzerChat'));
const PortfolioOverview = lazy(() => import('./components/dashboards/PortfolioOverview'));
const CompanyDetail = lazy(() => import('./components/dashboards/CompanyDetail'));
const OfficeDashboard = lazy(() => import('./components/dashboards/OfficeDashboard'));
const HelpChatWidget = lazy(() => import('./components/HelpChatWidget'));
const SharedMeetingPage = lazy(() => import('./components/SharedMeetingPage'));

// Non-lazy supporting components
import NotificationBell from './components/NotificationBell';

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="spinner w-10 h-10" />
    </div>
  );
}

// ─── Sidebar Navigation ──────────────────────────────────────────────────────

function WorkspaceSwitcher({ user }) {
  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState(null); // null = not loaded
  const { tenant } = useTenant();
  const menuRef = React.useRef(null);

  // Fetch workspaces eagerly on mount
  useEffect(() => {
    import('./lib/hooks/useApi').then(mod => {
      mod.default.get('/v1/auth/my-tenants').then(res => {
        setWorkspaces(res.data?.tenants || []);
      }).catch(() => setWorkspaces([]));
    });
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const currentSlug = tenant?.slug || window.location.hostname.split('.')[0];

  // Only show if user is admin/owner or has multiple workspaces
  const isAdmin = user?.role === 'admin' || user?.role === 'owner' || user?.role === 'sangha_admin' || user?.role === 'super_admin';
  if (workspaces === null) return null; // still loading
  if (!isAdmin && workspaces.length <= 1) return null;

  const switchTo = (ws) => {
    const subdomain = ws.subdomain || ws.slug;
    const proto = window.location.protocol;
    const host = window.location.hostname;
    // Build the target URL - same domain structure, different subdomain
    let target;
    if (host.endsWith('.coppice.ai')) {
      target = `${proto}//${subdomain}.coppice.ai`;
    } else if (host.includes('localhost')) {
      target = `${proto}//${subdomain}.localhost:${window.location.port}`;
    } else {
      target = `${proto}//${subdomain}.${host.split('.').slice(1).join('.')}`;
    }
    window.location.href = target;
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-white/[0.06] transition-colors"
      >
        <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold text-white/80" style={{ backgroundColor: 'var(--t-ui-accent)' }}>
          <Building size={14} />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <p className="text-[11px] font-semibold text-white/80 truncate">{tenant?.name || 'Workspace'}</p>
          <p className="text-[9px] text-white/25 truncate">{currentSlug}.coppice.ai</p>
        </div>
        <ChevronsUpDown size={14} className="text-white/30 shrink-0" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-1 bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50">
          <div className="px-3 py-2 border-b border-white/[0.06]">
            <p className="text-[9px] font-bold uppercase tracking-[1.5px] text-white/30">Workspaces</p>
          </div>
          {(workspaces || []).map(ws => {
            const isCurrent = ws.slug === currentSlug || ws.subdomain === currentSlug;
            return (
              <button
                key={ws.id}
                onClick={() => { if (!isCurrent) switchTo(ws); setOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
                  isCurrent ? 'bg-white/[0.06]' : 'hover:bg-white/[0.04]'
                }`}
              >
                <div className="w-6 h-6 rounded-md bg-white/10 flex items-center justify-center text-[10px] font-bold text-white/60 shrink-0">
                  {(ws.name || ws.slug || '?')[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium text-white/80 truncate">{ws.name}</p>
                  <p className="text-[10px] text-white/25">{ws.role}</p>
                </div>
                {isCurrent && <Check size={14} className="text-white/50 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AppSidebar({ activeTab, setActiveTab, navGroups, user, logout, sidebarOpen, setSidebarOpen }) {
  const { tenant } = useTenant();
  const brandName = tenant?.branding?.companyName || 'COPPICE';
  const logo = tenant?.branding?.logo;

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setSidebarOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
        </div>
      )}

      {/* Sidebar */}
      <aside
        style={{ backgroundColor: 'var(--t-sidebar, #1a2e1a)' }}
        className={`
        fixed top-0 left-0 z-50 h-screen w-72 text-white flex flex-col
        transition-transform duration-200 ease-in-out
        lg:translate-x-0 lg:sticky lg:z-auto lg:shrink-0
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        {/* Brand */}
        <div className="flex items-center gap-2.5 px-[18px] py-5 border-b border-white/[0.06]">
          {logo ? (
            <img src={logo} className="h-8 rounded-lg" alt="" />
          ) : (
            <CoppiceLogo color={tenant?.branding?.hideSanghaBranding ? 'transparent' : (tenant?.branding?.sidebarColor || '#1a2e1a')} size={32} />
          )}
          <span className="text-[13px] font-heading font-bold tracking-[2.5px] text-white/70 uppercase">{brandName}</span>
          <button onClick={() => setSidebarOpen(false)} className="ml-auto lg:hidden text-white/50 hover:text-white">
            <X size={18} />
          </button>
        </div>

        {/* Nav groups */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-6">
          {navGroups.map(group => (
            <div key={group.label}>
              <p className="text-[9px] font-heading font-bold uppercase tracking-[2px] text-white/20 px-2 mb-1">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map(item => item.hivemind ? (
                  <button
                    key={item.id}
                    onClick={() => { setActiveTab(item.id); setSidebarOpen(false); }}
                    className={`w-full flex items-center gap-2.5 mx-0 my-1.5 px-3 py-2.5 rounded-[10px] transition-all border`}
                    style={{
                      backgroundColor: activeTab === item.id
                        ? 'rgba(var(--t-sidebar-accent-rgb), 0.1)'
                        : 'rgba(var(--t-sidebar-accent-rgb), 0.04)',
                      borderColor: activeTab === item.id
                        ? 'rgba(var(--t-sidebar-accent-rgb), 0.15)'
                        : 'rgba(var(--t-sidebar-accent-rgb), 0.08)',
                    }}
                  >
                    <span className="w-2 h-2 rounded-full animate-pulse shrink-0" style={{ backgroundColor: 'var(--t-sidebar-accent)' }} />
                    <div className="text-left">
                      <div className="text-[12px] font-heading font-semibold" style={{ color: 'var(--t-sidebar-accent)' }}>{item.label}</div>
                      <div className="text-[10px] text-white/30">Hivemind - always on</div>
                    </div>
                  </button>
                ) : (
                  <button
                    key={item.id}
                    onClick={() => { setActiveTab(item.id); setSidebarOpen(false); }}
                    className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-[13px] font-heading font-medium transition-colors ${
                      activeTab === item.id
                        ? ''
                        : 'text-white/45 hover:bg-white/[0.04] hover:text-white/85'
                    }`}
                    style={activeTab === item.id ? {
                      backgroundColor: 'rgba(var(--t-sidebar-accent-rgb), 0.08)',
                      color: 'var(--t-sidebar-accent)',
                    } : undefined}
                  >
                    <item.icon size={16} className={activeTab === item.id ? 'opacity-100' : 'opacity-50'} />
                    <span className="flex-1">{item.label}</span>
                    {item.live && (
                      <span className="w-[5px] h-[5px] rounded-full animate-pulse" style={{ backgroundColor: 'var(--t-sidebar-accent)' }} />
                    )}
                    {item.count != null && (
                      <span className={`text-[11px] font-semibold tabular-nums ${
                        activeTab !== item.id ? 'text-white/25' : ''
                      }`} style={activeTab === item.id ? { color: 'var(--t-sidebar-accent)' } : undefined}>{item.count}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Workspace switcher + User footer */}
        <div className="border-t border-white/[0.06] px-3 py-3 space-y-1.5">
          <WorkspaceSwitcher user={user} />
          <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white/[0.04] cursor-pointer">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[11px] font-bold text-white" style={{ backgroundColor: 'var(--t-ui-accent)' }}>
              {user?.name?.split(' ').map(n => n[0]).join('').slice(0, 1).toUpperCase() || 'U'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-white/85 truncate">{user?.name}</p>
              <p className="text-[10px] text-white/25 truncate mt-px">{user?.email}</p>
            </div>
            <button onClick={logout} className="text-white/40 hover:text-white/80" title="Logout">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}

// ─── Main App Content ────────────────────────────────────────────────────────

function AppContent() {
  const { user, loading: authLoading, login, logout, hasPermission, hasRole } = useAuth();
  const { tenant } = useTenant();
  const [activeTab, setActiveTab] = useState(() => {
    const hash = window.location.hash.slice(1);
    return hash || 'command';
  });
  const handleSetActiveTab = (tab) => {
    if (tab !== 'portfolio') setSelectedCompanyId(null);
    setActiveTab(tab);
    window.location.hash = tab;
  };

  // Sync tab from browser back/forward
  useEffect(() => {
    const onHash = () => {
      const hash = window.location.hash.slice(1);
      if (hash) setActiveTab(hash);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Listen for cross-agent navigation events (delegation "View Thread" button)
  useEffect(() => {
    const onNav = (e) => {
      const { tab, threadId } = e.detail || {};
      if (tab) {
        handleSetActiveTab(tab);
        // Store pending threadId so AgentChat auto-selects it on mount (uses existing open_thread_id pattern)
        if (threadId) localStorage.setItem('open_thread_id', threadId);
      }
    };
    window.addEventListener('coppice:navigate', onNav);
    return () => window.removeEventListener('coppice:navigate', onNav);
  }, []);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [selectedCompanyId, setSelectedCompanyId] = useState(null);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showSetPassword, setShowSetPassword] = useState(false);

  // Clean query params from URL (e.g. ?email=... from login)
  useEffect(() => {
    if (user && window.location.search) {
      window.history.replaceState({}, '', window.location.pathname + window.location.hash);
    }
  }, [user]);

  // Prompt OAuth-only users to set a password, or force password change if flagged
  useEffect(() => {
    if (user?.mustSetPassword) {
      setShowSetPassword(true);
    } else if (user?.mustChangePassword) {
      setShowChangePassword(true);
    }
    // Show onboarding once per user (localStorage flag persists after completion)
    if (user?.id && !localStorage.getItem(`onboarding_done_${user.id}`)) {
      setShowOnboarding(true);
    }
  }, [user]);

  const industry = tenant?.settings?.industry;
  const isConstruction = industry === 'construction';
  const isVenture = industry === 'venture';

  // Dynamic PWA manifest per tenant
  useEffect(() => {
    if (!tenant) return;
    const tenantManifest = {
      name: tenant?.name || (isConstruction ? 'DACP Construction' : isVenture ? 'Zhan Capital' : 'Sangha Renewables'),
      short_name: tenant?.branding?.companyName || (isConstruction ? 'DACP' : isVenture ? 'Zhan' : 'Sangha'),
      description: isConstruction ? 'AI-powered construction operations platform' : isVenture ? 'AI-powered portfolio management platform' : 'AI-powered mining operations platform',
      start_url: window.location.origin + '/',
      display: 'standalone',
      background_color: '#fafaf8',
      theme_color: isConstruction ? '#1e3a5f' : (tenant?.branding?.primaryColor || '#1a6b3c'),
      orientation: 'portrait',
      icons: [
        { src: '/coppice-logo.png', sizes: '192x192', type: 'image/png' },
        { src: '/coppice-logo.png', sizes: '512x512', type: 'image/png' },
        { src: '/coppice-logo.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    };
    const blob = new Blob([JSON.stringify(tenantManifest)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.querySelector('link[rel="manifest"]');
    if (link) link.href = url;
    // Update apple meta tags
    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = tenantManifest.theme_color;
    const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
    if (appleTitle) appleTitle.content = tenantManifest.short_name;
    const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
    if (appleIcon) appleIcon.href = '/coppice-logo.png';
    document.title = tenantManifest.name;
    return () => URL.revokeObjectURL(url);
  }, [tenant, isConstruction, isVenture]);

  // Build navigation groups
  let platformItems = [];
  let agentItems = [];
  let infraItems = [];

  if (isConstruction) {
    platformItems = [
      { id: 'command', label: 'Command', icon: LayoutDashboard },
      { id: 'office', label: 'Office', icon: Building },
      { id: 'files', label: 'Files', icon: FolderOpen },
    ];
    agentItems = [
      { id: 'hivemind-chat', label: 'DACP Agent', icon: Bot, hivemind: true },
      { id: 'workflow-chat', label: 'Workflow', icon: ClipboardList },
      { id: 'comms-chat', label: 'Comms', icon: Mail },
    ];
    infraItems = [
      { id: 'accounting', label: 'Accounting', icon: DollarSign },
    ];
  } else if (isVenture) {
    platformItems = [
      { id: 'command', label: 'Command', icon: LayoutDashboard },
      { id: 'office', label: 'Office', icon: Building, live: true },
      { id: 'portfolio', label: 'Portfolio', icon: Building2 },
      { id: 'audit-trail', label: 'Files', icon: FileText },
    ];
    agentItems = [
      { id: 'hivemind-chat', label: 'Zhan Agent', icon: Bot, hivemind: true },
      { id: 'bots', label: 'Lead Engine', icon: MessageSquare },
      { id: 'pitch-deck-chat', label: 'Pitch Deck', icon: Presentation },
      { id: 'sales-chat', label: 'Sales Agent', icon: Phone },
      { id: 'meetings-chat', label: 'Meetings', icon: Mic, live: true },
      { id: 'email-chat', label: 'Email', icon: Mail },
    ];
  } else {
    platformItems.push({ id: 'command', label: 'Command', icon: LayoutDashboard, count: 5 });
    platformItems.push({ id: 'office', label: 'Office', icon: Building, live: true });
    platformItems.push({ id: 'audit-trail', label: 'Files', icon: FileText });

    agentItems.push({ id: 'hivemind-chat', label: 'Sangha Agent', icon: Bot, hivemind: true });
    agentItems.push({ id: 'bots', label: 'Lead Engine', icon: MessageSquare, count: 502 });
    agentItems.push({ id: 'curtailment-chat', label: 'Curtailment', icon: Zap, live: true });
    agentItems.push({ id: 'pools-chat', label: 'Pool Routing', icon: Activity });
    agentItems.push({ id: 'comms-chat', label: 'Comms', icon: Mail });

    if (!user || hasPermission('viewOperations')) {
      infraItems.push({ id: 'operations', label: 'Sites', icon: Hammer });
    }
    infraItems.push({ id: 'insurance', label: 'Insurance & Coverage', icon: Umbrella });
    infraItems.push({ id: 'accounting', label: 'Accounting', icon: DollarSign });
    if (!user || hasPermission('viewOperations')) {
      infraItems.push({ id: 'reporting', label: 'Operations', icon: BarChart3 });
    }
  }

  const systemItems = [];
  if (!user || hasPermission('viewSettings')) {
    systemItems.push({ id: 'settings', label: 'Settings', icon: Settings });
  }
  if (user && (hasRole('sangha_admin') || hasRole('sangha_underwriter'))) {
    systemItems.push({ id: 'admin', label: 'Admin Console', icon: Shield });
  }

  const navGroups = [
    { label: 'Platform', items: platformItems },
    { label: 'Agents', items: agentItems },
    ...(infraItems.length > 0 ? [{ label: 'Infrastructure', items: infraItems }] : []),
    { label: 'System', items: systemItems },
  ].filter(g => g.items.length > 0);

  // Tab labels for the page header
  const tabLabels = {
    command: 'Command',
    operations: 'Operations',
    macro: 'Macro Intelligence',
    correlations: 'Correlations',
    liquidity: 'Liquidity',
    insurance: 'Insurance',
    bots: isConstruction ? 'Estimating Bot' : 'Lead Engine',
    meetings: 'Meetings',
    alerts: 'Alerts',
    notes: 'Documents',
    curtailment: 'Curtailment',
    pools: 'Pool Routing',
    reporting: 'Reporting',
    settings: 'Settings',
    admin: 'Admin Console',
    'agent-tasks': 'Agent Tasks',
    'field-reports': 'Field Reports',
    'audit-trail': 'Audit Trail',
    'office': 'Office',
    'files': 'Files',
    'accounting': 'Accounting',
    'portfolio': 'Portfolio Companies',
  };

  const isChatView = activeTab.endsWith('-chat') || activeTab === 'bots';

  // WebSocket connection for real-time updates
  useEffect(() => {
    let ws;
    let reconnectTimeout;

    const connect = () => {
      const wsPort = window.location.port === '5173' ? '3002' : window.location.port;
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = import.meta.env.VITE_WS_URL || `${wsProtocol}//${window.location.hostname}:${wsPort}`;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        setWsConnected(true);
      };

      ws.onclose = () => {
        setWsConnected(false);
        reconnectTimeout = setTimeout(connect, 5000);
      };

      ws.onerror = () => {};

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        window.dispatchEvent(new CustomEvent('ws-update', { detail: data }));
      };
    };

    connect();

    return () => {
      if (ws) ws.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, []);

  // Request notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Show login if not authenticated and auth is loaded
  if (!authLoading && !user) {
    return (
      <Suspense fallback={<LoadingSpinner />}>
        <LoginPage onLogin={(data) => {
          login(data);
          if (data.user?.mustChangePassword) {
            setShowChangePassword(true);
          }
        }} />
      </Suspense>
    );
  }

  // Show loading while auth is loading
  if (authLoading) {
    return (
      <div className="min-h-screen bg-terminal-bg flex items-center justify-center">
        <div className="text-center">
          <div className="spinner w-10 h-10 mx-auto mb-4" />
          <p className="text-terminal-muted text-sm">Loading...</p>
        </div>
      </div>
    );
  }

  // Show onboarding wizard for new owners
  if (showOnboarding) {
    return (
      <Suspense fallback={<LoadingSpinner />}>
        <OnboardingWizard onComplete={() => { localStorage.setItem(`onboarding_done_${user?.id}`, '1'); setShowOnboarding(false); }} />
      </Suspense>
    );
  }

  // Force password change modal (shown over the main UI)
  const changePasswordOverlay = showChangePassword ? (
    <Suspense fallback={null}>
      <ChangePasswordModal
        onSuccess={() => setShowChangePassword(false)}
        onLogout={logout}
      />
    </Suspense>
  ) : null;

  // IPP partner gets simplified dashboard
  if (user?.role === 'ipp_partner') {
    return (
      <div className="min-h-screen bg-terminal-bg text-terminal-text flex">
        <AppSidebar
          activeTab="partner"
          setActiveTab={() => {}}
          navGroups={[{ label: 'Portal', items: [{ id: 'partner', label: 'Partner Dashboard', icon: Activity }] }]}
          user={user}
          logout={logout}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
        />
        <div className="flex-1 min-h-screen overflow-auto">
          <Suspense fallback={<LoadingSpinner />}>
            <PartnerDashboard />
          </Suspense>
        </div>
        <Suspense fallback={null}><HelpChatWidget /></Suspense>
      </div>
    );
  }

  // Balance sheet partner (LP) gets LP dashboard
  if (user?.role === 'balance_sheet_partner') {
    return (
      <div className="min-h-screen bg-terminal-bg text-terminal-text flex">
        <AppSidebar
          activeTab="lp"
          setActiveTab={() => {}}
          navGroups={[{ label: 'Portal', items: [{ id: 'lp', label: 'LP Dashboard', icon: DollarSign }] }]}
          user={user}
          logout={logout}
          sidebarOpen={sidebarOpen}
          setSidebarOpen={setSidebarOpen}
        />
        <div className="flex-1 min-h-screen overflow-auto">
          <Suspense fallback={<LoadingSpinner />}>
            <LPDashboard />
          </Suspense>
        </div>
        <Suspense fallback={null}><HelpChatWidget /></Suspense>
      </div>
    );
  }

  // Super admin gets completely separate experience
  if (user?.role === 'sangha_admin') {
    return (
      <Suspense fallback={<LoadingSpinner />}>
        <SuperAdminDashboard />
      </Suspense>
    );
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'command':
        return isConstruction ? <DacpCommandDashboard onNavigate={handleSetActiveTab} /> : <CommandDashboard onNavigate={handleSetActiveTab} />;
      // CEO Dashboard will be a separate interface, not embedded here
      case 'agent-tasks':
        return <TaskTrackerDashboard />;
      case 'field-reports':
        return <DacpFieldReportsDashboard />;
      case 'operations':
        return <OperationsDashboard onNavigate={handleSetActiveTab} />;
      case 'macro':
        return <MacroDashboard />;
      case 'correlations':
        return (
          <div className="p-6">
            <CorrelationPanel fullWidth />
          </div>
        );
      case 'alerts':
        return (
          <div className="p-6">
            <AlertsPanel />
          </div>
        );
      case 'notes':
        return (
          <div className="p-6">
            <NotesPanel />
          </div>
        );
      case 'liquidity':
        return (
          <div className="p-6">
            <LiquidityPanel />
          </div>
        );
      case 'bots':
        return <LeadEngineWorkspace />;
      case 'curtailment':
        return <CurtailmentDashboard />;
      case 'pools':
        return <PoolRoutingDashboard />;
      case 'meetings':
        return <MeetingsDashboard />;
      case 'office':
        return <OfficeDashboard />;
      case 'reporting':
        return <ReportingDashboard />;
      case 'insurance':
        return <InsuranceDashboard />;
      case 'settings':
        return isConstruction ? <DacpSettingsPanel /> : <SettingsPanel />;
      case 'audit-trail':
        return <AuditTrailDashboard />;
      case 'files':
        return <FilesDashboard />;
      case 'accounting':
        return <AccountingDashboard />;
      case 'portfolio':
        return selectedCompanyId
          ? <CompanyDetail companyId={selectedCompanyId} onBack={() => setSelectedCompanyId(null)} />
          : <PortfolioOverview onSelectCompany={(id) => setSelectedCompanyId(id)} />;
      case 'admin':
        return <AdminConsoleDashboard />;
      case 'hivemind-chat':
        return <AgentChat agentId={isConstruction ? 'hivemind' : isVenture ? 'zhan' : 'sangha'} />;
      case 'field-chat':
        return <FieldReporterChat />;
      case 'scope-chat':
        return <ScopeAnalyzerChat />;
      case 'estimating-chat':
      case 'documents-chat':
      case 'meetings-chat':
      case 'email-chat':
      case 'curtailment-chat':
      case 'pools-chat':
      case 'pitch-deck-chat':
      case 'sales-chat':
      case 'workflow-chat':
      case 'comms-chat':
        return <AgentChat agentId={activeTab.replace('-chat', '')} />;
      default:
        return <CommandDashboard onNavigate={handleSetActiveTab} />;
    }
  };

  return (
    <div className="min-h-screen bg-terminal-bg text-terminal-text flex">
      {/* Left Sidebar */}
      <AppSidebar
        activeTab={activeTab}
        setActiveTab={handleSetActiveTab}
        navGroups={navGroups}
        user={user}
        logout={logout}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
      />

      {/* Main area */}
      <div className={`flex-1 flex flex-col ${isChatView ? 'max-h-screen overflow-hidden' : 'min-h-screen overflow-auto'}`}>
        {/* Top bar - hidden for chat views (chat has its own header) */}
        {!isChatView && (
          <header className="sticky top-0 z-30 bg-terminal-panel border-b border-terminal-border px-7 py-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setSidebarOpen(true)}
                className="p-1.5 hover:bg-terminal-border/50 rounded-lg lg:hidden"
              >
                <Menu size={20} />
              </button>
              <div className="flex items-center gap-2.5">
                <h1 className="text-lg font-heading font-bold tracking-[0.3px]">{tabLabels[activeTab] || 'Overview'}</h1>
              </div>
              {/* Search bar */}
              <div className="hidden sm:flex items-center max-w-[260px]">
                <div className="relative w-full">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-terminal-muted" />
                  <input
                    type="text"
                    placeholder="Search..."
                    className="w-full pl-9 pr-14 py-1.5 rounded-lg text-[12px] bg-[#f5f4f0] border border-terminal-border text-terminal-text placeholder:text-terminal-muted focus:outline-none focus:border-terminal-green transition-colors"
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-terminal-muted bg-terminal-panel border border-terminal-border rounded px-1.5 py-[1px] font-mono">⌘K</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <NotificationBell onNavigate={handleSetActiveTab} />
            </div>
          </header>
        )}

        {/* Page content */}
        <main className={isChatView ? 'flex-1 relative' : 'flex-1'}>
          <Suspense fallback={<LoadingSpinner />}>
            {renderContent()}
          </Suspense>
        </main>
      </div>

      {/* Force set/change password overlays */}
      {showSetPassword && (
        <Suspense fallback={null}>
          <SetPasswordModal
            onSuccess={() => setShowSetPassword(false)}
            onSkip={() => setShowSetPassword(false)}
          />
        </Suspense>
      )}
      {changePasswordOverlay}

      {/* Help Chat Widget - floating on all authenticated pages */}
      <Suspense fallback={null}>
        <HelpChatWidget />
      </Suspense>
    </div>
  );
}

function App() {
  // Public shared meeting page - bypass auth entirely
  const pathMatch = window.location.pathname.match(/^\/m\/([a-zA-Z0-9_-]+)$/);
  if (pathMatch) {
    return (
      <ErrorBoundary>
        <Suspense fallback={<LoadingSpinner />}>
          <SharedMeetingPage token={pathMatch[1]} />
        </Suspense>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <TenantProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </TenantProvider>
    </ErrorBoundary>
  );
}

export default App;

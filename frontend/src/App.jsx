import React, { useState, useEffect, Suspense, lazy } from 'react';
import {
  Menu, X, Bell, FileText, Database, TrendingUp, Activity,
  DollarSign, Settings, Hammer, BarChart3, LogOut, User, Shield, Umbrella
} from 'lucide-react';

// Auth
import { AuthProvider, useAuth } from './components/auth/AuthContext';

// Lazy-load tab content for performance
const LoginPage = lazy(() => import('./components/auth/LoginPage'));
const OnboardingWizard = lazy(() => import('./components/auth/OnboardingWizard'));
const OperationsDashboard = lazy(() => import('./components/dashboards/OperationsDashboard'));
const MacroDashboard = lazy(() => import('./components/dashboards/MacroDashboard'));
const PartnerDashboard = lazy(() => import('./components/dashboards/PartnerDashboard'));
const AdminConsoleDashboard = lazy(() => import('./components/dashboards/AdminConsoleDashboard'));
const CorrelationPanel = lazy(() => import('./components/panels/macro/CorrelationPanel'));
const AlertsPanel = lazy(() => import('./components/AlertsPanel'));
const NotesPanel = lazy(() => import('./components/NotesPanel'));
const LiquidityPanel = lazy(() => import('./components/LiquidityPanel'));
const SettingsPanel = lazy(() => import('./components/SettingsPanel'));
const InsuranceDashboard = lazy(() => import('./components/dashboards/InsuranceDashboard'));

// Non-lazy supporting components
import ManualEntryModal from './components/ManualEntryModal';
import Sidebar from './components/Sidebar';
import NotificationBell from './components/NotificationBell';

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="spinner w-10 h-10" />
    </div>
  );
}

function AppContent() {
  const { user, loading: authLoading, logout, hasPermission, hasRole } = useAuth();
  const [activeTab, setActiveTab] = useState('operations');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [manualEntryOpen, setManualEntryOpen] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Build navigation based on user role
  const NAV_ITEMS = [];

  if (!user || hasPermission('viewOperations')) {
    NAV_ITEMS.push({ id: 'operations', label: 'Operations', shortLabel: 'Ops', icon: Hammer });
  }
  if (!user || hasPermission('viewMacroIntelligence')) {
    NAV_ITEMS.push({ id: 'macro', label: 'Macro Intelligence', shortLabel: 'Macro', icon: TrendingUp });
    NAV_ITEMS.push({ id: 'correlations', label: 'Correlations', shortLabel: 'Corr', icon: BarChart3 });
  }
  if (!user || hasPermission('viewAlerts')) {
    NAV_ITEMS.push({ id: 'alerts', label: 'Alerts', shortLabel: 'Alerts', icon: Bell });
  }
  if (!user || hasPermission('viewNotes')) {
    NAV_ITEMS.push({ id: 'notes', label: 'Notes', shortLabel: 'Notes', icon: FileText });
  }
  NAV_ITEMS.push({ id: 'liquidity', label: 'Liquidity', shortLabel: 'Liq', icon: DollarSign });
  NAV_ITEMS.push({ id: 'insurance', label: 'Insurance', shortLabel: 'Ins', icon: Umbrella });
  if (!user || hasPermission('viewSettings')) {
    NAV_ITEMS.push({ id: 'settings', label: 'Settings', shortLabel: 'Settings', icon: Settings });
  }
  // Admin console for Sangha roles
  if (user && (hasRole('sangha_admin') || hasRole('sangha_underwriter'))) {
    NAV_ITEMS.push({ id: 'admin', label: 'Admin Console', shortLabel: 'Admin', icon: Shield });
  }

  // WebSocket connection for real-time updates
  useEffect(() => {
    let ws;
    let reconnectTimeout;

    const connect = () => {
      const wsPort = window.location.port === '3000' ? '3002' : window.location.port;
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = import.meta.env.VITE_WS_URL || `${wsProtocol}//${window.location.hostname}:${wsPort}`;
      ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log('WebSocket connected');
        setWsConnected(true);
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        setWsConnected(false);
        reconnectTimeout = setTimeout(connect, 5000);
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

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
          // Check if onboarding needed
          if (data.user.role === 'owner') {
            setShowOnboarding(true);
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
        <OnboardingWizard onComplete={() => setShowOnboarding(false)} />
      </Suspense>
    );
  }

  // IPP partner gets simplified dashboard
  if (user?.role === 'ipp_partner') {
    return (
      <div className="min-h-screen bg-terminal-bg text-terminal-text">
        <header className="sticky top-0 z-50 bg-terminal-bg border-b border-terminal-border">
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-terminal-green font-bold text-lg">&#9650;</span>
              <h1 className="text-lg font-bold">AMPERA</h1>
              <span className="text-xs bg-terminal-amber/20 text-terminal-amber px-2 py-0.5 rounded">PARTNER</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-terminal-muted">{user.email}</span>
              <button onClick={logout} className="text-terminal-muted hover:text-terminal-red">
                <LogOut size={16} />
              </button>
            </div>
          </div>
        </header>
        <Suspense fallback={<LoadingSpinner />}>
          <PartnerDashboard />
        </Suspense>
      </div>
    );
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'operations':
        return <OperationsDashboard onNavigate={setActiveTab} />;
      case 'macro':
        return <MacroDashboard />;
      case 'correlations':
        return (
          <div className="p-4">
            <CorrelationPanel fullWidth />
          </div>
        );
      case 'alerts':
        return (
          <div className="p-4">
            <AlertsPanel />
          </div>
        );
      case 'notes':
        return (
          <div className="p-4">
            <NotesPanel />
          </div>
        );
      case 'liquidity':
        return (
          <div className="p-4">
            <LiquidityPanel />
          </div>
        );
      case 'insurance':
        return <InsuranceDashboard />;
      case 'settings':
        return <SettingsPanel />;
      case 'admin':
        return <AdminConsoleDashboard />;
      default:
        return <OperationsDashboard onNavigate={setActiveTab} />;
    }
  };

  // Only show a subset of tabs in mobile nav (most important ones)
  const mobileNavItems = NAV_ITEMS.filter(item =>
    ['operations', 'macro', 'alerts', 'insurance', 'settings'].includes(item.id)
  );

  return (
    <div className="min-h-screen bg-terminal-bg text-terminal-text">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-terminal-bg border-b border-terminal-border">
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 hover:bg-terminal-panel rounded-lg md:hidden"
            >
              {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <div className="flex items-center gap-2">
              <span className="text-terminal-green font-bold text-lg">&#9650;</span>
              <h1 className="text-lg font-bold hidden sm:block">AMPERA</h1>
              <h1 className="text-lg font-bold sm:hidden">A</h1>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-1">
            {NAV_ITEMS.map(item => (
              <NavButton
                key={item.id}
                active={activeTab === item.id}
                onClick={() => setActiveTab(item.id)}
                icon={<item.icon size={16} />}
                label={item.label}
              />
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <NotificationBell />
            {hasPermission('exportData') && (
              <button
                onClick={() => setManualEntryOpen(true)}
                className="flex items-center gap-2 px-3 py-1.5 bg-terminal-panel border border-terminal-border rounded hover:border-terminal-green text-sm"
              >
                <Database size={14} />
                <span className="hidden sm:inline">Data Entry</span>
              </button>
            )}
            {/* User info */}
            <div className="flex items-center gap-2 pl-2 border-l border-terminal-border">
              <div className="hidden sm:flex flex-col items-end">
                <span className="text-xs text-terminal-text">{user?.name}</span>
                <span className="text-[10px] text-terminal-muted capitalize">{user?.role}</span>
              </div>
              <button
                onClick={logout}
                className="p-1.5 text-terminal-muted hover:text-terminal-red rounded"
                title="Logout"
              >
                <LogOut size={16} />
              </button>
            </div>
            <div
              className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-terminal-green' : 'bg-terminal-red'}`}
              title={wsConnected ? 'Connected' : 'Disconnected'}
            />
          </div>
        </div>

        {/* Mobile nav */}
        <div className="md:hidden border-t border-terminal-border flex overflow-x-auto">
          {mobileNavItems.map(item => (
            <MobileNavButton
              key={item.id}
              active={activeTab === item.id}
              onClick={() => setActiveTab(item.id)}
              icon={<item.icon size={16} />}
              label={item.shortLabel}
            />
          ))}
        </div>
      </header>

      {/* Sidebar for mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <Sidebar onClose={() => setSidebarOpen(false)} />
        </div>
      )}

      {/* Main content */}
      <main className="pb-8">
        <Suspense fallback={<LoadingSpinner />}>
          {renderContent()}
        </Suspense>
      </main>

      {/* Manual Entry Modal */}
      {manualEntryOpen && (
        <ManualEntryModal onClose={() => setManualEntryOpen(false)} />
      )}

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-terminal-bg border-t border-terminal-border px-4 py-2 text-xs text-terminal-muted flex justify-between">
        <span>Ampera | Mining Operations Platform</span>
        <span>{new Date().toLocaleString()}</span>
      </footer>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded transition-colors ${
        active
          ? 'bg-terminal-panel text-terminal-green border border-terminal-green/30'
          : 'hover:bg-terminal-panel text-terminal-muted hover:text-terminal-text'
      }`}
    >
      {icon}
      <span className="text-sm">{label}</span>
    </button>
  );
}

function MobileNavButton({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex flex-col items-center gap-1 py-2 transition-colors min-w-0 ${
        active
          ? 'text-terminal-green border-b-2 border-terminal-green'
          : 'text-terminal-muted'
      }`}
    >
      {icon}
      <span className="text-xs truncate">{label}</span>
    </button>
  );
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;

import React, { useState, useEffect, Suspense, lazy } from 'react';
import {
  Menu, X, Bell, FileText, Database, TrendingUp, Activity,
  DollarSign, Settings, Hammer, BarChart3
} from 'lucide-react';

// Lazy-load tab content for performance
const OperationsDashboard = lazy(() => import('./components/dashboards/OperationsDashboard'));
const MacroDashboard = lazy(() => import('./components/dashboards/MacroDashboard'));
const CorrelationPanel = lazy(() => import('./components/panels/macro/CorrelationPanel'));
const AlertsPanel = lazy(() => import('./components/AlertsPanel'));
const NotesPanel = lazy(() => import('./components/NotesPanel'));
const LiquidityPanel = lazy(() => import('./components/LiquidityPanel'));
const SettingsPanel = lazy(() => import('./components/SettingsPanel'));

// Non-lazy supporting components
import ManualEntryModal from './components/ManualEntryModal';
import Sidebar from './components/Sidebar';

// Navigation configuration
const NAV_ITEMS = [
  { id: 'operations', label: 'Operations', shortLabel: 'Ops', icon: Hammer },
  { id: 'macro', label: 'Macro Intelligence', shortLabel: 'Macro', icon: TrendingUp },
  { id: 'correlations', label: 'Correlations', shortLabel: 'Corr', icon: BarChart3 },
  { id: 'alerts', label: 'Alerts', shortLabel: 'Alerts', icon: Bell },
  { id: 'notes', label: 'Notes', shortLabel: 'Notes', icon: FileText },
  { id: 'liquidity', label: 'Liquidity', shortLabel: 'Liq', icon: DollarSign },
  { id: 'settings', label: 'Settings', shortLabel: 'Settings', icon: Settings },
];

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="spinner w-10 h-10" />
    </div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState('operations');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [manualEntryOpen, setManualEntryOpen] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);

  // WebSocket connection for real-time updates
  useEffect(() => {
    let ws;
    let reconnectTimeout;

    const connect = () => {
      const wsPort = window.location.port === '3000' ? '3001' : window.location.port;
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
      case 'settings':
        return <SettingsPanel />;
      default:
        return <OperationsDashboard onNavigate={setActiveTab} />;
    }
  };

  // Only show a subset of tabs in mobile nav (most important ones)
  const mobileNavItems = NAV_ITEMS.filter(item =>
    ['operations', 'macro', 'alerts', 'notes', 'settings'].includes(item.id)
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
              <h1 className="text-lg font-bold hidden sm:block">SANGHA MINEOS</h1>
              <h1 className="text-lg font-bold sm:hidden">SMO</h1>
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
            <button
              onClick={() => setManualEntryOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-terminal-panel border border-terminal-border rounded hover:border-terminal-green text-sm"
            >
              <Database size={14} />
              <span className="hidden sm:inline">Data Entry</span>
            </button>
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
        <span>Sangha MineOS | Mining Operations Platform</span>
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

export default App;

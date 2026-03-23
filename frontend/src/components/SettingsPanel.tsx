import React, { useState, useEffect, lazy, Suspense } from 'react';
import { Cpu, Zap, Server, Bot, Bell, Palette, Save, RefreshCw, Plus, Trash2, ChevronDown, Battery, Monitor, Users, Key, Link2, Globe, Shield, Mail, Activity } from 'lucide-react';
import { useApi } from '../hooks/useApi';
import SettingsTeamPanel from './SettingsTeamPanel';
const EmailSecurityPanel = lazy(() => import('./EmailSecurityPanel'));
const AgentRunHistory = lazy(() => import('./panels/agents/AgentRunHistory'));

interface SettingsSectionProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  phase?: number;
  active?: boolean;
  children?: React.ReactNode;
}

function SettingsSection({ title, description, icon, phase, active, children }: SettingsSectionProps) {
  return (
    <div className="bg-terminal-panel border border-terminal-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-terminal-border bg-terminal-bg/50">
        <div className="flex items-center gap-3">
          {icon}
          <div>
            <h3 className="font-semibold text-terminal-text">{title}</h3>
            <p className="text-xs text-terminal-muted">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {active && (
            <span className="px-2 py-0.5 text-xs bg-terminal-green/20 text-terminal-green rounded">
              Active
            </span>
          )}
          {phase && !active && (
            <span className="px-2 py-0.5 text-xs bg-terminal-border rounded text-terminal-muted">
              Phase {phase}
            </span>
          )}
        </div>
      </div>
      <div className="p-4">
        {children || (
          <p className="text-sm text-terminal-muted italic">
            Configuration will be available when this feature is implemented.
          </p>
        )}
      </div>
    </div>
  );
}

const ERCOT_NODES = [
  'HB_NORTH', 'HB_SOUTH', 'HB_WEST', 'HB_HOUSTON', 'HB_PAN', 'HB_BUSAVG',
  'LZ_NORTH', 'LZ_SOUTH', 'LZ_WEST', 'LZ_HOUSTON'
];

const POOL_OPTIONS = [
  { id: 'foundry', name: 'Foundry USA' },
  { id: 'luxor', name: 'Luxor' },
  { id: 'antpool', name: 'Antpool' },
  { id: 'f2pool', name: 'F2Pool' },
  { id: 'braiins', name: 'Braiins Pool' },
  { id: 'ocean', name: 'Ocean' },
];

interface FleetEntry {
  asicModel: any;
  quantity: number;
  energyNode: string;
  location: string;
}

function IntegrationsPanel() {
  const [integrations, setIntegrations] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const api = useApi();

  useEffect(() => {
    api.get('/api/v1/auth/google/integrations')
      .then(res => res.json())
      .then(data => {
        const map: Record<string, boolean> = {};
        (data.connected || []).forEach((s: string) => { map[s.replace('google-', '')] = true; });
        setIntegrations(map);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const connectIntegration = (scopes: string, sourceId: string) => {
    const token = localStorage.getItem('coppice_token');
    if (!token) return;
    const url = `${window.location.origin}/api/v1/auth/google/integrate?scopes=${encodeURIComponent(scopes)}&source=google-${sourceId}&token=${encodeURIComponent(token)}`;
    const popup = window.open(url, 'oauth-popup', 'width=600,height=700,scrollbars=yes');

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'oauth-integration-success') {
        const connectedSource = event.data.source?.replace('google-', '');
        if (connectedSource) {
          setIntegrations(prev => ({ ...prev, [connectedSource]: true }));
        }
        window.removeEventListener('message', handleMessage);
      }
    };
    window.addEventListener('message', handleMessage);
  };

  const AVAILABLE_INTEGRATIONS = [
    {
      id: 'email',
      name: 'Email & Calendar',
      description: 'Send emails, manage inbox, and schedule meetings on behalf of your team',
      icon: Mail,
      scopes: 'gmail.send,gmail.modify,calendar.readonly,calendar.events',
    },
    {
      id: 'drive',
      name: 'Google Drive',
      description: 'Create and manage documents, spreadsheets, and presentations',
      icon: Globe,
      scopes: 'drive,docs,spreadsheets',
    },
  ];

  return (
    <div className="space-y-4">
      <SettingsSection
        title="Connected Services"
        description="Connect your Google account to enable email, calendar, and document features"
        icon={<Link2 size={18} className="text-terminal-green" />}
        active
      >
        {loading ? (
          <p className="text-sm text-terminal-muted">Loading...</p>
        ) : (
          <div className="space-y-3">
            {AVAILABLE_INTEGRATIONS.map(integration => {
              const connected = integrations[integration.id];
              const Icon = integration.icon;
              return (
                <div key={integration.id} className="flex items-center justify-between p-3 bg-terminal-bg rounded-lg border border-terminal-border">
                  <div className="flex items-center gap-3">
                    <Icon size={20} className={connected ? 'text-terminal-green' : 'text-terminal-muted'} />
                    <div>
                      <p className="text-sm font-medium text-terminal-text">{integration.name}</p>
                      <p className="text-xs text-terminal-muted">{integration.description}</p>
                    </div>
                  </div>
                  {connected ? (
                    <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-terminal-green bg-terminal-green/10 rounded-lg">
                      <Shield size={12} /> Connected
                    </span>
                  ) : (
                    <button
                      onClick={() => connectIntegration(integration.scopes, integration.id)}
                      className="px-4 py-1.5 text-xs font-semibold bg-[#1a6b3c] text-white rounded-lg hover:bg-[#15572f] transition-colors"
                    >
                      Connect
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SettingsSection>
    </div>
  );
}

export default function SettingsPanel() {
  // Phase 2: Energy settings
  const { data: settingsData, refetch: refetchSettings } = useApi('/energy/settings', { refreshInterval: 0 });

  const [energySettings, setEnergySettings] = useState({
    iso: 'ERCOT',
    primaryNode: 'HB_NORTH',
    monitoredNodes: ['HB_NORTH'],
    priceAlertHigh: 50,
    priceAlertLow: 0,
    negativeAlertEnabled: true,
    refreshIntervalMinutes: 5,
  });
  const [savingEnergy, setSavingEnergy] = useState(false);
  const [savedEnergy, setSavedEnergy] = useState(false);

  useEffect(() => {
    if (settingsData?.settings) {
      setEnergySettings(prev => ({ ...prev, ...settingsData.settings }));
    }
  }, [settingsData]);

  const handleSaveEnergy = async () => {
    setSavingEnergy(true);
    try {
      const response = await fetch('/api/energy/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(energySettings),
      });
      if (response.ok) {
        setSavedEnergy(true);
        setTimeout(() => setSavedEnergy(false), 2000);
        refetchSettings();
      }
    } catch (err) {
      console.error('Failed to save energy settings:', err);
    } finally {
      setSavingEnergy(false);
    }
  };

  const toggleNode = (node: string) => {
    setEnergySettings(prev => ({
      ...prev,
      monitoredNodes: prev.monitoredNodes.includes(node)
        ? prev.monitoredNodes.filter((n: string) => n !== node)
        : [...prev.monitoredNodes, node],
    }));
  };

  // Phase 3: Fleet configuration
  const { data: asicsData } = useApi('/fleet/asics', { refreshInterval: 0 });
  const { data: fleetConfigData, refetch: refetchFleet } = useApi('/fleet/config', { refreshInterval: 0 });

  const [fleetEntries, setFleetEntries] = useState<FleetEntry[]>([]);
  const [defaultEnergyCost, setDefaultEnergyCost] = useState(0.05);
  const [savingFleet, setSavingFleet] = useState(false);
  const [savedFleet, setSavedFleet] = useState(false);
  const [showAddModel, setShowAddModel] = useState(false);
  const [customModel, setCustomModel] = useState({ manufacturer: '', model: '', hashrate: 0, powerConsumption: 0 });
  const [isCustom, setIsCustom] = useState(false);

  const asicModels = asicsData?.models || [];

  useEffect(() => {
    if (fleetConfigData?.config) {
      const cfg = fleetConfigData.config;
      if (cfg.entries && cfg.entries.length > 0) {
        setFleetEntries(cfg.entries);
      }
      if (cfg.defaultEnergyCostKWh !== undefined) {
        setDefaultEnergyCost(cfg.defaultEnergyCostKWh);
      }
    }
  }, [fleetConfigData]);

  const addFleetEntry = (model: any) => {
    setFleetEntries(prev => [...prev, {
      asicModel: model,
      quantity: 1,
      energyNode: '',
      location: '',
    }]);
    setShowAddModel(false);
    setIsCustom(false);
  };

  const addCustomModel = () => {
    if (!customModel.model || !customModel.hashrate || !customModel.powerConsumption) return;
    const efficiency = customModel.powerConsumption / customModel.hashrate;
    addFleetEntry({
      id: `custom-${Date.now()}`,
      ...customModel,
      efficiency,
      generation: 'custom',
    });
    setCustomModel({ manufacturer: '', model: '', hashrate: 0, powerConsumption: 0 });
  };

  const removeFleetEntry = (index: number) => {
    setFleetEntries(prev => prev.filter((_, i) => i !== index));
  };

  const updateFleetEntry = (index: number, field: string, value: any) => {
    setFleetEntries(prev => prev.map((entry, i) =>
      i === index ? { ...entry, [field]: value } : entry
    ));
  };

  const handleSaveFleet = async () => {
    setSavingFleet(true);
    try {
      const response = await fetch('/api/fleet/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entries: fleetEntries,
          defaultEnergyCostKWh: defaultEnergyCost,
        }),
      });
      if (response.ok) {
        setSavedFleet(true);
        setTimeout(() => setSavedFleet(false), 2000);
        refetchFleet();
      }
    } catch (err) {
      console.error('Failed to save fleet config:', err);
    } finally {
      setSavingFleet(false);
    }
  };

  // Phase 4: Curtailment constraints
  const { data: curtailmentData, refetch: refetchCurtailment } = useApi('/curtailment/constraints', { refreshInterval: 0 });

  const [curtailmentSettings, setCurtailmentSettings] = useState({
    minCurtailmentMinutes: 30,
    minRunDurationMinutes: 30,
    rampUpMinutes: 15,
    demandResponseEnabled: false,
    demandResponsePaymentRate: 0,
    minimumTakePercent: 0,
    maxCurtailmentPercent: 100,
    hysteresisBandMWh: 2,
    curtailmentMode: 'copilot' as 'copilot' | 'auto',
    alwaysMineBelow: null as number | null,
    alwaysCurtailAbove: null as number | null,
    poolMinHashrateTH: null as number | null,
    autoSchedule: false,
  });
  const [savingCurtailment, setSavingCurtailment] = useState(false);
  const [savedCurtailment, setSavedCurtailment] = useState(false);

  // Phase 5: Pool configuration
  const { data: poolConfigData, refetch: refetchPools } = useApi('/pools', { refreshInterval: 0 });
  const [poolEntries, setPoolEntries] = useState<any[]>([]);
  const [showAddPool, setShowAddPool] = useState(false);
  const [newPool, setNewPool] = useState({ pool: 'foundry', apiKey: '', apiSecret: '', label: '' });
  const [testingPool, setTestingPool] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ poolId: string; ok: boolean; message: string } | null>(null);
  const [poolMonitoring, setPoolMonitoring] = useState({
    pollIntervalSeconds: 60,
    workerSnapshotMinutes: 5,
    hashrateDeviationPct: 10,
    rejectRateThreshold: 2,
    deadWorkerTimeoutMinutes: 30,
  });
  const [savingPool, setSavingPool] = useState(false);
  const [savedPool, setSavedPool] = useState(false);

  // Phase 6: Agent configuration
  const { data: agentData, refetch: refetchAgents } = useApi('/agents', { refreshInterval: 0 });
  const agentList = (agentData?.agents || []) as any[];

  // Phase 7: HPC/GPU configuration
  const { data: gpuModelsData } = useApi('/gpu/models', { refreshInterval: 0 });
  const { data: gpuFleetData, refetch: refetchGpuFleet } = useApi('/gpu/fleet', { refreshInterval: 0 });
  const { data: hpcContractsData, refetch: refetchContracts } = useApi('/hpc/contracts', { refreshInterval: 0 });

  const gpuModels = (gpuModelsData?.models || []) as any[];
  const gpuFleetEntries = (gpuFleetData?.entries || []) as any[];
  const hpcContracts = (hpcContractsData?.contracts || []) as any[];

  const [showAddGpu, setShowAddGpu] = useState(false);
  const [newGpuEntry, setNewGpuEntry] = useState({ gpuModelId: '', quantity: 1, gpusPerServer: 8, serverOverheadWatts: 500, pue: 1.2, coolingType: 'air' });
  const [savingGpu, setSavingGpu] = useState(false);
  const [savedGpu, setSavedGpu] = useState(false);

  const [showAddContract, setShowAddContract] = useState(false);
  const [newContract, setNewContract] = useState({
    customer: '', contractType: 'reserved', gpuModel: '', gpuCount: 0,
    powerDrawMW: 0, ratePerGpuHr: 0, monthlyRevenue: 0, uptimeSLA: 99.9,
    interruptible: false, curtailmentPenalty: 0, curtailmentMaxHours: 0,
    curtailmentNoticeMin: 30, startDate: '', endDate: '', autoRenew: false,
  });
  const [savingContract, setSavingContract] = useState(false);

  const [curtailmentPriority, setCurtailmentPriority] = useState([
    'btc_inefficient', 'btc_efficient', 'hpc_spot', 'hpc_interruptible'
  ]);
  const [savingPriority, setSavingPriority] = useState(false);
  const [savedPriority, setSavedPriority] = useState(false);

  useEffect(() => {
    if (curtailmentData) {
      setCurtailmentSettings(prev => ({ ...prev, ...curtailmentData }));
    }
  }, [curtailmentData]);

  useEffect(() => {
    if (poolConfigData?.pools) {
      setPoolEntries(poolConfigData.pools);
    }
    if (poolConfigData?.monitoring) {
      setPoolMonitoring(prev => ({ ...prev, ...poolConfigData.monitoring }));
    }
  }, [poolConfigData]);

  const handleSaveCurtailment = async () => {
    setSavingCurtailment(true);
    try {
      const response = await fetch('/api/curtailment/constraints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(curtailmentSettings),
      });
      if (response.ok) {
        setSavedCurtailment(true);
        setTimeout(() => setSavedCurtailment(false), 2000);
        refetchCurtailment();
      }
    } catch (err) {
      console.error('Failed to save curtailment settings:', err);
    } finally {
      setSavingCurtailment(false);
    }
  };

  // Phase 5: Pool handlers
  const handleAddPool = async () => {
    if (!newPool.apiKey) return;
    try {
      const response = await fetch('/api/pools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newPool),
      });
      if (response.ok) {
        setNewPool({ pool: 'foundry', apiKey: '', apiSecret: '', label: '' });
        setShowAddPool(false);
        refetchPools();
      }
    } catch (err) {
      console.error('Failed to add pool:', err);
    }
  };

  const handleRemovePool = async (poolId: string) => {
    try {
      await fetch(`/api/pools/${poolId}`, { method: 'DELETE' });
      refetchPools();
    } catch (err) {
      console.error('Failed to remove pool:', err);
    }
  };

  const handleTestPool = async (poolId: string) => {
    setTestingPool(poolId);
    setTestResult(null);
    try {
      const response = await fetch(`/api/pools/${poolId}/test`, { method: 'POST' });
      const result = await response.json();
      setTestResult({ poolId, ok: result.connected, message: result.message || (result.connected ? 'Connected' : 'Failed') });
    } catch {
      setTestResult({ poolId, ok: false, message: 'Connection test failed' });
    } finally {
      setTestingPool(null);
    }
  };

  const handleSavePoolMonitoring = async () => {
    setSavingPool(true);
    try {
      const response = await fetch('/api/pools/monitoring', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(poolMonitoring),
      });
      if (response.ok) {
        setSavedPool(true);
        setTimeout(() => setSavedPool(false), 2000);
      }
    } catch (err) {
      console.error('Failed to save pool monitoring:', err);
    } finally {
      setSavingPool(false);
    }
  };

  // Compute fleet totals for summary
  const fleetTotals = fleetEntries.reduce((acc, entry) => ({
    machines: acc.machines + entry.quantity,
    hashrate: acc.hashrate + (entry.asicModel.hashrate * entry.quantity),
    power: acc.power + (entry.asicModel.powerConsumption * entry.quantity),
  }), { machines: 0, hashrate: 0, power: 0 });

  const [settingsTab, setSettingsTab] = useState('general');

  // Check if user is admin/owner (role from localStorage)
  const storedUser = JSON.parse(localStorage.getItem('coppice_user') || '{}');
  const isAdmin = ['owner', 'admin'].includes(storedUser.role);

  const SETTINGS_TABS = [
    { id: 'general', label: 'General', icon: Cpu },
    ...(isAdmin ? [{ id: 'integrations', label: 'Integrations', icon: Link2 }] : []),
    ...(isAdmin ? [{ id: 'email-security', label: 'Email Security', icon: Mail }] : []),
  ];

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-terminal-green">Settings</h2>
        <p className="text-sm text-terminal-muted mt-1">
          Configure your mining operations platform. Settings marked with a phase number
          will become available as those features are built.
        </p>
        {SETTINGS_TABS.length > 1 && (
          <div className="flex gap-1 mt-4">
            {SETTINGS_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setSettingsTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
                  settingsTab === tab.id
                    ? 'bg-[#1a6b3c] text-white'
                    : 'text-terminal-muted hover:bg-[#f5f4f0] hover:text-terminal-text'
                }`}
              >
                <tab.icon size={13} />
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {settingsTab === 'email-security' && isAdmin && (
        <Suspense fallback={<div className="text-terminal-muted text-sm py-8 text-center">Loading...</div>}>
          <EmailSecurityPanel />
        </Suspense>
      )}

      {settingsTab === 'integrations' && isAdmin && <IntegrationsPanel />}

      {settingsTab === 'general' && <div className="space-y-4">
        {/* Team Management */}
        <SettingsTeamPanel />

        {/* Fleet Configuration — Phase 3 ACTIVE */}
        <SettingsSection
          title="Fleet Configuration"
          description="Define your ASIC fleet — models, quantities, efficiency ratings"
          icon={<Cpu size={18} className="text-terminal-green" />}
          phase={3}
          active
        >
          <div className="space-y-4">
            {/* Default Energy Cost */}
            <div>
              <label className="block text-xs text-terminal-muted mb-1">Default Energy Cost ($/kWh)</label>
              <input
                type="number"
                step="0.001"
                value={defaultEnergyCost}
                onChange={e => setDefaultEnergyCost(Number(e.target.value))}
                className="bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text w-48"
              />
              <p className="text-xs text-terminal-muted mt-1">
                Used when no ERCOT node is linked. Override per-entry by linking a node below.
              </p>
            </div>

            {/* Fleet Summary */}
            {fleetEntries.length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-terminal-bg rounded p-3 text-center">
                  <p className="text-xs text-terminal-muted">Total Machines</p>
                  <p className="text-lg font-bold text-terminal-text">{fleetTotals.machines.toLocaleString()}</p>
                </div>
                <div className="bg-terminal-bg rounded p-3 text-center">
                  <p className="text-xs text-terminal-muted">Total Hashrate</p>
                  <p className="text-lg font-bold text-terminal-text">
                    {fleetTotals.hashrate >= 1e6
                      ? `${(fleetTotals.hashrate / 1e6).toFixed(2)} EH/s`
                      : `${(fleetTotals.hashrate / 1e3).toFixed(1)} PH/s`}
                  </p>
                </div>
                <div className="bg-terminal-bg rounded p-3 text-center">
                  <p className="text-xs text-terminal-muted">Total Power</p>
                  <p className="text-lg font-bold text-terminal-text">{(fleetTotals.power / 1e6).toFixed(2)} MW</p>
                </div>
              </div>
            )}

            {/* Fleet Entries Table */}
            {fleetEntries.length > 0 && (
              <div className="border border-terminal-border rounded overflow-hidden">
                <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-terminal-bg/50 text-xs text-terminal-muted border-b border-terminal-border">
                  <div className="col-span-3">Model</div>
                  <div className="col-span-1 text-right">Qty</div>
                  <div className="col-span-2 text-right">TH/s</div>
                  <div className="col-span-2 text-right">J/TH</div>
                  <div className="col-span-2">Node</div>
                  <div className="col-span-1">Location</div>
                  <div className="col-span-1"></div>
                </div>
                {fleetEntries.map((entry, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 px-3 py-2 text-xs border-b border-terminal-border/50 items-center">
                    <div className="col-span-3 text-terminal-text truncate" title={entry.asicModel.model}>
                      {entry.asicModel.model}
                    </div>
                    <div className="col-span-1">
                      <input
                        type="number"
                        min="1"
                        value={entry.quantity}
                        onChange={e => updateFleetEntry(idx, 'quantity', Math.max(1, parseInt(e.target.value) || 1))}
                        className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text w-full text-right"
                      />
                    </div>
                    <div className="col-span-2 text-right text-terminal-text">{entry.asicModel.hashrate}</div>
                    <div className="col-span-2 text-right text-terminal-muted">{entry.asicModel.efficiency?.toFixed(1)}</div>
                    <div className="col-span-2">
                      <select
                        value={entry.energyNode || ''}
                        onChange={e => updateFleetEntry(idx, 'energyNode', e.target.value)}
                        className="bg-terminal-bg border border-terminal-border rounded px-1 py-1 text-xs text-terminal-text w-full"
                      >
                        <option value="">None</option>
                        {ERCOT_NODES.map(n => <option key={n} value={n}>{n.replace('_', ' ')}</option>)}
                      </select>
                    </div>
                    <div className="col-span-1">
                      <input
                        type="text"
                        placeholder="Site"
                        value={entry.location || ''}
                        onChange={e => updateFleetEntry(idx, 'location', e.target.value)}
                        className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text w-full"
                      />
                    </div>
                    <div className="col-span-1 text-center">
                      <button
                        onClick={() => removeFleetEntry(idx)}
                        className="p-1 text-terminal-muted hover:text-terminal-red transition-colors"
                        title="Remove"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add Machine */}
            {!showAddModel ? (
              <button
                onClick={() => setShowAddModel(true)}
                className="flex items-center gap-2 px-3 py-2 text-xs text-terminal-green border border-terminal-green/30 rounded hover:bg-terminal-green/10 transition-colors"
              >
                <Plus size={14} /> Add Machine Class
              </button>
            ) : (
              <div className="bg-terminal-bg border border-terminal-border rounded p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-terminal-text">Add Machine Class</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setIsCustom(false)}
                      className={`px-2 py-1 text-xs rounded ${!isCustom ? 'bg-terminal-green/20 text-terminal-green' : 'text-terminal-muted hover:text-terminal-text'}`}
                    >
                      From Database
                    </button>
                    <button
                      onClick={() => setIsCustom(true)}
                      className={`px-2 py-1 text-xs rounded ${isCustom ? 'bg-terminal-green/20 text-terminal-green' : 'text-terminal-muted hover:text-terminal-text'}`}
                    >
                      Custom
                    </button>
                  </div>
                </div>

                {!isCustom ? (
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {asicModels.map((model: any) => (
                      <button
                        key={model.id}
                        onClick={() => addFleetEntry(model)}
                        className="w-full flex items-center justify-between px-3 py-2 text-xs rounded hover:bg-terminal-border/50 transition-colors"
                      >
                        <span className="text-terminal-text">{model.model}</span>
                        <span className="text-terminal-muted">
                          {model.hashrate} TH/s &middot; {model.powerConsumption}W &middot; {model.efficiency?.toFixed(1)} J/TH
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-terminal-muted mb-1">Manufacturer</label>
                        <input
                          type="text"
                          value={customModel.manufacturer}
                          onChange={e => setCustomModel(prev => ({ ...prev, manufacturer: e.target.value }))}
                          placeholder="e.g. Bitmain"
                          className="bg-terminal-panel border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-terminal-muted mb-1">Model Name</label>
                        <input
                          type="text"
                          value={customModel.model}
                          onChange={e => setCustomModel(prev => ({ ...prev, model: e.target.value }))}
                          placeholder="e.g. Antminer S22"
                          className="bg-terminal-panel border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text w-full"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-terminal-muted mb-1">Hashrate (TH/s)</label>
                        <input
                          type="number"
                          value={customModel.hashrate || ''}
                          onChange={e => setCustomModel(prev => ({ ...prev, hashrate: Number(e.target.value) }))}
                          className="bg-terminal-panel border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-terminal-muted mb-1">Power (Watts)</label>
                        <input
                          type="number"
                          value={customModel.powerConsumption || ''}
                          onChange={e => setCustomModel(prev => ({ ...prev, powerConsumption: Number(e.target.value) }))}
                          className="bg-terminal-panel border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text w-full"
                        />
                      </div>
                    </div>
                    {customModel.hashrate > 0 && customModel.powerConsumption > 0 && (
                      <p className="text-xs text-terminal-muted">
                        Efficiency: {(customModel.powerConsumption / customModel.hashrate).toFixed(1)} J/TH
                      </p>
                    )}
                    <button
                      onClick={addCustomModel}
                      disabled={!customModel.model || !customModel.hashrate || !customModel.powerConsumption}
                      className="px-3 py-1.5 text-xs bg-terminal-green/20 text-terminal-green border border-terminal-green/30 rounded hover:bg-terminal-green/30 transition-colors disabled:opacity-50"
                    >
                      Add Custom Model
                    </button>
                  </div>
                )}

                <button
                  onClick={() => { setShowAddModel(false); setIsCustom(false); }}
                  className="text-xs text-terminal-muted hover:text-terminal-text"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Save Button */}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSaveFleet}
                disabled={savingFleet}
                className="flex items-center gap-2 px-4 py-2 bg-terminal-green/20 text-terminal-green border border-terminal-green/30 rounded hover:bg-terminal-green/30 transition-colors text-sm disabled:opacity-50"
              >
                {savingFleet ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                {savingFleet ? 'Saving...' : savedFleet ? 'Saved!' : 'Save Fleet Configuration'}
              </button>
              {savedFleet && <span className="text-xs text-terminal-green">Fleet configuration saved</span>}
            </div>
          </div>
        </SettingsSection>

        {/* Curtailment Configuration — Phase 4 ACTIVE */}
        <SettingsSection
          title="Curtailment Optimizer"
          description="Operational constraints, hysteresis, demand response"
          icon={<Battery size={18} className="text-terminal-cyan" />}
          phase={4}
          active
        >
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-terminal-muted mb-1">Min Curtailment (min)</label>
                <input
                  type="number"
                  min="0"
                  step="5"
                  value={curtailmentSettings.minCurtailmentMinutes}
                  onChange={e => setCurtailmentSettings(prev => ({ ...prev, minCurtailmentMinutes: Number(e.target.value) }))}
                  className="bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text w-full"
                />
                <p className="text-[10px] text-terminal-muted mt-1">Min shutdown to avoid thermal cycling</p>
              </div>
              <div>
                <label className="block text-xs text-terminal-muted mb-1">Min Run Duration (min)</label>
                <input
                  type="number"
                  min="0"
                  step="5"
                  value={curtailmentSettings.minRunDurationMinutes}
                  onChange={e => setCurtailmentSettings(prev => ({ ...prev, minRunDurationMinutes: Number(e.target.value) }))}
                  className="bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text w-full"
                />
                <p className="text-[10px] text-terminal-muted mt-1">Min mining window to justify restart</p>
              </div>
              <div>
                <label className="block text-xs text-terminal-muted mb-1">Ramp-Up Time (min)</label>
                <input
                  type="number"
                  min="0"
                  step="5"
                  value={curtailmentSettings.rampUpMinutes}
                  onChange={e => setCurtailmentSettings(prev => ({ ...prev, rampUpMinutes: Number(e.target.value) }))}
                  className="bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text w-full"
                />
                <p className="text-[10px] text-terminal-muted mt-1">Time from power-on to full hashrate</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-terminal-muted mb-1">Hysteresis Band ($/MWh)</label>
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={curtailmentSettings.hysteresisBandMWh}
                  onChange={e => setCurtailmentSettings(prev => ({ ...prev, hysteresisBandMWh: Number(e.target.value) }))}
                  className="bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text w-full"
                />
                <p className="text-[10px] text-terminal-muted mt-1">Dead band around breakeven to prevent flip-flopping</p>
              </div>
              <div>
                <label className="block text-xs text-terminal-muted mb-1">Max Curtailment (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="5"
                  value={curtailmentSettings.maxCurtailmentPercent}
                  onChange={e => setCurtailmentSettings(prev => ({ ...prev, maxCurtailmentPercent: Number(e.target.value) }))}
                  className="bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text w-full"
                />
                <p className="text-[10px] text-terminal-muted mt-1">Maximum % of fleet that can be curtailed</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-terminal-muted mb-1">Always Mine Below ($/MWh)</label>
                <input
                  type="number"
                  step="1"
                  value={curtailmentSettings.alwaysMineBelow ?? ''}
                  onChange={e => setCurtailmentSettings(prev => ({ ...prev, alwaysMineBelow: e.target.value ? Number(e.target.value) : null }))}
                  placeholder="None"
                  className="bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text w-full"
                />
                <p className="text-[10px] text-terminal-muted mt-1">Always mine when price is below this (overrides hysteresis)</p>
              </div>
              <div>
                <label className="block text-xs text-terminal-muted mb-1">Always Curtail Above ($/MWh)</label>
                <input
                  type="number"
                  step="1"
                  value={curtailmentSettings.alwaysCurtailAbove ?? ''}
                  onChange={e => setCurtailmentSettings(prev => ({ ...prev, alwaysCurtailAbove: e.target.value ? Number(e.target.value) : null }))}
                  placeholder="None"
                  className="bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text w-full"
                />
                <p className="text-[10px] text-terminal-muted mt-1">Always curtail when price exceeds this (overrides hysteresis)</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-terminal-muted mb-1">Minimum Take (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="5"
                  value={curtailmentSettings.minimumTakePercent}
                  onChange={e => setCurtailmentSettings(prev => ({ ...prev, minimumTakePercent: Number(e.target.value) }))}
                  className="bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text w-full"
                />
                <p className="text-[10px] text-terminal-muted mt-1">Contractual minimum power draw (%)</p>
              </div>
              <div>
                <label className="block text-xs text-terminal-muted mb-1">Pool Min Hashrate (TH/s)</label>
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={curtailmentSettings.poolMinHashrateTH ?? ''}
                  onChange={e => setCurtailmentSettings(prev => ({ ...prev, poolMinHashrateTH: e.target.value ? Number(e.target.value) : null }))}
                  placeholder="None"
                  className="bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text w-full"
                />
                <p className="text-[10px] text-terminal-muted mt-1">Keep enough machines online to maintain pool minimum</p>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-terminal-text">Auto-Schedule</p>
                <p className="text-xs text-terminal-muted">Automatically regenerate schedule when DAM prices publish</p>
              </div>
              <button
                onClick={() => setCurtailmentSettings(prev => ({ ...prev, autoSchedule: !prev.autoSchedule }))}
                className={`w-10 h-5 rounded-full transition-colors relative ${
                  curtailmentSettings.autoSchedule ? 'bg-terminal-green' : 'bg-terminal-border'
                }`}
              >
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                  curtailmentSettings.autoSchedule ? 'left-5' : 'left-0.5'
                }`} />
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-terminal-text">Mode</p>
                <p className="text-xs text-terminal-muted">
                  {curtailmentSettings.curtailmentMode === 'copilot'
                    ? 'Copilot: recommends actions, human decides'
                    : 'Auto: executes decisions automatically'}
                </p>
              </div>
              <select
                value={curtailmentSettings.curtailmentMode}
                onChange={e => setCurtailmentSettings(prev => ({ ...prev, curtailmentMode: e.target.value as 'copilot' | 'auto' }))}
                className="bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text"
              >
                <option value="copilot">Copilot (Recommended)</option>
                <option value="auto">Auto</option>
              </select>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-terminal-text">Demand Response</p>
                <p className="text-xs text-terminal-muted">Enable 4CP and ancillary services integration</p>
              </div>
              <button
                onClick={() => setCurtailmentSettings(prev => ({ ...prev, demandResponseEnabled: !prev.demandResponseEnabled }))}
                className={`w-10 h-5 rounded-full transition-colors relative ${
                  curtailmentSettings.demandResponseEnabled ? 'bg-terminal-green' : 'bg-terminal-border'
                }`}
              >
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                  curtailmentSettings.demandResponseEnabled ? 'left-5' : 'left-0.5'
                }`} />
              </button>
            </div>

            {curtailmentSettings.demandResponseEnabled && (
              <div>
                <label className="block text-xs text-terminal-muted mb-1">DR Payment Rate ($/MWh)</label>
                <input
                  type="number"
                  min="0"
                  step="5"
                  value={curtailmentSettings.demandResponsePaymentRate}
                  onChange={e => setCurtailmentSettings(prev => ({ ...prev, demandResponsePaymentRate: Number(e.target.value) }))}
                  className="bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text w-48"
                />
                <p className="text-[10px] text-terminal-muted mt-1">Payment rate for curtailing during grid stress events</p>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSaveCurtailment}
                disabled={savingCurtailment}
                className="flex items-center gap-2 px-4 py-2 bg-terminal-green/20 text-terminal-green border border-terminal-green/30 rounded hover:bg-terminal-green/30 transition-colors text-sm disabled:opacity-50"
              >
                {savingCurtailment ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                {savingCurtailment ? 'Saving...' : savedCurtailment ? 'Saved!' : 'Save Curtailment Settings'}
              </button>
              {savedCurtailment && <span className="text-xs text-terminal-green">Curtailment settings saved</span>}
            </div>
          </div>
        </SettingsSection>

        {/* Energy Configuration — Phase 2 ACTIVE */}
        <SettingsSection
          title="Energy Market"
          description="ISO/RTO connection, node selection, price thresholds"
          icon={<Zap size={18} className="text-terminal-amber" />}
          phase={2}
          active
        >
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-terminal-muted mb-1">ISO / RTO</label>
              <select
                value={energySettings.iso}
                onChange={e => setEnergySettings(prev => ({ ...prev, iso: e.target.value }))}
                className="bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text w-full"
              >
                <option value="ERCOT">ERCOT (Texas)</option>
                <option value="PJM" disabled>PJM (Mid-Atlantic) — Coming Soon</option>
                <option value="MISO" disabled>MISO (Central US) — Coming Soon</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-terminal-muted mb-1">Primary Settlement Point</label>
              <select
                value={energySettings.primaryNode}
                onChange={e => setEnergySettings(prev => ({ ...prev, primaryNode: e.target.value }))}
                className="bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text w-full"
              >
                {ERCOT_NODES.map(n => (
                  <option key={n} value={n}>{n.replace('_', ' ')}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-terminal-muted mb-2">Monitored Nodes</label>
              <div className="flex flex-wrap gap-2">
                {ERCOT_NODES.map(node => (
                  <button
                    key={node}
                    onClick={() => toggleNode(node)}
                    className={`px-2 py-1 text-xs rounded border transition-colors ${
                      energySettings.monitoredNodes.includes(node)
                        ? 'border-terminal-green/50 bg-terminal-green/10 text-terminal-green'
                        : 'border-terminal-border text-terminal-muted hover:border-terminal-text'
                    }`}
                  >
                    {node.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-terminal-muted mb-1">High Price Alert ($/MWh)</label>
                <input
                  type="number"
                  value={energySettings.priceAlertHigh}
                  onChange={e => setEnergySettings(prev => ({ ...prev, priceAlertHigh: Number(e.target.value) }))}
                  className="bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text w-full"
                />
              </div>
              <div>
                <label className="block text-xs text-terminal-muted mb-1">Low Price Alert ($/MWh)</label>
                <input
                  type="number"
                  value={energySettings.priceAlertLow}
                  onChange={e => setEnergySettings(prev => ({ ...prev, priceAlertLow: Number(e.target.value) }))}
                  className="bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text w-full"
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-terminal-text">Negative Price Alerts</p>
                <p className="text-xs text-terminal-muted">Get notified when prices go negative</p>
              </div>
              <button
                onClick={() => setEnergySettings(prev => ({ ...prev, negativeAlertEnabled: !prev.negativeAlertEnabled }))}
                className={`w-10 h-5 rounded-full transition-colors relative ${
                  energySettings.negativeAlertEnabled ? 'bg-terminal-green' : 'bg-terminal-border'
                }`}
              >
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                  energySettings.negativeAlertEnabled ? 'left-5' : 'left-0.5'
                }`} />
              </button>
            </div>

            <div>
              <label className="block text-xs text-terminal-muted mb-1">Refresh Interval (minutes)</label>
              <select
                value={energySettings.refreshIntervalMinutes}
                onChange={e => setEnergySettings(prev => ({ ...prev, refreshIntervalMinutes: Number(e.target.value) }))}
                className="bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text w-full"
              >
                <option value={1}>1 minute</option>
                <option value={5}>5 minutes</option>
                <option value={15}>15 minutes</option>
                <option value={30}>30 minutes</option>
                <option value={60}>1 hour</option>
              </select>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSaveEnergy}
                disabled={savingEnergy}
                className="flex items-center gap-2 px-4 py-2 bg-terminal-green/20 text-terminal-green border border-terminal-green/30 rounded hover:bg-terminal-green/30 transition-colors text-sm disabled:opacity-50"
              >
                {savingEnergy ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                {savingEnergy ? 'Saving...' : savedEnergy ? 'Saved!' : 'Save Energy Settings'}
              </button>
              {savedEnergy && <span className="text-xs text-terminal-green">Settings saved successfully</span>}
            </div>
          </div>
        </SettingsSection>

        {/* Pool Configuration — Phase 5 ACTIVE */}
        <SettingsSection
          title="Pool Configuration"
          description="Connect mining pools for unified monitoring and earnings tracking"
          icon={<Server size={18} className="text-terminal-cyan" />}
          phase={5}
          active
        >
          <div className="space-y-4">
            {/* Connected Pools */}
            {poolEntries.length > 0 && (
              <div className="space-y-2">
                {poolEntries.map((pool: any, idx: number) => (
                  <div key={idx} className="flex items-center justify-between bg-terminal-bg rounded p-3">
                    <div className="flex items-center gap-3">
                      <span className={`w-2 h-2 rounded-full ${pool.connected !== false ? 'bg-terminal-green' : 'bg-terminal-red'}`} />
                      <div>
                        <p className="text-sm text-terminal-text font-medium">
                          {pool.label || POOL_OPTIONS.find(p => p.id === pool.pool)?.name || pool.pool}
                        </p>
                        <p className="text-xs text-terminal-muted">
                          {POOL_OPTIONS.find(p => p.id === pool.pool)?.name || pool.pool} &middot; Key: ****{pool.apiKey?.slice(-4) || '****'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {testResult?.poolId === (pool.id || pool.pool) && (
                        <span className={`text-xs ${testResult.ok ? 'text-terminal-green' : 'text-terminal-red'}`}>
                          {testResult.message}
                        </span>
                      )}
                      <button
                        onClick={() => handleTestPool(pool.id || pool.pool)}
                        disabled={testingPool === (pool.id || pool.pool)}
                        className="px-2 py-1 text-xs border border-terminal-border rounded hover:border-terminal-cyan text-terminal-muted hover:text-terminal-cyan transition-colors disabled:opacity-50"
                      >
                        {testingPool === (pool.id || pool.pool) ? (
                          <RefreshCw size={12} className="animate-spin" />
                        ) : 'Test'}
                      </button>
                      <button
                        onClick={() => handleRemovePool(pool.id || pool.pool)}
                        className="p-1 text-terminal-muted hover:text-terminal-red transition-colors"
                        title="Remove pool"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {poolEntries.length === 0 && !showAddPool && (
              <div className="bg-terminal-bg/50 rounded p-4 text-center">
                <p className="text-sm text-terminal-muted mb-1">No pools connected</p>
                <p className="text-xs text-terminal-muted">Add your mining pool API credentials to enable unified monitoring.</p>
              </div>
            )}

            {/* Add Pool */}
            {!showAddPool ? (
              <button
                onClick={() => setShowAddPool(true)}
                className="flex items-center gap-2 px-3 py-2 text-xs text-terminal-cyan border border-terminal-cyan/30 rounded hover:bg-terminal-cyan/10 transition-colors"
              >
                <Plus size={14} /> Add Pool Connection
              </button>
            ) : (
              <div className="bg-terminal-bg border border-terminal-border rounded p-3 space-y-3">
                <p className="text-sm font-semibold text-terminal-text">Add Pool Connection</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-terminal-muted mb-1">Pool</label>
                    <select
                      value={newPool.pool}
                      onChange={e => setNewPool(prev => ({ ...prev, pool: e.target.value }))}
                      className="bg-terminal-panel border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text w-full"
                    >
                      {POOL_OPTIONS.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-terminal-muted mb-1">Label (optional)</label>
                    <input
                      type="text"
                      value={newPool.label}
                      onChange={e => setNewPool(prev => ({ ...prev, label: e.target.value }))}
                      placeholder="e.g. Primary Pool"
                      className="bg-terminal-panel border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text w-full"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-terminal-muted mb-1">API Key</label>
                  <input
                    type="password"
                    value={newPool.apiKey}
                    onChange={e => setNewPool(prev => ({ ...prev, apiKey: e.target.value }))}
                    placeholder="Enter API key"
                    className="bg-terminal-panel border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text w-full font-sans"
                  />
                </div>
                <div>
                  <label className="block text-xs text-terminal-muted mb-1">API Secret (if required)</label>
                  <input
                    type="password"
                    value={newPool.apiSecret}
                    onChange={e => setNewPool(prev => ({ ...prev, apiSecret: e.target.value }))}
                    placeholder="Enter API secret"
                    className="bg-terminal-panel border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text w-full font-sans"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleAddPool}
                    disabled={!newPool.apiKey}
                    className="px-3 py-1.5 text-xs bg-terminal-cyan/20 text-terminal-cyan border border-terminal-cyan/30 rounded hover:bg-terminal-cyan/30 transition-colors disabled:opacity-50"
                  >
                    Add Pool
                  </button>
                  <button
                    onClick={() => { setShowAddPool(false); setNewPool({ pool: 'foundry', apiKey: '', apiSecret: '', label: '' }); }}
                    className="text-xs text-terminal-muted hover:text-terminal-text"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Monitoring Preferences */}
            <div className="border-t border-terminal-border pt-4 mt-4">
              <p className="text-sm font-medium text-terminal-text mb-3">Monitoring Preferences</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-terminal-muted mb-1">Poll Interval</label>
                  <select
                    value={poolMonitoring.pollIntervalSeconds}
                    onChange={e => setPoolMonitoring(prev => ({ ...prev, pollIntervalSeconds: Number(e.target.value) }))}
                    className="bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text w-full"
                  >
                    <option value={30}>30 seconds</option>
                    <option value={60}>1 minute</option>
                    <option value={120}>2 minutes</option>
                    <option value={300}>5 minutes</option>
                  </select>
                  <p className="text-[10px] text-terminal-muted mt-1">How often to fetch pool data</p>
                </div>
                <div>
                  <label className="block text-xs text-terminal-muted mb-1">Worker Snapshot Interval</label>
                  <select
                    value={poolMonitoring.workerSnapshotMinutes}
                    onChange={e => setPoolMonitoring(prev => ({ ...prev, workerSnapshotMinutes: Number(e.target.value) }))}
                    className="bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text w-full"
                  >
                    <option value={1}>1 minute</option>
                    <option value={5}>5 minutes</option>
                    <option value={15}>15 minutes</option>
                    <option value={30}>30 minutes</option>
                  </select>
                  <p className="text-[10px] text-terminal-muted mt-1">Interval for worker status snapshots</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 mt-3">
                <div>
                  <label className="block text-xs text-terminal-muted mb-1">Hashrate Deviation (%)</label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={poolMonitoring.hashrateDeviationPct}
                    onChange={e => setPoolMonitoring(prev => ({ ...prev, hashrateDeviationPct: Number(e.target.value) }))}
                    className="bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text w-full"
                  />
                  <p className="text-[10px] text-terminal-muted mt-1">Alert when hashrate deviates by this %</p>
                </div>
                <div>
                  <label className="block text-xs text-terminal-muted mb-1">Reject Rate Threshold (%)</label>
                  <input
                    type="number"
                    min="0.1"
                    max="10"
                    step="0.1"
                    value={poolMonitoring.rejectRateThreshold}
                    onChange={e => setPoolMonitoring(prev => ({ ...prev, rejectRateThreshold: Number(e.target.value) }))}
                    className="bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text w-full"
                  />
                  <p className="text-[10px] text-terminal-muted mt-1">Alert when reject rate exceeds this</p>
                </div>
                <div>
                  <label className="block text-xs text-terminal-muted mb-1">Dead Worker Timeout (min)</label>
                  <input
                    type="number"
                    min="5"
                    max="120"
                    step="5"
                    value={poolMonitoring.deadWorkerTimeoutMinutes}
                    onChange={e => setPoolMonitoring(prev => ({ ...prev, deadWorkerTimeoutMinutes: Number(e.target.value) }))}
                    className="bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text w-full"
                  />
                  <p className="text-[10px] text-terminal-muted mt-1">Mark worker dead after this silence</p>
                </div>
              </div>
            </div>

            {/* Save Button */}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSavePoolMonitoring}
                disabled={savingPool}
                className="flex items-center gap-2 px-4 py-2 bg-terminal-green/20 text-terminal-green border border-terminal-green/30 rounded hover:bg-terminal-green/30 transition-colors text-sm disabled:opacity-50"
              >
                {savingPool ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                {savingPool ? 'Saving...' : savedPool ? 'Saved!' : 'Save Pool Settings'}
              </button>
              {savedPool && <span className="text-xs text-terminal-green">Pool settings saved</span>}
            </div>
          </div>
        </SettingsSection>

        {/* Agent Configuration — Phase 6 ACTIVE */}
        <SettingsSection
          title="Clawbot Agents"
          description="Configure autonomous agent behavior, modes, and guardrails"
          icon={<Bot size={18} className="text-terminal-green" />}
          phase={6}
          active
        >
          <div className="space-y-4">
            {agentList.length === 0 && (
              <p className="text-sm text-terminal-muted italic">
                No agents registered. Agents register when the backend starts.
              </p>
            )}

            {agentList.map((agent: any) => {
              const config = agent.config || {};
              const mode = config.mode || 'recommend';
              const status = agent.status?.state || 'stopped';

              return (
                <div key={agent.id} className="bg-terminal-bg border border-terminal-border rounded p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${status !== 'stopped' && status !== 'error' ? 'bg-terminal-green' : 'bg-terminal-muted'}`} />
                      <p className="text-sm font-medium text-terminal-text">{agent.name}</p>
                      <span className="text-[10px] text-terminal-muted">v{agent.version || '1.0.0'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={mode}
                        onChange={async (e) => {
                          await fetch(`/api/agents/${agent.id}/config`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ mode: e.target.value }),
                          });
                          refetchAgents();
                        }}
                        className="bg-terminal-panel border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text"
                      >
                        <option value="observe">Observe</option>
                        <option value="recommend">Recommend</option>
                        <option value="approve">Approve</option>
                        <option value="autonomous">Autonomous</option>
                      </select>
                      <button
                        onClick={async () => {
                          const endpoint = status === 'stopped' ? 'start' : 'stop';
                          await fetch(`/api/agents/${agent.id}/${endpoint}`, { method: 'POST' });
                          refetchAgents();
                        }}
                        className={`px-2 py-1 text-xs rounded border transition-colors ${
                          status === 'stopped'
                            ? 'border-terminal-green/50 text-terminal-green hover:bg-terminal-green/10'
                            : 'border-terminal-red/50 text-terminal-red hover:bg-terminal-red/10'
                        }`}
                      >
                        {status === 'stopped' ? 'Start' : 'Stop'}
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-terminal-muted">{agent.description}</p>
                  {config.permissions && (
                    <div className="flex flex-wrap gap-2 text-[10px]">
                      {config.permissions.canAlert && (
                        <span className="px-1.5 py-0.5 bg-terminal-amber/10 text-terminal-amber rounded">Alert</span>
                      )}
                      {config.permissions.canExecute && (
                        <span className="px-1.5 py-0.5 bg-terminal-green/10 text-terminal-green rounded">Execute</span>
                      )}
                      {config.permissions.maxFinancialImpact && (
                        <span className="px-1.5 py-0.5 bg-terminal-cyan/10 text-terminal-cyan rounded">
                          Max ${config.permissions.maxFinancialImpact}/hr
                        </span>
                      )}
                      {config.permissions.cooldownPeriod && (
                        <span className="px-1.5 py-0.5 bg-terminal-border text-terminal-muted rounded">
                          {Math.round(config.permissions.cooldownPeriod / 60)}min cooldown
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            <div className="border-t border-terminal-border pt-3 mt-3">
              <p className="text-[10px] text-terminal-muted">
                All agents start in "Recommend" mode. Upgrade to "Approve" or "Autonomous" after building trust.
                Use the Agent Command Center on the Operations tab for real-time monitoring and approvals.
              </p>
            </div>
          </div>
        </SettingsSection>

        {/* GPU Fleet Configuration — Phase 7 ACTIVE */}
        <SettingsSection
          title="GPU Fleet Configuration"
          description="Configure your GPU fleet for AI/HPC workloads"
          icon={<Monitor size={18} className="text-terminal-cyan" />}
          phase={7}
          active
        >
          <div className="space-y-4">
            {/* GPU Fleet Summary */}
            {gpuFleetEntries.length > 0 && (
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-terminal-bg rounded p-3 text-center">
                  <p className="text-xs text-terminal-muted">Total GPUs</p>
                  <p className="text-lg font-bold text-terminal-text">
                    {gpuFleetEntries.reduce((s: number, e: any) => s + (e.quantity || 0), 0).toLocaleString()}
                  </p>
                </div>
                <div className="bg-terminal-bg rounded p-3 text-center">
                  <p className="text-xs text-terminal-muted">Total Power</p>
                  <p className="text-lg font-bold text-terminal-text">
                    {(gpuFleetEntries.reduce((s: number, e: any) => {
                      const model = gpuModels.find((m: any) => m.id === e.gpuModelId);
                      const tdp = model?.tdpWatts || 700;
                      const servers = Math.ceil((e.quantity || 0) / (e.gpusPerServer || 8));
                      const it = tdp * (e.quantity || 0) + (e.serverOverheadWatts || 500) * servers;
                      return s + it * (e.pue || 1.2);
                    }, 0) / 1e6).toFixed(2)} MW
                  </p>
                </div>
                <div className="bg-terminal-bg rounded p-3 text-center">
                  <p className="text-xs text-terminal-muted">Total Memory</p>
                  <p className="text-lg font-bold text-terminal-text">
                    {(gpuFleetEntries.reduce((s: number, e: any) => {
                      const model = gpuModels.find((m: any) => m.id === e.gpuModelId);
                      return s + (model?.memoryGB || 80) * (e.quantity || 0);
                    }, 0) / 1000).toFixed(1)} TB
                  </p>
                </div>
              </div>
            )}

            {/* GPU Fleet Entries */}
            {gpuFleetEntries.length > 0 && (
              <div className="border border-terminal-border rounded overflow-hidden">
                <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-terminal-bg/50 text-xs text-terminal-muted border-b border-terminal-border">
                  <div className="col-span-3">GPU Model</div>
                  <div className="col-span-1 text-right">Qty</div>
                  <div className="col-span-2 text-right">TDP (W)</div>
                  <div className="col-span-2 text-right">GPU/Srv</div>
                  <div className="col-span-2 text-right">PUE</div>
                  <div className="col-span-1">Cool</div>
                  <div className="col-span-1"></div>
                </div>
                {gpuFleetEntries.map((entry: any, idx: number) => {
                  const model = gpuModels.find((m: any) => m.id === entry.gpuModelId);
                  return (
                    <div key={idx} className="grid grid-cols-12 gap-2 px-3 py-2 text-xs border-b border-terminal-border/50 items-center">
                      <div className="col-span-3 text-terminal-text truncate">{model?.model || entry.gpuModelId}</div>
                      <div className="col-span-1 text-right text-terminal-text">{entry.quantity}</div>
                      <div className="col-span-2 text-right text-terminal-muted">{model?.tdpWatts || '—'}</div>
                      <div className="col-span-2 text-right text-terminal-muted">{entry.gpusPerServer || 8}</div>
                      <div className="col-span-2 text-right text-terminal-muted">{entry.pue || 1.2}</div>
                      <div className="col-span-1 text-terminal-muted">{entry.coolingType || 'air'}</div>
                      <div className="col-span-1 text-center">
                        <button
                          onClick={async () => {
                            const updated = gpuFleetEntries.filter((_: any, i: number) => i !== idx);
                            await fetch('/api/gpu/fleet', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ entries: updated }),
                            });
                            refetchGpuFleet();
                          }}
                          className="p-1 text-terminal-muted hover:text-terminal-red transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Add GPU */}
            {!showAddGpu ? (
              <button
                onClick={() => setShowAddGpu(true)}
                className="flex items-center gap-2 px-3 py-2 text-xs text-terminal-cyan border border-terminal-cyan/30 rounded hover:bg-terminal-cyan/10 transition-colors"
              >
                <Plus size={14} /> Add GPU Class
              </button>
            ) : (
              <div className="bg-terminal-bg border border-terminal-border rounded p-3 space-y-3">
                <p className="text-sm font-semibold text-terminal-text">Add GPU Class</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-terminal-muted mb-1">GPU Model</label>
                    <select
                      value={newGpuEntry.gpuModelId}
                      onChange={e => setNewGpuEntry(prev => ({ ...prev, gpuModelId: e.target.value }))}
                      className="bg-terminal-panel border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text w-full"
                    >
                      <option value="">Select...</option>
                      {gpuModels.map((m: any) => (
                        <option key={m.id} value={m.id}>{m.manufacturer} {m.model} ({m.memoryGB}GB, {m.tdpWatts}W)</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-terminal-muted mb-1">Quantity</label>
                    <input
                      type="number" min="1" value={newGpuEntry.quantity}
                      onChange={e => setNewGpuEntry(prev => ({ ...prev, quantity: Math.max(1, parseInt(e.target.value) || 1) }))}
                      className="bg-terminal-panel border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-terminal-muted mb-1">GPUs per Server</label>
                    <input
                      type="number" min="1" max="16" value={newGpuEntry.gpusPerServer}
                      onChange={e => setNewGpuEntry(prev => ({ ...prev, gpusPerServer: parseInt(e.target.value) || 8 }))}
                      className="bg-terminal-panel border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-terminal-muted mb-1">PUE</label>
                    <input
                      type="number" step="0.01" min="1" max="2" value={newGpuEntry.pue}
                      onChange={e => setNewGpuEntry(prev => ({ ...prev, pue: parseFloat(e.target.value) || 1.2 }))}
                      className="bg-terminal-panel border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text w-full"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      if (!newGpuEntry.gpuModelId) return;
                      const updated = [...gpuFleetEntries, newGpuEntry];
                      setSavingGpu(true);
                      try {
                        await fetch('/api/gpu/fleet', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ entries: updated }),
                        });
                        setSavedGpu(true);
                        setTimeout(() => setSavedGpu(false), 2000);
                        refetchGpuFleet();
                        setShowAddGpu(false);
                        setNewGpuEntry({ gpuModelId: '', quantity: 1, gpusPerServer: 8, serverOverheadWatts: 500, pue: 1.2, coolingType: 'air' });
                      } finally { setSavingGpu(false); }
                    }}
                    className="px-3 py-1.5 text-xs bg-terminal-cyan/20 text-terminal-cyan border border-terminal-cyan/30 rounded hover:bg-terminal-cyan/30"
                  >
                    {savingGpu ? 'Saving...' : 'Add'}
                  </button>
                  <button
                    onClick={() => setShowAddGpu(false)}
                    className="px-3 py-1.5 text-xs text-terminal-muted border border-terminal-border rounded hover:bg-terminal-panel"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {gpuFleetEntries.length === 0 && !showAddGpu && (
              <p className="text-xs text-terminal-muted italic">
                No GPU fleet configured. Add GPU classes to enable AI/HPC workload tracking.
              </p>
            )}
          </div>
        </SettingsSection>

        {/* HPC Contract Management — Phase 7 ACTIVE */}
        <SettingsSection
          title="HPC Contracts"
          description="Manage AI/HPC customer contracts, SLA requirements, and curtailment rules"
          icon={<Server size={18} className="text-terminal-cyan" />}
          phase={7}
          active
        >
          <div className="space-y-4">
            {/* Contract List */}
            {hpcContracts.length > 0 && (
              <div className="space-y-2">
                {hpcContracts.map((c: any) => (
                  <div key={c.id} className="bg-terminal-bg border border-terminal-border rounded p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${c.status === 'active' ? 'bg-terminal-green' : 'bg-terminal-muted'}`} />
                        <span className="text-sm font-medium text-terminal-text">{c.id}</span>
                        <span className="text-xs text-terminal-muted">— {c.customer}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 text-[10px] rounded ${
                          c.interruptible ? 'bg-terminal-amber/20 text-terminal-amber' : 'bg-terminal-green/20 text-terminal-green'
                        }`}>
                          {c.interruptible ? 'Interruptible' : 'Firm'}
                        </span>
                        <button
                          onClick={async () => {
                            await fetch(`/api/hpc/contracts/${c.id}`, { method: 'DELETE' });
                            refetchContracts();
                          }}
                          className="p-1 text-terminal-muted hover:text-terminal-red"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-xs">
                      <div><span className="text-terminal-muted">GPU:</span> <span className="text-terminal-text">{c.gpu_model || c.gpuModel} × {c.gpu_count || c.gpuCount}</span></div>
                      <div><span className="text-terminal-muted">Power:</span> <span className="text-terminal-text">{c.power_draw_mw || c.powerDrawMW} MW</span></div>
                      <div><span className="text-terminal-muted">Rate:</span> <span className="text-terminal-text">${c.rate_per_gpu_hr || c.ratePerGpuHr}/GPU-hr</span></div>
                      <div><span className="text-terminal-muted">SLA:</span> <span className="text-terminal-text">{c.uptime_sla || c.uptimeSLA}%</span></div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add Contract */}
            {!showAddContract ? (
              <button
                onClick={() => setShowAddContract(true)}
                className="flex items-center gap-2 px-3 py-2 text-xs text-terminal-cyan border border-terminal-cyan/30 rounded hover:bg-terminal-cyan/10 transition-colors"
              >
                <Plus size={14} /> Add HPC Contract
              </button>
            ) : (
              <div className="bg-terminal-bg border border-terminal-border rounded p-3 space-y-3">
                <p className="text-sm font-semibold text-terminal-text">New HPC Contract</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-terminal-muted mb-1">Customer</label>
                    <input
                      type="text" value={newContract.customer}
                      onChange={e => setNewContract(prev => ({ ...prev, customer: e.target.value }))}
                      className="bg-terminal-panel border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text w-full"
                      placeholder="e.g. Neocloud"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-terminal-muted mb-1">Type</label>
                    <select
                      value={newContract.contractType}
                      onChange={e => setNewContract(prev => ({ ...prev, contractType: e.target.value }))}
                      className="bg-terminal-panel border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text w-full"
                    >
                      <option value="reserved">Reserved</option>
                      <option value="spot">Spot</option>
                      <option value="burst">Burst</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-terminal-muted mb-1">GPU Model</label>
                    <select
                      value={newContract.gpuModel}
                      onChange={e => setNewContract(prev => ({ ...prev, gpuModel: e.target.value }))}
                      className="bg-terminal-panel border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text w-full"
                    >
                      <option value="">Select...</option>
                      {gpuModels.map((m: any) => (
                        <option key={m.id} value={m.id}>{m.manufacturer} {m.model}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-terminal-muted mb-1">GPU Count</label>
                    <input
                      type="number" min="1" value={newContract.gpuCount}
                      onChange={e => setNewContract(prev => ({ ...prev, gpuCount: parseInt(e.target.value) || 0 }))}
                      className="bg-terminal-panel border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-terminal-muted mb-1">Power Draw (MW)</label>
                    <input
                      type="number" step="0.1" value={newContract.powerDrawMW}
                      onChange={e => setNewContract(prev => ({ ...prev, powerDrawMW: parseFloat(e.target.value) || 0 }))}
                      className="bg-terminal-panel border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-terminal-muted mb-1">Rate ($/GPU-hr)</label>
                    <input
                      type="number" step="0.01" value={newContract.ratePerGpuHr}
                      onChange={e => setNewContract(prev => ({ ...prev, ratePerGpuHr: parseFloat(e.target.value) || 0 }))}
                      className="bg-terminal-panel border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-terminal-muted mb-1">Uptime SLA (%)</label>
                    <input
                      type="number" step="0.1" min="90" max="100" value={newContract.uptimeSLA}
                      onChange={e => setNewContract(prev => ({ ...prev, uptimeSLA: parseFloat(e.target.value) || 99.9 }))}
                      className="bg-terminal-panel border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text w-full"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox" checked={newContract.interruptible}
                      onChange={e => setNewContract(prev => ({ ...prev, interruptible: e.target.checked }))}
                      className="rounded border-terminal-border"
                    />
                    <label className="text-xs text-terminal-muted">Interruptible (can be curtailed)</label>
                  </div>
                  {newContract.interruptible && (
                    <>
                      <div>
                        <label className="block text-xs text-terminal-muted mb-1">Curtailment Penalty ($/hr)</label>
                        <input
                          type="number" step="0.01" value={newContract.curtailmentPenalty}
                          onChange={e => setNewContract(prev => ({ ...prev, curtailmentPenalty: parseFloat(e.target.value) || 0 }))}
                          className="bg-terminal-panel border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text w-full"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-terminal-muted mb-1">Max Curtail Hours/Month</label>
                        <input
                          type="number" value={newContract.curtailmentMaxHours}
                          onChange={e => setNewContract(prev => ({ ...prev, curtailmentMaxHours: parseFloat(e.target.value) || 0 }))}
                          className="bg-terminal-panel border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text w-full"
                        />
                      </div>
                    </>
                  )}
                  <div>
                    <label className="block text-xs text-terminal-muted mb-1">Start Date</label>
                    <input
                      type="date" value={newContract.startDate}
                      onChange={e => setNewContract(prev => ({ ...prev, startDate: e.target.value }))}
                      className="bg-terminal-panel border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-terminal-muted mb-1">End Date</label>
                    <input
                      type="date" value={newContract.endDate}
                      onChange={e => setNewContract(prev => ({ ...prev, endDate: e.target.value }))}
                      className="bg-terminal-panel border border-terminal-border rounded px-2 py-1.5 text-xs text-terminal-text w-full"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={async () => {
                      if (!newContract.customer) return;
                      setSavingContract(true);
                      try {
                        await fetch('/api/hpc/contracts', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(newContract),
                        });
                        refetchContracts();
                        setShowAddContract(false);
                        setNewContract({
                          customer: '', contractType: 'reserved', gpuModel: '', gpuCount: 0,
                          powerDrawMW: 0, ratePerGpuHr: 0, monthlyRevenue: 0, uptimeSLA: 99.9,
                          interruptible: false, curtailmentPenalty: 0, curtailmentMaxHours: 0,
                          curtailmentNoticeMin: 30, startDate: '', endDate: '', autoRenew: false,
                        });
                      } finally { setSavingContract(false); }
                    }}
                    className="px-3 py-1.5 text-xs bg-terminal-cyan/20 text-terminal-cyan border border-terminal-cyan/30 rounded hover:bg-terminal-cyan/30"
                  >
                    {savingContract ? 'Creating...' : 'Create Contract'}
                  </button>
                  <button
                    onClick={() => setShowAddContract(false)}
                    className="px-3 py-1.5 text-xs text-terminal-muted border border-terminal-border rounded hover:bg-terminal-panel"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {hpcContracts.length === 0 && !showAddContract && (
              <p className="text-xs text-terminal-muted italic">
                No HPC contracts configured. Add contracts to enable AI/HPC workload management.
              </p>
            )}
          </div>
        </SettingsSection>

        {/* Curtailment Priority — Phase 7 */}
        <SettingsSection
          title="Curtailment Priority Order"
          description="Configure which workloads get curtailed first during price spikes"
          icon={<Battery size={18} className="text-terminal-amber" />}
          phase={7}
          active
        >
          <div className="space-y-3">
            <p className="text-xs text-terminal-muted">
              Drag to reorder. Top items are curtailed first. Firm HPC contracts are never curtailed.
            </p>
            <div className="space-y-1">
              {curtailmentPriority.map((item, idx) => {
                const labels: Record<string, string> = {
                  btc_inefficient: 'BTC Mining — Inefficient machines first',
                  btc_efficient: 'BTC Mining — Efficient machines',
                  hpc_spot: 'HPC — Spot/burst capacity',
                  hpc_interruptible: 'HPC — Interruptible contracts (with penalty)',
                };
                return (
                  <div key={item} className="flex items-center gap-3 bg-terminal-bg border border-terminal-border rounded px-3 py-2">
                    <span className="text-xs text-terminal-muted w-4">{idx + 1}.</span>
                    <span className="text-xs text-terminal-text flex-1">{labels[item] || item}</span>
                    <div className="flex gap-1">
                      {idx > 0 && (
                        <button
                          onClick={() => {
                            const arr = [...curtailmentPriority];
                            [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
                            setCurtailmentPriority(arr);
                          }}
                          className="px-1.5 py-0.5 text-[10px] text-terminal-muted hover:text-terminal-text border border-terminal-border rounded"
                        >
                          Up
                        </button>
                      )}
                      {idx < curtailmentPriority.length - 1 && (
                        <button
                          onClick={() => {
                            const arr = [...curtailmentPriority];
                            [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
                            setCurtailmentPriority(arr);
                          }}
                          className="px-1.5 py-0.5 text-[10px] text-terminal-muted hover:text-terminal-text border border-terminal-border rounded"
                        >
                          Down
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center gap-3 bg-terminal-bg border border-terminal-green/20 rounded px-3 py-2">
              <span className="text-xs text-terminal-muted w-4">—</span>
              <span className="text-xs text-terminal-green flex-1">HPC — Firm contracts (NEVER curtailed)</span>
            </div>
            <button
              onClick={async () => {
                setSavingPriority(true);
                try {
                  await fetch('/api/curtailment/constraints', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...curtailmentSettings, curtailmentPriority }),
                  });
                  setSavedPriority(true);
                  setTimeout(() => setSavedPriority(false), 2000);
                } finally { setSavingPriority(false); }
              }}
              disabled={savingPriority}
              className="flex items-center gap-2 px-4 py-2 bg-terminal-amber/20 text-terminal-amber border border-terminal-amber/30 rounded hover:bg-terminal-amber/30 transition-colors text-sm disabled:opacity-50"
            >
              {savingPriority ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
              {savingPriority ? 'Saving...' : savedPriority ? 'Saved!' : 'Save Priority Order'}
            </button>
          </div>
        </SettingsSection>

        {/* Alert Thresholds */}
        <SettingsSection
          title="Alert Thresholds"
          description="Default thresholds for operational alerts"
          icon={<Bell size={18} className="text-terminal-red" />}
          phase={4}
        >
          <p className="text-sm text-terminal-muted">
            Set default alert thresholds for energy prices, hashprice targets,
            hashrate drops, temperature warnings, and more. Individual alerts
            can still be configured in the Alerts tab.
          </p>
        </SettingsSection>

        {/* Theme */}
        <SettingsSection
          title="Display"
          description="Theme and layout preferences"
          icon={<Palette size={18} className="text-terminal-cyan" />}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-terminal-text">Theme</p>
                <p className="text-xs text-terminal-muted">Terminal dark theme (Bloomberg-inspired)</p>
              </div>
              <span className="px-2 py-1 text-xs bg-terminal-green/20 text-terminal-green rounded">
                Active
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-terminal-text">Font</p>
                <p className="text-xs text-terminal-muted">Exo 2</p>
              </div>
              <span className="text-xs text-terminal-muted">Default</span>
            </div>
          </div>
        </SettingsSection>

        {/* Phase 8: Team Management */}
        <TeamManagementSection />

        {/* Phase 8: Partner Access */}
        <PartnerAccessSection />

        {/* Phase 8: API Keys */}
        <ApiKeysSection />

        {/* Phase 8: Webhooks */}
        <WebhooksSection />

        {/* Phase 8: Notification Preferences */}
        <NotificationPreferencesSection />

        {/* Phase 8: White Label / Branding */}
        <BrandingSection />

        {/* Phase 9: Insurance Settings */}
        <InsuranceSettingsSection />

        {/* Agent Run History / Eval */}
        <SettingsSection title="Agent Run History" description="Audit agent outputs, track regressions, and compare runs" icon={<Activity size={18} />}>
          <Suspense fallback={<div className="py-8 text-center text-terminal-muted text-sm">Loading run history...</div>}>
            <AgentRunHistory />
          </Suspense>
        </SettingsSection>
      </div>}
    </div>
  );
}

function TeamManagementSection() {
  const { data: users, refetch } = useApi('/tenant/users', { refreshInterval: 30000 });
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('viewer');
  const [inviting, setInviting] = useState(false);

  const handleInvite = async () => {
    if (!inviteEmail) return;
    setInviting(true);
    try {
      const { postApi } = await import('../hooks/useApi');
      await postApi('/tenant/users/invite', { email: inviteEmail, role: inviteRole });
      setInviteEmail('');
      refetch();
    } catch (err) {
      console.error('Invite failed:', err);
    }
    setInviting(false);
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      const { putApi } = await import('../hooks/useApi');
      await putApi(`/tenant/users/${userId}`, { role: newRole });
      refetch();
    } catch (err) {
      console.error('Role change failed:', err);
    }
  };

  return (
    <SettingsSection
      title="Team Members"
      description="Manage users and roles"
      icon={<Users size={18} className="text-terminal-green" />}
      active
    >
      <div className="space-y-4">
        {/* User list */}
        <div className="space-y-2">
          {(users || []).map((u: any) => (
            <div key={u.id} className="flex items-center justify-between p-2 bg-terminal-bg rounded border border-terminal-border">
              <div>
                <p className="text-sm text-terminal-text">{u.name}</p>
                <p className="text-xs text-terminal-muted">{u.email}</p>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={u.role}
                  onChange={e => handleRoleChange(u.id, e.target.value)}
                  className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-xs text-terminal-text"
                >
                  <option value="owner">Owner</option>
                  <option value="admin">Admin</option>
                  <option value="operator">Operator</option>
                  <option value="viewer">Viewer</option>
                </select>
                <span className={`w-2 h-2 rounded-full ${u.status === 'active' ? 'bg-terminal-green' : 'bg-terminal-amber'}`} />
              </div>
            </div>
          ))}
        </div>

        {/* Invite form */}
        <div className="flex gap-2">
          <input
            type="email"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            placeholder="Email address"
            className="flex-1 bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text placeholder-terminal-muted focus:border-terminal-green focus:outline-none"
          />
          <select
            value={inviteRole}
            onChange={e => setInviteRole(e.target.value)}
            className="bg-terminal-bg border border-terminal-border rounded px-2 py-2 text-sm text-terminal-text"
          >
            <option value="admin">Admin</option>
            <option value="operator">Operator</option>
            <option value="viewer">Viewer</option>
          </select>
          <button
            onClick={handleInvite}
            disabled={inviting || !inviteEmail}
            className="px-4 py-2 bg-terminal-green/20 text-terminal-green border border-terminal-green/30 rounded text-sm hover:bg-terminal-green/30 disabled:opacity-50"
          >
            {inviting ? 'Inviting...' : 'Invite'}
          </button>
        </div>
      </div>
    </SettingsSection>
  );
}

function PartnerAccessSection() {
  const { data: partners, refetch } = useApi('/partners', { refreshInterval: 30000 });
  const [showForm, setShowForm] = useState(false);
  const [partnerEmail, setPartnerEmail] = useState('');
  const [accessType, setAccessType] = useState('ipp');
  const [permissions, setPermissions] = useState({
    shareEnergyConsumption: true,
    shareCurtailmentSchedule: true,
    shareRevenueData: false,
    shareFleetComposition: false,
    shareHashrateData: false,
    shareAgentActivity: false,
    shareHPCContractData: false,
    shareSLACompliance: true,
    dataGranularity: 'daily',
    historicalAccess: 30,
  });

  const handleGrant = async () => {
    if (!partnerEmail) return;
    try {
      const { postApi } = await import('../hooks/useApi');
      await postApi('/partners', { partnerEmail, accessType, permissions });
      setPartnerEmail('');
      setShowForm(false);
      refetch();
    } catch (err) {
      console.error('Partner grant failed:', err);
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      const { deleteApi } = await import('../hooks/useApi');
      await deleteApi(`/partners/${id}`);
      refetch();
    } catch (err) {
      console.error('Partner revoke failed:', err);
    }
  };

  return (
    <SettingsSection
      title="Partner Access"
      description="Grant IPP or auditor visibility into your data"
      icon={<Link2 size={18} className="text-terminal-amber" />}
      active
    >
      <div className="space-y-4">
        {(partners?.grants || []).map((p: any) => (
          <div key={p.id} className="flex items-center justify-between p-2 bg-terminal-bg rounded border border-terminal-border">
            <div>
              <p className="text-sm text-terminal-text">{p.partner_tenant_id}</p>
              <p className="text-xs text-terminal-muted capitalize">{p.access_type} partner</p>
            </div>
            <button onClick={() => handleRevoke(p.id)} className="text-terminal-red text-xs hover:underline">
              Revoke
            </button>
          </div>
        ))}

        {showForm ? (
          <div className="space-y-3 p-3 bg-terminal-bg rounded border border-terminal-border">
            <input
              type="email"
              value={partnerEmail}
              onChange={e => setPartnerEmail(e.target.value)}
              placeholder="Partner email"
              className="w-full bg-terminal-panel border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text placeholder-terminal-muted focus:border-terminal-green focus:outline-none"
            />
            <select
              value={accessType}
              onChange={e => setAccessType(e.target.value)}
              className="w-full bg-terminal-panel border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text"
            >
              <option value="ipp">IPP / Energy Provider</option>
              <option value="auditor">Auditor</option>
              <option value="insurance">Insurance Provider</option>
            </select>

            <div className="space-y-2">
              <p className="text-xs text-terminal-muted font-semibold">Data Sharing</p>
              {[
                { key: 'shareEnergyConsumption', label: 'Energy Consumption' },
                { key: 'shareCurtailmentSchedule', label: 'Curtailment Schedule' },
                { key: 'shareRevenueData', label: 'Revenue Data' },
                { key: 'shareFleetComposition', label: 'Fleet Composition' },
                { key: 'shareHashrateData', label: 'Hashrate Data' },
                { key: 'shareSLACompliance', label: 'SLA Compliance' },
              ].map(item => (
                <label key={item.key} className="flex items-center gap-2 text-xs text-terminal-text">
                  <input
                    type="checkbox"
                    checked={(permissions as any)[item.key]}
                    onChange={e => setPermissions({ ...permissions, [item.key]: e.target.checked })}
                    className="rounded"
                  />
                  {item.label}
                </label>
              ))}
            </div>

            <div className="flex gap-2">
              <button onClick={handleGrant} className="px-3 py-1.5 bg-terminal-green/20 text-terminal-green text-xs rounded border border-terminal-green/30">
                Grant Access
              </button>
              <button onClick={() => setShowForm(false)} className="px-3 py-1.5 text-terminal-muted text-xs rounded border border-terminal-border">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1 text-sm text-terminal-green hover:underline"
          >
            <Plus size={14} /> Add Partner
          </button>
        )}
      </div>
    </SettingsSection>
  );
}

function ApiKeysSection() {
  const { data: keysData, refetch } = useApi('/tenant/api-keys', { refreshInterval: 30000 });
  const [keyName, setKeyName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!keyName) return;
    setCreating(true);
    try {
      const { postApi } = await import('../hooks/useApi');
      const result = await postApi('/tenant/api-keys', { name: keyName });
      setNewKey(result.key);
      setKeyName('');
      refetch();
    } catch (err) {
      console.error('API key creation failed:', err);
    }
    setCreating(false);
  };

  const handleRevoke = async (id: string) => {
    try {
      const { deleteApi } = await import('../hooks/useApi');
      await deleteApi(`/tenant/api-keys/${id}`);
      refetch();
    } catch (err) {
      console.error('API key revocation failed:', err);
    }
  };

  return (
    <SettingsSection
      title="API Keys"
      description="Manage API keys for external integrations"
      icon={<Key size={18} className="text-terminal-cyan" />}
      active
    >
      <div className="space-y-4">
        {newKey && (
          <div className="p-3 bg-terminal-green/10 border border-terminal-green/30 rounded">
            <p className="text-xs text-terminal-green mb-1 font-semibold">New API Key — copy now, it won't be shown again:</p>
            <code className="text-xs text-terminal-text bg-terminal-bg px-2 py-1 rounded block overflow-x-auto">{newKey}</code>
            <button onClick={() => setNewKey(null)} className="text-xs text-terminal-muted mt-2 hover:underline">Dismiss</button>
          </div>
        )}

        {(keysData?.keys || []).map((k: any) => (
          <div key={k.id} className="flex items-center justify-between p-2 bg-terminal-bg rounded border border-terminal-border">
            <div>
              <p className="text-sm text-terminal-text">{k.name}</p>
              <p className="text-xs text-terminal-muted font-sans">{k.key_prefix}...</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-terminal-muted">{k.last_used ? `Last used: ${new Date(k.last_used).toLocaleDateString()}` : 'Never used'}</span>
              {!k.revoked && (
                <button onClick={() => handleRevoke(k.id)} className="text-terminal-red text-xs hover:underline">
                  Revoke
                </button>
              )}
            </div>
          </div>
        ))}

        <div className="flex gap-2">
          <input
            type="text"
            value={keyName}
            onChange={e => setKeyName(e.target.value)}
            placeholder="Key name (e.g., Production API)"
            className="flex-1 bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text placeholder-terminal-muted focus:border-terminal-green focus:outline-none"
          />
          <button
            onClick={handleCreate}
            disabled={creating || !keyName}
            className="px-4 py-2 bg-terminal-green/20 text-terminal-green border border-terminal-green/30 rounded text-sm hover:bg-terminal-green/30 disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create Key'}
          </button>
        </div>
      </div>
    </SettingsSection>
  );
}

function WebhooksSection() {
  const { data: webhooksData, refetch } = useApi('/v1/webhooks', { refreshInterval: 30000 });
  const [showForm, setShowForm] = useState(false);
  const [whUrl, setWhUrl] = useState('');
  const [whEvents, setWhEvents] = useState<string[]>([]);

  const EVENT_TYPES = [
    'curtailment.recommendation', 'curtailment.executed',
    'agent.approval_required', 'agent.action_executed',
    'alert.critical', 'alert.warning',
    'pool.hashrate_deviation', 'pool.worker_dead',
    'energy.price_spike', 'energy.grid_emergency',
    'report.generated', 'hpc.sla_warning',
  ];

  const handleCreate = async () => {
    if (!whUrl || whEvents.length === 0) return;
    try {
      const { postApi } = await import('../hooks/useApi');
      await postApi('/v1/webhooks', { url: whUrl, events: whEvents });
      setWhUrl('');
      setWhEvents([]);
      setShowForm(false);
      refetch();
    } catch (err) {
      console.error('Webhook creation failed:', err);
    }
  };

  return (
    <SettingsSection
      title="Webhooks"
      description="Receive real-time event notifications"
      icon={<Globe size={18} className="text-terminal-amber" />}
      active
    >
      <div className="space-y-4">
        {(webhooksData?.webhooks || []).map((wh: any) => (
          <div key={wh.id} className="p-2 bg-terminal-bg rounded border border-terminal-border">
            <div className="flex items-center justify-between">
              <p className="text-sm text-terminal-text font-sans truncate">{wh.url}</p>
              <span className={`text-xs px-1.5 py-0.5 rounded ${wh.status === 'active' ? 'bg-terminal-green/20 text-terminal-green' : 'bg-terminal-red/20 text-terminal-red'}`}>
                {wh.status}
              </span>
            </div>
            <p className="text-xs text-terminal-muted mt-1">{(wh.events || []).join(', ')}</p>
          </div>
        ))}

        {showForm ? (
          <div className="space-y-3 p-3 bg-terminal-bg rounded border border-terminal-border">
            <input
              type="url"
              value={whUrl}
              onChange={e => setWhUrl(e.target.value)}
              placeholder="https://your-endpoint.com/webhook"
              className="w-full bg-terminal-panel border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text placeholder-terminal-muted focus:border-terminal-green focus:outline-none"
            />
            <div className="grid grid-cols-2 gap-1">
              {EVENT_TYPES.map(evt => (
                <label key={evt} className="flex items-center gap-1.5 text-xs text-terminal-text">
                  <input
                    type="checkbox"
                    checked={whEvents.includes(evt)}
                    onChange={e => {
                      if (e.target.checked) setWhEvents([...whEvents, evt]);
                      else setWhEvents(whEvents.filter(x => x !== evt));
                    }}
                    className="rounded"
                  />
                  {evt}
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={handleCreate} className="px-3 py-1.5 bg-terminal-green/20 text-terminal-green text-xs rounded border border-terminal-green/30">
                Create Webhook
              </button>
              <button onClick={() => setShowForm(false)} className="px-3 py-1.5 text-terminal-muted text-xs rounded border border-terminal-border">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowForm(true)} className="flex items-center gap-1 text-sm text-terminal-green hover:underline">
            <Plus size={14} /> Add Webhook
          </button>
        )}
      </div>
    </SettingsSection>
  );
}

function NotificationPreferencesSection() {
  const [prefs, setPrefs] = useState({
    criticalAlerts: { inApp: true, email: true, webhook: true },
    curtailmentChanges: { inApp: true, email: true, webhook: true },
    agentApprovals: { inApp: true, email: true, webhook: true },
    agentActions: { inApp: true, email: false, webhook: true },
    dailyReports: { inApp: true, email: true, webhook: false },
    poolAlerts: { inApp: true, email: false, webhook: true },
    weeklyDigest: { inApp: false, email: true, webhook: false },
  });

  const categories = [
    { key: 'criticalAlerts', label: 'Critical Alerts' },
    { key: 'curtailmentChanges', label: 'Curtailment Changes' },
    { key: 'agentApprovals', label: 'Agent Approvals' },
    { key: 'agentActions', label: 'Agent Actions' },
    { key: 'dailyReports', label: 'Daily Reports' },
    { key: 'poolAlerts', label: 'Pool Alerts' },
    { key: 'weeklyDigest', label: 'Weekly Digest' },
  ];

  return (
    <SettingsSection
      title="Notification Preferences"
      description="Control how you receive notifications"
      icon={<Bell size={18} className="text-terminal-green" />}
      active
    >
      <div className="space-y-1">
        <div className="grid grid-cols-4 gap-2 text-xs text-terminal-muted font-semibold pb-2 border-b border-terminal-border">
          <span></span>
          <span className="text-center">In-App</span>
          <span className="text-center">Email</span>
          <span className="text-center">Webhook</span>
        </div>
        {categories.map(cat => (
          <div key={cat.key} className="grid grid-cols-4 gap-2 items-center py-1.5">
            <span className="text-xs text-terminal-text">{cat.label}</span>
            {(['inApp', 'email', 'webhook'] as const).map(channel => (
              <div key={channel} className="flex justify-center">
                <input
                  type="checkbox"
                  checked={(prefs as any)[cat.key][channel]}
                  onChange={e => setPrefs({
                    ...prefs,
                    [cat.key]: { ...(prefs as any)[cat.key], [channel]: e.target.checked }
                  })}
                  className="rounded"
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}

function BrandingSection() {
  const [branding, setBranding] = useState({
    companyName: '',
    primaryColor: '#00d26a',
    logo: '',
    hideSanghaBranding: false,
  });

  return (
    <SettingsSection
      title="Branding & White Label"
      description="Customize the platform appearance"
      icon={<Shield size={18} className="text-terminal-cyan" />}
      active
    >
      <div className="space-y-3">
        <div>
          <label className="text-xs text-terminal-muted">Company Name Override</label>
          <input
            type="text"
            value={branding.companyName}
            onChange={e => setBranding({ ...branding, companyName: e.target.value })}
            placeholder="Your Company Name"
            className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text placeholder-terminal-muted focus:border-terminal-green focus:outline-none mt-1"
          />
        </div>
        <div>
          <label className="text-xs text-terminal-muted">Primary Color</label>
          <div className="flex items-center gap-2 mt-1">
            <input
              type="color"
              value={branding.primaryColor}
              onChange={e => setBranding({ ...branding, primaryColor: e.target.value })}
              className="w-8 h-8 rounded border border-terminal-border bg-transparent cursor-pointer"
            />
            <input
              type="text"
              value={branding.primaryColor}
              onChange={e => setBranding({ ...branding, primaryColor: e.target.value })}
              className="bg-terminal-bg border border-terminal-border rounded px-3 py-1.5 text-sm text-terminal-text font-sans w-28"
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-terminal-muted">Logo URL</label>
          <input
            type="url"
            value={branding.logo}
            onChange={e => setBranding({ ...branding, logo: e.target.value })}
            placeholder="https://..."
            className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text placeholder-terminal-muted focus:border-terminal-green focus:outline-none mt-1"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-terminal-text">
          <input
            type="checkbox"
            checked={branding.hideSanghaBranding}
            onChange={e => setBranding({ ...branding, hideSanghaBranding: e.target.checked })}
            className="rounded"
          />
          Hide "Powered by Coppice" (Enterprise plans only)
        </label>
        <button className="px-4 py-2 bg-terminal-green/20 text-terminal-green border border-terminal-green/30 rounded text-sm hover:bg-terminal-green/30">
          Save Branding
        </button>
      </div>
    </SettingsSection>
  );
}

function InsuranceSettingsSection() {
  const [insuranceSettings, setInsuranceSettings] = useState({
    enabled: true,
    defaultFloorPreference: 'moderate',
    claimsNotifications: true,
    dataSharingConsent: false,
    consentTimestamp: null as string | null,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Scheduler controls
  const { data: schedulerData, refetch: refetchSchedulers } = useApi('/v1/insurance/schedulers', { refreshInterval: 10000 });
  const [togglingScheduler, setTogglingScheduler] = useState<string | null>(null);

  const toggleScheduler = async (name: string, currentlyRunning: boolean) => {
    setTogglingScheduler(name);
    try {
      const { postApi } = await import('../hooks/useApi');
      const action = currentlyRunning ? 'stop' : 'start';
      await postApi(`/v1/insurance/schedulers/${action}`, { scheduler: name });
      refetchSchedulers();
    } catch (err) {
      console.error(`Failed to toggle ${name} scheduler:`, err);
    }
    setTogglingScheduler(null);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { postApi } = await import('../hooks/useApi');
      await postApi('/v1/insurance/settings', insuranceSettings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save insurance settings:', err);
    }
    setSaving(false);
  };

  return (
    <SettingsSection
      title="Insurance & Revenue Protection"
      description="Configure Sangha revenue floor guarantee settings"
      icon={<Shield size={18} className="text-terminal-cyan" />}
      phase={9}
      active
    >
      <div className="space-y-4">
        {/* Background Scheduler Controls */}
        <div className="p-3 bg-terminal-bg border border-terminal-border rounded">
          <p className="text-xs text-terminal-muted uppercase tracking-wider mb-2">Background Schedulers</p>
          <p className="text-[10px] text-terminal-muted mb-3">
            These are background jobs. They are OFF by default to avoid unnecessary computation.
            The calibration scheduler requires the SanghaModel Python service running on port 8100.
          </p>
          <div className="space-y-2">
            {['claims', 'calibration'].map(name => {
              const sched = schedulerData?.[name];
              const running = sched?.running ?? false;
              return (
                <div key={name} className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-terminal-text capitalize">{name} Scheduler</p>
                    <p className="text-[10px] text-terminal-muted">{sched?.description || ''}</p>
                  </div>
                  <button
                    onClick={() => toggleScheduler(name, running)}
                    disabled={togglingScheduler === name}
                    className={`px-3 py-1 text-xs rounded border transition-colors ${
                      running
                        ? 'bg-terminal-green/10 text-terminal-green border-terminal-green/30 hover:bg-terminal-red/10 hover:text-terminal-red hover:border-terminal-red/30'
                        : 'bg-terminal-panel text-terminal-muted border-terminal-border hover:text-terminal-green hover:border-terminal-green/30'
                    } disabled:opacity-50`}
                  >
                    {togglingScheduler === name ? '...' : running ? 'Running — Stop' : 'Stopped — Start'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-terminal-text">
          <input
            type="checkbox"
            checked={insuranceSettings.enabled}
            onChange={e => setInsuranceSettings({ ...insuranceSettings, enabled: e.target.checked })}
            className="rounded"
          />
          Enable Insurance Features
        </label>

        <div>
          <label className="text-xs text-terminal-muted block mb-1">Default Coverage Preference</label>
          <select
            value={insuranceSettings.defaultFloorPreference}
            onChange={e => setInsuranceSettings({ ...insuranceSettings, defaultFloorPreference: e.target.value })}
            className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text focus:border-terminal-green focus:outline-none"
          >
            <option value="conservative">Conservative (Higher floor, higher premium)</option>
            <option value="moderate">Moderate (Balanced risk/cost)</option>
            <option value="aggressive">Aggressive (Lower floor, lower premium)</option>
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm text-terminal-text">
          <input
            type="checkbox"
            checked={insuranceSettings.claimsNotifications}
            onChange={e => setInsuranceSettings({ ...insuranceSettings, claimsNotifications: e.target.checked })}
            className="rounded"
          />
          Receive claims notifications
        </label>

        <div className="p-3 bg-terminal-bg border border-terminal-amber/30 rounded">
          <label className="flex items-center gap-2 text-sm text-terminal-text">
            <input
              type="checkbox"
              checked={insuranceSettings.dataSharingConsent}
              onChange={e => setInsuranceSettings({
                ...insuranceSettings,
                dataSharingConsent: e.target.checked,
                consentTimestamp: e.target.checked ? new Date().toISOString() : null,
              })}
              className="rounded"
            />
            <span>Consent to anonymized data sharing for calibration</span>
          </label>
          <p className="text-[10px] text-terminal-muted mt-1 ml-6">
            Your operational data will be aggregated and anonymized before being used to calibrate the network simulator.
            No individual tenant data is ever shared. This helps improve risk assessment accuracy for all miners.
          </p>
          {insuranceSettings.consentTimestamp && (
            <p className="text-[10px] text-terminal-green mt-1 ml-6">
              Consent granted: {new Date(insuranceSettings.consentTimestamp).toLocaleString()}
            </p>
          )}
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 bg-terminal-green/20 text-terminal-green border border-terminal-green/30 rounded text-sm hover:bg-terminal-green/30 disabled:opacity-50"
        >
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Insurance Settings'}
        </button>
      </div>
    </SettingsSection>
  );
}

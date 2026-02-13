import React, { useState, useEffect } from 'react';
import { Cpu, Zap, Server, Bot, Bell, Palette, Save, RefreshCw, Plus, Trash2, ChevronDown, Battery } from 'lucide-react';
import { useApi } from '../hooks/useApi';

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

  return (
    <div className="p-4 max-w-4xl mx-auto">
      <div className="mb-6">
        <h2 className="text-xl font-bold text-terminal-green">Settings</h2>
        <p className="text-sm text-terminal-muted mt-1">
          Configure your mining operations platform. Settings marked with a phase number
          will become available as those features are built.
        </p>
      </div>

      <div className="space-y-4">
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
                    className="bg-terminal-panel border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text w-full font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs text-terminal-muted mb-1">API Secret (if required)</label>
                  <input
                    type="password"
                    value={newPool.apiSecret}
                    onChange={e => setNewPool(prev => ({ ...prev, apiSecret: e.target.value }))}
                    placeholder="Enter API secret"
                    className="bg-terminal-panel border border-terminal-border rounded px-3 py-2 text-sm text-terminal-text w-full font-mono"
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

        {/* Agent Preferences */}
        <SettingsSection
          title="Agent Preferences"
          description="Configure autonomous agent behavior and constraints"
          icon={<Bot size={18} className="text-terminal-purple" />}
          phase={6}
        >
          <p className="text-sm text-terminal-muted">
            Define risk thresholds, approval requirements, and operational boundaries
            for autonomous agents. Control what agents can do without human approval.
          </p>
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
                <p className="text-xs text-terminal-muted">JetBrains Mono</p>
              </div>
              <span className="text-xs text-terminal-muted">Default</span>
            </div>
          </div>
        </SettingsSection>
      </div>
    </div>
  );
}

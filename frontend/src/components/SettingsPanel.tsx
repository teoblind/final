import React, { useState, useEffect } from 'react';
import { Cpu, Zap, Server, Bot, Bell, Palette, Save, RefreshCw } from 'lucide-react';
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

export default function SettingsPanel() {
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
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settingsData?.settings) {
      setEnergySettings(prev => ({ ...prev, ...settingsData.settings }));
    }
  }, [settingsData]);

  const handleSaveEnergy = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/energy/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(energySettings),
      });
      if (response.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        refetchSettings();
      }
    } catch (err) {
      console.error('Failed to save energy settings:', err);
    } finally {
      setSaving(false);
    }
  };

  const toggleNode = (node: string) => {
    setEnergySettings(prev => ({
      ...prev,
      monitoredNodes: prev.monitoredNodes.includes(node)
        ? prev.monitoredNodes.filter(n => n !== node)
        : [...prev.monitoredNodes, node],
    }));
  };

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
        {/* Energy Configuration — Phase 2 ACTIVE */}
        <SettingsSection
          title="Energy Market"
          description="ISO/RTO connection, node selection, price thresholds"
          icon={<Zap size={18} className="text-terminal-amber" />}
          phase={2}
          active
        >
          <div className="space-y-4">
            {/* ISO Selection */}
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

            {/* Primary Node */}
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

            {/* Monitored Nodes */}
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

            {/* Price Thresholds */}
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

            {/* Negative Alert Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-terminal-text">Negative Price Alerts</p>
                <p className="text-xs text-terminal-muted">Get notified when prices go negative (free energy!)</p>
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

            {/* Refresh Interval */}
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

            {/* Save Button */}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSaveEnergy}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-terminal-green/20 text-terminal-green border border-terminal-green/30 rounded hover:bg-terminal-green/30 transition-colors text-sm disabled:opacity-50"
              >
                {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Energy Settings'}
              </button>
              {saved && <span className="text-xs text-terminal-green">Settings saved successfully</span>}
            </div>
          </div>
        </SettingsSection>

        {/* Fleet Configuration */}
        <SettingsSection
          title="Fleet Configuration"
          description="Define your ASIC fleet — models, quantities, efficiency ratings"
          icon={<Cpu size={18} className="text-terminal-green" />}
          phase={3}
        >
          <div className="space-y-3">
            <p className="text-sm text-terminal-muted">
              Configure your mining hardware fleet to enable fleet-aware hashprice modeling
              and profitability analysis.
            </p>
            <div className="bg-terminal-bg rounded p-3">
              <p className="text-xs text-terminal-muted mb-2">Example fleet entry:</p>
              <div className="grid grid-cols-4 gap-2 text-xs">
                <div>
                  <p className="text-terminal-muted">Model</p>
                  <p className="text-terminal-text">S21 XP</p>
                </div>
                <div>
                  <p className="text-terminal-muted">Quantity</p>
                  <p className="text-terminal-text">500</p>
                </div>
                <div>
                  <p className="text-terminal-muted">Hashrate</p>
                  <p className="text-terminal-text">270 TH/s</p>
                </div>
                <div>
                  <p className="text-terminal-muted">Efficiency</p>
                  <p className="text-terminal-text">15.0 J/TH</p>
                </div>
              </div>
            </div>
          </div>
        </SettingsSection>

        {/* Pool API Keys */}
        <SettingsSection
          title="Pool API Keys"
          description="Connect mining pools for unified monitoring"
          icon={<Server size={18} className="text-terminal-blue" />}
          phase={5}
        >
          <div className="space-y-3">
            <p className="text-sm text-terminal-muted">
              Add API keys from your mining pools to enable the unified Pool Monitor.
              Supports Foundry, Braiins, Ocean, F2Pool, Luxor, and custom pools.
            </p>
            <div className="bg-terminal-bg rounded p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-terminal-muted">No pools configured yet</span>
                <span className="text-terminal-green cursor-pointer hover:underline">
                  + Add Pool
                </span>
              </div>
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

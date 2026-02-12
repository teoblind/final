import React from 'react';
import { Cpu, Zap, Server, Bot, Bell, Palette } from 'lucide-react';

interface SettingsSectionProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  phase?: number;
  children?: React.ReactNode;
}

function SettingsSection({ title, description, icon, phase, children }: SettingsSectionProps) {
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
        {phase && (
          <span className="px-2 py-0.5 text-xs bg-terminal-border rounded text-terminal-muted">
            Phase {phase}
          </span>
        )}
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

export default function SettingsPanel() {
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

        {/* Energy Configuration */}
        <SettingsSection
          title="Energy Contract"
          description="Energy provider, contract type, rates, and market connection"
          icon={<Zap size={18} className="text-terminal-amber" />}
          phase={2}
        >
          <div className="space-y-3">
            <p className="text-sm text-terminal-muted">
              Connect your energy market data source and configure your contract details
              for accurate profitability calculations and curtailment optimization.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-terminal-bg rounded p-3">
                <p className="text-xs text-terminal-muted">ISO/RTO</p>
                <p className="text-sm text-terminal-text">ERCOT, PJM, CAISO, MISO, etc.</p>
              </div>
              <div className="bg-terminal-bg rounded p-3">
                <p className="text-xs text-terminal-muted">Contract Type</p>
                <p className="text-sm text-terminal-text">Fixed, Index, PPA, Hybrid</p>
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

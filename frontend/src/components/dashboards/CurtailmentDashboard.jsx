import React, { useState, useEffect, useCallback } from 'react';
import { LmpTicker, IntradayChart, LmpHeatmap, NodeComparison, LmpStats } from '../panels/curtailment/ercot';
import EmptyState from '../ui/EmptyState';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const MACHINE_MODELS = ['S19', 'S19j Pro', 'S19k Pro', 'S19 XP', 'S21', 'M30', 'M50'];

// ─── Helpers ────────────────────────────────────────────────────────────────

const VAL_CLS = {
  green: 'text-[#1a6b3c]',
  warn: 'text-[#b8860b]',
  danger: 'text-[#c0392b]',
  accent: 'text-[#1a6b3c]',
  '': 'text-terminal-text',
};

// ─── Sub-components ─────────────────────────────────────────────────────────

function Card({ title, meta, children }) {
  return (
    <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
      <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
        <span className="text-xs font-bold text-terminal-text tracking-[0.3px] font-heading">{title}</span>
        {meta && <span className="text-[11px] text-terminal-muted font-mono">{meta}</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function KVRow({ label, value, cls = '', last = false }) {
  return (
    <div className={`flex items-center justify-between px-[18px] py-[10px] ${last ? '' : 'border-b border-[#f0eeea]'} text-[13px]`}>
      <span className="text-[#6b6b65]">{label}</span>
      <span className={`font-semibold tabular-nums font-mono text-xs ${VAL_CLS[cls] || 'text-terminal-text'}`}>{value}</span>
    </div>
  );
}

// ─── Fleet Config Modal ─────────────────────────────────────────────────────

function FleetConfigModal({ onClose, onSaved, existing }) {
  const [form, setForm] = useState({
    ercotApiKey: '',
    ercotAccountId: '',
    fleetName: '',
    machineCount: '',
    machineModel: 'S19',
    breakevenPrice: '',
    curtailThreshold: '',
    hubspotZoneId: '',
    ...(existing || {}),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const set = (field, value) => setForm(prev => ({ ...prev, [field]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const token = sessionStorage.getItem('sangha_auth');
      const res = await fetch(`${API_BASE}/v1/tenant/fleet-config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          ercotApiKey: form.ercotApiKey,
          ercotAccountId: form.ercotAccountId,
          fleetName: form.fleetName,
          machineCount: Number(form.machineCount) || 0,
          machineModel: form.machineModel,
          breakevenPrice: Number(form.breakevenPrice) || 0,
          curtailThreshold: Number(form.curtailThreshold) || 0,
          hubspotZoneId: form.hubspotZoneId || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'w-full px-3 py-2 text-[13px] bg-terminal-panel border border-terminal-border rounded-lg text-terminal-text placeholder-terminal-muted focus:outline-none focus:ring-1 focus:ring-[#1a6b3c] focus:border-[#1a6b3c] transition-colors';

  const labelCls = 'block text-[11px] font-semibold text-terminal-muted uppercase tracking-[0.5px] mb-1.5 font-heading';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-terminal-panel border border-terminal-border rounded-[16px] shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-4 border-b border-terminal-border flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-terminal-text font-heading">Connect Fleet</h2>
            <p className="text-[11px] text-terminal-muted mt-0.5">Enter your ERCOT credentials and fleet details</p>
          </div>
          <button
            onClick={onClose}
            className="text-terminal-muted hover:text-terminal-text transition-colors text-lg leading-none px-1"
          >
            &times;
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* ERCOT API Key */}
          <div>
            <label className={labelCls}>ERCOT API Key</label>
            <input
              type="password"
              className={inputCls}
              placeholder="Enter your ERCOT API key"
              value={form.ercotApiKey}
              onChange={(e) => set('ercotApiKey', e.target.value)}
              required
            />
          </div>

          {/* ERCOT Account ID */}
          <div>
            <label className={labelCls}>ERCOT Account ID</label>
            <input
              type="text"
              className={inputCls}
              placeholder="e.g. ACCT-12345"
              value={form.ercotAccountId}
              onChange={(e) => set('ercotAccountId', e.target.value)}
              required
            />
          </div>

          {/* Fleet Name */}
          <div>
            <label className={labelCls}>Fleet Name</label>
            <input
              type="text"
              className={inputCls}
              placeholder="e.g. Oberon Solar — ERCOT West"
              value={form.fleetName}
              onChange={(e) => set('fleetName', e.target.value)}
              required
            />
          </div>

          {/* Machine Count + Model (side by side) */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Number of Machines</label>
              <input
                type="number"
                className={inputCls}
                placeholder="e.g. 960"
                min="1"
                value={form.machineCount}
                onChange={(e) => set('machineCount', e.target.value)}
                required
              />
            </div>
            <div>
              <label className={labelCls}>Machine Model</label>
              <select
                className={inputCls}
                value={form.machineModel}
                onChange={(e) => set('machineModel', e.target.value)}
                required
              >
                {MACHINE_MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Breakeven + Threshold (side by side) */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Breakeven Price $/MWh</label>
              <input
                type="number"
                className={inputCls}
                placeholder="e.g. 41.30"
                step="0.01"
                min="0"
                value={form.breakevenPrice}
                onChange={(e) => set('breakevenPrice', e.target.value)}
                required
              />
            </div>
            <div>
              <label className={labelCls}>Auto-curtail Threshold $/MWh</label>
              <input
                type="number"
                className={inputCls}
                placeholder="e.g. 38.00"
                step="0.01"
                min="0"
                value={form.curtailThreshold}
                onChange={(e) => set('curtailThreshold', e.target.value)}
                required
              />
            </div>
          </div>

          {/* HubSpot Zone ID (optional) */}
          <div>
            <label className={labelCls}>HubSpot Zone ID <span className="font-normal text-terminal-muted">(optional)</span></label>
            <input
              type="text"
              className={inputCls}
              placeholder="e.g. HB_NORTH"
              value={form.hubspotZoneId}
              onChange={(e) => set('hubspotZoneId', e.target.value)}
            />
          </div>

          {/* Error */}
          {error && (
            <div className="text-[12px] text-[#c0392b] bg-[#fdf0ef] border border-[#f5c6c0] rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-[12px] font-semibold text-terminal-muted bg-terminal-panel border border-terminal-border rounded-lg hover:bg-[#f5f4f0] transition-colors font-heading"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-[12px] font-semibold text-white bg-[#1a6b3c] border border-[#1a6b3c] rounded-lg hover:opacity-90 transition-all disabled:opacity-50 font-heading"
            >
              {saving ? 'Saving...' : 'Connect Fleet'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Connected Dashboard View ───────────────────────────────────────────────

function ConnectedDashboard({ config }) {
  const [timeRange, setTimeRange] = useState('24H');
  const node = config.hubspotZoneId || 'HB_NORTH';

  return (
    <div className="p-6 lg:px-7 lg:py-6">
      {/* Fleet Connected Banner */}
      <div className="border border-[#1a6b3c]/30 rounded-[14px] overflow-hidden mb-5" style={{ background: 'linear-gradient(135deg, var(--t-panel), #edf7f0)' }}>
        <div className="px-[18px] py-[14px] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-[#2dd478] animate-pulse" />
            <div>
              <span className="text-[13px] font-semibold text-terminal-text">{config.fleetName}</span>
              <span className="text-[11px] text-terminal-muted ml-2">Fleet connected</span>
            </div>
          </div>
          <span className="text-[11px] text-terminal-muted">
            {config.machineCount} x {config.machineModel}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-terminal-border border-t border-terminal-border">
          <div className="bg-terminal-panel px-[18px] py-3">
            <div className="text-[10px] font-bold text-terminal-muted uppercase tracking-[0.8px] font-heading">Machines</div>
            <div className="text-lg font-bold text-terminal-text tabular-nums font-display">{config.machineCount}</div>
          </div>
          <div className="bg-terminal-panel px-[18px] py-3">
            <div className="text-[10px] font-bold text-terminal-muted uppercase tracking-[0.8px] font-heading">Model</div>
            <div className="text-lg font-bold text-terminal-text font-display">{config.machineModel}</div>
          </div>
          <div className="bg-terminal-panel px-[18px] py-3">
            <div className="text-[10px] font-bold text-terminal-muted uppercase tracking-[0.8px] font-heading">Breakeven</div>
            <div className="text-lg font-bold text-[#b8860b] tabular-nums font-display">${config.breakevenPrice}<span className="text-[11px] font-medium text-terminal-muted ml-0.5">/MWh</span></div>
          </div>
          <div className="bg-terminal-panel px-[18px] py-3">
            <div className="text-[10px] font-bold text-terminal-muted uppercase tracking-[0.8px] font-heading">Auto-curtail</div>
            <div className="text-lg font-bold text-[#1a6b3c] tabular-nums font-display">${config.curtailThreshold}<span className="text-[11px] font-medium text-terminal-muted ml-0.5">/MWh</span></div>
          </div>
        </div>
      </div>

      {/* Top bar */}
      <div className="flex items-center justify-end gap-2 mb-5">
        {['1H', '24H', '7D', '30D'].map(r => (
          <button
            key={r}
            onClick={() => setTimeRange(r)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all font-heading ${
              timeRange === r
                ? 'bg-terminal-text text-white border-terminal-text'
                : 'bg-terminal-panel text-terminal-muted border-terminal-border hover:bg-[#f5f4f0]'
            }`}
          >
            {r}
          </button>
        ))}
        <div className="w-px h-5 bg-terminal-border mx-1" />
        <button
          onClick={() => alert('Backtest initiated — analyzing last 30 days of ERCOT pricing against curtailment decisions.')}
          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-terminal-green text-white border border-terminal-green hover:opacity-90 transition-all font-heading"
        >
          Run Backtest
        </button>
        <button
          onClick={() => alert('All curtailment recommendations paused. Resume manually when ready.')}
          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-[#c0392b] text-white border border-[#c0392b] hover:opacity-90 transition-all font-heading"
        >
          Pause All
        </button>
      </div>

      {/* ERCOT LMP Integration */}
      <LmpTicker node={node} ppaRate={config.breakevenPrice} />
      <IntradayChart node={node} />
      <LmpHeatmap node={node} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <NodeComparison />
        <LmpStats node={node} />
      </div>

      {/* Fleet Config Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <Card title="Fleet Configuration" meta="Current">
          <KVRow label="Fleet Name" value={config.fleetName} />
          <KVRow label="Machine Model" value={config.machineModel} />
          <KVRow label="Machine Count" value={String(config.machineCount)} />
          <KVRow label="Breakeven Price" value={`$${config.breakevenPrice}/MWh`} cls="warn" />
          <KVRow label="Auto-curtail Threshold" value={`$${config.curtailThreshold}/MWh`} cls="green" />
          <KVRow label="ERCOT Account" value={config.ercotAccountId} />
          <KVRow label="Zone" value={config.hubspotZoneId || 'Not set'} cls={config.hubspotZoneId ? '' : 'warn'} last />
        </Card>

        <Card title="Agent Status" meta="Curtailment Engine">
          <KVRow label="Mode" value="Copilot" cls="accent" />
          <KVRow label="Strategy" value="Peeling — least efficient first" cls="accent" />
          <KVRow label="ERCOT Node" value={node} />
          <KVRow label="Margin Threshold" value="5%" />
          <KVRow label="Data Feed" value="Awaiting ERCOT connection" cls="warn" last />
        </Card>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function CurtailmentDashboard() {
  const [fleetConfig, setFleetConfig] = useState(null);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const fetchConfig = useCallback(async () => {
    try {
      const token = sessionStorage.getItem('sangha_auth');
      const res = await fetch(`${API_BASE}/v1/tenant/fleet-config`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setConfigured(!!data.configured);
      if (data.configured) {
        setFleetConfig(data.config || data);
      }
    } catch {
      setConfigured(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
    const interval = setInterval(fetchConfig, 60_000);
    return () => clearInterval(interval);
  }, [fetchConfig]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-[13px] text-terminal-muted animate-pulse">Loading fleet configuration...</div>
      </div>
    );
  }

  if (!configured) {
    return (
      <div className="p-6 lg:px-7 lg:py-6">
        <EmptyState
          icon="zap"
          title="No fleet connected"
          subtitle="Connect your ERCOT account and fleet details to enable automated curtailment."
          ctaLabel="Connect Fleet"
          onCta={() => setShowModal(true)}
        />
        {showModal && (
          <FleetConfigModal
            onClose={() => setShowModal(false)}
            onSaved={() => {
              setShowModal(false);
              fetchConfig();
            }}
          />
        )}
      </div>
    );
  }

  return (
    <>
      <ConnectedDashboard config={fleetConfig} />
      {showModal && (
        <FleetConfigModal
          existing={fleetConfig}
          onClose={() => setShowModal(false)}
          onSaved={() => {
            setShowModal(false);
            fetchConfig();
          }}
        />
      )}
    </>
  );
}

import React, { useState, useEffect, useCallback } from 'react';
import EmptyState from '../ui/EmptyState';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const POOL_PROVIDERS = [
  'Foundry USA',
  'Luxor',
  'Braiins Pool',
  'ViaBTC',
  'F2Pool',
  'AntPool',
  'Ocean',
  'Other',
];

// ─── Helpers ────────────────────────────────────────────────────────────────

const VAL_CLS = {
  green: 'text-[#1a6b3c]', warn: 'text-[#b8860b]', danger: 'text-[#c0392b]',
  best: 'text-[#1a6b3c] font-bold', accent: 'text-[#1a6b3c]', muted: 'text-terminal-muted', '': 'text-terminal-text',
};

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

// ─── Pool Config Modal ──────────────────────────────────────────────────────

function PoolConfigModal({ onClose, onSaved }) {
  const [provider, setProvider] = useState('Foundry USA');
  const [apiKey, setApiKey] = useState('');
  const [workerPrefix, setWorkerPrefix] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [subAccount, setSubAccount] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!apiKey.trim()) { setError('API Key is required'); return; }
    if (!workerPrefix.trim()) { setError('Worker Prefix is required'); return; }
    if (!walletAddress.trim()) { setError('Wallet Address is required'); return; }

    setLoading(true);
    try {
      const session = JSON.parse(sessionStorage.getItem('sangha_auth') || '{}');
      const res = await fetch(`${API_BASE}/v1/tenant/pool-config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.tokens?.accessToken}`,
        },
        body: JSON.stringify({
          provider,
          apiKey: apiKey.trim(),
          workerPrefix: workerPrefix.trim(),
          walletAddress: walletAddress.trim(),
          subAccount: subAccount.trim() || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save pool configuration');

      onSaved(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000,
      fontFamily: "'Instrument Sans', sans-serif",
    }}>
      <div style={{
        background: '#fff', borderRadius: 20, padding: 32, width: '100%', maxWidth: 440,
        boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
      }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#111110', marginBottom: 4 }}>
          Connect Mining Pool
        </div>
        <div style={{ fontSize: 13, color: '#9a9a92', marginBottom: 24 }}>
          Enter your pool API credentials to enable hashrate routing and fee optimization.
        </div>

        {error && (
          <div style={{
            marginBottom: 16, padding: '10px 14px', borderRadius: 10,
            background: '#fbeae8', color: '#c0392b', fontSize: 13,
            border: '1px solid rgba(192,57,43,0.15)',
          }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Pool Provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              style={{ ...inputStyle, cursor: 'pointer' }}
            >
              {POOL_PROVIDERS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>API Key</label>
            <input
              type="password" value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              required placeholder="Enter pool API key"
              style={inputStyle}
              autoFocus
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Worker Prefix</label>
            <input
              type="text" value={workerPrefix}
              onChange={(e) => setWorkerPrefix(e.target.value)}
              required placeholder="e.g. sangha-site01"
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>Wallet Address</label>
            <input
              type="text" value={walletAddress}
              onChange={(e) => setWalletAddress(e.target.value)}
              required placeholder="BTC wallet address"
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={labelStyle}>
              Sub-account Name
              <span style={{ fontWeight: 400, color: '#9a9a92', marginLeft: 6 }}>(optional)</span>
            </label>
            <input
              type="text" value={subAccount}
              onChange={(e) => setSubAccount(e.target.value)}
              placeholder="e.g. main, worker-group-1"
              style={inputStyle}
            />
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={onClose} style={{
              flex: 1, padding: 13, borderRadius: 12, background: '#f5f4f0',
              color: '#6b6b65', fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
              border: '1.5px solid #e8e6e1', cursor: 'pointer', transition: 'all 0.2s',
            }}>
              Cancel
            </button>
            <button type="submit" disabled={loading} style={{
              flex: 2, padding: 13, borderRadius: 12, background: '#1a6b3c',
              color: '#fff', fontFamily: 'inherit', fontSize: 14, fontWeight: 600,
              border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.5 : 1, transition: 'all 0.2s',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              {loading && (
                <div style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
              )}
              Connect Pool
            </button>
          </div>
        </form>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

const labelStyle = {
  fontSize: 12, fontWeight: 600, color: '#333330', marginBottom: 6, display: 'block',
};

const inputStyle = {
  width: '100%', padding: '12px 16px', border: '1.5px solid #e8e6e1',
  borderRadius: 12, fontFamily: "'Instrument Sans', sans-serif", fontSize: 14,
  color: '#111110', background: '#ffffff', outline: 'none', transition: 'all 0.2s',
  boxSizing: 'border-box',
};

// ─── Main Component ─────────────────────────────────────────────────────────

export default function PoolRoutingDashboard() {
  const [poolConfig, setPoolConfig] = useState(null);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const fetchConfig = useCallback(async () => {
    try {
      const session = JSON.parse(sessionStorage.getItem('sangha_auth') || '{}');
      const res = await fetch(`${API_BASE}/v1/tenant/pool-config`, {
        headers: {
          Authorization: `Bearer ${session?.tokens?.accessToken}`,
        },
      });
      if (!res.ok) {
        setConfigured(false);
        setPoolConfig(null);
        return;
      }
      const data = await res.json();
      setConfigured(!!data.configured);
      setPoolConfig(data.configured ? data : null);
    } catch {
      setConfigured(false);
      setPoolConfig(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
    const interval = setInterval(fetchConfig, 60_000);
    return () => clearInterval(interval);
  }, [fetchConfig]);

  const handleSaved = (data) => {
    setShowModal(false);
    setConfigured(true);
    setPoolConfig(data);
  };

  if (loading) {
    return (
      <div className="p-6 lg:px-7 lg:py-6 flex items-center justify-center" style={{ minHeight: 300 }}>
        <div className="text-terminal-muted text-sm">Loading pool configuration...</div>
      </div>
    );
  }

  // ─── Empty State (no pool configured) ───────────────────────────────────

  if (!configured) {
    return (
      <div className="p-6 lg:px-7 lg:py-6">
        <Card title="Pool Routing" meta="Not configured">
          <EmptyState
            icon="database"
            title="No pool connected"
            subtitle="Connect your mining pool to enable hashrate routing and fee optimization."
            ctaLabel="Connect Pool"
            onCta={() => setShowModal(true)}
          />
        </Card>
        {showModal && (
          <PoolConfigModal
            onClose={() => setShowModal(false)}
            onSaved={handleSaved}
          />
        )}
      </div>
    );
  }

  // ─── Connected State ────────────────────────────────────────────────────

  const cfg = poolConfig || {};

  // Mask the API key for display
  const maskedKey = cfg.apiKey
    ? cfg.apiKey.slice(0, 4) + '••••••••' + cfg.apiKey.slice(-4)
    : '••••••••';

  return (
    <div className="p-6 lg:px-7 lg:py-6">
      {/* Connected Banner */}
      <div className="bg-[#edf7f0] border border-[rgba(26,107,60,0.2)] rounded-[14px] p-[18px_22px] mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-[#1a6b3c] animate-pulse shrink-0" />
          <div>
            <div className="text-sm font-bold text-terminal-text font-heading">
              Pool connected — {cfg.provider || 'Unknown'}
            </div>
            <div className="text-[11px] text-terminal-muted mt-0.5 font-mono">
              Worker: {cfg.workerPrefix || '—'} · Wallet: {cfg.walletAddress ? cfg.walletAddress.slice(0, 8) + '...' + cfg.walletAddress.slice(-6) : '—'}
              {cfg.subAccount ? ` · Sub-account: ${cfg.subAccount}` : ''}
            </div>
          </div>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-terminal-panel text-terminal-muted border border-terminal-border hover:bg-[#f5f4f0] transition-all font-heading"
        >
          Edit Config
        </button>
      </div>

      {/* Pool Configuration Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <Card title="Pool Configuration" meta={cfg.provider || ''}>
          <KVRow label="Provider" value={cfg.provider || '—'} cls="accent" />
          <KVRow label="API Key" value={maskedKey} />
          <KVRow label="Worker Prefix" value={cfg.workerPrefix || '—'} />
          <KVRow label="Wallet Address" value={cfg.walletAddress ? cfg.walletAddress.slice(0, 12) + '...' + cfg.walletAddress.slice(-6) : '—'} />
          <KVRow label="Sub-account" value={cfg.subAccount || 'None'} cls={cfg.subAccount ? '' : 'muted'} last />
        </Card>

        <Card title="Connection Status" meta="Live">
          <KVRow label="Status" value="Connected" cls="green" />
          <KVRow label="Provider" value={cfg.provider || '—'} />
          <KVRow label="Last Sync" value={cfg.lastSync ? new Date(cfg.lastSync).toLocaleString() : 'Pending'} cls={cfg.lastSync ? '' : 'muted'} />
          <KVRow label="Polling Interval" value="60s" />
          <KVRow label="API Health" value={cfg.apiHealthy !== false ? 'OK' : 'Degraded'} cls={cfg.apiHealthy !== false ? 'green' : 'warn'} last />
        </Card>
      </div>

      {showModal && (
        <PoolConfigModal
          onClose={() => setShowModal(false)}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}

import React, { useState } from 'react';
import { Bell, Plus, Trash2, Check, X, Send } from 'lucide-react';
import { useApi, postApi, deleteApi, putApi } from '../hooks/useApi';
import { formatDate, formatNumber } from '../utils/formatters';

const METRICS = [
  { value: 'hashprice', label: 'Hashprice ($/TH/s/day)' },
  { value: 'btc_price', label: 'BTC Price (USD)' },
  { value: 'eu_us_ratio', label: 'EU/US Tech Ratio' },
  { value: 'jgb_10y', label: 'JGB 10Y Yield (%)' },
  { value: 'uranium_spot', label: 'Uranium Spot ($/lb)' },
  { value: 'ndpr_price', label: 'NdPr Price ($/kg)' },
  { value: 'ewz_spy_ratio', label: 'EWZ/SPY Ratio' },
  { value: 'glw_qqq_ratio', label: 'GLW/QQQ Ratio' },
  { value: 'iran_hashrate_share', label: 'Iran Hashrate Share (%)' },
  // Phase 5: Pool & On-Chain
  { value: 'pool_hashrate_drop', label: 'Pool Hashrate Drop (%)' },
  { value: 'pool_reject_rate', label: 'Pool Reject Rate (%)' },
  { value: 'worker_dead_count', label: 'Dead Workers (#)' },
  { value: 'mempool_fee_rate', label: 'Mempool Fee Rate (sat/vB)' },
  { value: 'fee_revenue_pct', label: 'Fee Revenue % of Block' },
  { value: 'pool_luck', label: 'Pool Luck (%)' },
];

const CONDITIONS = [
  { value: 'above', label: 'Above' },
  { value: 'below', label: 'Below' },
  { value: 'crosses_above', label: 'Crosses Above' },
  { value: 'crosses_below', label: 'Crosses Below' }
];

export default function AlertsPanel() {
  const [showAddModal, setShowAddModal] = useState(false);

  const { data, loading, refetch } = useApi('/alerts');
  const { data: historyData } = useApi('/alerts/history');

  const alerts = data?.alerts || [];
  const history = historyData?.history || [];

  const handleDelete = async (id) => {
    if (!confirm('Delete this alert?')) return;
    try {
      await deleteApi(`/alerts/${id}`);
      refetch();
    } catch (err) {
      alert('Failed to delete: ' + err.message);
    }
  };

  const handleToggle = async (id, enabled) => {
    try {
      await putApi(`/alerts/${id}`, { enabled: enabled ? 0 : 1 });
      refetch();
    } catch (err) {
      alert('Failed to update: ' + err.message);
    }
  };

  const handleCheck = async () => {
    try {
      const result = await postApi('/alerts/check', {});
      if (result.triggered > 0) {
        alert(`${result.triggered} alert(s) triggered!`);
        // Show browser notification
        if ('Notification' in window && Notification.permission === 'granted') {
          result.alerts.forEach(a => {
            new Notification('Thesis Dashboard Alert', {
              body: `${a.alert.metric}: ${a.value} (threshold: ${a.alert.threshold})`,
              icon: '/favicon.svg'
            });
          });
        }
      } else {
        alert('No alerts triggered');
      }
    } catch (err) {
      alert('Failed to check alerts: ' + err.message);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-terminal-panel border border-terminal-border rounded-lg">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-terminal-border">
          <div className="flex items-center gap-2">
            <Bell className="text-terminal-green" size={20} />
            <h2 className="text-lg font-bold">Alert Configuration</h2>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCheck}
              className="flex items-center gap-2 px-3 py-1.5 text-sm border border-terminal-border rounded hover:bg-terminal-border"
            >
              <Send size={14} />
              Check Now
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-terminal-green/20 border border-terminal-green/30 text-terminal-green rounded hover:bg-terminal-green/30"
            >
              <Plus size={14} />
              Add Alert
            </button>
          </div>
        </div>

        {/* Active Alerts */}
        <div className="p-4">
          <h3 className="text-sm text-terminal-muted uppercase mb-3">Active Alerts</h3>

          {loading ? (
            <div className="flex justify-center py-8">
              <div className="spinner w-6 h-6" />
            </div>
          ) : alerts.length === 0 ? (
            <p className="text-terminal-muted text-center py-8">
              No alerts configured. Click "Add Alert" to create one.
            </p>
          ) : (
            <div className="space-y-2">
              {alerts.map((alert) => (
                <div
                  key={alert.id}
                  className={`flex items-center justify-between p-3 rounded border ${
                    alert.enabled ? 'border-terminal-green/30 bg-terminal-green/5' : 'border-terminal-border bg-terminal-bg/50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleToggle(alert.id, alert.enabled)}
                      className={`w-6 h-6 rounded border flex items-center justify-center ${
                        alert.enabled
                          ? 'bg-terminal-green/20 border-terminal-green text-terminal-green'
                          : 'border-terminal-muted text-terminal-muted'
                      }`}
                    >
                      {alert.enabled ? <Check size={14} /> : <X size={14} />}
                    </button>
                    <div>
                      <p className="font-medium">
                        {METRICS.find(m => m.value === alert.metric)?.label || alert.metric}
                      </p>
                      <p className="text-sm text-terminal-muted">
                        {CONDITIONS.find(c => c.value === alert.condition)?.label} {formatNumber(alert.threshold, 4)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {alert.last_triggered && (
                      <span className="text-xs text-terminal-amber">
                        Last: {formatDate(alert.last_triggered)}
                      </span>
                    )}
                    <button
                      onClick={() => handleDelete(alert.id)}
                      className="p-1.5 text-terminal-red hover:bg-terminal-red/10 rounded"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Alert History */}
        <div className="border-t border-terminal-border p-4">
          <h3 className="text-sm text-terminal-muted uppercase mb-3">Alert History</h3>

          {history.length === 0 ? (
            <p className="text-terminal-muted text-center py-4">No alerts triggered yet.</p>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {history.slice(0, 20).map((h, i) => (
                <div key={i} className="flex justify-between text-sm bg-terminal-bg/50 rounded p-2">
                  <div>
                    <span className="font-medium">{h.metric}</span>
                    <span className="text-terminal-muted mx-2">{h.condition} {h.threshold}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-terminal-amber">{formatNumber(h.value, 4)}</span>
                    <span className="text-terminal-muted ml-2">{formatDate(h.triggered_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Add Alert Modal */}
      {showAddModal && (
        <AddAlertModal onClose={() => setShowAddModal(false)} onSuccess={refetch} />
      )}
    </div>
  );
}

function AddAlertModal({ onClose, onSuccess }) {
  const [form, setForm] = useState({
    metric: 'hashprice',
    condition: 'below',
    threshold: '',
    webhook_url: ''
  });
  const [saving, setSaving] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await postApi('/alerts', form);
      onSuccess();
      onClose();
    } catch (err) {
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleTestWebhook = async () => {
    if (!form.webhook_url) return;
    setTestingWebhook(true);
    try {
      const result = await postApi('/alerts/test-webhook', { url: form.webhook_url });
      alert(result.success ? 'Webhook test successful!' : 'Webhook test failed');
    } catch (err) {
      alert('Webhook test failed: ' + err.message);
    } finally {
      setTestingWebhook(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-terminal-panel border border-terminal-border rounded-lg p-6 w-full max-w-md">
        <h3 className="text-lg font-bold mb-4">Add Alert</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-terminal-muted mb-1">Metric</label>
            <select
              value={form.metric}
              onChange={(e) => setForm({ ...form, metric: e.target.value })}
              className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm"
            >
              {METRICS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-terminal-muted mb-1">Condition</label>
              <select
                value={form.condition}
                onChange={(e) => setForm({ ...form, condition: e.target.value })}
                className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm"
              >
                {CONDITIONS.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-terminal-muted mb-1">Threshold</label>
              <input
                type="number"
                step="any"
                value={form.threshold}
                onChange={(e) => setForm({ ...form, threshold: e.target.value })}
                className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm"
                placeholder="0.04"
                required
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-terminal-muted mb-1">Webhook URL (optional)</label>
            <div className="flex gap-2">
              <input
                type="url"
                value={form.webhook_url}
                onChange={(e) => setForm({ ...form, webhook_url: e.target.value })}
                className="flex-1 bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm"
                placeholder="https://discord.com/api/webhooks/..."
              />
              <button
                type="button"
                onClick={handleTestWebhook}
                disabled={!form.webhook_url || testingWebhook}
                className="px-3 py-2 border border-terminal-border rounded hover:bg-terminal-border disabled:opacity-50 text-sm"
              >
                {testingWebhook ? '...' : 'Test'}
              </button>
            </div>
            <p className="text-xs text-terminal-muted mt-1">
              Discord, Slack, or Telegram webhook URL
            </p>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-terminal-border rounded hover:bg-terminal-border"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-terminal-green/20 border border-terminal-green/30 text-terminal-green rounded hover:bg-terminal-green/30 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Add Alert'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

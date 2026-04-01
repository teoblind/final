import React, { useState, useEffect, Suspense } from 'react';
import { DollarSign, FileText, CreditCard, RefreshCw, CheckCircle, AlertCircle, Clock, TrendingUp, ArrowUpRight, ArrowDownLeft, Settings, Link2, Unlink } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || `${window.location.origin}/api`;

function LoadingSpinner() {
  return <div className="flex items-center justify-center py-24"><div className="spinner w-10 h-10" /></div>;
}

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'invoices', label: 'Invoices' },
  { id: 'bills', label: 'Bills' },
  { id: 'payments', label: 'Payments' },
  { id: 'settings', label: 'Settings' },
];

function Card({ title, meta, children, className = '' }) {
  return (
    <div className={`bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden ${className}`}>
      <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
        <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">{title}</span>
        {meta && <span className="text-[11px] text-terminal-muted">{meta}</span>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function StatCard({ label, value, sub, icon: Icon, color = '#1a6b3c' }) {
  return (
    <div className="bg-terminal-panel border border-terminal-border rounded-[14px] p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-terminal-muted font-semibold uppercase tracking-wide">{label}</span>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: color + '15' }}>
          <Icon size={14} style={{ color }} />
        </div>
      </div>
      <div className="text-xl font-bold text-terminal-text tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-terminal-muted mt-0.5">{sub}</div>}
    </div>
  );
}

function StatusBadge({ status }) {
  const colors = {
    paid: 'bg-[#dcfce7] text-[#166534]',
    open: 'bg-[#dbeafe] text-[#1e40af]',
    overdue: 'bg-[#fee2e2] text-[#991b1b]',
    partial: 'bg-[#fef3c7] text-[#92400e]',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${colors[status] || colors.open}`}>
      {status}
    </span>
  );
}

function fmt(amount) {
  return '$' + (amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Overview Tab ────────────────────────────────────────────────────────────

function OverviewTab({ stats, loading }) {
  if (loading) return <LoadingSpinner />;

  return (
    <div className="p-6 space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Receivable" value={fmt(stats.invoices?.totalDue)} sub={`${stats.invoices?.total || 0} invoices`} icon={ArrowDownLeft} color="#1a6b3c" />
        <StatCard label="Total Payable" value={fmt(stats.bills?.totalDue)} sub={`${stats.bills?.total || 0} bills`} icon={ArrowUpRight} color="#dc2626" />
        <StatCard label="Overdue Invoices" value={stats.invoices?.overdue || 0} sub={fmt(stats.invoices?.overdueAmount)} icon={AlertCircle} color="#f59e0b" />
        <StatCard label="Payments Received" value={fmt(stats.payments?.received?.amount)} sub={`${stats.payments?.received?.count || 0} payments`} icon={CheckCircle} color="#3b82f6" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card title="Connections" meta="Status">
          <div className="divide-y divide-[#f0eeea]">
            <div className="flex items-center justify-between px-[18px] py-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-[#2CA01C15] flex items-center justify-center">
                  <span className="text-[10px] font-bold text-[#2CA01C]">QB</span>
                </div>
                <span className="text-[13px] font-medium">QuickBooks</span>
              </div>
              {stats.connections?.quickbooks
                ? <span className="flex items-center gap-1 text-[11px] text-[#1a6b3c] font-semibold"><CheckCircle size={12} /> Connected</span>
                : <span className="flex items-center gap-1 text-[11px] text-terminal-muted"><Clock size={12} /> Not connected</span>
              }
            </div>
            <div className="flex items-center justify-between px-[18px] py-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded bg-[#00B9F115] flex items-center justify-center">
                  <span className="text-[10px] font-bold text-[#00B9F1]">BC</span>
                </div>
                <span className="text-[13px] font-medium">Bill.com</span>
              </div>
              {stats.connections?.billcom
                ? <span className="flex items-center gap-1 text-[11px] text-[#1a6b3c] font-semibold"><CheckCircle size={12} /> Connected</span>
                : <span className="flex items-center gap-1 text-[11px] text-terminal-muted"><Clock size={12} /> Not connected</span>
              }
            </div>
          </div>
        </Card>

        <Card title="Cash Flow Summary" meta="All time">
          <div className="divide-y divide-[#f0eeea]">
            <div className="flex items-center justify-between px-[18px] py-3 text-[13px]">
              <span className="text-[#6b6b65]">Invoiced</span>
              <span className="font-semibold tabular-nums">{fmt(stats.invoices?.totalAmount)}</span>
            </div>
            <div className="flex items-center justify-between px-[18px] py-3 text-[13px]">
              <span className="text-[#6b6b65]">Collected</span>
              <span className="font-semibold tabular-nums text-[#1a6b3c]">{fmt(stats.payments?.received?.amount)}</span>
            </div>
            <div className="flex items-center justify-between px-[18px] py-3 text-[13px]">
              <span className="text-[#6b6b65]">Bills Paid</span>
              <span className="font-semibold tabular-nums text-[#dc2626]">{fmt(stats.payments?.sent?.amount)}</span>
            </div>
            <div className="flex items-center justify-between px-[18px] py-3 text-[13px]">
              <span className="text-[#6b6b65]">Outstanding AR</span>
              <span className="font-semibold tabular-nums">{fmt(stats.invoices?.totalDue)}</span>
            </div>
            <div className="flex items-center justify-between px-[18px] py-3 text-[13px]">
              <span className="text-[#6b6b65]">Outstanding AP</span>
              <span className="font-semibold tabular-nums">{fmt(stats.bills?.totalDue)}</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── Table Tab (Invoices / Bills / Payments) ─────────────────────────────────

function TableTab({ type, data, loading }) {
  if (loading) return <LoadingSpinner />;

  if (type === 'invoices') {
    return (
      <div className="p-6">
        <Card title={`Invoices (${data.length})`} meta="All sources">
          {data.length === 0 ? (
            <div className="px-[18px] py-8 text-center text-[13px] text-terminal-muted">No invoices synced yet. Connect QuickBooks or Bill.com to get started.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[#f0eeea] text-left">
                    <th className="px-4 py-2.5 text-[11px] font-semibold text-terminal-muted uppercase tracking-wide">Invoice #</th>
                    <th className="px-4 py-2.5 text-[11px] font-semibold text-terminal-muted uppercase tracking-wide">Customer</th>
                    <th className="px-4 py-2.5 text-[11px] font-semibold text-terminal-muted uppercase tracking-wide text-right">Amount</th>
                    <th className="px-4 py-2.5 text-[11px] font-semibold text-terminal-muted uppercase tracking-wide text-right">Balance</th>
                    <th className="px-4 py-2.5 text-[11px] font-semibold text-terminal-muted uppercase tracking-wide">Due Date</th>
                    <th className="px-4 py-2.5 text-[11px] font-semibold text-terminal-muted uppercase tracking-wide">Status</th>
                    <th className="px-4 py-2.5 text-[11px] font-semibold text-terminal-muted uppercase tracking-wide">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((inv, i) => (
                    <tr key={inv.id} className={`border-b border-[#f0eeea] last:border-b-0 ${i % 2 === 1 ? 'bg-[#fafaf8]' : ''}`}>
                      <td className="px-4 py-2.5 font-mono text-xs">{inv.invoice_number}</td>
                      <td className="px-4 py-2.5">{inv.customer_name}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmt(inv.amount)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmt(inv.balance_due)}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{inv.due_date || '-'}</td>
                      <td className="px-4 py-2.5"><StatusBadge status={inv.status} /></td>
                      <td className="px-4 py-2.5 text-[11px] text-terminal-muted">{inv.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    );
  }

  if (type === 'bills') {
    return (
      <div className="p-6">
        <Card title={`Bills (${data.length})`} meta="All sources">
          {data.length === 0 ? (
            <div className="px-[18px] py-8 text-center text-[13px] text-terminal-muted">No bills synced yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[#f0eeea] text-left">
                    <th className="px-4 py-2.5 text-[11px] font-semibold text-terminal-muted uppercase tracking-wide">Bill #</th>
                    <th className="px-4 py-2.5 text-[11px] font-semibold text-terminal-muted uppercase tracking-wide">Vendor</th>
                    <th className="px-4 py-2.5 text-[11px] font-semibold text-terminal-muted uppercase tracking-wide text-right">Amount</th>
                    <th className="px-4 py-2.5 text-[11px] font-semibold text-terminal-muted uppercase tracking-wide text-right">Balance</th>
                    <th className="px-4 py-2.5 text-[11px] font-semibold text-terminal-muted uppercase tracking-wide">Due Date</th>
                    <th className="px-4 py-2.5 text-[11px] font-semibold text-terminal-muted uppercase tracking-wide">Status</th>
                    <th className="px-4 py-2.5 text-[11px] font-semibold text-terminal-muted uppercase tracking-wide">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((bill, i) => (
                    <tr key={bill.id} className={`border-b border-[#f0eeea] last:border-b-0 ${i % 2 === 1 ? 'bg-[#fafaf8]' : ''}`}>
                      <td className="px-4 py-2.5 font-mono text-xs">{bill.bill_number}</td>
                      <td className="px-4 py-2.5">{bill.vendor_name}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmt(bill.amount)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{fmt(bill.balance_due)}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{bill.due_date || '-'}</td>
                      <td className="px-4 py-2.5"><StatusBadge status={bill.status} /></td>
                      <td className="px-4 py-2.5 text-[11px] text-terminal-muted">{bill.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    );
  }

  // Payments
  return (
    <div className="p-6">
      <Card title={`Payments (${data.length})`} meta="All sources">
        {data.length === 0 ? (
          <div className="px-[18px] py-8 text-center text-[13px] text-terminal-muted">No payments synced yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[#f0eeea] text-left">
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-terminal-muted uppercase tracking-wide">Type</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-terminal-muted uppercase tracking-wide">Customer / Vendor</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-terminal-muted uppercase tracking-wide text-right">Amount</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-terminal-muted uppercase tracking-wide">Date</th>
                  <th className="px-4 py-2.5 text-[11px] font-semibold text-terminal-muted uppercase tracking-wide">Source</th>
                </tr>
              </thead>
              <tbody>
                {data.map((pmt, i) => (
                  <tr key={pmt.id} className={`border-b border-[#f0eeea] last:border-b-0 ${i % 2 === 1 ? 'bg-[#fafaf8]' : ''}`}>
                    <td className="px-4 py-2.5">
                      <span className={`flex items-center gap-1 text-xs font-semibold ${pmt.type === 'received' ? 'text-[#1a6b3c]' : 'text-[#dc2626]'}`}>
                        {pmt.type === 'received' ? <ArrowDownLeft size={12} /> : <ArrowUpRight size={12} />}
                        {pmt.type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">{pmt.customer_or_vendor}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{fmt(pmt.amount)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{pmt.payment_date || '-'}</td>
                    <td className="px-4 py-2.5 text-[11px] text-terminal-muted">{pmt.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Settings Tab ────────────────────────────────────────────────────────────

function SettingsTab({ qbConnected, billcomConnected, onConnectQB, onDisconnectQB }) {
  const [bcCreds, setBcCreds] = useState({ username: '', password: '', orgId: '', devKey: '' });
  const [saving, setSaving] = useState(false);

  const handleSaveBillcom = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem('auth_token');
      // Store each credential in key_vault via the admin endpoint
      for (const [key, value] of Object.entries(bcCreds)) {
        if (!value) continue;
        await fetch(`${API_BASE}/v1/admin/key-vault`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ service: 'billcom', keyName: key === 'orgId' ? 'org_id' : key === 'devKey' ? 'dev_key' : key, keyValue: value }),
        });
      }
      alert('Bill.com credentials saved');
    } catch (err) {
      alert('Error saving credentials: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const [showGuide, setShowGuide] = useState(false);

  return (
    <div className="p-6 space-y-5">
      <Card title="QuickBooks Online" meta={qbConnected ? 'Connected' : 'Not connected'}>
        <div className="px-[18px] py-4">
          {qbConnected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 px-3 py-2.5 bg-[#dcfce7] rounded-lg">
                <CheckCircle size={14} className="text-[#166534]" />
                <span className="text-[13px] font-medium text-[#166534]">QuickBooks connected - syncing every 15 minutes</span>
              </div>
              <button
                onClick={() => onDisconnectQB?.()}
                className="px-4 py-2 rounded-lg text-[12px] font-semibold text-terminal-red border border-terminal-border hover:bg-red-50 transition-colors"
              >
                Disconnect QuickBooks
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 px-3 py-2.5 bg-[#fef3c7] rounded-lg">
                <AlertCircle size={14} className="text-[#92400e]" />
                <span className="text-[13px] font-medium text-[#92400e]">Not connected - click below to authorize QuickBooks access</span>
              </div>
              <p className="text-[12px] text-terminal-muted">
                Clicking Connect will open Intuit's authorization page where you'll log in and select which QuickBooks company to link. Coppice will sync invoices, bills, and payments every 15 minutes.
              </p>
              <button
                onClick={() => onConnectQB?.()}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-[13px] font-semibold text-white bg-[#2ca01c] hover:bg-[#259016] transition-colors"
              >
                <span className="text-[16px]">QB</span>
                Connect QuickBooks
              </button>
            </div>
          )}
        </div>
      </Card>

      <Card title="Bill.com Integration" meta={billcomConnected ? 'Connected' : 'Not connected'}>
        <div className="px-[18px] py-4 space-y-4">
          {billcomConnected ? (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-[#dcfce7] rounded-lg">
              <CheckCircle size={14} className="text-[#166534]" />
              <span className="text-[13px] font-medium text-[#166534]">Bill.com connected - syncing every 15 minutes</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-[#fef3c7] rounded-lg">
              <AlertCircle size={14} className="text-[#92400e]" />
              <span className="text-[13px] font-medium text-[#92400e]">Not connected - enter your Bill.com credentials below to start syncing</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-terminal-muted mb-1">Email (Bill.com login)</label>
              <input type="text" value={bcCreds.username} onChange={e => setBcCreds(p => ({ ...p, username: e.target.value }))}
                placeholder="mihir@sanghasystems.com"
                className="w-full px-3 py-2 text-[13px] border border-terminal-border rounded-lg bg-[#f5f4f0] focus:bg-terminal-panel outline-none placeholder:text-[#c5c5bc]" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-terminal-muted mb-1">Password</label>
              <input type="password" value={bcCreds.password} onChange={e => setBcCreds(p => ({ ...p, password: e.target.value }))}
                placeholder="Your Bill.com password"
                className="w-full px-3 py-2 text-[13px] border border-terminal-border rounded-lg bg-[#f5f4f0] focus:bg-terminal-panel outline-none placeholder:text-[#c5c5bc]" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-terminal-muted mb-1">Organization ID</label>
              <input type="text" value={bcCreds.orgId} onChange={e => setBcCreds(p => ({ ...p, orgId: e.target.value }))}
                placeholder="e.g. 00e1234ABC"
                className="w-full px-3 py-2 text-[13px] border border-terminal-border rounded-lg bg-[#f5f4f0] focus:bg-terminal-panel outline-none placeholder:text-[#c5c5bc] font-mono" />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-terminal-muted mb-1">Developer Key</label>
              <input type="text" value={bcCreds.devKey} onChange={e => setBcCreds(p => ({ ...p, devKey: e.target.value }))}
                placeholder="Generated from Bill.com settings"
                className="w-full px-3 py-2 text-[13px] border border-terminal-border rounded-lg bg-[#f5f4f0] focus:bg-terminal-panel outline-none placeholder:text-[#c5c5bc] font-mono" />
            </div>
          </div>

          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowGuide(v => !v)}
              className="text-[12px] font-semibold text-[#3b82f6] hover:text-[#2563eb] transition-colors"
            >
              {showGuide ? 'Hide setup guide' : 'Where do I find these?'}
            </button>
            <button
              onClick={handleSaveBillcom}
              disabled={saving || !bcCreds.username || !bcCreds.password || !bcCreds.orgId || !bcCreds.devKey}
              className="px-4 py-2 rounded-lg text-[12px] font-semibold text-white bg-terminal-text hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              {saving ? 'Saving...' : 'Save & Connect'}
            </button>
          </div>
        </div>
      </Card>

      {showGuide && (
        <Card title="Setup Guide" meta="4 steps">
          <div className="px-[18px] py-4 space-y-4">
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-[#1e3a5f] text-white flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5">1</div>
              <div>
                <p className="text-[13px] font-semibold text-terminal-text">Email & Password</p>
                <p className="text-[12px] text-terminal-muted mt-0.5">Use the same email and password you log into Bill.com with. This account must have Administrator access.</p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-[#1e3a5f] text-white flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5">2</div>
              <div>
                <p className="text-[13px] font-semibold text-terminal-text">Find your Organization ID</p>
                <p className="text-[12px] text-terminal-muted mt-0.5">
                  Log into Bill.com. Go to <strong>Settings</strong> (gear icon) → <strong>Organization</strong>. Your Org ID starts with <code className="px-1 py-0.5 bg-[#f5f4f0] rounded text-[11px] font-mono">00e</code> and appears near the top of the page.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-[#1e3a5f] text-white flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5">3</div>
              <div>
                <p className="text-[13px] font-semibold text-terminal-text">Generate a Developer Key</p>
                <p className="text-[12px] text-terminal-muted mt-0.5">
                  In Bill.com, go to <strong>Settings</strong> → <strong>Sync & Integrations</strong> → <strong>Manage Developer Keys</strong>. Click <strong>Generate Key</strong>. Copy the key and paste it here. You can generate up to 4 keys per organization.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-[#1e3a5f] text-white flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5">4</div>
              <div>
                <p className="text-[13px] font-semibold text-terminal-text">Save & Connect</p>
                <p className="text-[12px] text-terminal-muted mt-0.5">
                  Fill in all 4 fields above and click <strong>Save & Connect</strong>. Coppice will immediately sync your invoices, bills, and payments. Data refreshes automatically every 15 minutes.
                </p>
              </div>
            </div>

            <div className="px-3 py-2.5 bg-[#f5f4f0] rounded-lg">
              <p className="text-[11px] text-terminal-muted">
                <strong>Security:</strong> Credentials are encrypted and stored in Coppice's secure key vault. They are only used to authenticate with Bill.com's API and are never shared or exposed.
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────

export default function AccountingDashboard() {
  const [activeTab, setActiveTab] = useState('overview');
  const [stats, setStats] = useState({});
  const [invoices, setInvoices] = useState([]);
  const [bills, setBills] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const token = localStorage.getItem('auth_token');
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const fetchData = async () => {
    setLoading(true);
    try {
      const [statsRes, invRes, billRes, pmtRes] = await Promise.all([
        fetch(`${API_BASE}/v1/accounting/stats`, { headers }),
        fetch(`${API_BASE}/v1/accounting/invoices`, { headers }),
        fetch(`${API_BASE}/v1/accounting/bills`, { headers }),
        fetch(`${API_BASE}/v1/accounting/payments`, { headers }),
      ]);
      const [statsData, invData, billData, pmtData] = await Promise.all([
        statsRes.json(), invRes.json(), billRes.json(), pmtRes.json(),
      ]);
      setStats(statsData);
      setInvoices(invData.invoices || []);
      setBills(billData.bills || []);
      setPayments(pmtData.payments || []);
    } catch (err) {
      console.error('Accounting fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch(`${API_BASE}/v1/accounting/sync`, { method: 'POST', headers });
      await fetchData();
    } catch (err) {
      console.error('Sync error:', err);
    } finally {
      setSyncing(false);
    }
  };

  const handleConnectQB = () => {
    const session = JSON.parse(sessionStorage.getItem('sangha_auth') || '{}');
    const authToken = session?.tokens?.accessToken || token;
    if (!authToken) return;

    const url = `${window.location.origin}/api/v1/auth/intuit/integrate?token=${encodeURIComponent(authToken)}`;
    const popup = window.open(url, 'qb-oauth', 'width=600,height=700,scrollbars=yes');

    const handleMessage = (event) => {
      if (event.data?.type === 'oauth-integration-success' && event.data?.source === 'intuit-quickbooks') {
        window.removeEventListener('message', handleMessage);
        fetchData();
      }
    };
    window.addEventListener('message', handleMessage);
  };

  const handleDisconnectQB = async () => {
    if (!confirm('Disconnect QuickBooks? Synced data will be preserved.')) return;
    try {
      await fetch(`${API_BASE}/v1/auth/intuit/disconnect`, { method: 'DELETE', headers });
      fetchData();
    } catch (err) {
      console.error('Disconnect error:', err);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex items-center gap-1 px-5 py-2 border-b border-terminal-border bg-terminal-panel shrink-0">
        <div className="flex items-center gap-1.5 mr-4">
          <div className="w-6 h-6 rounded-lg bg-[#1e3a5f] flex items-center justify-center">
            <DollarSign size={12} className="text-white" />
          </div>
          <span className="text-[13px] font-semibold text-terminal-text">Accounting</span>
        </div>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
              activeTab === tab.id
                ? 'bg-[#1e3a5f] text-white'
                : 'text-terminal-muted hover:bg-[#f5f4f0] hover:text-terminal-text'
            }`}
          >
            {tab.label}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-terminal-muted hover:bg-[#f5f4f0] hover:text-terminal-text transition-colors disabled:opacity-40"
        >
          <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Syncing...' : 'Sync Now'}
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'overview' && <OverviewTab stats={stats} loading={loading} />}
        {activeTab === 'invoices' && <TableTab type="invoices" data={invoices} loading={loading} />}
        {activeTab === 'bills' && <TableTab type="bills" data={bills} loading={loading} />}
        {activeTab === 'payments' && <TableTab type="payments" data={payments} loading={loading} />}
        {activeTab === 'settings' && (
          <SettingsTab
            qbConnected={stats.connections?.quickbooks}
            billcomConnected={stats.connections?.billcom}
            onConnectQB={handleConnectQB}
            onDisconnectQB={handleDisconnectQB}
          />
        )}
      </div>
    </div>
  );
}

import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import {
  Building2, DollarSign, BarChart3, MessageSquare, FileText,
  Truck, Users, AlertTriangle, ChevronDown, Mail, Settings as SettingsIcon, Activity, X,
  Plug, Lock, ExternalLink, Check, Unlink,
} from 'lucide-react';
import SettingsTeamPanel from './SettingsTeamPanel';
import api from '../lib/hooks/useApi';
const EmailSecurityPanel = lazy(() => import('./EmailSecurityPanel'));
const AgentRunHistory = lazy(() => import('./panels/agents/AgentRunHistory'));

const API_BASE = import.meta.env.VITE_API_URL || '/api';

/* ── reusable section shell ─────────────────────────────────────────────────── */
function Section({ icon: Icon, iconClass, title, desc, badge, borderDanger, children }) {
  return (
    <div className={`bg-terminal-panel border rounded-[14px] p-6 mb-4 ${borderDanger ? 'border-red-200' : 'border-terminal-border'}`}>
      <div className="flex items-center justify-between mb-[18px]">
        <div className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-[10px] flex items-center justify-center ${iconClass}`}>
            <Icon size={18} />
          </div>
          <div>
            <div className="text-[16px] font-semibold text-terminal-text">{title}</div>
            <div className="text-[12px] text-terminal-muted mt-px">{desc}</div>
          </div>
        </div>
        {badge && (
          <span className={`text-[10px] font-bold px-3 py-1 rounded-lg tracking-[0.3px] uppercase ${
            badge === 'active' ? 'bg-green-50 text-green-700' : 'bg-[#f5f4f0] text-terminal-muted'
          }`}>{badge}</span>
        )}
      </div>
      {children}
    </div>
  );
}

/* ── toggle ──────────────────────────────────────────────────────────────────── */
function Toggle({ on, onChange }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`w-10 h-[22px] rounded-full relative transition-colors shrink-0 ${on ? 'bg-[#1e3a5f]' : 'bg-[#c5c5bc]'}`}
    >
      <div className={`absolute top-[3px] w-4 h-4 rounded-full bg-white shadow-sm transition-[left] ${on ? 'left-[21px]' : 'left-[3px]'}`} />
    </button>
  );
}

/* ── toggle row ──────────────────────────────────────────────────────────────── */
function ToggleRow({ label, desc, on, onChange }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-[#f0eeea] last:border-b-0">
      <div>
        <div className="text-[13px] font-medium text-terminal-text">{label}</div>
        <div className="text-[11px] text-terminal-muted mt-px">{desc}</div>
      </div>
      <Toggle on={on} onChange={onChange} />
    </div>
  );
}

/* ── field ────────────────────────────────────────────────────────────────────── */
function Field({ label, hint, children, className = '' }) {
  return (
    <div className={className}>
      <label className="block text-[12px] font-semibold text-terminal-text mb-1.5">{label}</label>
      {children}
      {hint && <div className="text-[11px] text-[#c5c5bc] mt-1">{hint}</div>}
    </div>
  );
}

function Input({ value, onChange, type = 'text', placeholder, mono }) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full px-3.5 py-2.5 border-[1.5px] border-terminal-border rounded-[10px] text-[13px] text-terminal-text bg-[#f5f4f0] outline-none focus:border-[#1e3a5f] focus:bg-terminal-panel transition-all placeholder:text-[#c5c5bc] ${mono ? 'font-mono' : ''}`}
    />
  );
}

function Select({ value, onChange, options }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full px-3.5 py-2.5 border-[1.5px] border-terminal-border rounded-[10px] text-[13px] text-terminal-text bg-[#f5f4f0] outline-none focus:border-[#1e3a5f] focus:bg-terminal-panel transition-all appearance-none pr-9"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%239a9a92' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 14px center',
      }}
    >
      {options.map(o => (
        <option key={typeof o === 'string' ? o : o.value} value={typeof o === 'string' ? o : o.value}>
          {typeof o === 'string' ? o : o.label}
        </option>
      ))}
    </select>
  );
}

function Btn({ children, variant = 'primary', onClick, saving, saved: savedProp }) {
  const cls = variant === 'primary'
    ? 'bg-[#1e3a5f] text-white hover:bg-[#2a5080]'
    : variant === 'danger'
      ? 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100'
      : 'bg-terminal-panel text-terminal-muted border border-terminal-border hover:bg-[#f5f4f0]';
  const [internalSaved, setInternalSaved] = useState(false);
  const saved = savedProp || internalSaved;
  const handleClick = () => {
    if (onClick) { onClick(); return; }
    setInternalSaved(true);
    setTimeout(() => setInternalSaved(false), 1500);
  };
  return (
    <button onClick={handleClick} disabled={saving} className={`px-5 py-2.5 rounded-[10px] text-[13px] font-semibold transition-colors flex items-center gap-1.5 ${saving ? 'opacity-60 cursor-wait' : ''} ${saved && variant === 'primary' ? 'bg-green-700 text-white' : cls}`}>
      {saving ? 'Saving...' : saved && variant === 'primary' ? '✓ Saved' : children}
    </button>
  );
}

function Divider() {
  return <div className="h-px bg-[#f0eeea] my-[18px]" />;
}

/* ── integrations config ─────────────────────────────────────────────────────── */
const INTEGRATIONS = [
  // OAuth-based
  { id: 'google-workspace', name: 'Google Workspace', desc: 'Connect Gmail, Drive, Calendar, and Sheets', category: 'Workspace', color: '#4285f4', selfServe: true, oauth: true,
    logo: <svg width="20" height="20" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg> },
  // Self-serve: API key based
  { id: 'hubspot', name: 'HubSpot', desc: 'Sync your CRM pipeline, contacts, and deals', category: 'CRM', color: '#ff7a59', service: 'hubspot', selfServe: true,
    logo: <svg width="20" height="20" viewBox="0 0 24 24" fill="#ff7a59"><path d="M18.16 7.58V4.22a1.74 1.74 0 0 0 1-1.56V2.6A1.74 1.74 0 0 0 17.42.87h-.06a1.74 1.74 0 0 0-1.74 1.74v.06a1.74 1.74 0 0 0 1 1.56v3.32a5.32 5.32 0 0 0-2.38 1.22l-7.9-6.14a2.13 2.13 0 0 0 .06-.52 2.08 2.08 0 1 0-2.08 2.08 2.06 2.06 0 0 0 1.16-.36l7.76 6.04a5.35 5.35 0 0 0 .17 6.16l-2.34 2.34a1.63 1.63 0 0 0-.48-.08 1.68 1.68 0 1 0 1.68 1.68 1.63 1.63 0 0 0-.08-.48l2.3-2.3A5.36 5.36 0 1 0 18.16 7.58zM17.36 16a3.16 3.16 0 1 1 3.16-3.16A3.16 3.16 0 0 1 17.36 16z"/></svg> },
  { id: 'salesforce', name: 'Salesforce', desc: 'Sync opportunities, accounts, and contacts', category: 'CRM', color: '#00a1e0', service: 'salesforce', selfServe: true,
    logo: <div className="text-[16px] font-bold" style={{ color: '#00a1e0' }}>SF</div> },
  { id: 'procore', name: 'Procore', desc: 'Sync projects, RFIs, submittals, and budgets', category: 'Construction', color: '#f47e20', service: 'procore', selfServe: true,
    logo: <div className="text-[16px] font-bold" style={{ color: '#f47e20' }}>P</div> },
  { id: 'quickbooks', name: 'QuickBooks', desc: 'Sync invoices, expenses, and job costing', category: 'Accounting', color: '#2ca01c', service: 'quickbooks', selfServe: true,
    logo: <div className="text-[16px] font-bold" style={{ color: '#2ca01c' }}>QB</div> },
  { id: 'canva', name: 'Canva', desc: 'Generate presentations, proposals, and marketing materials', category: 'Design', color: '#00c4cc', service: 'canva', selfServe: true,
    logo: <div className="text-[16px] font-bold" style={{ color: '#00c4cc' }}>C</div> },
  { id: 'slack', name: 'Slack', desc: 'Get notified on bids, approvals, and task completions', category: 'Notifications', color: '#4a154b', service: 'slack', selfServe: true,
    logo: <div className="text-[16px] font-bold" style={{ color: '#4a154b' }}>S</div> },
  // Mac Mini required
  { id: 'premiere', name: 'Adobe Premiere Pro', desc: 'Automated video editing, rendering, and export', category: 'Creative', color: '#9999ff', macRequired: true,
    logo: <div className="text-[14px] font-bold" style={{ color: '#9999ff' }}>Pr</div> },
  { id: 'aftereffects', name: 'Adobe After Effects', desc: 'Motion graphics, compositing, and visual effects', category: 'Creative', color: '#9999ff', macRequired: true,
    logo: <div className="text-[14px] font-bold" style={{ color: '#9999ff' }}>Ae</div> },
  { id: 'photoshop', name: 'Adobe Photoshop', desc: 'Image editing, compositing, and batch processing', category: 'Creative', color: '#31a8ff', macRequired: true,
    logo: <div className="text-[14px] font-bold" style={{ color: '#31a8ff' }}>Ps</div> },
  { id: 'indesign', name: 'Adobe InDesign', desc: 'Automated report layout, typesetting, and PDF generation', category: 'Creative', color: '#ff3366', macRequired: true,
    logo: <div className="text-[14px] font-bold" style={{ color: '#ff3366' }}>Id</div> },
  { id: 'blender', name: 'Blender', desc: '3D modeling, rendering, and animation', category: 'Creative', color: '#e87d0d', macRequired: true,
    logo: <div className="text-[14px] font-bold" style={{ color: '#e87d0d' }}>B</div> },
  // Construction software - hardware required
  { id: 'planswift', name: 'PlanSwift', desc: 'Automated takeoffs, material quantification, and cost estimation', category: 'Estimating', color: '#1a73e8', macRequired: true, construction: true,
    logo: <div className="text-[14px] font-bold" style={{ color: '#1a73e8' }}>PS</div> },
  { id: 'bluebeam', name: 'Bluebeam Revu', desc: 'PDF markup, plan review, and punch list management', category: 'Plan Review', color: '#0054a6', macRequired: true, construction: true,
    logo: <div className="text-[14px] font-bold" style={{ color: '#0054a6' }}>BB</div> },
];

function IntegrationsPanel() {
  const [statuses, setStatuses] = useState({});
  const [connecting, setConnecting] = useState(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    // Check HubSpot status
    fetch(`${API_BASE}/v1/hubspot/status`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { if (d.configured) setStatuses(prev => ({ ...prev, hubspot: true })); })
      .catch(() => {});
    // Check Google Workspace status (key_vault has refresh_token for google-docs)
    fetch(`${API_BASE}/v1/auth/google/integration-status`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => { if (d.connected) setStatuses(prev => ({ ...prev, 'google-workspace': true })); })
      .catch(() => {});

    // Listen for OAuth popup success
    const handleOAuthMessage = (e) => {
      if (e.data?.type === 'oauth-integration-success' && e.data?.source === 'google-all') {
        setStatuses(prev => ({ ...prev, 'google-workspace': true }));
        setConnecting(null);
      }
    };
    window.addEventListener('message', handleOAuthMessage);
    return () => window.removeEventListener('message', handleOAuthMessage);
  }, []);

  const handleConnect = async (integration) => {
    // OAuth-based integrations (Google Workspace) - open popup
    if (integration.oauth) {
      setConnecting(integration.id);
      const token = localStorage.getItem('auth_token');
      const scopes = 'gmail.readonly,gmail.send,gmail.compose,gmail.modify,calendar,drive,spreadsheets,documents';
      const url = `${API_BASE}/v1/auth/google/integrate?scopes=${encodeURIComponent(scopes)}&source=google-all&token=${encodeURIComponent(token)}`;
      window.open(url, 'google-oauth', 'width=500,height=700,left=200,top=100');
      return;
    }
    // API key-based integrations (HubSpot, etc.)
    if (!apiKeyInput.trim()) return;
    setConnecting(integration.id);
    setError('');
    try {
      const token = localStorage.getItem('auth_token');
      const res = await fetch(`${API_BASE}/v1/hubspot/connect`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKeyInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Failed to connect'); return; }
      setStatuses(prev => ({ ...prev, [integration.id]: true }));
      setExpandedId(null);
      setApiKeyInput('');
    } catch (e) { setError(e.message); }
    finally { setConnecting(null); }
  };

  const handleDisconnect = async (integration) => {
    const token = localStorage.getItem('auth_token');
    await fetch(`${API_BASE}/v1/hubspot/disconnect`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` },
    });
    setStatuses(prev => { const n = { ...prev }; delete n[integration.id]; return n; });
  };

  const selfServe = INTEGRATIONS.filter(i => i.selfServe);
  const creativeHw = INTEGRATIONS.filter(i => i.macRequired && !i.construction);
  const constructionHw = INTEGRATIONS.filter(i => i.macRequired && i.construction);

  return (
    <>
      <Section icon={Plug} iconClass="bg-[#eef3f9] text-[#1e3a5f]" title="Integrations" desc="Connect your existing tools to Coppice">
        <div className="space-y-1">
          {selfServe.map(int => {
            const connected = statuses[int.id];
            const expanded = expandedId === int.id;
            return (
              <div key={int.id} className="border border-[#f0eeea] rounded-[10px] overflow-hidden">
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="w-9 h-9 rounded-[10px] bg-[#f5f4f0] flex items-center justify-center shrink-0">
                    {int.logo}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-terminal-text">{int.name}</span>
                      <span className="text-[9px] font-heading font-bold px-1.5 py-0.5 rounded bg-[#f5f4f0] text-terminal-muted uppercase tracking-[0.3px]">{int.category}</span>
                    </div>
                    <div className="text-[11px] text-terminal-muted mt-px">{int.desc}</div>
                  </div>
                  {connected ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="flex items-center gap-1 text-[11px] font-semibold text-green-700 bg-green-50 px-2.5 py-1 rounded-lg">
                        <Check size={11} /> Connected
                      </span>
                      <button onClick={() => handleDisconnect(int)}
                        className="text-terminal-muted hover:text-red-500 p-1 rounded hover:bg-red-50" title="Disconnect">
                        <Unlink size={13} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        if (int.oauth) { handleConnect(int); }
                        else { setExpandedId(expanded ? null : int.id); setApiKeyInput(''); setError(''); }
                      }}
                      disabled={connecting === int.id}
                      className="flex items-center gap-1.5 text-[11px] font-heading font-semibold px-3 py-1.5 rounded-lg border transition-colors shrink-0 disabled:opacity-50"
                      style={{ color: int.color, borderColor: int.color + '40', backgroundColor: int.color + '08' }}
                    >
                      <Plug size={11} /> {connecting === int.id ? 'Connecting...' : 'Connect'}
                    </button>
                  )}
                </div>
                {expanded && !connected && (
                  <div className="px-4 pb-4 border-t border-[#f0eeea] pt-3">
                    {int.id === 'hubspot' ? (
                      <>
                        <p className="text-[11px] text-terminal-muted mb-3">
                          Enter your HubSpot private app access token. Create one in{' '}
                          <a href="https://app.hubspot.com/private-apps" target="_blank" rel="noopener noreferrer" className="hover:underline" style={{ color: int.color }}>
                            HubSpot Settings <ExternalLink size={9} className="inline" />
                          </a>
                        </p>
                        <div className="flex gap-2">
                          <input type="password" value={apiKeyInput} onChange={e => setApiKeyInput(e.target.value)}
                            placeholder="pat-na1-..." className="flex-1 text-[12px] px-3 py-2 border border-[#e8e6e2] rounded-lg focus:outline-none font-mono" style={{ focusBorderColor: int.color }} />
                          <button onClick={() => handleConnect(int)} disabled={!apiKeyInput.trim() || connecting === int.id}
                            className="px-4 py-2 text-[12px] font-semibold text-white rounded-lg disabled:opacity-50" style={{ backgroundColor: int.color }}>
                            {connecting === int.id ? '...' : 'Connect'}
                          </button>
                        </div>
                        {error && <div className="text-[11px] text-red-500 mt-2">{error}</div>}
                      </>
                    ) : (
                      <div className="flex items-center gap-3 py-2">
                        <div className="text-[12px] text-terminal-muted">Coming soon. API integration for {int.name} is on the roadmap.</div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      <Section icon={Lock} iconClass="bg-[#eef3f9] text-[#1e3a5f]" title="Construction Software" desc="Estimating and plan review tools powered by dedicated hardware">
        <div className="space-y-1">
          {constructionHw.map(int => (
            <div key={int.id} className="border border-[#f0eeea] rounded-[10px] overflow-hidden opacity-60">
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="w-9 h-9 rounded-[10px] bg-[#f5f4f0] flex items-center justify-center shrink-0">
                  {int.logo}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-terminal-text">{int.name}</span>
                    <span className="text-[9px] font-heading font-bold px-1.5 py-0.5 rounded bg-[#f5f4f0] text-terminal-muted uppercase tracking-[0.3px]">{int.category}</span>
                  </div>
                  <div className="text-[11px] text-terminal-muted mt-px">{int.desc}</div>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#7c3aed] bg-[#f5f0fa] px-2.5 py-1.5 rounded-lg shrink-0">
                  <Lock size={11} /> Hardware Required
                </div>
              </div>
              <div className="px-4 pb-3 border-t border-[#f0eeea] pt-2.5 bg-[#fafaf8]">
                <p className="text-[11px] text-terminal-muted">
                  This integration requires a dedicated hardware integration. Contact your administrator to upgrade your package.
                </p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section icon={Lock} iconClass="bg-[#f5f0fa] text-[#7c3aed]" title="Creative Suite" desc="Desktop application integrations powered by dedicated hardware">
        <div className="space-y-1">
          {creativeHw.map(int => (
            <div key={int.id} className="border border-[#f0eeea] rounded-[10px] overflow-hidden opacity-60">
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="w-9 h-9 rounded-[10px] bg-[#f5f4f0] flex items-center justify-center shrink-0">
                  {int.logo}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-terminal-text">{int.name}</span>
                    <span className="text-[9px] font-heading font-bold px-1.5 py-0.5 rounded bg-[#f5f4f0] text-terminal-muted uppercase tracking-[0.3px]">{int.category}</span>
                  </div>
                  <div className="text-[11px] text-terminal-muted mt-px">{int.desc}</div>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#7c3aed] bg-[#f5f0fa] px-2.5 py-1.5 rounded-lg shrink-0">
                  <Lock size={11} /> Hardware Required
                </div>
              </div>
              <div className="px-4 pb-3 border-t border-[#f0eeea] pt-2.5 bg-[#fafaf8]">
                <p className="text-[11px] text-terminal-muted">
                  This integration requires a dedicated hardware integration. Contact your administrator to upgrade your package.
                </p>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

/* ── main component ──────────────────────────────────────────────────────────── */
export default function DacpSettingsPanel() {
  // Company Profile
  const [company, setCompany] = useState({
    name: 'DACP Construction LLC',
    license: 'TX-CBC-2018-04521',
    contact: 'David Castillo',
    email: 'estimating@dacpconstruction.com',
    area: 'Greater Houston, TX (100 mile radius)',
    specialty: 'Concrete / Flatwork',
  });

  // Pricing
  const [pricing, setPricing] = useState([]);
  const [pricingLoading, setPricingLoading] = useState(true);

  // Markup
  const [markup, setMarkup] = useState({
    overhead: '15', profit: '10', bond: '2.5',
    mob1: '1500', mob2: '2500', mob3: '3500',
    test1: '1200', test2: '2400', outside: '8', rounding: 'Nearest $500',
  });

  // Bot
  const [bot, setBot] = useState({
    inbox: 'estimating@dacpconstruction.com',
    mode: 'copilot',
    response: 'Next business day',
    confidence: '85',
    autoMissing: true, historicalComp: true, autoSpreadsheet: true, trackOutcomes: true,
  });

  // Field
  const [field, setField] = useState({
    channel: 'Email + Dashboard',
    dueBy: '6:00 PM daily',
    autoMatch: true, marginAlerts: true, autoSync: false,
    marginThreshold: '8', materialOverage: '15', laborOverage: '20',
  });

  // Suppliers
  const [suppliers, setSuppliers] = useState({
    primary: 'Texas Industries (TXI)', primaryPrice: '145.00',
    secondary: 'Buzzi Unicem', secondaryPrice: '148.50',
    rebar: 'CMC Steel', lumber: '84 Lumber',
  });

  // GC contacts
  const [gcContacts, setGcContacts] = useState([
    { company: 'Turner Construction', contact: 'Mike Rodriguez', domain: '@turner.com', jobs: 8, winRate: 75 },
    { company: 'McCarthy Building', contact: 'Sarah Williams', domain: '@mccarthy.com', jobs: 5, winRate: 60 },
    { company: 'Hensel Phelps', contact: 'James Park', domain: '@henselphelps.com', jobs: 3, winRate: 33 },
    { company: 'DPR Construction', contact: 'Lisa Chen', domain: '@dpr.com', jobs: 4, winRate: 50 },
    { company: 'Skanska', contact: 'Robert Torres', domain: '@skanska.com', jobs: 2, winRate: 50 },
  ]);

  // Persistence state
  const [saving, setSaving] = useState(false);
  const [savedSection, setSavedSection] = useState(null);
  const settingsRef = useRef({});

  // Load existing settings from backend on mount
  useEffect(() => {
    api.get('/v1/tenant').then(res => {
      const s = res.data?.tenant?.settings || {};
      settingsRef.current = s;
      if (s.company) setCompany(prev => ({ ...prev, ...s.company }));
      if (s.markup) setMarkup(prev => ({ ...prev, ...s.markup }));
      if (s.bot) setBot(prev => ({ ...prev, ...s.bot }));
      if (s.field) setField(prev => ({ ...prev, ...s.field }));
      if (s.suppliers) setSuppliers(prev => ({ ...prev, ...s.suppliers }));
      if (s.gcContacts) setGcContacts(s.gcContacts);
    }).catch(() => {});
  }, []);

  // Save a single section - merges with existing settings so other sections aren't lost
  const saveSettings = async (section, data) => {
    setSaving(true);
    try {
      const merged = { ...settingsRef.current, [section]: data };
      await api.put('/v1/tenant', { settings: merged });
      settingsRef.current = merged;
      setSavedSection(section);
      setTimeout(() => setSavedSection(null), 2000);
    } catch (err) {
      alert('Failed to save: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  };

  // Load pricing
  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    fetch(`${API_BASE}/v1/estimates/pricing`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(data => {
        const items = (data.pricing || []).slice(0, 10);
        setPricing(items.map(p => ({
          id: p.id,
          item: p.item,
          unit: p.unit,
          material: String(p.material_cost ?? ''),
          labor: String(p.labor_cost ?? ''),
          equipment: String(p.equipment_cost ?? ''),
          total: p.unit_price,
        })));
      })
      .catch(console.error)
      .finally(() => setPricingLoading(false));
  }, []);

  const updatePricing = (index, field, value) => {
    setPricing(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      const m = parseFloat(updated[index].material) || 0;
      const l = parseFloat(updated[index].labor) || 0;
      const e = parseFloat(updated[index].equipment) || 0;
      updated[index].total = +(m + l + e).toFixed(2);
      return updated;
    });
  };

  // Inline form visibility + state
  const [showAddPricing, setShowAddPricing] = useState(false);
  const [newPricing, setNewPricing] = useState({ category: 'Concrete', item: '', unit: 'CY', material: '', labor: '', equipment: '' });
  const [addingPricing, setAddingPricing] = useState(false);

  const [showAddGc, setShowAddGc] = useState(false);
  const [newGc, setNewGc] = useState({ company: '', contact: '', domain: '', jobs: 0, winRate: 0 });

  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [newSupplier, setNewSupplier] = useState({ name: '', material: '', price: '' });
  const [extraSuppliers, setExtraSuppliers] = useState([]);

  // Load extra suppliers from settings
  useEffect(() => {
    const s = settingsRef.current;
    if (s.extraSuppliers) setExtraSuppliers(s.extraSuppliers);
  }, [suppliers]); // re-run after settings load triggers suppliers update

  const handleAddPricing = async () => {
    if (!newPricing.item.trim()) return;
    setAddingPricing(true);
    try {
      const token = localStorage.getItem('auth_token');
      const m = parseFloat(newPricing.material) || 0;
      const l = parseFloat(newPricing.labor) || 0;
      const e = parseFloat(newPricing.equipment) || 0;
      const unitPrice = +(m + l + e).toFixed(2);
      // Generate a simple slug id from category + item
      const id = `${newPricing.category}-${newPricing.item}`.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/-+$/, '').substring(0, 30);
      const res = await fetch(`${API_BASE}/v1/estimates/pricing`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          category: newPricing.category,
          item: newPricing.item,
          unit: newPricing.unit,
          material_cost: m,
          labor_cost: l,
          equipment_cost: e,
          unit_price: unitPrice,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to create');
      }
      const data = await res.json();
      // Refresh the pricing list from backend response
      const items = (data.pricing || []).slice(0, 20);
      setPricing(items.map(p => ({
        id: p.id,
        item: p.item,
        unit: p.unit,
        material: String(p.material_cost ?? ''),
        labor: String(p.labor_cost ?? ''),
        equipment: String(p.equipment_cost ?? ''),
        total: p.unit_price,
      })));
      setNewPricing({ category: 'Concrete', item: '', unit: 'CY', material: '', labor: '', equipment: '' });
      setShowAddPricing(false);
    } catch (err) {
      alert('Failed to add pricing item: ' + err.message);
    } finally {
      setAddingPricing(false);
    }
  };

  const handleAddGc = () => {
    if (!newGc.company.trim()) return;
    setGcContacts(prev => [...prev, { ...newGc, jobs: parseInt(newGc.jobs) || 0, winRate: parseInt(newGc.winRate) || 0 }]);
    setNewGc({ company: '', contact: '', domain: '', jobs: 0, winRate: 0 });
    setShowAddGc(false);
  };

  const handleAddSupplier = () => {
    if (!newSupplier.name.trim() || !newSupplier.material.trim()) return;
    const updated = [...extraSuppliers, { ...newSupplier }];
    setExtraSuppliers(updated);
    // Persist immediately
    saveSettings('extraSuppliers', updated);
    setNewSupplier({ name: '', material: '', price: '' });
    setShowAddSupplier(false);
  };

  const removeExtraSupplier = (index) => {
    const updated = extraSuppliers.filter((_, i) => i !== index);
    setExtraSuppliers(updated);
    saveSettings('extraSuppliers', updated);
  };

  const [settingsTab, setSettingsTab] = useState('general');
  const storedUser = JSON.parse(localStorage.getItem('coppice_user') || '{}');
  const isAdmin = ['owner', 'admin'].includes(storedUser.role);

  const SETTINGS_TABS = [
    { id: 'general', label: 'General', icon: SettingsIcon },
    { id: 'integrations', label: 'Integrations', icon: Plug },
    ...(isAdmin ? [{ id: 'email-security', label: 'Email Security', icon: Mail }] : []),
  ];

  return (
    <div className="p-6 lg:px-7 lg:py-6 max-w-[860px]">
      <div className="mb-6">
        <h2 className="text-[24px] font-normal text-terminal-text" style={{ fontFamily: "'Newsreader', Georgia, serif" }}>Settings</h2>
        <p className="text-[13px] text-terminal-muted mt-1">Configure your construction estimating platform. All changes are saved per section.</p>
        {SETTINGS_TABS.length > 1 && (
          <div className="flex gap-1 mt-4">
            {SETTINGS_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setSettingsTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all ${
                  settingsTab === tab.id
                    ? 'bg-[#1e3a5f] text-white'
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

      {settingsTab === 'integrations' && <IntegrationsPanel />}

      {settingsTab === 'general' && <>
      {/* ═══ TEAM MANAGEMENT ═══ */}
      <SettingsTeamPanel />

      {/* ═══ COMPANY PROFILE ═══ */}
      <Section icon={Building2} iconClass="bg-[#eef3f9] text-[#1e3a5f]" title="Company Profile" desc="Business information used in estimates and correspondence">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Company Name">
            <Input value={company.name} onChange={v => setCompany(p => ({ ...p, name: v }))} />
          </Field>
          <Field label="License Number">
            <Input value={company.license} onChange={v => setCompany(p => ({ ...p, license: v }))} mono />
          </Field>
          <Field label="Primary Contact">
            <Input value={company.contact} onChange={v => setCompany(p => ({ ...p, contact: v }))} />
          </Field>
          <Field label="Estimating Email">
            <Input value={company.email} onChange={v => setCompany(p => ({ ...p, email: v }))} type="email" />
          </Field>
          <Field label="Service Area">
            <Input value={company.area} onChange={v => setCompany(p => ({ ...p, area: v }))} />
          </Field>
          <Field label="Specialty">
            <Select value={company.specialty} onChange={v => setCompany(p => ({ ...p, specialty: v }))} options={[
              'Concrete / Flatwork', 'General Concrete', 'Structural', 'Paving / Asphalt', 'Excavation',
            ]} />
          </Field>
        </div>
        <div className="flex gap-2.5 mt-4">
          <Btn onClick={() => saveSettings('company', company)} saving={saving} saved={savedSection === 'company'}>Save Profile</Btn>
        </div>
      </Section>

      {/* ═══ PRICING MASTER TABLE ═══ */}
      <Section icon={DollarSign} iconClass="bg-green-50 text-green-700" title="Pricing Master Table" desc="Unit costs used by the estimating bot to generate quotes" badge="active">
        {pricingLoading ? (
          <div className="py-8 text-center text-terminal-muted text-sm">Loading pricing...</div>
        ) : (
          <div className="overflow-x-auto mt-3">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  {['Item', 'Unit', 'Material', 'Labor', 'Equipment', 'Total / Unit'].map(h => (
                    <th key={h} className="text-[10px] font-bold text-terminal-muted uppercase tracking-[0.8px] text-left px-2.5 py-2 border-b border-terminal-border">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pricing.map((p, i) => (
                  <tr key={p.id || i} className="border-b border-[#f0eeea] last:border-b-0">
                    <td className="text-[13px] font-medium text-terminal-text px-2.5 py-2.5 min-w-[180px]">{p.item}</td>
                    <td className="text-[13px] text-terminal-muted px-2.5 py-2.5">{p.unit}</td>
                    <td className="px-2.5 py-2">
                      <input
                        value={p.material}
                        onChange={e => updatePricing(i, 'material', e.target.value)}
                        className="w-20 px-2.5 py-1.5 border-[1.5px] border-terminal-border rounded-lg font-mono text-[12px] text-terminal-text bg-[#f5f4f0] outline-none focus:border-[#1e3a5f] focus:bg-terminal-panel text-right"
                      />
                    </td>
                    <td className="px-2.5 py-2">
                      <input
                        value={p.labor}
                        onChange={e => updatePricing(i, 'labor', e.target.value)}
                        className="w-20 px-2.5 py-1.5 border-[1.5px] border-terminal-border rounded-lg font-mono text-[12px] text-terminal-text bg-[#f5f4f0] outline-none focus:border-[#1e3a5f] focus:bg-terminal-panel text-right"
                      />
                    </td>
                    <td className="px-2.5 py-2">
                      <input
                        value={p.equipment}
                        onChange={e => updatePricing(i, 'equipment', e.target.value)}
                        className="w-20 px-2.5 py-1.5 border-[1.5px] border-terminal-border rounded-lg font-mono text-[12px] text-terminal-text bg-[#f5f4f0] outline-none focus:border-[#1e3a5f] focus:bg-terminal-panel text-right"
                      />
                    </td>
                    <td className="text-[13px] font-semibold text-terminal-text px-2.5 py-2.5 tabular-nums">
                      ${p.total.toFixed(2)}<span className="text-[11px] text-terminal-muted ml-1">/{p.unit}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {showAddPricing && (
          <div className="mt-4 p-4 bg-[#f5f4f0] border border-terminal-border rounded-[10px]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[13px] font-semibold text-terminal-text">New Pricing Item</span>
              <button onClick={() => setShowAddPricing(false)} className="text-terminal-muted hover:text-terminal-text"><X size={14} /></button>
            </div>
            <div className="grid grid-cols-6 gap-3">
              <Field label="Category" className="col-span-1">
                <Select value={newPricing.category} onChange={v => setNewPricing(p => ({ ...p, category: v }))} options={[
                  'Concrete', 'Labor', 'Reinforcement', 'Formwork', 'Equipment', 'Finishing', 'Other',
                ]} />
              </Field>
              <Field label="Item Name" className="col-span-2">
                <Input value={newPricing.item} onChange={v => setNewPricing(p => ({ ...p, item: v }))} placeholder="e.g. 4000 PSI Concrete" />
              </Field>
              <Field label="Unit" className="col-span-1">
                <Select value={newPricing.unit} onChange={v => setNewPricing(p => ({ ...p, unit: v }))} options={[
                  'CY', 'SF', 'LF', 'TON', 'EA', 'HR', 'LS',
                ]} />
              </Field>
              <Field label="Material $" className="col-span-1">
                <Input value={newPricing.material} onChange={v => setNewPricing(p => ({ ...p, material: v }))} placeholder="0.00" mono />
              </Field>
              <Field label="Labor $" className="col-span-1">
                <Input value={newPricing.labor} onChange={v => setNewPricing(p => ({ ...p, labor: v }))} placeholder="0.00" mono />
              </Field>
            </div>
            <div className="grid grid-cols-6 gap-3 mt-3">
              <Field label="Equipment $" className="col-span-1">
                <Input value={newPricing.equipment} onChange={v => setNewPricing(p => ({ ...p, equipment: v }))} placeholder="0.00" mono />
              </Field>
              <div className="col-span-1 flex items-end">
                <span className="text-[12px] font-mono text-terminal-muted pb-2.5">
                  Total: ${((parseFloat(newPricing.material) || 0) + (parseFloat(newPricing.labor) || 0) + (parseFloat(newPricing.equipment) || 0)).toFixed(2)}
                </span>
              </div>
            </div>
            <div className="flex gap-2.5 mt-3">
              <Btn onClick={handleAddPricing} saving={addingPricing}>Add Item</Btn>
              <Btn variant="secondary" onClick={() => setShowAddPricing(false)}>Cancel</Btn>
            </div>
          </div>
        )}
        <div className="flex gap-2.5 mt-4">
          <Btn variant="secondary" onClick={() => setShowAddPricing(true)}>+ Add Line Item</Btn>
          <Btn onClick={() => saveSettings('pricing', pricing)} saving={saving} saved={savedSection === 'pricing'}>Save Pricing</Btn>
        </div>
      </Section>

      {/* ═══ MARKUP & OVERHEAD ═══ */}
      <Section icon={BarChart3} iconClass="bg-amber-50 text-amber-700" title="Markup & Overhead" desc="Default margins applied to all estimates" badge="active">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Overhead (%)" hint="Applied to total direct costs">
            <Input value={markup.overhead} onChange={v => setMarkup(p => ({ ...p, overhead: v }))} mono />
          </Field>
          <Field label="Profit Margin (%)" hint="Applied after overhead">
            <Input value={markup.profit} onChange={v => setMarkup(p => ({ ...p, profit: v }))} mono />
          </Field>
          <Field label="Bond Rate (%)" hint="If bonding is required by GC">
            <Input value={markup.bond} onChange={v => setMarkup(p => ({ ...p, bond: v }))} mono />
          </Field>
        </div>

        <Divider />

        <div className="grid grid-cols-3 gap-4">
          <Field label="Mobilization (under $50K)" hint="Flat rate per job">
            <Input value={markup.mob1} onChange={v => setMarkup(p => ({ ...p, mob1: v }))} mono />
          </Field>
          <Field label="Mobilization ($50K-$150K)">
            <Input value={markup.mob2} onChange={v => setMarkup(p => ({ ...p, mob2: v }))} mono />
          </Field>
          <Field label="Mobilization ($150K+)">
            <Input value={markup.mob3} onChange={v => setMarkup(p => ({ ...p, mob3: v }))} mono />
          </Field>
        </div>

        <Divider />

        <div className="grid grid-cols-2 gap-4">
          <Field label="Testing Allowance (under $100K)" hint="Third-party testing costs">
            <Input value={markup.test1} onChange={v => setMarkup(p => ({ ...p, test1: v }))} mono />
          </Field>
          <Field label="Testing Allowance ($100K+)">
            <Input value={markup.test2} onChange={v => setMarkup(p => ({ ...p, test2: v }))} mono />
          </Field>
          <Field label="Outside Service Area Adjustment (%)" hint="Added for jobs beyond 100 mile radius">
            <Input value={markup.outside} onChange={v => setMarkup(p => ({ ...p, outside: v }))} mono />
          </Field>
          <Field label="Rounding">
            <Select value={markup.rounding} onChange={v => setMarkup(p => ({ ...p, rounding: v }))} options={[
              'Nearest $500', 'Nearest $100', 'Nearest $1,000', 'No rounding',
            ]} />
          </Field>
        </div>

        <div className="flex gap-2.5 mt-4">
          <Btn onClick={() => saveSettings('markup', markup)} saving={saving} saved={savedSection === 'markup'}>Save Margins</Btn>
        </div>
      </Section>

      {/* ═══ ESTIMATING BOT ═══ */}
      <Section icon={MessageSquare} iconClass="bg-purple-50 text-purple-600" title="Estimating Bot" desc="Automated bid processing and estimate generation" badge="active">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Inbox to Monitor" hint="Bot checks this inbox for new bid requests">
            <Input value={bot.inbox} onChange={v => setBot(p => ({ ...p, inbox: v }))} type="email" />
          </Field>
          <Field label="Operating Mode">
            <Select value={bot.mode} onChange={v => setBot(p => ({ ...p, mode: v }))} options={[
              { value: 'copilot', label: 'Copilot - drafts estimates for review' },
              { value: 'autonomous', label: 'Autonomous - sends after approval delay' },
              { value: 'off', label: 'Off' },
            ]} />
          </Field>
          <Field label="Default Response Time">
            <Select value={bot.response} onChange={v => setBot(p => ({ ...p, response: v }))} options={[
              'Same day', 'Next business day', '2 business days', 'Manual only',
            ]} />
          </Field>
          <Field label="Confidence Threshold (%)" hint="Below this, estimate flagged for manual review">
            <Input value={bot.confidence} onChange={v => setBot(p => ({ ...p, confidence: v }))} mono />
          </Field>
        </div>

        <Divider />

        <ToggleRow
          label="Auto-request missing information"
          desc="If bid request is incomplete, draft a clarification email to the GC"
          on={bot.autoMissing}
          onChange={v => setBot(p => ({ ...p, autoMissing: v }))}
        />
        <ToggleRow
          label="Include historical job comparisons"
          desc="Reference similar past jobs in the estimate review panel"
          on={bot.historicalComp}
          onChange={v => setBot(p => ({ ...p, historicalComp: v }))}
        />
        <ToggleRow
          label="Auto-generate estimate spreadsheet"
          desc="Create Excel attachment with line-item breakdown for each quote"
          on={bot.autoSpreadsheet}
          onChange={v => setBot(p => ({ ...p, autoSpreadsheet: v }))}
        />
        <ToggleRow
          label="Track win/loss outcomes"
          desc="Prompt for outcome 30 days after quote sent to improve pricing accuracy"
          on={bot.trackOutcomes}
          onChange={v => setBot(p => ({ ...p, trackOutcomes: v }))}
        />

        <div className="flex gap-2.5 mt-4">
          <Btn onClick={() => saveSettings('bot', bot)} saving={saving} saved={savedSection === 'bot'}>Save Bot Settings</Btn>
        </div>
      </Section>

      {/* ═══ FIELD REPORTING ═══ */}
      <Section icon={FileText} iconClass="bg-[#eef3f9] text-[#1e3a5f]" title="Field Reporting" desc="How field workers submit daily activity to the platform" badge="active">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Submission Channel" hint="How field crews submit daily logs">
            <Select value={field.channel} onChange={v => setField(p => ({ ...p, channel: v }))} options={[
              'Email', 'Email + Dashboard', 'Dashboard only',
            ]} />
          </Field>
          <Field label="Report Due By">
            <Select value={field.dueBy} onChange={v => setField(p => ({ ...p, dueBy: v }))} options={[
              'End of shift', '6:00 PM daily', 'Next morning',
            ]} />
          </Field>
        </div>

        <Divider />

        <ToggleRow
          label="Auto-match field usage to job estimates"
          desc="Compare actual material usage against estimated quantities and flag overages"
          on={field.autoMatch}
          onChange={v => setField(p => ({ ...p, autoMatch: v }))}
        />
        <ToggleRow
          label="Margin alerts"
          desc="Notify when actual job costs exceed estimate by more than the threshold"
          on={field.marginAlerts}
          onChange={v => setField(p => ({ ...p, marginAlerts: v }))}
        />
        <ToggleRow
          label="Auto-sync to accounting"
          desc="Push tagged field data to accounting system for invoicing"
          on={field.autoSync}
          onChange={v => setField(p => ({ ...p, autoSync: v }))}
        />

        <Divider />

        <div className="grid grid-cols-3 gap-4">
          <Field label="Margin Alert Threshold (%)" hint="Alert when job margin drops below this">
            <Input value={field.marginThreshold} onChange={v => setField(p => ({ ...p, marginThreshold: v }))} mono />
          </Field>
          <Field label="Material Overage Alert (%)" hint="Alert when material usage exceeds estimate">
            <Input value={field.materialOverage} onChange={v => setField(p => ({ ...p, materialOverage: v }))} mono />
          </Field>
          <Field label="Labor Overage Alert (%)" hint="Alert when labor hours exceed budget">
            <Input value={field.laborOverage} onChange={v => setField(p => ({ ...p, laborOverage: v }))} mono />
          </Field>
        </div>

        <div className="flex gap-2.5 mt-4">
          <Btn onClick={() => saveSettings('field', field)} saving={saving} saved={savedSection === 'field'}>Save Field Settings</Btn>
        </div>
      </Section>

      {/* ═══ PREFERRED SUPPLIERS ═══ */}
      <Section icon={Truck} iconClass="bg-amber-50 text-amber-700" title="Preferred Suppliers" desc="Concrete and material suppliers referenced in estimates">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Primary Concrete Supplier">
            <Input value={suppliers.primary} onChange={v => setSuppliers(p => ({ ...p, primary: v }))} />
          </Field>
          <Field label="Concrete Price ($/CY, 3000 PSI)">
            <Input value={suppliers.primaryPrice} onChange={v => setSuppliers(p => ({ ...p, primaryPrice: v }))} mono />
          </Field>
          <Field label="Secondary Concrete Supplier">
            <Input value={suppliers.secondary} onChange={v => setSuppliers(p => ({ ...p, secondary: v }))} />
          </Field>
          <Field label="Concrete Price ($/CY, 3000 PSI)">
            <Input value={suppliers.secondaryPrice} onChange={v => setSuppliers(p => ({ ...p, secondaryPrice: v }))} mono />
          </Field>
          <Field label="Rebar Supplier">
            <Input value={suppliers.rebar} onChange={v => setSuppliers(p => ({ ...p, rebar: v }))} />
          </Field>
          <Field label="Form Lumber Supplier">
            <Input value={suppliers.lumber} onChange={v => setSuppliers(p => ({ ...p, lumber: v }))} />
          </Field>
        </div>
        {extraSuppliers.length > 0 && (
          <>
            <Divider />
            <div className="text-[12px] font-semibold text-terminal-muted uppercase tracking-[0.5px] mb-3">Additional Suppliers</div>
            <div className="grid grid-cols-2 gap-4">
              {extraSuppliers.map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-terminal-text truncate">{s.name}</div>
                    <div className="text-[11px] text-terminal-muted">{s.material}{s.price ? ` - $${s.price}` : ''}</div>
                  </div>
                  <button onClick={() => removeExtraSupplier(i)} className="text-terminal-muted hover:text-red-600 shrink-0"><X size={13} /></button>
                </div>
              ))}
            </div>
          </>
        )}
        {showAddSupplier && (
          <div className="mt-4 p-4 bg-[#f5f4f0] border border-terminal-border rounded-[10px]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[13px] font-semibold text-terminal-text">New Supplier</span>
              <button onClick={() => setShowAddSupplier(false)} className="text-terminal-muted hover:text-terminal-text"><X size={14} /></button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Supplier Name">
                <Input value={newSupplier.name} onChange={v => setNewSupplier(p => ({ ...p, name: v }))} placeholder="e.g. Vulcan Materials" />
              </Field>
              <Field label="Material Type">
                <Input value={newSupplier.material} onChange={v => setNewSupplier(p => ({ ...p, material: v }))} placeholder="e.g. Aggregate, Sand" />
              </Field>
              <Field label="Price ($/unit)">
                <Input value={newSupplier.price} onChange={v => setNewSupplier(p => ({ ...p, price: v }))} placeholder="Optional" mono />
              </Field>
            </div>
            <div className="flex gap-2.5 mt-3">
              <Btn onClick={handleAddSupplier}>Add Supplier</Btn>
              <Btn variant="secondary" onClick={() => setShowAddSupplier(false)}>Cancel</Btn>
            </div>
          </div>
        )}
        <div className="flex gap-2.5 mt-4">
          <Btn variant="secondary" onClick={() => setShowAddSupplier(true)}>+ Add Supplier</Btn>
          <Btn onClick={() => saveSettings('suppliers', suppliers)} saving={saving} saved={savedSection === 'suppliers'}>Save Suppliers</Btn>
        </div>
      </Section>

      {/* ═══ GC CONTACTS ═══ */}
      <Section icon={Users} iconClass="bg-green-50 text-green-700" title="General Contractor Contacts" desc="GCs the bot recognizes when processing bid requests">
        <div className="overflow-x-auto mt-3">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {['Company', 'Contact', 'Email Domain', 'Jobs (12mo)', 'Win Rate'].map(h => (
                  <th key={h} className="text-[10px] font-bold text-terminal-muted uppercase tracking-[0.8px] text-left px-2.5 py-2 border-b border-terminal-border">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {gcContacts.map((gc, i) => (
                <tr key={i} className="border-b border-[#f0eeea] last:border-b-0">
                  <td className="text-[13px] font-medium text-terminal-text px-2.5 py-2.5">{gc.company}</td>
                  <td className="text-[13px] text-terminal-text px-2.5 py-2.5">{gc.contact}</td>
                  <td className="text-[12px] font-mono text-terminal-muted px-2.5 py-2.5">{gc.domain}</td>
                  <td className="text-[13px] font-mono text-terminal-text px-2.5 py-2.5">{gc.jobs}</td>
                  <td className={`text-[13px] font-mono font-medium px-2.5 py-2.5 ${gc.winRate >= 50 ? 'text-green-700' : 'text-amber-600'}`}>
                    {gc.winRate}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {showAddGc && (
          <div className="mt-4 p-4 bg-[#f5f4f0] border border-terminal-border rounded-[10px]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[13px] font-semibold text-terminal-text">New GC Contact</span>
              <button onClick={() => setShowAddGc(false)} className="text-terminal-muted hover:text-terminal-text"><X size={14} /></button>
            </div>
            <div className="grid grid-cols-5 gap-3">
              <Field label="Company" className="col-span-1">
                <Input value={newGc.company} onChange={v => setNewGc(p => ({ ...p, company: v }))} placeholder="e.g. Kiewit" />
              </Field>
              <Field label="Contact Name" className="col-span-1">
                <Input value={newGc.contact} onChange={v => setNewGc(p => ({ ...p, contact: v }))} placeholder="e.g. John Smith" />
              </Field>
              <Field label="Email Domain" className="col-span-1">
                <Input value={newGc.domain} onChange={v => setNewGc(p => ({ ...p, domain: v }))} placeholder="@kiewit.com" mono />
              </Field>
              <Field label="Jobs (12mo)" className="col-span-1">
                <Input value={newGc.jobs} onChange={v => setNewGc(p => ({ ...p, jobs: v }))} type="number" placeholder="0" mono />
              </Field>
              <Field label="Win Rate (%)" className="col-span-1">
                <Input value={newGc.winRate} onChange={v => setNewGc(p => ({ ...p, winRate: v }))} type="number" placeholder="0" mono />
              </Field>
            </div>
            <div className="flex gap-2.5 mt-3">
              <Btn onClick={handleAddGc}>Add GC</Btn>
              <Btn variant="secondary" onClick={() => setShowAddGc(false)}>Cancel</Btn>
            </div>
          </div>
        )}
        <div className="flex gap-2.5 mt-4">
          <Btn variant="secondary" onClick={() => setShowAddGc(true)}>+ Add GC</Btn>
          <Btn onClick={() => saveSettings('gcContacts', gcContacts)} saving={saving} saved={savedSection === 'gcContacts'}>Save GC List</Btn>
        </div>
      </Section>

      {/* ═══ AGENT RUN HISTORY ═══ */}
      <Section icon={Activity} iconClass="bg-[#e8eef5] text-[#1e3a5f]" title="Agent Run History" desc="Audit agent outputs, track regressions, compare runs">
        <Suspense fallback={<div className="py-8 text-center text-terminal-muted text-[13px]">Loading run history...</div>}>
          <AgentRunHistory />
        </Suspense>
      </Section>

      {/* ═══ DANGER ZONE ═══ */}
      <Section icon={AlertTriangle} iconClass="bg-red-50 text-red-700" title="Danger Zone" desc="Irreversible actions" borderDanger>
        <div className="flex items-center justify-between py-2.5 border-b border-[#f0eeea]">
          <div>
            <div className="text-[13px] font-medium text-terminal-text">Reset pricing table to defaults</div>
            <div className="text-[11px] text-terminal-muted mt-px">Overwrites all custom pricing with system defaults</div>
          </div>
          <Btn variant="danger" onClick={() => { if (confirm('Are you sure? This will overwrite all custom pricing.')) alert('Pricing reset to defaults.'); }}>Reset</Btn>
        </div>
        <div className="flex items-center justify-between py-2.5">
          <div>
            <div className="text-[13px] font-medium text-terminal-text">Clear all historical job data</div>
            <div className="text-[11px] text-terminal-muted mt-px">Permanently deletes all completed job records and field reports</div>
          </div>
          <Btn variant="danger" onClick={() => { if (confirm('Are you sure? This permanently deletes all job records.')) alert('Historical data cleared.'); }}>Clear</Btn>
        </div>
      </Section>
      </>}
    </div>
  );
}

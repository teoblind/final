import React, { useState, useEffect } from 'react';
import { Search, Mail, Mic, Bot, Zap, Calendar, FileText, BarChart3, Users } from 'lucide-react';
import api from '../../lib/hooks/useApi';
import { useTenant } from '../../contexts/TenantContext';
import CoppiceLogo from '../ui/CoppiceLogo';

const STEPS = [
  { id: 'welcome', label: 'Welcome' },
  { id: 'connect', label: 'Connect' },
  { id: 'agents', label: 'Agents' },
  { id: 'team', label: 'Team' },
  { id: 'launch', label: 'Launch' },
];

// ─── Mining Industry Config ──────────────────────────────────────────────────

const ISO_OPTIONS = [
  { id: 'ERCOT', label: 'ERCOT (Texas)', available: true },
  { id: 'PJM', label: 'PJM (Mid-Atlantic)', available: false },
  { id: 'MISO', label: 'MISO (Midwest)', available: false },
  { id: 'CAISO', label: 'CAISO (California)', available: false },
  { id: 'NYISO', label: 'NYISO (New York)', available: false },
];

const MINING_DATA_SOURCES = [
  { id: 'energy', Icon: Zap, name: 'Energy Market (ERCOT)', desc: 'Real-time LMP pricing and settlement data', oauth: false },
  { id: 'calendar', Icon: Calendar, name: 'Google Calendar', desc: 'Meeting scheduling, event tracking, and agent reminders', oauth: 'google', scopes: 'calendar.readonly' },
  { id: 'gmail', Icon: Mail, name: 'Gmail', desc: 'Email integration — agent reads and drafts from your inbox', oauth: 'google', scopes: 'gmail.modify,gmail.send' },
  { id: 'docs', Icon: FileText, name: 'Google Docs & Drive', desc: 'Document sync, meeting notes, and file access', oauth: 'google', scopes: 'drive.file,drive.readonly' },
];

const MINING_AGENTS = [
  { id: 'lead-engine', name: 'Lead Engine', desc: 'Discovers prospects, enriches contacts, and manages your sales pipeline', color: '#1a6b3c' },
  { id: 'outreach', name: 'Outreach Agent', desc: 'Generates personalized emails, manages follow-ups, and tracks engagement', color: '#3b82f6' },
  { id: 'meetings', name: 'Meeting Agent', desc: 'Joins calls, transcribes conversations, and extracts action items', color: '#a855f7' },
  { id: 'reporting', name: 'Reporting Engine', desc: 'Generates weekly briefings, pipeline reports, and market analysis', color: '#f59e0b' },
];

const MINING_WELCOME = {
  title: 'Welcome to Coppice',
  subtitle: 'An AI operations platform that connects your pipeline, meetings, documents, and email into a single command center — with autonomous agents that work for you.',
  features: [
    { Icon: Search, title: 'Lead Intelligence', desc: 'AI-powered prospect discovery and pipeline management' },
    { Icon: Mail, title: 'Smart Outreach', desc: 'Personalized email campaigns with engagement tracking' },
    { Icon: Mic, title: 'Meeting Capture', desc: 'Auto-transcription, action items, and follow-up generation' },
    { Icon: Bot, title: 'AI Agents', desc: 'Autonomous agents that optimize your operations 24/7' },
  ],
};

// ─── Construction (DACP) Config ──────────────────────────────────────────────

const DACP_DATA_SOURCES = [
  { id: 'pricing', Icon: BarChart3, name: 'Pricing Table', desc: 'Material, labor, and equipment unit costs for concrete work' },
  { id: 'email', Icon: Mail, name: 'Email Inbox', desc: 'Bid request intake, GC correspondence, and follow-ups' },
  { id: 'jobs', Icon: FileText, name: 'Job History', desc: 'Past projects, actual costs, and margin tracking' },
  { id: 'docs', Icon: FileText, name: 'Google Docs', desc: 'Meeting notes, submittals, and document sync' },
  { id: 'calendar', Icon: Calendar, name: 'Google Calendar', desc: 'Meeting scheduling and deadline tracking' },
];

const DACP_AGENTS = [
  { id: 'estimating', name: 'Estimating Bot', desc: 'Reads bid requests, generates line-item estimates from your pricing table, and drafts response emails', color: '#1e3a5f' },
  { id: 'documents', name: 'Documents Agent', desc: 'Processes plans and specs, extracts scope from PDFs, and searches your file library', color: '#7c3aed' },
  { id: 'meetings', name: 'Meeting Bot', desc: 'Auto-joins calls, transcribes, extracts action items, and distributes notes', color: '#1a6b3c' },
  { id: 'email', name: 'Email Agent', desc: 'Drafts professional correspondence, follows up on outstanding bids, and manages your inbox', color: '#f59e0b' },
];

const DACP_WELCOME = {
  title: 'Welcome to DACP',
  subtitle: 'An AI-powered platform that connects your estimating, job tracking, field operations, and documents into a single command center.',
  features: [
    { Icon: BarChart3, title: 'Estimating Engine', desc: 'AI-generated estimates from your pricing table with line-item accuracy' },
    { Icon: FileText, title: 'Job Tracking', desc: 'Active projects, field reports, cost tracking, and margin analysis' },
    { Icon: Search, title: 'Document Intelligence', desc: 'Plan reading, scope extraction, and searchable file library' },
    { Icon: Bot, title: 'AI Agents', desc: 'Autonomous agents that handle bids, emails, and meetings 24/7' },
  ],
};

// ─── Shared Constants ────────────────────────────────────────────────────────

const CONCRETE_SPECIALTIES = [
  'Foundations', 'Slabs-on-Grade', 'Elevated Decks', 'Post-Tension',
  'Curb & Gutter', 'Retaining Walls', 'Tilt-Wall', 'Paving',
];

const SERVICE_AREAS = [
  { id: 'houston', label: 'Greater Houston', available: true },
  { id: 'dfw', label: 'Dallas–Fort Worth', available: true },
  { id: 'sa', label: 'San Antonio', available: true },
  { id: 'austin', label: 'Austin', available: true },
  { id: 'other', label: 'Other Texas', available: true },
];

export default function OnboardingWizard({ onComplete }) {
  const { tenant } = useTenant();
  const isConstruction = tenant?.settings?.industry === 'construction';

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Pick config based on industry
  const DATA_SOURCES = isConstruction ? DACP_DATA_SOURCES : MINING_DATA_SOURCES;
  const AGENTS = isConstruction ? DACP_AGENTS : MINING_AGENTS;
  const WELCOME = isConstruction ? DACP_WELCOME : MINING_WELCOME;
  const brandName = isConstruction ? 'DACP' : 'Coppice';

  // Connect step state
  const [sources, setSources] = useState(
    isConstruction
      ? {
          pricing: { connected: false },
          email: { connected: false, provider: 'gmail' },
          jobs: { connected: false },
          docs: { connected: false },
          calendar: { connected: false },
        }
      : {
          energy: { connected: false, iso: 'ERCOT', node: '', rate: '' },
          calendar: { connected: false },
          gmail: { connected: false },
          docs: { connected: false },
        }
  );
  const [expandedSource, setExpandedSource] = useState(null);

  // DACP-specific state
  const [companyName, setCompanyName] = useState('');
  const [specialties, setSpecialties] = useState([]);
  const [serviceArea, setServiceArea] = useState('houston');
  const [crewSize, setCrewSize] = useState('');

  // Agents step state
  const defaultModes = isConstruction
    ? { estimating: 'copilot', documents: 'copilot', meetings: 'autonomous', email: 'copilot' }
    : { 'lead-engine': 'autonomous', outreach: 'copilot', meetings: 'autonomous', reporting: 'autonomous' };
  const [agentModes, setAgentModes] = useState(defaultModes);

  // Team step state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('viewer');
  const [invitedMembers, setInvitedMembers] = useState([]);

  const goNext = () => { if (step < STEPS.length - 1) { setStep(step + 1); setError(null); } };
  const goBack = () => { if (step > 0) { setStep(step - 1); setError(null); } };

  // Connect helpers
  const updateSource = (id, updates) => {
    setSources(prev => ({ ...prev, [id]: { ...prev[id], ...updates } }));
  };

  // OAuth popup handler for Google integrations
  const handleOAuthConnect = (sourceId, scopes) => {
    let token = null;
    try {
      const session = JSON.parse(sessionStorage.getItem('sangha_auth'));
      token = session?.tokens?.accessToken;
    } catch {}
    if (!token) return;

    const url = `${window.location.origin}/api/v1/auth/google/integrate?scopes=${encodeURIComponent(scopes)}&source=google-${sourceId}&token=${encodeURIComponent(token)}`;
    const popup = window.open(url, 'oauth-popup', 'width=500,height=700,scrollbars=yes');

    const handleMessage = (event) => {
      if (event.data?.type === 'oauth-integration-success') {
        const connectedSource = event.data.source?.replace('google-', '');
        if (connectedSource) {
          updateSource(connectedSource, { connected: true });
        }
        window.removeEventListener('message', handleMessage);
      }
    };
    window.addEventListener('message', handleMessage);

    // Fallback: check if popup was blocked
    if (!popup || popup.closed) {
      window.removeEventListener('message', handleMessage);
      setError('Popup was blocked. Please allow popups for this site.');
    }
  };

  // Check existing Google integrations on mount
  useEffect(() => {
    async function checkConnections() {
      try {
        let token = null;
        try {
          const session = JSON.parse(sessionStorage.getItem('sangha_auth'));
          token = session?.tokens?.accessToken;
        } catch {}
        if (!token) return;
        const res = await fetch(`${window.location.origin}/api/v1/auth/google/integrations`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.connected) {
          const updates = {};
          for (const svc of data.connected) {
            const key = svc.replace('google-', '');
            if (sources[key]) updates[key] = { ...sources[key], connected: true };
          }
          if (Object.keys(updates).length > 0) {
            setSources(prev => ({ ...prev, ...updates }));
          }
        }
      } catch {}
    }
    checkConnections();
  }, []);

  // Team helpers
  const addInvite = () => {
    if (!inviteEmail || !inviteEmail.includes('@')) return;
    setInvitedMembers(prev => [...prev, { email: inviteEmail, role: inviteRole }]);
    setInviteEmail('');
  };

  const removeInvite = (index) => {
    setInvitedMembers(prev => prev.filter((_, i) => i !== index));
  };

  // Summary counts
  const connectedCount = Object.values(sources).filter(s => s.connected).length;
  const activeAgents = Object.values(agentModes).filter(m => m !== 'off').length;

  // Submit
  const handleLaunch = async () => {
    setSubmitting(true);
    setError(null);

    const config = isConstruction
      ? {
          companyName,
          specialties,
          serviceArea,
          crewSize: parseInt(crewSize, 10) || 0,
          agents: agentModes,
          team: invitedMembers,
          sources: Object.fromEntries(
            Object.entries(sources).map(([k, v]) => [k, v.connected])
          ),
        }
      : {
          energy: {
            iso: sources.energy?.iso,
            settlementNode: sources.energy?.node,
            electricityRate: parseFloat(sources.energy?.rate) || 0,
          },
          agents: agentModes,
          team: invitedMembers,
          sources: Object.fromEntries(
            Object.entries(sources).map(([k, v]) => [k, v.connected])
          ),
        };

    try {
      await api.post('/v1/tenant', { settings: config });
      if (onComplete) onComplete(config);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to save configuration');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSkip = () => { if (onComplete) onComplete(null); };

  const toggleSpecialty = (s) => {
    setSpecialties(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  // ─── Step Indicator ──────────────────────────────────────────────────────────
  const renderStepIndicator = () => (
    <div className="flex items-center justify-center gap-0">
      {STEPS.map((s, i) => (
        <div key={s.id} className="flex items-center">
          <div className="flex flex-col items-center">
            <button
              onClick={() => i < step && setStep(i)}
              disabled={i > step}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                i === step
                  ? isConstruction
                    ? 'bg-[#1e3a5f] text-white shadow-[0_0_0_4px_rgba(30,58,95,0.12)]'
                    : 'bg-[#1a6b3c] text-white shadow-[0_0_0_4px_rgba(26,107,60,0.12)]'
                  : i < step
                    ? isConstruction
                      ? 'bg-[#1e3a5f]/15 text-[#1e3a5f] cursor-pointer'
                      : 'bg-[#1a6b3c]/15 text-[#1a6b3c] cursor-pointer'
                    : 'bg-terminal-panel border border-terminal-border text-terminal-muted'
              }`}
            >
              {i < step ? '✓' : i + 1}
            </button>
            <span className={`text-[10px] mt-1.5 font-medium whitespace-nowrap ${
              i === step
                ? isConstruction ? 'text-[#1e3a5f]' : 'text-[#1a6b3c]'
                : i < step ? 'text-terminal-text' : 'text-terminal-muted'
            }`}>{s.label}</span>
          </div>
          {i < STEPS.length - 1 && (
            <div className={`w-14 sm:w-20 h-[2px] mx-1.5 mt-[-14px] rounded-full ${
              i < step
                ? isConstruction ? 'bg-[#1e3a5f]/30' : 'bg-[#1a6b3c]/30'
                : 'bg-terminal-border'
            }`} />
          )}
        </div>
      ))}
    </div>
  );

  const accent = isConstruction ? '#1e3a5f' : '#1a6b3c';
  const accentHover = isConstruction ? '#15304f' : '#155a32';
  const accentDot = isConstruction ? '#3b82f6' : '#2dd478';
  const heroBg = isConstruction
    ? 'bg-gradient-to-br from-[#1e3a5f] to-[#0f1f3a]'
    : 'bg-gradient-to-br from-[#1a2e1a] to-[#0f1f0f]';

  // ─── Step 1: Welcome ─────────────────────────────────────────────────────────
  const renderWelcome = () => (
    <div className="max-w-2xl mx-auto">
      {/* Hero */}
      <div className={`text-center mb-8 px-8 py-10 rounded-[18px] ${heroBg} text-white`}>
        <div className="mx-auto mb-5 flex justify-center">
          <CoppiceLogo color={isConstruction ? '#1e3a5f' : '#1a2e1a'} size={56} />
        </div>
        <h2 className="text-[26px] font-bold mb-2.5 tracking-[-0.3px]">{WELCOME.title}</h2>
        <p className="text-white/55 text-[13px] leading-relaxed max-w-md mx-auto">
          {WELCOME.subtitle}
        </p>
      </div>

      {/* Feature cards */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {WELCOME.features.map(f => (
          <div key={f.title} className="p-5 bg-terminal-panel border border-terminal-border rounded-[14px] hover:border-[#c5c5bc] transition-colors">
            <div className="mb-3">
              <f.Icon size={20} className="text-terminal-muted" />
            </div>
            <h3 className="text-[13px] font-semibold text-terminal-text mb-1">{f.title}</h3>
            <p className="text-[11px] text-terminal-muted leading-[1.5]">{f.desc}</p>
          </div>
        ))}
      </div>

      <p className="text-center text-[11px] text-terminal-muted">
        This setup takes about 2 minutes. You can always change settings later.
      </p>
    </div>
  );

  // ─── Step 2: Connect ─────────────────────────────────────────────────────────
  const renderConnect = () => (
    <div className="max-w-xl mx-auto">
      <div className="mb-6">
        <h2 className="text-[20px] font-bold text-terminal-text mb-1 tracking-[-0.2px]">
          {isConstruction ? 'Connect Your Tools' : 'Connect Your Infrastructure'}
        </h2>
        <p className="text-[13px] text-terminal-muted">
          {isConstruction
            ? 'Link your data sources to unlock AI-powered estimating and project management.'
            : 'Link your data sources to unlock real-time analytics and automation.'}
        </p>
      </div>

      {/* DACP: Company info section */}
      {isConstruction && (
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] p-4 mb-4 space-y-3">
          <div>
            <label className="text-[10px] text-terminal-muted uppercase tracking-[0.8px] mb-1.5 block font-semibold">Company Name</label>
            <input
              type="text"
              value={companyName}
              onChange={e => setCompanyName(e.target.value)}
              placeholder="e.g., DACP Construction"
              className="w-full px-3 py-2 bg-terminal-bg border border-terminal-border rounded-lg text-[13px] text-terminal-text placeholder:text-terminal-muted/50 focus:outline-none focus:border-[#1e3a5f]"
            />
          </div>
          <div>
            <label className="text-[10px] text-terminal-muted uppercase tracking-[0.8px] mb-1.5 block font-semibold">Specialties</label>
            <div className="flex flex-wrap gap-1.5">
              {CONCRETE_SPECIALTIES.map(s => (
                <button
                  key={s}
                  onClick={() => toggleSpecialty(s)}
                  className={`px-3 py-1.5 text-[11px] font-medium rounded-lg transition-all ${
                    specialties.includes(s)
                      ? 'bg-[#1e3a5f]/10 text-[#1e3a5f] border border-[#1e3a5f]/25'
                      : 'bg-[#f5f4f0] text-terminal-muted border border-transparent hover:border-terminal-border'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-terminal-muted uppercase tracking-[0.8px] mb-1.5 block font-semibold">Service Area</label>
              <select
                value={serviceArea}
                onChange={e => setServiceArea(e.target.value)}
                className="w-full px-3 py-2 bg-terminal-bg border border-terminal-border rounded-lg text-[13px] text-terminal-text focus:outline-none focus:border-[#1e3a5f]"
              >
                {SERVICE_AREAS.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-terminal-muted uppercase tracking-[0.8px] mb-1.5 block font-semibold">Crew Size</label>
              <input
                type="number"
                value={crewSize}
                onChange={e => setCrewSize(e.target.value)}
                placeholder="e.g., 45"
                className="w-full px-3 py-2 bg-terminal-bg border border-terminal-border rounded-lg text-[13px] text-terminal-text placeholder:text-terminal-muted/50 focus:outline-none focus:border-[#1e3a5f]"
              />
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {DATA_SOURCES.map(src => {
          const sourceState = sources[src.id];
          if (!sourceState) return null;
          const isExpanded = expandedSource === src.id;

          return (
            <div key={src.id} className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
              {/* Source row */}
              <div
                className="flex items-center gap-3.5 px-4 py-3.5 cursor-pointer hover:bg-[#f5f4f0] transition-colors"
                onClick={() => setExpandedSource(isExpanded ? null : src.id)}
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: `${accent}10` }}>
                  <src.Icon size={16} style={{ color: accent }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-terminal-text">{src.name}</div>
                  <div className="text-[11px] text-terminal-muted">{src.desc}</div>
                </div>
                {sourceState.connected ? (
                  <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-green-50 text-green-700 border border-green-200 shrink-0">Connected</span>
                ) : (
                  <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-[#f5f4f0] text-terminal-muted border border-terminal-border shrink-0">
                    {isConstruction ? 'Connect' : src.id === 'energy' ? 'Configure' : 'Connect'}
                  </span>
                )}
                <span className={`text-[#c5c5bc] text-base transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}>›</span>
              </div>

              {/* Mining: Energy config */}
              {!isConstruction && isExpanded && src.id === 'energy' && (
                <div className="px-4 pb-4 pt-2 border-t border-terminal-border space-y-3">
                  <div>
                    <label className="text-[10px] text-terminal-muted uppercase tracking-[0.8px] mb-1.5 block font-semibold">ISO Region</label>
                    <select
                      value={sourceState.iso}
                      onChange={e => updateSource('energy', { iso: e.target.value })}
                      className="w-full px-3 py-2 bg-terminal-bg border border-terminal-border rounded-lg text-[13px] text-terminal-text focus:outline-none focus:border-[#1a6b3c]"
                    >
                      {ISO_OPTIONS.map(o => (
                        <option key={o.id} value={o.id} disabled={!o.available}>
                          {o.label}{!o.available ? ' (coming soon)' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-terminal-muted uppercase tracking-[0.8px] mb-1.5 block font-semibold">Settlement Node</label>
                    <input
                      type="text"
                      value={sourceState.node}
                      onChange={e => updateSource('energy', { node: e.target.value })}
                      placeholder="e.g., HB_HOUSTON"
                      className="w-full px-3 py-2 bg-terminal-bg border border-terminal-border rounded-lg text-[13px] text-terminal-text placeholder:text-terminal-muted/50 focus:outline-none focus:border-[#1a6b3c]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-terminal-muted uppercase tracking-[0.8px] mb-1.5 block font-semibold">Electricity Rate ($/kWh)</label>
                    <input
                      type="number"
                      step="0.001"
                      value={sourceState.rate}
                      onChange={e => updateSource('energy', { rate: e.target.value })}
                      placeholder="0.045"
                      className="w-full px-3 py-2 bg-terminal-bg border border-terminal-border rounded-lg text-[13px] text-terminal-text placeholder:text-terminal-muted/50 focus:outline-none focus:border-[#1a6b3c]"
                    />
                  </div>
                  <button
                    onClick={() => { updateSource('energy', { connected: true }); setExpandedSource(null); }}
                    className={`w-full py-2.5 text-[13px] font-semibold rounded-lg transition-colors ${
                      sourceState.connected
                        ? 'bg-green-50 text-green-700 border border-green-200'
                        : 'bg-[#1a6b3c] text-white hover:bg-[#155a32]'
                    }`}
                  >
                    {sourceState.connected ? '✓ Connected' : 'Connect Energy Source'}
                  </button>
                </div>
              )}

              {/* Generic connect (OAuth and non-OAuth sources) */}
              {isExpanded && !['energy'].includes(src.id) && !(
                !isConstruction && ['energy'].includes(src.id)
              ) && (
                <div className="px-4 pb-4 pt-2 border-t border-terminal-border">
                  <p className="text-[12px] text-terminal-muted mb-3">
                    {isConstruction
                      ? {
                          pricing: 'Import your master pricing table — material, labor, and equipment costs per unit.',
                          email: 'Connect Gmail to auto-import bid requests and manage GC correspondence.',
                          jobs: 'Import your job history for cost tracking and estimate benchmarking.',
                          docs: 'Connect Google Docs to sync meeting notes, submittals, and reports.',
                          calendar: 'Connect Google Calendar to track bid deadlines and meeting schedules.',
                        }[src.id]
                      : {
                          calendar: 'Grant your agent read access to your Google Calendar for meeting tracking and scheduling.',
                          gmail: 'Connect Gmail so your agent can read incoming messages and draft responses.',
                          docs: 'Connect Google Docs & Drive for document sync, meeting notes, and file access.',
                        }[src.id]}
                  </p>
                  <button
                    onClick={() => {
                      if (src.oauth === 'google') {
                        handleOAuthConnect(src.id, src.scopes);
                      } else {
                        updateSource(src.id, { connected: !sourceState.connected });
                        setExpandedSource(null);
                      }
                    }}
                    className={`w-full py-2.5 text-[13px] font-semibold rounded-lg transition-colors ${
                      sourceState.connected
                        ? 'bg-green-50 text-green-700 border border-green-200'
                        : `text-white hover:opacity-90`
                    }`}
                    style={sourceState.connected ? {} : { backgroundColor: accent }}
                  >
                    {sourceState.connected ? '✓ Connected' : `Connect ${src.name}`}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-center text-[11px] text-terminal-muted mt-5">
        {connectedCount} of {DATA_SOURCES.length} sources connected — you can add more later from Settings.
      </p>
    </div>
  );

  // ─── Step 3: Agents ──────────────────────────────────────────────────────────
  const renderAgents = () => (
    <div className="max-w-xl mx-auto">
      <div className="mb-6">
        <h2 className="text-[20px] font-bold text-terminal-text mb-1 tracking-[-0.2px]">Configure Your Agents</h2>
        <p className="text-[13px] text-terminal-muted">
          {isConstruction
            ? 'Set up AI agents to automate estimating, document processing, and communication.'
            : 'Set up autonomous AI agents to monitor and optimize your operations.'}
        </p>
      </div>

      <div className="space-y-3">
        {AGENTS.map(agent => (
          <div key={agent.id} className="bg-terminal-panel border border-terminal-border rounded-[14px] p-[18px]">
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: agent.color }} />
                  <h3 className="text-[13px] font-semibold text-terminal-text">{agent.name}</h3>
                </div>
                <p className="text-[11px] text-terminal-muted leading-[1.5] pl-[18px]">{agent.desc}</p>
              </div>
            </div>
            <div className="flex gap-1.5 pl-[18px]">
              {['autonomous', 'copilot', 'off'].map(mode => (
                <button
                  key={mode}
                  onClick={() => setAgentModes(prev => ({ ...prev, [agent.id]: mode }))}
                  className={`px-3.5 py-[6px] text-[11px] font-semibold rounded-lg transition-all ${
                    agentModes[agent.id] === mode
                      ? mode === 'off'
                        ? 'bg-[#f0eeea] text-terminal-muted border border-terminal-border'
                        : mode === 'autonomous'
                          ? `bg-[${accent}]/10 text-[${accent}] border border-[${accent}]/25`
                          : 'bg-blue-50 text-blue-700 border border-blue-200'
                      : 'text-terminal-muted hover:bg-[#f5f4f0] border border-transparent'
                  }`}
                  style={
                    agentModes[agent.id] === mode && mode === 'autonomous'
                      ? { backgroundColor: `${accent}15`, color: accent, borderColor: `${accent}40` }
                      : {}
                  }
                >
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 p-3.5 bg-[#f5f4f0] rounded-[12px]">
        <div className="flex items-start gap-2.5">
          <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-px" style={{ backgroundColor: `${accent}15` }}>
            <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: accent }} />
          </div>
          <div>
            <p className="text-[12px] text-terminal-text font-medium mb-0.5">{activeAgents} of {AGENTS.length} agents active</p>
            <p className="text-[11px] text-terminal-muted leading-[1.4]">
              <strong>Autonomous</strong> agents act on their own. <strong>Copilot</strong> agents suggest actions and wait for your approval.
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  // ─── Step 4: Team ────────────────────────────────────────────────────────────
  const renderTeam = () => (
    <div className="max-w-xl mx-auto">
      <div className="mb-6">
        <h2 className="text-[20px] font-bold text-terminal-text mb-1 tracking-[-0.2px]">Invite Your Team</h2>
        <p className="text-[13px] text-terminal-muted">
          {isConstruction
            ? 'Add project managers, estimators, and field crew to collaborate.'
            : 'Add team members to collaborate on your operations.'}
        </p>
      </div>

      {/* Invite form */}
      <div className="bg-terminal-panel border border-terminal-border rounded-[14px] p-4 mb-4">
        <div className="flex gap-2">
          <input
            type="email"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            placeholder="email@example.com"
            className="flex-1 px-3 py-2.5 bg-terminal-bg border border-terminal-border rounded-lg text-[13px] text-terminal-text placeholder:text-terminal-muted/50 focus:outline-none focus:border-[#1a6b3c]"
            onKeyDown={e => e.key === 'Enter' && addInvite()}
          />
          <select
            value={inviteRole}
            onChange={e => setInviteRole(e.target.value)}
            className="px-3 py-2.5 bg-terminal-bg border border-terminal-border rounded-lg text-[13px] text-terminal-text focus:outline-none focus:border-[#1a6b3c]"
          >
            {isConstruction ? (
              <>
                <option value="viewer">Viewer</option>
                <option value="operator">Estimator</option>
                <option value="admin">Project Manager</option>
              </>
            ) : (
              <>
                <option value="viewer">Viewer</option>
                <option value="operator">Operator</option>
                <option value="admin">Admin</option>
              </>
            )}
          </select>
          <button
            onClick={addInvite}
            disabled={!inviteEmail}
            className="px-5 py-2.5 text-white text-[13px] font-semibold rounded-lg hover:opacity-90 transition-colors disabled:opacity-40 shrink-0"
            style={{ backgroundColor: accent }}
          >
            Invite
          </button>
        </div>
      </div>

      {/* Invited list */}
      {invitedMembers.length > 0 ? (
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          {invitedMembers.map((m, i) => (
            <div key={i} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-terminal-border' : ''}`}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                style={{ backgroundColor: `${accent}15`, color: accent }}>
                {m.email.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-terminal-text truncate">{m.email}</div>
              </div>
              <span className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-[#f5f4f0] text-terminal-muted border border-terminal-border capitalize shrink-0">{m.role}</span>
              <button onClick={() => removeInvite(i)} className="text-terminal-muted hover:text-terminal-red text-sm shrink-0">✕</button>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-10">
          <div className="w-12 h-12 rounded-full bg-[#f5f4f0] flex items-center justify-center mx-auto mb-3">
            <Users size={20} className="text-terminal-muted" />
          </div>
          <p className="text-[13px] text-terminal-muted">No team members invited yet</p>
          <p className="text-[11px] text-terminal-muted mt-1">You can always invite people later from Settings.</p>
        </div>
      )}
    </div>
  );

  // ─── Step 5: Launch ──────────────────────────────────────────────────────────
  const renderLaunch = () => (
    <div className="max-w-lg mx-auto text-center">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5"
        style={{ backgroundColor: `${accent}15` }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={accent} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </div>

      <h2 className="text-[26px] font-bold text-terminal-text mb-2 tracking-[-0.3px]">You're All Set!</h2>
      <p className="text-[13px] text-terminal-muted mb-8">
        Your {brandName} command center is configured and ready to launch.
      </p>

      <div className="grid grid-cols-3 gap-3 mb-8">
        {[
          { label: 'Agents Active', value: activeAgents, sub: `of ${AGENTS.length}` },
          { label: 'Sources Connected', value: connectedCount, sub: `of ${DATA_SOURCES.length}` },
          { label: 'Team Members', value: invitedMembers.length, sub: 'invited' },
        ].map(s => (
          <div key={s.label} className="bg-terminal-panel border border-terminal-border rounded-[14px] p-4">
            <div className="text-[28px] font-bold text-terminal-text tabular-nums leading-none">{s.value}</div>
            <div className="text-[10px] text-terminal-muted uppercase tracking-[0.8px] mt-1.5 font-semibold">{s.label}</div>
            <div className="text-[10px] text-terminal-muted mt-0.5">{s.sub}</div>
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4 px-4 py-2.5 bg-red-50 border border-red-200 rounded-[12px] text-red-700 text-[13px] text-left">
          {error}
        </div>
      )}

      <button
        onClick={handleLaunch}
        disabled={submitting}
        className="w-full py-3.5 text-white font-bold rounded-[14px] hover:opacity-90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2 text-[15px]"
        style={{ backgroundColor: accent }}
      >
        {submitting && <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
        Launch Dashboard
      </button>

      <p className="text-[11px] text-terminal-muted mt-4">
        You can adjust all settings from the Settings panel anytime.
      </p>
    </div>
  );

  // ─── Render ──────────────────────────────────────────────────────────────────
  const renderStep = () => {
    switch (step) {
      case 0: return renderWelcome();
      case 1: return renderConnect();
      case 2: return renderAgents();
      case 3: return renderTeam();
      case 4: return renderLaunch();
      default: return null;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-terminal-bg overflow-y-auto">
      <div className="min-h-screen flex flex-col">
        {/* Top bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-terminal-border bg-terminal-panel">
          <div className="flex items-center gap-2.5">
            <CoppiceLogo color={isConstruction ? '#1e3a5f' : '#1a2e1a'} size={28} />
            <span className="text-[13px] font-semibold text-terminal-text tracking-[0.2px]">Setup</span>
          </div>
          <button onClick={handleSkip} className="text-[12px] text-terminal-muted hover:text-terminal-text transition-colors">
            Skip Setup →
          </button>
        </div>

        {/* Step indicator */}
        <div className="px-6 pt-6 pb-2">
          {renderStepIndicator()}
        </div>

        {/* Content */}
        <div className="flex-1 px-6 py-6">
          {renderStep()}
        </div>

        {/* Bottom nav */}
        {step < 4 && (
          <div className="px-6 py-4 border-t border-terminal-border bg-terminal-panel flex items-center justify-between">
            <button
              onClick={goBack}
              disabled={step === 0}
              className="px-5 py-2 text-[13px] text-terminal-muted border border-terminal-border rounded-lg disabled:opacity-30 hover:bg-terminal-bg transition-colors"
            >
              Back
            </button>
            <span className="text-[11px] text-terminal-muted tabular-nums">
              Step {step + 1} of {STEPS.length}
            </span>
            <button
              onClick={goNext}
              className="px-6 py-2 text-[13px] text-white font-semibold rounded-lg hover:opacity-90 transition-colors"
              style={{ backgroundColor: accent }}
            >
              Continue
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import {
  Building2, DollarSign, BarChart3, MessageSquare, FileText,
  Truck, Users, AlertTriangle, ChevronDown, Mail, Settings as SettingsIcon
} from 'lucide-react';
import SettingsTeamPanel from './SettingsTeamPanel';
import api from '../lib/hooks/useApi';
const EmailSecurityPanel = lazy(() => import('./EmailSecurityPanel'));

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

  // Save a single section — merges with existing settings so other sections aren't lost
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

  const [settingsTab, setSettingsTab] = useState('general');
  const storedUser = JSON.parse(localStorage.getItem('coppice_user') || '{}');
  const isAdmin = ['owner', 'admin'].includes(storedUser.role);

  const SETTINGS_TABS = [
    { id: 'general', label: 'General', icon: SettingsIcon },
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
        <div className="flex gap-2.5 mt-4">
          <Btn variant="secondary">+ Add Line Item</Btn>
          <Btn variant="secondary">Import from Excel</Btn>
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
              { value: 'copilot', label: 'Copilot — drafts estimates for review' },
              { value: 'autonomous', label: 'Autonomous — sends after approval delay' },
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
        <div className="flex gap-2.5 mt-4">
          <Btn variant="secondary">+ Add Supplier</Btn>
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
        <div className="flex gap-2.5 mt-4">
          <Btn variant="secondary">+ Add GC</Btn>
          <Btn variant="secondary">Import from Contacts</Btn>
          <Btn onClick={() => saveSettings('gcContacts', gcContacts)} saving={saving} saved={savedSection === 'gcContacts'}>Save GC List</Btn>
        </div>
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

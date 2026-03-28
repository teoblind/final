import React, { useState } from 'react';
import { useApi, putApi } from '../../../hooks/useApi';
import { Card, KVRow } from './shared';

const DEMO_CONFIG = {
  mode: 'copilot',
  enabled: 1,
  queries: ['solar IPP ERCOT negative LMP', 'wind energy developer PJM underperforming', 'renewable IPP curtailment MISO'],
  regions: ['ERCOT', 'PJM', 'MISO', 'SPP', 'CAISO'],
  queries_per_cycle: 2,
  max_emails_per_cycle: 10,
  followup_delay_days: 5,
  max_followups: 2,
  sender_name: 'Sangha Renewables',
  sender_email: 'outreach@sangha.io',
};

export default function ConfigTab() {
  const { data: configData, refetch: refetchConfig } = useApi('/lead-engine/config', { refreshInterval: 60000 });
  const config = configData?.config || DEMO_CONFIG;

  const [editing, setEditing] = useState(false);

  return (
    <div className="p-6 lg:px-7 lg:py-6">
      {/* Agent Info */}
      <Card title="Agent Info" meta="Read-only">
        <KVRow label="Enrichment" value="Apollo" cls="sans" />
        <KVRow label="Personalization" value="Sonnet 4.6" cls="sans" />
        <KVRow label="Sending" value="Gmail API" cls="sans" />
      </Card>

      <div className="h-4" />

      {/* Config */}
      {!editing ? (
        <Card title="Agent Configuration" meta={
          <button onClick={() => setEditing(true)} className="text-[11px] font-semibold text-ui-accent hover:opacity-70">Edit</button>
        }>
          <KVRow label="Mode" value={config.mode === 'autonomous' ? 'Autonomous' : 'Copilot'} cls="accent" />
          <KVRow label="Status" value={config.enabled ? 'Active' : 'Paused'} cls={config.enabled ? 'green' : 'muted'} />
          <KVRow label="Queries" value={`${(config.queries || []).length} configured`} cls="" />
          <KVRow label="Regions" value={(config.regions || []).join(', ')} cls="sans" />
          <KVRow label="Emails / Cycle" value={config.max_emails_per_cycle || 10} cls="" />
          <KVRow label="Follow-Up After" value={`${config.followup_delay_days || 5} days`} cls="" />
          <KVRow label="Max Follow-Ups" value={config.max_followups || 2} cls="" />
          <KVRow label="Sender" value={config.sender_name || '-'} cls="sans" />
          <KVRow label="Send From" value={config.sender_email || '-'} cls="muted" />
        </Card>
      ) : (
        <ConfigEditor config={config} onSave={async (updated) => {
          try {
            await putApi('/lead-engine/config', updated);
            refetchConfig();
            setEditing(false);
          } catch (err) {
            console.error('Config save failed:', err);
          }
        }} onClose={() => setEditing(false)} />
      )}
    </div>
  );
}

function ConfigEditor({ config, onSave, onClose }) {
  const [mode, setMode] = useState(config.mode || 'copilot');
  const [enabled, setEnabled] = useState(!!config.enabled);
  const [queries, setQueries] = useState((config.queries || []).join('\n'));
  const [regions, setRegions] = useState((config.regions || []).join(', '));
  const [maxEmails, setMaxEmails] = useState(config.max_emails_per_cycle || 10);
  const [followupDays, setFollowupDays] = useState(config.followup_delay_days || 5);
  const [senderName, setSenderName] = useState(config.sender_name || '');
  const [senderEmail, setSenderEmail] = useState(config.sender_email || '');

  const handleSave = () => {
    onSave({
      mode,
      enabled,
      queries: queries.split('\n').map(q => q.trim()).filter(Boolean),
      regions: regions.split(',').map(r => r.trim()).filter(Boolean),
      maxEmailsPerCycle: parseInt(maxEmails) || 10,
      followupDelayDays: parseInt(followupDays) || 5,
      maxFollowups: config.max_followups || 2,
      queriesPerCycle: config.queries_per_cycle || 2,
      minSendIntervalSeconds: config.min_send_interval_seconds || 300,
      senderName,
      senderEmail,
    });
  };

  return (
    <Card title="Lead Engine Configuration" meta={
      <button onClick={onClose} className="text-[11px] font-semibold text-terminal-muted hover:text-terminal-text">Close</button>
    }>
      <div className="p-[18px] space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] font-bold text-terminal-muted uppercase tracking-[0.8px] block mb-1">Mode</label>
            <select value={mode} onChange={e => setMode(e.target.value)} className="w-full px-3 py-2 border border-terminal-border rounded-lg text-[13px] bg-[#f5f4f0] text-terminal-text">
              <option value="copilot">Copilot (manual approval)</option>
              <option value="autonomous">Autonomous (auto-send)</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-terminal-muted uppercase tracking-[0.8px] block mb-1">Status</label>
            <button onClick={() => setEnabled(!enabled)} className={`px-4 py-2 rounded-lg text-[13px] font-semibold border transition-all ${enabled ? 'bg-ui-accent-light text-ui-accent border-ui-accent-light' : 'bg-[#f5f4f0] text-[#9a9a92] border-terminal-border'}`}>
              {enabled ? 'Active' : 'Paused'}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] font-bold text-terminal-muted uppercase tracking-[0.8px] block mb-1">Sender Name</label>
            <input value={senderName} onChange={e => setSenderName(e.target.value)} className="w-full px-3 py-2 border border-terminal-border rounded-lg text-[13px] bg-[#f5f4f0] text-terminal-text" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-terminal-muted uppercase tracking-[0.8px] block mb-1">Send From Email</label>
            <input value={senderEmail} onChange={e => setSenderEmail(e.target.value)} className="w-full px-3 py-2 border border-terminal-border rounded-lg text-[13px] bg-[#f5f4f0] text-terminal-text" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] font-bold text-terminal-muted uppercase tracking-[0.8px] block mb-1">Max Emails / Cycle</label>
            <input type="number" value={maxEmails} onChange={e => setMaxEmails(e.target.value)} className="w-full px-3 py-2 border border-terminal-border rounded-lg text-[13px] bg-[#f5f4f0] text-terminal-text" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-terminal-muted uppercase tracking-[0.8px] block mb-1">Follow-Up After (days)</label>
            <input type="number" value={followupDays} onChange={e => setFollowupDays(e.target.value)} className="w-full px-3 py-2 border border-terminal-border rounded-lg text-[13px] bg-[#f5f4f0] text-terminal-text" />
          </div>
        </div>
        <div>
          <label className="text-[10px] font-bold text-terminal-muted uppercase tracking-[0.8px] block mb-1">Target Regions</label>
          <input value={regions} onChange={e => setRegions(e.target.value)} className="w-full px-3 py-2 border border-terminal-border rounded-lg text-[13px] bg-[#f5f4f0] text-terminal-text" placeholder="ERCOT, PJM, MISO, SPP" />
        </div>
        <div>
          <label className="text-[10px] font-bold text-terminal-muted uppercase tracking-[0.8px] block mb-1">Search Queries (one per line)</label>
          <textarea value={queries} onChange={e => setQueries(e.target.value)} rows={6} className="w-full px-3 py-2 border border-terminal-border rounded-lg text-[13px] bg-[#f5f4f0] text-terminal-text font-mono" />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-[13px] font-semibold bg-terminal-panel text-[#6b6b65] border border-terminal-border hover:bg-[#f5f4f0] transition-colors">Cancel</button>
          <button onClick={handleSave} className="px-4 py-2 rounded-lg text-[13px] font-semibold bg-ui-accent text-white border border-ui-accent hover:opacity-90 transition-colors">Save Configuration</button>
        </div>
      </div>
    </Card>
  );
}

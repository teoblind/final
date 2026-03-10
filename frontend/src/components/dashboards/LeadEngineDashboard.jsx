import React, { useState, useRef, useEffect } from 'react';
import { useApi, postApi, putApi } from '../../hooks/useApi';

// ─── Fallback Demo Data ─────────────────────────────────────────────────────

const DEMO_STATS = {
  totalLeads: 502, newLeads: 34, contactedLeads: 96, respondedLeads: 7,
  meetingLeads: 2, qualifiedLeads: 1, totalEmailsSent: 96,
  totalResponded: 7, responseRate: 7.3, pendingDrafts: 3, sentToday: 8,
};

const DEMO_LEADS = [
  { id: 'le-s-001', venue_name: 'Meridian Renewables', region: 'ERCOT', industry: 'Solar IPP', status: 'responded', priority_score: 92, discovered_at: '2026-02-20', contactCount: 1 },
  { id: 'le-s-002', venue_name: 'GridScale Partners', region: 'PJM', industry: 'Wind IPP', status: 'responded', priority_score: 85, discovered_at: '2026-02-22', contactCount: 1 },
  { id: 'le-s-004', venue_name: 'SunPeak Energy', region: 'ERCOT', industry: 'Solar IPP', status: 'meeting', priority_score: 88, discovered_at: '2026-02-18', contactCount: 1 },
  { id: 'le-s-005', venue_name: 'Apex Clean Energy', region: 'SPP', industry: 'Wind/Solar', status: 'responded', priority_score: 90, discovered_at: '2026-02-15', contactCount: 1 },
  { id: 'le-s-006', venue_name: 'Clearway Energy', region: 'ERCOT', industry: 'Wind IPP', status: 'contacted', priority_score: 75, discovered_at: '2026-03-01', contactCount: 1 },
  { id: 'le-s-003', venue_name: 'Nexus Solar', region: 'MISO', industry: 'Solar IPP', status: 'contacted', priority_score: 60, discovered_at: '2026-02-25', contactCount: 1 },
  { id: 'le-s-007', venue_name: 'EDP Renewables', region: 'MISO', industry: 'Solar IPP', status: 'new', priority_score: 70, discovered_at: '2026-03-07', contactCount: 1 },
  { id: 'le-s-008', venue_name: 'NextEra Partners', region: 'ERCOT', industry: 'Wind/Solar', status: 'new', priority_score: 95, discovered_at: '2026-03-07', contactCount: 1 },
];

const DEMO_OUTREACH = [
  { id: 'lo-s-001', venue_name: 'Meridian Renewables', contact_name: 'Sarah Chen', contact_email: 'schen@meridianrenewables.com', email_type: 'initial', subject: 'Behind-the-meter mining for Crane County', status: 'sent', sent_at: '2026-03-02T09:14:00', responded_at: '2026-03-07T11:42:00', body: 'Hi Sarah,\n\nI came across Meridian\'s Crane County solar portfolio and noticed your assets have been facing some of the same negative LMP challenges that many ERCOT operators are dealing with right now.\n\nWe\'ve been working with renewable operators to co-locate behind-the-meter Bitcoin mining on underperforming sites — effectively creating an additional revenue stream from the same infrastructure.\n\nWould be happy to share how this has worked on similar assets.\n\nBest,\nSangha Renewables' },
  { id: 'lo-s-002', venue_name: 'GridScale Partners', contact_name: 'Mark Liu', contact_email: 'mliu@gridscalepartners.com', email_type: 'initial', subject: 'Hashrate co-location for underperforming wind assets', status: 'sent', sent_at: '2026-03-03T10:22:00', responded_at: '2026-03-05T14:18:00', body: 'Hi Mark,\n\nGridScale\'s PJM wind portfolio caught our attention — we work with operators who are turning curtailed or low-price hours into reliable mining revenue.\n\nWould love to share our approach if relevant.\n\nBest,\nSangha Renewables' },
  { id: 'lo-s-004', venue_name: 'Meridian Renewables', contact_name: 'Sarah Chen', contact_email: 'schen@meridianrenewables.com', email_type: 'followup_1', subject: 'Re: Behind-the-meter mining for Crane County', status: 'draft', sent_at: null, responded_at: null, body: 'Hi Sarah,\n\nGreat to hear there\'s alignment. I\'ll put together a brief overview of our typical project structure for a site in your capacity range.\n\nWould Thursday or Friday afternoon work for a quick call?\n\nBest,\nSangha Renewables' },
];

const DEMO_CONFIG = {
  mode: 'copilot',
  enabled: 1,
  queries: ['solar IPP ERCOT negative LMP', 'wind energy developer PJM underperforming', 'renewable IPP curtailment MISO', 'solar farm operator SPP Oklahoma', 'wind portfolio ERCOT West Texas'],
  regions: ['ERCOT', 'PJM', 'MISO', 'SPP', 'CAISO'],
  queries_per_cycle: 2,
  max_emails_per_cycle: 10,
  followup_delay_days: 5,
  max_followups: 2,
  sender_name: 'Sangha Renewables',
  sender_email: 'outreach@sangha.io',
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const STAGE_CLS = {
  new: 'bg-[#f5f4f0] text-[#9a9a92]',
  enriched: 'bg-[#f0f0ff] text-[#6366f1]',
  contacted: 'bg-[#eff6ff] text-[#2563eb]',
  responded: 'bg-[#fdf6e8] text-[#b8860b]',
  meeting: 'bg-[#edf7f0] text-[#1a6b3c]',
  qualified: 'bg-[#f3f0ff] text-[#7c3aed]',
  closed: 'bg-[#edf7f0] text-[#1a6b3c]',
  declined: 'bg-[#fef2f2] text-[#c0392b]',
};

const OUTREACH_STATUS_CLS = {
  draft: 'bg-[#f5f4f0] text-[#9a9a92]',
  pending_approval: 'bg-[#fdf6e8] text-[#b8860b]',
  approved: 'bg-[#eff6ff] text-[#2563eb]',
  sent: 'bg-[#edf7f0] text-[#1a6b3c]',
  bounced: 'bg-[#fef2f2] text-[#c0392b]',
  responded: 'bg-[#f3f0ff] text-[#7c3aed]',
};

const SUB_CLS = { green: 'text-[#1a6b3c]', warn: 'text-[#b8860b]', danger: 'text-[#c0392b]', flat: 'text-terminal-muted' };

function Card({ title, meta, children }) {
  return (
    <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
      <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
        <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">{title}</span>
        {meta && <span className="text-[11px] text-terminal-muted">{meta}</span>}
      </div>
      {children}
    </div>
  );
}

function timeAgo(dateStr) {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function LeadEngineDashboard() {
  const [filter, setFilter] = useState('all');
  const [leadSearch, setLeadSearch] = useState('');
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [actionLoading, setActionLoading] = useState(null);
  const searchRef = useRef(null);

  // API data
  const { data: statsData, refetch: refetchStats } = useApi('/lead-engine/stats', { refreshInterval: 30000 });
  const { data: leadsData, refetch: refetchLeads } = useApi('/lead-engine/leads', { refreshInterval: 30000 });
  const { data: outreachData, refetch: refetchOutreach } = useApi('/lead-engine/outreach', { refreshInterval: 30000 });
  const { data: configData, refetch: refetchConfig } = useApi('/lead-engine/config', { refreshInterval: 60000 });

  // Use API data or fall back to demo
  const stats = statsData || DEMO_STATS;
  const leads = leadsData?.leads || DEMO_LEADS;
  const outreach = outreachData?.outreach || DEMO_OUTREACH;
  const config = configData?.config || DEMO_CONFIG;

  // Select first lead on mount
  useEffect(() => {
    if (!selectedLeadId && leads.length > 0) {
      setSelectedLeadId(leads[0].id);
    }
  }, [leads, selectedLeadId]);

  const filteredLeads = leads.filter(l => {
    if (filter === 'responded' && l.status !== 'responded') return false;
    if (filter === 'contacted' && l.status !== 'contacted') return false;
    if (filter === 'new' && l.status !== 'new') return false;
    if (leadSearch) {
      const q = leadSearch.toLowerCase();
      return (l.venue_name || '').toLowerCase().includes(q)
        || (l.industry || '').toLowerCase().includes(q)
        || (l.region || '').toLowerCase().includes(q);
    }
    return true;
  });

  const selectedOutreach = outreach.filter(o => {
    const lead = leads.find(l => l.id === selectedLeadId);
    return lead && o.venue_name === lead.venue_name;
  });

  // Pipeline counts
  const pipelineCounts = {
    new: leads.filter(l => l.status === 'new').length,
    enriched: leads.filter(l => l.status === 'enriched').length,
    contacted: leads.filter(l => l.status === 'contacted').length,
    responded: leads.filter(l => l.status === 'responded').length,
    meeting: leads.filter(l => l.status === 'meeting').length,
    qualified: leads.filter(l => l.status === 'qualified' || l.status === 'closed').length,
  };
  const pipelineMax = Math.max(...Object.values(pipelineCounts), 1);

  const FUNNEL = [
    { label: 'New', count: pipelineCounts.new, gradient: 'from-[#9a9a92] to-[#b5b5ad]' },
    { label: 'Contacted', count: pipelineCounts.contacted, gradient: 'from-[#2563eb] to-[#3b82f6]' },
    { label: 'Responded', count: pipelineCounts.responded, gradient: 'from-[#b8860b] to-[#d4a00a]' },
    { label: 'Meeting', count: pipelineCounts.meeting, gradient: 'from-[#1a6b3c] to-[#22884d]' },
    { label: 'Qualified', count: pipelineCounts.qualified, gradient: 'from-[#7c3aed] to-[#8b5cf6]' },
  ];

  // Actions
  const refetchAll = () => { refetchStats(); refetchLeads(); refetchOutreach(); refetchConfig(); };

  const handleAction = async (action) => {
    setActionLoading(action);
    try {
      await postApi(`/lead-engine/${action}`);
      refetchAll();
    } catch (err) {
      console.error(`Action ${action} failed:`, err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleApprove = async (outreachId) => {
    try {
      await postApi(`/lead-engine/outreach/${outreachId}/approve`);
      refetchOutreach();
    } catch (err) {
      console.error('Approve failed:', err);
    }
  };

  // Stat cells
  const STAT_CELLS = [
    { label: 'Total Leads', val: stats.totalLeads, sub: stats.newLeads ? `+${stats.newLeads} new` : null, subCls: 'green', highlight: true },
    { label: 'Contacted', val: stats.contactedLeads, sub: null, subCls: 'flat' },
    { label: 'Response Rate', val: stats.responseRate, unit: '%', sub: 'vs emails sent', subCls: stats.responseRate >= 5 ? 'green' : 'flat' },
    { label: 'Emails Sent', val: stats.totalEmailsSent, sub: stats.sentToday ? `+${stats.sentToday} today` : null, subCls: 'green' },
    { label: 'Sent Today', val: stats.sentToday, sub: null, subCls: 'flat' },
    { label: 'Pending Drafts', val: stats.pendingDrafts, sub: stats.pendingDrafts > 0 ? 'Needs review' : 'All clear', subCls: stats.pendingDrafts > 0 ? 'warn' : 'green' },
  ];

  return (
    <div className="p-6 lg:px-7 lg:py-6">
      {/* Header pills + Actions */}
      <div className="flex items-center justify-between gap-2 mb-5">
        <div className="flex items-center gap-2">
          {[{ l: 'All', v: 'all' }, { l: 'New', v: 'new' }, { l: 'Contacted', v: 'contacted' }, { l: 'Replied', v: 'responded' }].map(f => (
            <button
              key={f.v}
              onClick={() => setFilter(f.v)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
                filter === f.v
                  ? 'bg-terminal-text text-white border-terminal-text'
                  : 'bg-terminal-panel text-terminal-muted border-terminal-border hover:bg-[#f5f4f0]'
              }`}
            >
              {f.l}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleAction('discover')}
            disabled={actionLoading === 'discover'}
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-terminal-panel text-terminal-text border border-terminal-border hover:bg-[#f5f4f0] transition-all disabled:opacity-50"
          >
            {actionLoading === 'discover' ? 'Discovering...' : 'Run Discovery'}
          </button>
          <button
            onClick={() => handleAction('generate-outreach')}
            disabled={actionLoading === 'generate-outreach'}
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-terminal-panel text-terminal-text border border-terminal-border hover:bg-[#f5f4f0] transition-all disabled:opacity-50"
          >
            {actionLoading === 'generate-outreach' ? 'Generating...' : 'Generate Outreach'}
          </button>
          <button
            onClick={() => handleAction('run-cycle')}
            disabled={actionLoading === 'run-cycle'}
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-terminal-green text-white border border-terminal-green hover:opacity-90 transition-all disabled:opacity-50"
          >
            {actionLoading === 'run-cycle' ? 'Running...' : 'Full Cycle'}
          </button>
          <div className="w-px h-5 bg-terminal-border mx-1" />
          {stats.sheetUrl && (
            <a
              href={stats.sheetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-terminal-panel text-terminal-text border border-terminal-border hover:bg-[#f5f4f0] transition-all flex items-center gap-1.5"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              View in Sheets
            </a>
          )}
          <button
            disabled
            title="Coming soon — sync leads, contacts & deals to HubSpot"
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-terminal-panel text-[#c5c5bc] border border-terminal-border cursor-not-allowed opacity-60"
          >
            Export to HubSpot
          </button>
          <button
            onClick={() => setShowConfig(!showConfig)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
              showConfig ? 'bg-terminal-text text-white border-terminal-text' : 'bg-terminal-panel text-terminal-muted border-terminal-border hover:bg-[#f5f4f0]'
            }`}
          >
            Config
          </button>
        </div>
      </div>

      {/* Stats ticker */}
      <div className="flex gap-[1px] bg-terminal-border border border-terminal-border rounded-[14px] overflow-hidden mb-4">
        {STAT_CELLS.map((s, i) => (
          <div
            key={i}
            className="bg-terminal-panel p-[14px_18px] flex-1"
            style={s.highlight ? { background: 'linear-gradient(135deg, var(--t-panel, #fff), #edf7f0)' } : undefined}
          >
            <div className="text-[9px] font-bold text-terminal-muted uppercase tracking-[1px] mb-[3px]">{s.label}</div>
            <div className="text-xl font-bold tabular-nums font-mono leading-none text-terminal-text">
              {s.val}{s.unit && <span className="text-[11px] font-medium text-terminal-muted">{s.unit}</span>}
            </div>
            {s.sub && <div className={`text-[10px] font-semibold mt-[3px] ${SUB_CLS[s.subCls]}`}>{s.sub}</div>}
          </div>
        ))}
      </div>

      {/* Pipeline + Replies */}
      <div className="grid grid-cols-1 lg:grid-cols-[5fr_3fr] gap-4 mb-4">
        {/* Pipeline Funnel */}
        <Card title="Pipeline Funnel" meta={`${stats.totalLeads} total leads`}>
          <div className="p-[18px] flex flex-col gap-[6px]">
            {FUNNEL.map((f, i) => {
              const pct = pipelineMax > 0 ? Math.max((f.count / pipelineMax) * 100, 2) : 2;
              return (
                <div key={i} className="flex items-center gap-3">
                  <div className="text-xs font-medium text-[#6b6b65] w-[90px] text-right shrink-0">{f.label}</div>
                  <div className="flex-1 h-7 bg-[#f5f4f0] rounded-md overflow-hidden">
                    <div
                      className={`h-full rounded-md bg-gradient-to-r ${f.gradient} flex items-center pl-[10px]`}
                      style={{ width: `${pct}%` }}
                    >
                      {pct > 15 && <span className="text-[11px] font-bold text-white whitespace-nowrap">{f.count}</span>}
                    </div>
                  </div>
                  <div className="font-mono text-[13px] font-bold text-terminal-text min-w-[40px]">{f.count}</div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Reply Inbox */}
        <Card title="Reply Inbox" meta={`${stats.respondedLeads || 0} replies`}>
          <div>
            {outreach.filter(o => o.responded_at).length === 0 && (
              <div className="px-[18px] py-6 text-center text-sm text-terminal-muted">No replies yet</div>
            )}
            {outreach.filter(o => o.responded_at).map((o, i) => (
              <div
                key={i}
                onClick={() => setSelectedLeadId(leads.find(l => l.venue_name === o.venue_name)?.id)}
                className="flex items-start gap-3 px-[18px] py-[14px] border-b border-[#f0eeea] last:border-b-0 cursor-pointer transition-colors hover:bg-[#f5f4f0]"
              >
                <div className="w-2 h-2 rounded-full shrink-0 mt-[5px] bg-[#b8860b]" />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-terminal-text">{o.contact_name}</div>
                  <div className="text-[11px] text-[#9a9a92]">{o.venue_name}</div>
                  <div className="text-xs text-[#6b6b65] mt-1 leading-[1.5] line-clamp-2">{o.subject}</div>
                </div>
                <div className="font-mono text-[10px] text-[#c5c5bc] shrink-0 mt-[2px]">{timeAgo(o.responded_at)}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Lead Database + Email Thread */}
      <div className="grid grid-cols-1 lg:grid-cols-[5fr_3fr] gap-4 mb-4">
        {/* Lead Database */}
        <Card title="Lead Database" meta={`${stats.totalLeads} leads`}>
          <div className="flex items-center gap-[10px] px-[18px] py-3 border-b border-[#f0eeea]">
            <input
              ref={searchRef}
              value={leadSearch}
              onChange={e => setLeadSearch(e.target.value)}
              className="flex-1 px-[14px] py-2 border-[1.5px] border-terminal-border rounded-[10px] text-[13px] text-terminal-text bg-[#f5f4f0] outline-none focus:border-[#1a6b3c] focus:bg-white transition-colors placeholder:text-[#c5c5bc]"
              placeholder="Search by name, industry, region..."
            />
            <span className="text-[11px] text-terminal-muted whitespace-nowrap">{filteredLeads.length} leads</span>
          </div>
          <div
            className="grid px-[18px] py-[10px] text-[10px] font-bold text-terminal-muted uppercase tracking-[0.8px] border-b border-terminal-border"
            style={{ gridTemplateColumns: '2.5fr 1.5fr 1fr 1fr 80px' }}
          >
            <div>Company</div><div>Industry</div><div>Region</div><div>Stage</div><div />
          </div>
          {filteredLeads.length === 0 && (
            <div className="px-[18px] py-6 text-center text-sm text-terminal-muted">No leads match your search.</div>
          )}
          {filteredLeads.map(l => (
            <div
              key={l.id}
              onClick={() => setSelectedLeadId(l.id)}
              className={`grid px-[18px] py-[12px] border-b border-[#f0eeea] last:border-b-0 items-center text-[13px] hover:bg-[#f5f4f0] transition-colors cursor-pointer ${
                selectedLeadId === l.id ? 'bg-[#edf7f0]' : ''
              } ${l.status === 'responded' ? 'border-l-[3px] border-l-[#b8860b]' : ''}`}
              style={{ gridTemplateColumns: '2.5fr 1.5fr 1fr 1fr 80px' }}
            >
              <div>
                <div className="font-semibold text-terminal-text">{l.venue_name}</div>
                <div className="text-[11px] text-[#9a9a92]">{l.contactCount || 0} contact{l.contactCount !== 1 ? 's' : ''}</div>
              </div>
              <div className="text-xs text-[#6b6b65]">{l.industry || '—'}</div>
              <div className="text-xs text-[#6b6b65]">{l.region || '—'}</div>
              <div>
                <span className={`text-[10px] font-semibold px-[9px] py-[3px] rounded-md uppercase tracking-[0.3px] ${STAGE_CLS[l.status] || STAGE_CLS.new}`}>
                  {l.status}
                </span>
              </div>
              <div>
                <span className="text-[11px] font-semibold text-[#1a6b3c] hover:opacity-70 transition-opacity">View</span>
              </div>
            </div>
          ))}
        </Card>

        {/* Email Thread */}
        <Card title={`Email Thread${selectedLeadId ? ` — ${leads.find(l => l.id === selectedLeadId)?.venue_name || ''}` : ''}`} meta={selectedOutreach.length > 0 ? `${selectedOutreach.length} messages` : null}>
          <div className="p-[18px]">
            {selectedOutreach.length === 0 && (
              <div className="text-center py-8 text-sm text-terminal-muted">
                {selectedLeadId ? 'No outreach yet for this lead' : 'Select a lead to view email thread'}
              </div>
            )}
            {selectedOutreach.map((msg, i) => (
              <div
                key={i}
                className={`border rounded-[10px] p-[14px_16px] mb-[10px] last:mb-0 ${
                  msg.status === 'sent' ? 'border-[#f0eeea] border-l-[3px] border-l-[#1a6b3c] bg-terminal-panel' :
                  msg.status === 'draft' ? 'border-dashed border-[#c5c5bc] border-l-[3px] border-l-[#c5c5bc] bg-[#f5f4f0]' :
                  'border-[#f0eeea]'
                }`}
              >
                <div className="flex items-center justify-between mb-[2px]">
                  <div className="text-xs font-semibold text-terminal-text">
                    {msg.status === 'draft' ? 'Draft — Pending Approval' : `To: ${msg.contact_name || msg.contact_email}`}
                  </div>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-md uppercase ${OUTREACH_STATUS_CLS[msg.status] || ''}`}>
                    {msg.status}
                  </span>
                </div>
                <div className="text-[10px] text-[#9a9a92] mb-2">
                  {msg.email_type === 'initial' ? 'Initial outreach' : msg.email_type?.replace('_', ' ')}
                  {msg.sent_at && ` · Sent ${new Date(msg.sent_at).toLocaleDateString()}`}
                  {msg.responded_at && ` · Reply ${timeAgo(msg.responded_at)}`}
                </div>
                <div className="text-xs font-semibold text-terminal-text mb-1">{msg.subject}</div>
                <div className="text-[13px] text-terminal-text leading-relaxed whitespace-pre-line">{msg.body}</div>
                {msg.status === 'draft' && (
                  <div className="flex gap-2 mt-[10px]">
                    <button
                      onClick={() => handleApprove(msg.id)}
                      className="text-[11px] font-semibold px-[14px] py-[5px] rounded-lg bg-[#1a6b3c] text-white border border-[#1a6b3c] hover:bg-[#22884d] transition-colors"
                    >
                      Approve & Send
                    </button>
                    <button onClick={() => alert('Opening draft editor...')} className="text-[11px] font-semibold px-[14px] py-[5px] rounded-lg bg-terminal-panel text-[#6b6b65] border border-terminal-border hover:bg-[#f5f4f0] transition-colors">
                      Edit Draft
                    </button>
                    <button onClick={() => alert('Draft dismissed.')} className="text-[11px] font-semibold px-[14px] py-[5px] rounded-lg bg-terminal-panel text-[#6b6b65] border border-terminal-border hover:bg-[#f5f4f0] transition-colors">
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Bottom row: Outreach Log + Config */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4 mb-6">
        {/* Outreach Log */}
        <Card title="Outreach Log" meta={`${outreach.length} emails`}>
          <div
            className="grid px-[18px] py-[10px] text-[10px] font-bold text-terminal-muted uppercase tracking-[0.8px] border-b border-terminal-border"
            style={{ gridTemplateColumns: '2fr 1.5fr 1fr 1fr 100px' }}
          >
            <div>Contact</div><div>Subject</div><div>Type</div><div>Status</div><div>Date</div>
          </div>
          {outreach.slice(0, 10).map((o, i) => (
            <div
              key={i}
              className="grid px-[18px] py-[11px] border-b border-[#f0eeea] last:border-b-0 items-center text-[13px] hover:bg-[#f5f4f0] transition-colors cursor-pointer"
              style={{ gridTemplateColumns: '2fr 1.5fr 1fr 1fr 100px' }}
              onClick={() => {
                const lead = leads.find(l => l.venue_name === o.venue_name);
                if (lead) setSelectedLeadId(lead.id);
              }}
            >
              <div>
                <div className="font-semibold text-terminal-text">{o.contact_name || '—'}</div>
                <div className="text-[11px] text-[#9a9a92]">{o.venue_name}</div>
              </div>
              <div className="text-xs text-[#6b6b65] truncate">{o.subject || '—'}</div>
              <div className="text-xs text-[#6b6b65]">{o.email_type === 'initial' ? 'Initial' : o.email_type?.replace('_', ' ')}</div>
              <div>
                <span className={`text-[10px] font-semibold px-[9px] py-[3px] rounded-md uppercase ${OUTREACH_STATUS_CLS[o.status] || ''}`}>
                  {o.status}
                </span>
              </div>
              <div className="font-mono text-[11px] text-[#9a9a92]">{o.sent_at ? new Date(o.sent_at).toLocaleDateString() : timeAgo(o.created_at)}</div>
            </div>
          ))}
        </Card>

        {/* Agent Config */}
        <Card title="Agent Configuration" meta={config.mode === 'autonomous' ? 'Autonomous' : 'Copilot'}>
          <div>
            <KVRow label="Mode" value={config.mode === 'autonomous' ? 'Autonomous' : 'Copilot'} cls="accent" />
            <KVRow label="Status" value={config.enabled ? 'Active' : 'Paused'} cls={config.enabled ? 'green' : 'muted'} />
            <KVRow label="Email Generator" value="Claude Sonnet" cls="sans" />
            <KVRow label="Queries" value={`${(config.queries || []).length} configured`} cls="" />
            <KVRow label="Regions" value={(config.regions || []).join(', ')} cls="sans" />
            <KVRow label="Emails / Cycle" value={config.max_emails_per_cycle || 10} cls="" />
            <KVRow label="Follow-Up After" value={`${config.followup_delay_days || 5} days`} cls="" />
            <KVRow label="Max Follow-Ups" value={config.max_followups || 2} cls="" />
            <KVRow label="Sender" value={config.sender_name || '—'} cls="sans" />
            <KVRow label="Send From" value={config.sender_email || '—'} cls="muted" />
          </div>
        </Card>
      </div>

      {/* Config Panel (expanded) */}
      {showConfig && (
        <ConfigPanel config={config} onSave={async (updated) => {
          try {
            await putApi('/lead-engine/config', updated);
            refetchConfig();
            setShowConfig(false);
          } catch (err) {
            console.error('Config save failed:', err);
          }
        }} onClose={() => setShowConfig(false)} />
      )}
    </div>
  );
}

function KVRow({ label, value, cls = '' }) {
  const valStyle = {
    accent: 'font-sans text-[#1a6b3c]',
    green: 'text-[#1a6b3c]',
    sans: 'font-sans text-terminal-text',
    muted: 'font-sans text-[#9a9a92]',
    '': 'text-terminal-text',
  }[cls] || 'text-terminal-text';
  return (
    <div className="flex items-center justify-between px-[18px] py-[10px] border-b border-[#f0eeea] last:border-b-0 text-[13px]">
      <span className="text-[#6b6b65]">{label}</span>
      <span className={`font-semibold tabular-nums font-mono text-xs ${valStyle}`}>{value}</span>
    </div>
  );
}

function ConfigPanel({ config, onSave, onClose }) {
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
            <button
              onClick={() => setEnabled(!enabled)}
              className={`px-4 py-2 rounded-lg text-[13px] font-semibold border transition-all ${
                enabled ? 'bg-[#edf7f0] text-[#1a6b3c] border-[#1a6b3c]/30' : 'bg-[#f5f4f0] text-[#9a9a92] border-terminal-border'
              }`}
            >
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
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-[13px] font-semibold bg-terminal-panel text-[#6b6b65] border border-terminal-border hover:bg-[#f5f4f0] transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} className="px-4 py-2 rounded-lg text-[13px] font-semibold bg-[#1a6b3c] text-white border border-[#1a6b3c] hover:bg-[#22884d] transition-colors">
            Save Configuration
          </button>
        </div>
      </div>
    </Card>
  );
}

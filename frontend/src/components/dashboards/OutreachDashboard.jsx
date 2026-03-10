import React, { useState, useRef } from 'react';

// ─── Data ───────────────────────────────────────────────────────────────────

const STATS = [
  { label: 'Leads Discovered', val: '502', sub: '+34 today', subCls: 'green', highlight: true },
  { label: 'Emails Sent', val: '96', sub: '+8 today', subCls: 'green' },
  { label: 'Reply Rate', val: '7.3', unit: '%', sub: 'Above industry avg', subCls: 'green' },
  { label: 'Replies', val: '7', sub: '3 unread', subCls: 'warn' },
  { label: 'Meetings Booked', val: '2', sub: 'From outreach', subCls: 'flat' },
  { label: 'API Cost', val: '$2.40', sub: '30-day total', subCls: 'green', valCls: 'text-[#1a6b3c]' },
];

const FUNNEL = [
  { label: 'Discovered', count: 389, pct: '77.5%', width: '100%', gradient: 'from-[#1a6b3c] to-[#22884d]' },
  { label: 'Contacted', count: 96, pct: '19.1%', width: '19%', gradient: 'from-[#1a6b3c] to-[#22884d]' },
  { label: 'Replied', count: 7, pct: '7.3%', width: '7.3%', gradient: 'from-[#b8860b] to-[#d4a00a]' },
  { label: 'Meeting', count: 2, pct: '2.1%', width: '1.4%', gradient: 'from-[#2563eb] to-[#3b82f6]' },
  { label: 'Active Deal', count: 1, pct: '1.0%', width: '0.6%', gradient: 'from-[#7c3aed] to-[#8b5cf6]' },
];

const SPARK_DATA = [
  { d: 40, s: 15 }, { d: 35, s: 12 }, { d: 45, s: 18 }, { d: 30, s: 10 }, { d: 50, s: 20 },
  { d: 42, s: 14 }, { d: 38, s: 16 }, { d: 55, s: 22 }, { d: 48, s: 19 }, { d: 35, s: 13 },
  { d: 60, s: 25 }, { d: 52, s: 20 }, { d: 45, s: 18 }, { d: 70, s: 28 }, { d: 65, s: 24 },
];

const REPLIES = [
  { name: 'Sarah Chen', company: 'CFO — Meridian Renewables · 180 MW solar · ERCOT', snippet: "Thanks for reaching out. We've actually been exploring behind-the-meter mining as an option for our Crane County site. Would be interested in learning more about your approach...", time: '5h ago', status: 'unread' },
  { name: 'Mark Liu', company: 'VP Strategy — GridScale Partners · 320 MW wind · PJM', snippet: "Interesting timing — we're currently reviewing options for some underperforming assets in PJM. Can you send over more details on what the partnership structure looks like?", time: '2d ago', status: 'unread' },
  { name: 'David Park', company: 'Director BD — Nexus Solar · 95 MW · MISO', snippet: 'Not the right time for us but appreciate the outreach. Feel free to check back in Q3 when we have a clearer picture on our MISO portfolio strategy.', time: '3d ago', status: 'unread' },
  { name: 'James Torres', company: 'VP Ops — SunPeak Energy · 240 MW solar · ERCOT', snippet: "Let's set up a call. We have two sites in West Texas that might be a fit. What does your availability look like next week?", time: '5d ago', status: 'actioned' },
  { name: 'Linda Pham', company: 'CEO — Apex Clean Energy Partners · 400 MW · SPP', snippet: "This is exactly the kind of conversation we need to be having. We've been struggling with negative LMPs at our Oklahoma sites. Looping in our energy team...", time: '1w ago', status: 'actioned' },
];

const LEADS = [
  { name: 'Sarah Chen', company: 'Meridian Renewables', asset: '180 MW Solar', region: 'ERCOT', stage: 'replied', lastActivity: '5h ago' },
  { name: 'Mark Liu', company: 'GridScale Partners', asset: '320 MW Wind', region: 'PJM', stage: 'replied', lastActivity: '2d ago' },
  { name: 'James Torres', company: 'SunPeak Energy', asset: '240 MW Solar', region: 'ERCOT', stage: 'meeting', lastActivity: '5d ago' },
  { name: 'Linda Pham', company: 'Apex Clean Energy', asset: '400 MW Mixed', region: 'SPP', stage: 'active', lastActivity: '1w ago' },
  { name: 'Ryan Brooks', company: 'Clearway Energy', asset: '520 MW Wind', region: 'ERCOT', stage: 'contacted', lastActivity: '3d ago' },
  { name: 'Emily Nakamura', company: 'Invenergy', asset: '680 MW Wind', region: 'PJM', stage: 'contacted', lastActivity: '4d ago' },
  { name: 'Carlos Ruiz', company: 'EDP Renewables', asset: '350 MW Solar', region: 'MISO', stage: 'discovered', lastActivity: 'Today' },
  { name: 'Amanda Foster', company: 'NextEra Partners', asset: '1.2 GW Mixed', region: 'ERCOT', stage: 'discovered', lastActivity: 'Today' },
];

const EMAIL_THREAD = [
  {
    type: 'sent',
    from: 'Sangha Renewables (via Outreach Agent)',
    date: 'Mar 2, 2026 — 9:14 AM CST — Auto-sent',
    body: `Hi Sarah,\n\nI came across Meridian's <hl>Crane County solar portfolio</hl> and noticed your assets have been facing some of the same <hl>negative LMP challenges</hl> that many ERCOT operators are dealing with right now.\n\nWe've been working with renewable operators to co-locate behind-the-meter Bitcoin mining on underperforming sites — effectively creating an additional revenue stream from the same infrastructure without any additional grid interconnection.\n\nWe've developed 8 years of operational experience doing this and are currently building financial products to provide revenue floor protection for the mining output.\n\nWould be happy to share how this has worked on similar assets if there's interest on your end.\n\nBest,\nSangha Renewables`,
  },
  {
    type: 'received',
    from: 'Sarah Chen — CFO, Meridian Renewables',
    date: 'Mar 7, 2026 — 11:42 AM CST',
    body: `Thanks for reaching out. We've actually been exploring behind-the-meter mining as an option for our Crane County site. Would be interested in learning more about your approach and what the economics look like for a 180 MW solar facility.\n\nCan you send over a brief overview of your structure?\n\nSarah`,
  },
  {
    type: 'draft',
    from: 'Draft — Pending Approval',
    date: 'Auto-generated Mar 7, 2026 — 12:15 PM CST',
    body: `Hi Sarah,\n\nGreat to hear there's alignment. I'll put together a brief overview of our typical project structure for a site in your capacity range and send it over this week.\n\nIn the meantime, would it be helpful to jump on a quick call? We can walk through the economics specific to Crane County and answer any questions your team might have.\n\nWould Thursday or Friday afternoon work on your end?\n\nBest,\nSangha Renewables`,
  },
];

const FOLLOW_UPS = [
  { name: 'Ryan Brooks', company: 'Clearway Energy', type: 'Initial outreach', days: 7, daysCls: 'text-[#c0392b]', action: 'send' },
  { name: 'Emily Nakamura', company: 'Invenergy', type: 'Initial outreach', days: 6, daysCls: 'text-[#c0392b]', action: 'review' },
  { name: 'Tom Whitfield', company: 'Pattern Energy', type: 'Initial outreach', days: 5, daysCls: 'text-[#b8860b]', action: 'review' },
  { name: 'Jessica Kim', company: 'Recurrent Energy', type: '2nd touch', days: 3, daysCls: 'text-[#9a9a92]', action: 'review' },
];

const GEO = [
  { label: 'ERCOT', count: 218, pct: '43.4%', width: '100%' },
  { label: 'PJM', count: 126, pct: '25.1%', width: '58%' },
  { label: 'MISO', count: 78, pct: '15.5%', width: '35%' },
  { label: 'SPP', count: 48, pct: '9.6%', width: '22%' },
  { label: 'CAISO', count: 32, pct: '6.4%', width: '15%' },
];

const AGENT_CONFIG = [
  { k: 'Mode', v: 'Autonomous', cls: 'accent' },
  { k: 'Enrichment', v: 'Apollo', cls: 'sans' },
  { k: 'Personalization', v: 'Sonnet 4.6', cls: 'sans' },
  { k: 'Sending', v: 'Gmail API', cls: 'sans' },
  { k: 'Daily Send Limit', v: '15', cls: '' },
  { k: 'Follow-Up After', v: '5 days', cls: '' },
  { k: 'Max Touches', v: '3', cls: '' },
  { k: 'Target Verticals', v: 'Solar, Wind IPPs', cls: 'sans' },
  { k: 'Min Asset Size', v: '50 MW', cls: '' },
  { k: 'Approval Required', v: 'First touch only', cls: 'muted' },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

const SUB_CLS = { green: 'text-[#1a6b3c]', warn: 'text-[#b8860b]', danger: 'text-[#c0392b]', flat: 'text-terminal-muted' };

const STAGE_CLS = {
  discovered: 'bg-[#f5f4f0] text-[#9a9a92]',
  contacted: 'bg-[#eff6ff] text-[#2563eb]',
  replied: 'bg-[#fdf6e8] text-[#b8860b]',
  meeting: 'bg-[#edf7f0] text-[#1a6b3c]',
  active: 'bg-[#f3f0ff] text-[#7c3aed]',
};

const REPLY_DOT = { unread: 'bg-[#b8860b]', read: 'bg-[#c5c5bc]', actioned: 'bg-[#1a6b3c]' };

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

function renderEmailBody(body) {
  return body.split('\n').map((line, i) => {
    if (line === '') return <br key={i} />;
    const parts = line.split(/<hl>(.*?)<\/hl>/g);
    if (parts.length === 1) return <span key={i}>{line}</span>;
    return (
      <span key={i}>
        {parts.map((p, j) =>
          j % 2 === 1
            ? <span key={j} className="bg-[#edf7f0] px-1 rounded-[3px] font-medium">{p}</span>
            : p
        )}
      </span>
    );
  });
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function OutreachDashboard() {
  const [filter, setFilter] = useState('all');
  const [leadSearch, setLeadSearch] = useState('');
  const [selectedLead, setSelectedLead] = useState(0);
  const [selectedReply, setSelectedReply] = useState(null);
  const searchRef = useRef(null);

  const filteredLeads = LEADS.filter(l => {
    if (filter === 'replied' && l.stage !== 'replied') return false;
    if (filter === 'follow-up' && !['contacted'].includes(l.stage)) return false;
    if (leadSearch) {
      const q = leadSearch.toLowerCase();
      return l.name.toLowerCase().includes(q) || l.company.toLowerCase().includes(q) || l.region.toLowerCase().includes(q) || l.asset.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="p-6 lg:px-7 lg:py-6">
      {/* Header pills */}
      <div className="flex items-center justify-end gap-2 mb-5">
        {[{ l: 'All Leads', v: 'all' }, { l: 'Replied', v: 'replied' }, { l: 'Follow-Up Due', v: 'follow-up' }].map(f => (
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
        <div className="w-px h-5 bg-terminal-border mx-1" />
        <button onClick={() => alert('Campaign builder — configure target criteria, templates, and send schedule.')} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-terminal-green text-white border border-terminal-green hover:opacity-90 transition-all">
          New Campaign
        </button>
      </div>

      {/* Stats ticker */}
      <div className="flex gap-[1px] bg-terminal-border border border-terminal-border rounded-[14px] overflow-hidden mb-4">
        {STATS.map((s, i) => (
          <div
            key={i}
            className="bg-terminal-panel p-[14px_18px] flex-1"
            style={s.highlight ? { background: 'linear-gradient(135deg, var(--t-panel, #fff), #edf7f0)' } : undefined}
          >
            <div className="text-[9px] font-bold text-terminal-muted uppercase tracking-[1px] mb-[3px]">{s.label}</div>
            <div className={`text-xl font-bold tabular-nums font-mono leading-none ${s.valCls || 'text-terminal-text'}`}>
              {s.val}{s.unit && <span className="text-[11px] font-medium text-terminal-muted">{s.unit}</span>}
            </div>
            <div className={`text-[10px] font-semibold mt-[3px] ${SUB_CLS[s.subCls]}`}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Funnel + Reply Inbox */}
      <div className="grid grid-cols-1 lg:grid-cols-[5fr_3fr] gap-4 mb-4">
        {/* Pipeline Funnel */}
        <Card title="Pipeline Funnel" meta="502 total leads">
          <div className="p-[18px] flex flex-col gap-[6px]">
            {FUNNEL.map((f, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="text-xs font-medium text-[#6b6b65] w-[90px] text-right shrink-0">{f.label}</div>
                <div className="flex-1 h-7 bg-[#f5f4f0] rounded-md overflow-hidden">
                  <div
                    className={`h-full rounded-md bg-gradient-to-r ${f.gradient} flex items-center pl-[10px]`}
                    style={{ width: f.width }}
                  >
                    {parseInt(f.width) > 10 && <span className="text-[11px] font-bold text-white whitespace-nowrap">{f.count} leads</span>}
                  </div>
                </div>
                <div className="font-mono text-[13px] font-bold text-terminal-text min-w-[40px]">{f.count}</div>
                <div className="font-mono text-[11px] text-[#9a9a92] min-w-[40px]">{f.pct}</div>
              </div>
            ))}
          </div>
          {/* Sparkline */}
          <div className="px-[18px] pb-[18px]">
            <div className="text-[11px] font-semibold text-[#6b6b65] mb-2">Daily Activity — 30 Days</div>
            <div className="flex items-end gap-[2px] h-[60px]">
              {SPARK_DATA.map((bar, i) => (
                <React.Fragment key={i}>
                  <div className="flex-1 rounded-t-sm bg-[#2563eb] opacity-40 cursor-crosshair hover:opacity-30 transition-opacity" style={{ height: `${bar.d}%` }} />
                  <div className="flex-1 rounded-t-sm bg-[#1a6b3c] cursor-crosshair hover:opacity-70 transition-opacity" style={{ height: `${bar.s}%` }} />
                </React.Fragment>
              ))}
            </div>
            <div className="flex justify-between pt-1 font-mono text-[8px] text-[#c5c5bc]">
              <span>Feb 5</span><span>Feb 12</span><span>Feb 19</span><span>Feb 26</span><span>Mar 5</span>
            </div>
            <div className="flex gap-[14px] mt-2 text-[10px] text-[#9a9a92]">
              <div className="flex items-center gap-[5px]"><div className="w-2 h-2 rounded-[3px] bg-[#2563eb] opacity-40" /> Discovered</div>
              <div className="flex items-center gap-[5px]"><div className="w-2 h-2 rounded-[3px] bg-[#1a6b3c]" /> Sent</div>
            </div>
          </div>
        </Card>

        {/* Reply Inbox */}
        <Card title="Reply Inbox" meta="3 unread">
          <div>
            {REPLIES.map((r, i) => (
              <div
                key={i}
                onClick={() => setSelectedReply(i)}
                className={`flex items-start gap-3 px-[18px] py-[14px] border-b border-[#f0eeea] last:border-b-0 cursor-pointer transition-colors hover:bg-[#f5f4f0] ${
                  r.status === 'unread' ? 'bg-[rgba(184,134,11,0.04)]' : ''
                } ${selectedReply === i ? 'bg-[#edf7f0]' : ''}`}
              >
                <div className={`w-2 h-2 rounded-full shrink-0 mt-[5px] ${REPLY_DOT[r.status]}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-terminal-text">{r.name}</div>
                  <div className="text-[11px] text-[#9a9a92]">{r.company}</div>
                  <div className="text-xs text-[#6b6b65] mt-1 leading-[1.5] line-clamp-2">{r.snippet}</div>
                </div>
                <div className="font-mono text-[10px] text-[#c5c5bc] shrink-0 mt-[2px]">{r.time}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Lead Database + Email Thread */}
      <div className="grid grid-cols-1 lg:grid-cols-[5fr_3fr] gap-4 mb-4">
        {/* Lead Database */}
        <Card title="Lead Database" meta="502 leads">
          {/* Search */}
          <div className="flex items-center gap-[10px] px-[18px] py-3 border-b border-[#f0eeea]">
            <input
              ref={searchRef}
              value={leadSearch}
              onChange={e => setLeadSearch(e.target.value)}
              className="flex-1 px-[14px] py-2 border-[1.5px] border-terminal-border rounded-[10px] text-[13px] text-terminal-text bg-[#f5f4f0] outline-none focus:border-[#1a6b3c] focus:bg-white transition-colors placeholder:text-[#c5c5bc]"
              placeholder="Search by name, company, region, asset type..."
            />
            <span className="text-[11px] text-terminal-muted whitespace-nowrap">{filteredLeads.length} leads</span>
          </div>
          {/* Header */}
          <div
            className="grid px-[18px] py-[10px] text-[10px] font-bold text-terminal-muted uppercase tracking-[0.8px] border-b border-terminal-border"
            style={{ gridTemplateColumns: '2.5fr 1.5fr 1fr 1fr 1fr 80px' }}
          >
            <div>Contact</div><div>Asset</div><div>Region</div><div>Stage</div><div>Last Activity</div><div />
          </div>
          {filteredLeads.length === 0 && (
            <div className="px-[18px] py-6 text-center text-sm text-terminal-muted">No leads match your search.</div>
          )}
          {filteredLeads.map((l, i) => {
            const realIdx = LEADS.indexOf(l);
            return (
              <div
                key={realIdx}
                onClick={() => setSelectedLead(realIdx)}
                className={`grid px-[18px] py-[12px] border-b border-[#f0eeea] last:border-b-0 items-center text-[13px] hover:bg-[#f5f4f0] transition-colors cursor-pointer ${
                  selectedLead === realIdx ? 'bg-[#edf7f0]' : ''
                } ${l.stage === 'replied' ? 'border-l-[3px] border-l-[#b8860b]' : ''}`}
                style={{ gridTemplateColumns: '2.5fr 1.5fr 1fr 1fr 1fr 80px' }}
              >
                <div>
                  <div className="font-semibold text-terminal-text">{l.name}</div>
                  <div className="text-xs text-[#6b6b65] mt-[1px]">{l.company}</div>
                </div>
                <div className="text-xs text-[#6b6b65]">{l.asset}</div>
                <div className="text-xs text-[#6b6b65]">{l.region}</div>
                <div>
                  <span className={`text-[10px] font-semibold px-[9px] py-[3px] rounded-md uppercase tracking-[0.3px] ${STAGE_CLS[l.stage]}`}>{l.stage}</span>
                </div>
                <div className="font-mono text-xs text-terminal-text">{l.lastActivity}</div>
                <div>
                  <span className="text-[11px] font-semibold text-[#1a6b3c] hover:opacity-70 transition-opacity">View</span>
                </div>
              </div>
            );
          })}
        </Card>

        {/* Email Thread */}
        <Card title="Email Thread — Sarah Chen" meta={
          <div className="flex items-center gap-2">
            <span onClick={() => alert('Full email thread view — all messages in this conversation.')} className="text-[11px] font-semibold text-[#1a6b3c] cursor-pointer hover:opacity-70">Full Thread</span>
            <span className="text-[#c5c5bc]">|</span>
            <span onClick={() => alert('Lead profile — company details, contacts, engagement history.')} className="text-[11px] font-semibold text-[#1a6b3c] cursor-pointer hover:opacity-70">Lead Profile</span>
          </div>
        }>
          <div className="p-[18px]">
            {EMAIL_THREAD.map((msg, i) => (
              <div
                key={i}
                className={`border rounded-[10px] p-[14px_16px] mb-[10px] last:mb-0 ${
                  msg.type === 'sent' ? 'border-[#f0eeea] border-l-[3px] border-l-[#1a6b3c] bg-terminal-panel' :
                  msg.type === 'received' ? 'border-[#f0eeea] border-l-[3px] border-l-[#b8860b]' :
                  'border-dashed border-[#c5c5bc] border-l-[3px] border-l-[#c5c5bc] bg-[#f5f4f0]'
                }`}
                style={msg.type === 'received' ? { background: 'linear-gradient(135deg, var(--t-panel, #fff), #fdf6e8)' } : undefined}
              >
                <div className="text-xs font-semibold text-terminal-text mb-[2px]">{msg.from}</div>
                <div className="text-[10px] text-[#9a9a92] mb-2">{msg.date}</div>
                <div className="text-[13px] text-terminal-text leading-relaxed whitespace-pre-line">
                  {renderEmailBody(msg.body)}
                </div>
                {msg.type === 'draft' && (
                  <div className="flex gap-2 mt-[10px]">
                    <button onClick={() => alert('Email approved and sent.')} className="text-[11px] font-semibold px-[14px] py-[5px] rounded-lg bg-[#1a6b3c] text-white border border-[#1a6b3c] hover:bg-[#22884d] transition-colors">
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

      {/* Bottom row: Follow-ups, Geo, Config */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        {/* Follow-Up Queue */}
        <Card title="Follow-Up Queue" meta="6 pending">
          <div>
            {FOLLOW_UPS.map((fu, i) => (
              <div key={i} className="grid items-center px-[18px] py-[11px] border-b border-[#f0eeea] last:border-b-0 text-[13px] hover:bg-[#f5f4f0] transition-colors" style={{ gridTemplateColumns: '2.5fr 1.5fr 1fr 100px' }}>
                <div>
                  <div className="font-semibold text-terminal-text">{fu.name}</div>
                  <div className="text-[11px] text-[#9a9a92]">{fu.company}</div>
                </div>
                <div className="text-xs text-[#6b6b65]">{fu.type}</div>
                <div className={`font-mono text-xs font-semibold ${fu.daysCls}`}>{fu.days} days</div>
                <div>
                  <button onClick={() => alert(fu.action === 'send' ? `Follow-up sent to ${fu.name}.` : `Reviewing follow-up for ${fu.name}...`)} className={`text-[10px] font-semibold px-3 py-1 rounded-md transition-all ${
                    fu.action === 'send'
                      ? 'bg-[#1a6b3c] text-white hover:bg-[#22884d]'
                      : 'bg-[#fdf6e8] text-[#b8860b] border border-[rgba(184,134,11,0.2)] hover:bg-[#faecd0]'
                  }`}>
                    {fu.action === 'send' ? 'Send' : 'Review'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Geographic Breakdown */}
        <Card title="Target Geography" meta="Leads by region">
          <div className="py-3">
            {GEO.map((g, i) => (
              <div key={i} className="flex items-center gap-3 px-[18px] py-[10px] border-b border-[#f0eeea] last:border-b-0">
                <div className="text-[13px] font-medium text-terminal-text w-[80px] shrink-0">{g.label}</div>
                <div className="flex-1 h-2 bg-[#f5f4f0] rounded overflow-hidden">
                  <div className="h-full rounded bg-[#1a6b3c]" style={{ width: g.width }} />
                </div>
                <div className="font-mono text-xs font-semibold text-terminal-text min-w-[30px] text-right">{g.count}</div>
                <div className="font-mono text-[11px] text-[#9a9a92] min-w-[36px] text-right">{g.pct}</div>
              </div>
            ))}
          </div>
        </Card>

        {/* Agent Config */}
        <Card title="Agent Configuration" meta="Outreach Engine">
          {AGENT_CONFIG.map((item, i) => (
            <KVRow key={i} label={item.k} value={item.v} cls={item.cls} />
          ))}
        </Card>
      </div>
    </div>
  );
}

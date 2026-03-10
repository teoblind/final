import React, { useState } from 'react';

// ─── Data ───────────────────────────────────────────────────────────────────

const STATS = [
  { label: 'Total Meetings', val: '17', sub: 'Since Feb 1', subCls: 'flat', highlight: true },
  { label: 'Hours Captured', val: '14.2', unit: ' hrs', sub: 'Avg 50 min each', subCls: 'flat' },
  { label: 'Action Items', val: '34', sub: '8 open', subCls: 'warn' },
  { label: 'Decisions Logged', val: '22', sub: 'Across all calls', subCls: 'flat' },
  { label: 'People Tracked', val: '18', sub: 'Internal + external', subCls: 'flat' },
  { label: 'API Cost', val: '$0.89', sub: 'Total to date', subCls: 'green', valCls: 'text-[#1a6b3c]' },
];

const UPCOMING_NEXT = [
  { time: '14:00', title: 'Total Energies — Oberon Project Update', dur: '45 min' },
  { time: 'Mon 9:00', title: 'Reassurity — Product Structuring Follow-up', dur: '60 min' },
  { time: 'Tue 11:00', title: 'Mihir / Marcel — Coppice Platform Review', dur: '30 min' },
];

const ACTION_ITEMS = [
  { text: 'Send revised term sheet to Total Energies legal team', assignee: 'Spencer', due: 'Overdue — Mar 5', dueCls: 'text-[#c0392b]', from: 'Oberon Review, Mar 3', done: false },
  { text: 'Draft scope response to Reassurity consulting proposal', assignee: 'Spencer', due: 'Due today', dueCls: 'text-[#b8860b]', from: 'Reassurity Call, Feb 20', done: false },
  { text: 'Pull 8760 data for Crane County site and share with JD', assignee: 'Teo', due: 'Due today', dueCls: 'text-[#b8860b]', from: 'Weekly Ops, Mar 3', done: false },
  { text: 'Follow up with Meridian Renewables on behind-the-meter proposal', assignee: 'Jason', due: 'Mar 10', dueCls: 'text-[#9a9a92]', from: 'BD Review, Mar 5', done: false },
  { text: 'Update SanghaModel with revised energy price assumptions', assignee: 'Miguel', due: 'Completed Mar 6', dueCls: 'text-[#1a6b3c]', from: null, done: true },
  { text: 'Share ERCOT nodal pricing analysis with energy team', assignee: 'Teo', due: 'Completed Mar 5', dueCls: 'text-[#1a6b3c]', from: null, done: true },
];

const MEETINGS = [
  { title: 'Reassurity — Product Strategy', type: 'external', date: 'Feb 20', dur: '42 min', attendees: 6, actions: '4 open', actionCls: 'bg-[#fdf6e8] text-[#b8860b]' },
  { title: 'Weekly Ops Review', type: 'internal', date: 'Mar 3', dur: '58 min', attendees: 4, actions: '2 open', actionCls: 'bg-[#fdf6e8] text-[#b8860b]' },
  { title: 'Total Energies — Oberon Review', type: 'external', date: 'Mar 3', dur: '45 min', attendees: 5, actions: '1 open', actionCls: 'bg-[#fdf6e8] text-[#b8860b]' },
  { title: 'BD Pipeline Review', type: 'internal', date: 'Mar 5', dur: '35 min', attendees: 3, actions: '1 open', actionCls: 'bg-[#fdf6e8] text-[#b8860b]' },
  { title: 'LP Update — Q1 Preview', type: 'investor', date: 'Feb 28', dur: '30 min', attendees: 4, actions: 'All done', actionCls: 'bg-[#edf7f0] text-[#1a6b3c]' },
  { title: 'Weekly Ops Review', type: 'internal', date: 'Feb 24', dur: '52 min', attendees: 4, actions: 'All done', actionCls: 'bg-[#edf7f0] text-[#1a6b3c]' },
  { title: 'Jason / JD — ERCOT Market Update', type: 'external', date: 'Feb 22', dur: '65 min', attendees: 3, actions: 'All done', actionCls: 'bg-[#edf7f0] text-[#1a6b3c]' },
  { title: 'Miguel — SanghaModel Deep Dive', type: 'internal', date: 'Feb 19', dur: '78 min', attendees: 3, actions: 'All done', actionCls: 'bg-[#edf7f0] text-[#1a6b3c]' },
];

const PEOPLE = [
  { initials: 'SM', name: 'Spencer Marr', role: 'President, Sangha', count: 17, color: 'bg-[#1a6b3c]' },
  { initials: 'AR', name: 'Adam Reeve', role: 'Reassurity', count: 3, color: 'bg-[#2563eb]' },
  { initials: 'MA', name: 'Miguel Alvarez', role: 'Quant, Sangha', count: 8, color: 'bg-[#7c3aed]' },
  { initials: 'JG', name: 'Jason Gunderson', role: 'Energy Consultant', count: 6, color: 'bg-[#b8860b]' },
  { initials: 'JS', name: 'JD Schmidt', role: 'Energy Consultant', count: 5, color: 'bg-[#64748b]' },
  { initials: 'MP', name: 'Marcel Pineda', role: 'Finance, Sangha', count: 4, color: 'bg-[#1a6b3c]' },
  { initials: 'MB', name: 'Mihir Bhangley', role: 'Cofounder, Sangha', count: 4, color: 'bg-[#1a6b3c]' },
  { initials: 'TB', name: 'Teo Blind', role: 'Quant Analyst', count: 12, color: 'bg-[#1a6b3c]' },
];

const AGENT_CONFIG = [
  { k: 'Mode', v: 'Autonomous', cls: 'accent' },
  { k: 'Calendar Source', v: 'Google Calendar API', cls: 'sans' },
  { k: 'Auto-Join', v: 'Enabled', cls: 'accent' },
  { k: 'Transcription Engine', v: 'faster-whisper (local)', cls: 'sans' },
  { k: 'Summary Model', v: 'Sonnet 4.6', cls: 'sans' },
  { k: 'Action Item Extraction', v: 'Enabled', cls: 'accent' },
  { k: 'Speaker Identification', v: 'Enabled', cls: 'accent' },
  { k: 'Knowledge Base Sync', v: 'Auto', cls: 'accent' },
  { k: 'Delivery', v: 'Telegram + Dashboard', cls: 'sans' },
  { k: 'Avg Processing Time', v: '3 min 20 sec', cls: '' },
  { k: 'Avg API Cost', v: '$0.05 / meeting', cls: 'green' },
  { k: 'Storage Used', v: '1.2 GB', cls: '' },
];

const TRANSCRIPT_LINES = [
  { time: '02:34', speaker: 'Spencer', ext: false, text: 'We\'ve had a theory that it\'s actually possible instead of looking at the revenues of mining as infinitely volatile, there are ways of ', hl: 'bounding how you think about cash flows over time', after: '.' },
  { time: '15:31', speaker: 'Adam', ext: true, text: 'We worked with Allianz Global, Nephila Capital — that basically had the balance sheet to take on this sort of risk. What we spent years doing is investing in making sure the ', hl: 'underwriting was solid', after: '.' },
  { time: '24:40', speaker: 'Spencer', ext: false, text: 'I think we can get to a ', hl: '90% comfort level', after: ' on what\'s the real time distribution of energy pricing on the network. But to go from 90 to 100 could be challenging.' },
  { time: '25:05', speaker: 'Adam', ext: true, text: 'The modeling accuracy was sort of a ', hl: 'necessary but not sufficient', after: ' part. The robustness of the structure is just as important to getting the insurer comfortable.' },
];

const DECISIONS = [
  'Reassurity will approach this as consulting engagement, not success-based brokerage — product is too early stage for success fees',
  'Sangha may raise capital into Sangha Risk Management LLC to fund consulting and legal costs',
  'Target: first instrument issued within 18 months — Spencer confirmed this as goal',
];

// ─── Helpers ────────────────────────────────────────────────────────────────

const DOT_CLS = { internal: 'bg-[#1a6b3c]', external: 'bg-[#2563eb]', investor: 'bg-[#7c3aed]' };
const SUB_CLS = { green: 'text-[#1a6b3c]', warn: 'text-[#b8860b]', flat: 'text-terminal-muted' };

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
    '': 'text-terminal-text',
  }[cls] || 'text-terminal-text';
  return (
    <div className="flex items-center justify-between px-[18px] py-[10px] border-b border-[#f0eeea] last:border-b-0 text-[13px]">
      <span className="text-[#6b6b65]">{label}</span>
      <span className={`font-semibold tabular-nums font-mono text-xs ${valStyle}`}>{value}</span>
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function MeetingsDashboard() {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedMeeting, setSelectedMeeting] = useState(0); // index into MEETINGS
  const [actionItems, setActionItems] = useState(ACTION_ITEMS);
  const searchRef = React.useRef(null);

  const filteredMeetings = MEETINGS.filter(m => {
    if (filter !== 'all' && m.type !== filter) return false;
    if (search && !m.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const toggleAction = (idx) => {
    setActionItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const done = !item.done;
      return {
        ...item,
        done,
        due: done ? `Completed ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : item.due,
        dueCls: done ? 'text-[#1a6b3c]' : item.dueCls,
      };
    }));
  };

  return (
    <div className="p-6 lg:px-7 lg:py-6">
      {/* Header pills */}
      <div className="flex items-center justify-end gap-2 mb-5">
        {['All', 'Internal', 'External', 'Investor'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f.toLowerCase())}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all ${
              filter === f.toLowerCase()
                ? 'bg-terminal-text text-white border-terminal-text'
                : 'bg-terminal-panel text-terminal-muted border-terminal-border hover:bg-[#f5f4f0]'
            }`}
          >
            {f}
          </button>
        ))}
        <div className="w-px h-5 bg-terminal-border mx-1" />
        <button
          onClick={() => searchRef.current?.focus()}
          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-terminal-green text-white border border-terminal-green hover:opacity-90 transition-all"
        >
          Search Transcripts
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

      {/* Upcoming + Action Items */}
      <div className="grid grid-cols-1 lg:grid-cols-[5fr_3fr] gap-4 mb-4">
        {/* Upcoming */}
        <Card title="Upcoming" meta="From Google Calendar">
          <div className="p-[18px]">
            {/* Current meeting card */}
            <div className="border-[1.5px] border-[#1a6b3c] rounded-xl p-4 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, var(--t-panel, #fff), #edf7f0)' }}>
              <div className="absolute top-3 right-3 text-[9px] font-bold text-white bg-[#1a6b3c] px-[10px] py-[3px] rounded-full uppercase tracking-[0.5px] flex items-center gap-[5px]">
                <span className="w-[5px] h-[5px] rounded-full bg-[#2dd478] animate-pulse" />
                Joining in 23 min
              </div>
              <div className="font-mono text-xs text-[#1a6b3c] font-semibold mb-1.5">Today, 10:00 AM CST</div>
              <div className="text-base font-semibold text-terminal-text mb-1">Sangha Internal — Weekly Ops Review</div>
              <div className="text-xs text-[#6b6b65] mb-3">Google Meet — 60 min scheduled</div>
              <div className="flex gap-1.5 flex-wrap">
                {['Spencer Marr', 'Colin', 'Keisha', 'Teo Blind'].map(a => (
                  <span key={a} className="text-[11px] font-medium px-[10px] py-[3px] rounded-md bg-white border border-terminal-border text-terminal-text">{a}</span>
                ))}
              </div>
            </div>
            {/* Next meetings */}
            <div className="mt-3.5">
              {UPCOMING_NEXT.map((m, i) => (
                <div key={i} className="flex items-center gap-3 py-[10px] border-t border-[#f0eeea]">
                  <div className="font-mono text-[11px] text-terminal-muted min-w-[50px]">{m.time}</div>
                  <div className="text-[13px] font-medium text-terminal-text flex-1">{m.title}</div>
                  <div className="text-[11px] text-terminal-muted">{m.dur}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Open Action Items */}
        <Card title="Open Action Items" meta="8 remaining">
          <div className="px-[18px] py-[14px]">
            {actionItems.map((ai, i) => (
              <div key={i} className="flex items-start gap-[10px] py-[10px] border-b border-[#f0eeea] last:border-b-0">
                <button
                  onClick={() => toggleAction(i)}
                  className={`w-[18px] h-[18px] rounded-md border-[1.5px] shrink-0 mt-[1px] flex items-center justify-center cursor-pointer transition-all ${
                    ai.done ? 'bg-[#1a6b3c] border-[#1a6b3c]' : 'border-terminal-border hover:border-[#1a6b3c]'
                  }`}
                >
                  {ai.done && <span className="text-[11px] text-white font-bold">✓</span>}
                </button>
                <div className="flex-1">
                  <div className={`text-[13px] leading-[1.4] ${ai.done ? 'line-through text-terminal-muted' : 'text-terminal-text'}`}>{ai.text}</div>
                  <div className="flex gap-3 mt-[3px] text-[10px]">
                    <span className="font-semibold px-2 py-[2px] rounded-[5px] bg-[#f5f4f0] text-[#6b6b65]">{ai.assignee}</span>
                    <span className={`font-semibold ${ai.dueCls}`}>{ai.due}</span>
                    {ai.from && <span className="text-[#c5c5bc]">from: {ai.from}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Meeting Library + Transcript Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-[5fr_3fr] gap-4 mb-4">
        {/* Meeting Library */}
        <Card title="Meeting Library" meta="17 transcripts">
          {/* Search */}
          <div className="flex items-center gap-[10px] px-[18px] py-3 border-b border-[#f0eeea]">
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 px-[14px] py-2 border-[1.5px] border-terminal-border rounded-[10px] text-[13px] text-terminal-text bg-[#f5f4f0] outline-none focus:border-[#1a6b3c] focus:bg-white transition-colors placeholder:text-[#c5c5bc]"
              placeholder="Search across all transcripts..."
            />
            <span className="text-[11px] text-terminal-muted whitespace-nowrap">{filteredMeetings.length} meetings</span>
          </div>
          {/* Header */}
          <div
            className="grid px-[18px] py-[10px] text-[10px] font-bold text-terminal-muted uppercase tracking-[0.8px] border-b border-terminal-border"
            style={{ gridTemplateColumns: '3fr 1.5fr 0.8fr 1.2fr 1fr 80px' }}
          >
            <div>Meeting</div><div>Date</div><div>Duration</div><div>Attendees</div><div>Actions</div><div />
          </div>
          {filteredMeetings.length === 0 && (
            <div className="px-[18px] py-6 text-center text-sm text-terminal-muted">No meetings match your search.</div>
          )}
          {filteredMeetings.map((m, i) => {
            const realIdx = MEETINGS.indexOf(m);
            return (
              <div
                key={realIdx}
                onClick={() => setSelectedMeeting(realIdx)}
                className={`grid px-[18px] py-[13px] border-b border-[#f0eeea] last:border-b-0 items-center text-[13px] hover:bg-[#f5f4f0] transition-colors cursor-pointer ${
                  selectedMeeting === realIdx ? 'bg-[#edf7f0]' : ''
                }`}
                style={{ gridTemplateColumns: '3fr 1.5fr 0.8fr 1.2fr 1fr 80px' }}
              >
                <div className="font-semibold text-terminal-text flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-[3px] shrink-0 ${DOT_CLS[m.type]}`} />
                  {m.title}
                </div>
                <div className="text-xs text-[#6b6b65]">{m.date}</div>
                <div className="font-mono text-xs text-terminal-text tabular-nums">{m.dur}</div>
                <div className="text-xs text-[#6b6b65]">{m.attendees}</div>
                <div>
                  <span className={`text-[11px] font-semibold px-[9px] py-[3px] rounded-md ${m.actionCls}`}>{m.actions}</span>
                </div>
                <div>
                  <span className="text-[11px] font-semibold text-[#1a6b3c] hover:opacity-70 transition-opacity cursor-pointer">View</span>
                </div>
              </div>
            );
          })}
        </Card>

        {/* Transcript Preview */}
        <Card title="Transcript — Reassurity Call" meta={
          <div className="flex items-center gap-2">
            <span onClick={() => alert('Full transcript view — coming soon. The complete meeting transcript is available in the Hivemind chat.')} className="text-[11px] font-semibold text-[#1a6b3c] cursor-pointer hover:opacity-70">Full Transcript</span>
            <span className="text-[#c5c5bc]">|</span>
            <span onClick={() => alert('Transcript exported to clipboard.')} className="text-[11px] font-semibold text-[#1a6b3c] cursor-pointer hover:opacity-70">Export</span>
          </div>
        }>
          <div className="p-[18px]">
            {/* Header */}
            <div className="mb-4">
              <div className="font-serif text-lg text-terminal-text mb-1">Reassurity — Product Strategy Call</div>
              <div className="text-xs text-terminal-muted">February 20, 2026 — 42 minutes — Google Meet</div>
              <div className="flex gap-1.5 mt-2">
                <span className="text-[10px] font-semibold px-[10px] py-[3px] rounded-md bg-[#eff6ff] text-[#2563eb]">External</span>
                <span className="text-[10px] font-semibold px-[10px] py-[3px] rounded-md bg-[#f5f4f0] text-[#6b6b65]">42 min</span>
                <span className="text-[10px] font-semibold px-[10px] py-[3px] rounded-md bg-[#f5f4f0] text-[#6b6b65]">6 attendees</span>
              </div>
            </div>

            {/* AI Summary */}
            <div className="bg-[#f5f4f0] rounded-[10px] p-[14px_16px] mb-4 border-l-[3px] border-l-[#1a6b3c]">
              <div className="text-[10px] font-bold text-[#1a6b3c] tracking-[0.8px] uppercase mb-1.5">AI Summary</div>
              <div className="text-[13px] text-terminal-text leading-relaxed">
                Sangha presented their revenue floor swap concept for Bitcoin mining to Reassurity. Adam Reeve confirmed Reassurity can help with product structuring and go-to-market, drawing from proxy revenue swap experience with Allianz/Nephila in wind energy. Key challenge identified: empirical energy pricing data across mining jurisdictions. Spencer estimates 90% accuracy achievable, with product durability and contract robustness equally important to model precision. 18-month timeline to first instrument issuance. Next step: Reassurity to scope consulting engagement.
              </div>
            </div>

            {/* Key Decisions */}
            <div className="mb-3.5">
              <div className="text-[11px] font-bold text-[#6b6b65] tracking-[0.8px] uppercase mb-2 pb-1.5 border-b border-[#f0eeea]">Key Decisions</div>
              {DECISIONS.map((d, i) => (
                <div key={i} className="flex items-start gap-[10px] py-2 border-b border-[#f0eeea] last:border-b-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#1a6b3c] mt-[7px] shrink-0" />
                  <div className="text-[13px] text-terminal-text leading-relaxed">{d}</div>
                </div>
              ))}
            </div>

            {/* Transcript Excerpt */}
            <div>
              <div className="text-[11px] font-bold text-[#6b6b65] tracking-[0.8px] uppercase mb-2 pb-1.5 border-b border-[#f0eeea]">Transcript Excerpt</div>
              {TRANSCRIPT_LINES.map((l, i) => (
                <div key={i} className="flex gap-3 py-2 border-b border-[#f0eeea] last:border-b-0">
                  <div className="font-mono text-[10px] text-[#c5c5bc] min-w-[40px] shrink-0 pt-[2px]">{l.time}</div>
                  <div className={`text-[11px] font-semibold min-w-[80px] shrink-0 pt-[1px] ${l.ext ? 'text-[#2563eb]' : 'text-[#1a6b3c]'}`}>{l.speaker}</div>
                  <div className="text-[13px] text-terminal-text leading-relaxed">
                    {l.text}<span className="bg-[#fdf6e8] px-1 rounded-[3px]">{l.hl}</span>{l.after}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>

      {/* People + Config */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        {/* People */}
        <Card title="People Mentioned Across Meetings" meta="18 tracked">
          <div className="flex flex-wrap gap-2 p-[18px]">
            {PEOPLE.map(p => (
              <div key={p.initials} className="flex items-center gap-2 px-[14px] py-2 border border-terminal-border rounded-[10px] cursor-pointer hover:bg-[#f5f4f0] hover:border-[#9a9a92] transition-all">
                <div className={`w-6 h-6 rounded-[7px] flex items-center justify-center text-[10px] font-bold text-white shrink-0 ${p.color}`}>{p.initials}</div>
                <div>
                  <div className="text-xs font-semibold text-terminal-text">{p.name}</div>
                  <div className="text-[10px] text-terminal-muted">{p.role}</div>
                </div>
                <div className="font-mono text-[11px] text-terminal-muted ml-1">{p.count}</div>
              </div>
            ))}
          </div>
        </Card>

        {/* Agent Config */}
        <Card title="Agent Configuration" meta="Meeting Bot">
          {AGENT_CONFIG.map((item, i) => (
            <KVRow key={i} label={item.k} value={item.v} cls={item.cls} />
          ))}
        </Card>
      </div>
    </div>
  );
}

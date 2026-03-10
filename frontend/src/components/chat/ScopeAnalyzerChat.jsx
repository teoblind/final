import React, { useState } from 'react';

// ─── Simple markdown-like formatting ────────────────────────────────────────────
function formatContent(text) {
  if (!text) return null;
  return text.split('\n').map((line, i) => {
    const parts = line.split(/(\*\*.*?\*\*)/g).map((part, j) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={j} className="font-semibold">{part.slice(2, -2)}</strong>;
      }
      return part;
    });
    return <span key={i}>{parts}{i < text.split('\n').length - 1 && <br />}</span>;
  });
}

// ─── Scope Extraction Card ──────────────────────────────────────────────────────
function ScopeExtractionCard({ data }) {
  const statusIcon = (status) => {
    if (status === 'priced') return <span className="text-[#1a6b3c]">&#10003;</span>;
    if (status === 'clarification') return <span className="text-[#b8860b]">&#9889;</span>;
    if (status === 'warning') return <span className="text-[#c0392b]">&#9888;</span>;
    return <span className="text-[#9a9a92]">&#8226;</span>;
  };

  const statusBg = (status) => {
    if (status === 'priced') return 'bg-[#edf7f0]';
    if (status === 'clarification') return 'bg-[#fdf6e8]';
    if (status === 'warning') return 'bg-[#fbeae8]';
    return '';
  };

  return (
    <div className="mt-2.5 bg-[#f5f4f0] border border-[#f0eeea] rounded-[10px] overflow-hidden">
      <div className="px-3.5 py-2.5 bg-terminal-panel border-b border-[#f0eeea] flex items-center justify-between">
        <span className="text-[12px] font-bold text-terminal-text">{data.title}</span>
        <span className="text-[9px] font-bold px-2 py-[3px] rounded-[5px] uppercase tracking-[0.3px] bg-[#f3f0ff] text-[#7c3aed]">
          {data.badge}
        </span>
      </div>
      {data.items.map((item, i) => (
        <div
          key={i}
          className={`flex items-start gap-2.5 px-3.5 py-[9px] text-[12px] border-b border-[#f0eeea] last:border-b-0 ${statusBg(item.status)}`}
        >
          <span className="shrink-0 w-4 text-center text-[13px] mt-px">{statusIcon(item.status)}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="font-semibold text-terminal-text">{item.name}</span>
              <span className="text-[#6b6b65]">— {item.quantity}</span>
              {item.section && (
                <span className="text-[10px] font-mono text-[#9a9a92]">({item.section})</span>
              )}
            </div>
            {item.note && (
              <div className={`text-[11px] mt-0.5 ${
                item.status === 'clarification' ? 'text-[#b8860b]' :
                item.status === 'warning' ? 'text-[#c0392b]' :
                'text-[#9a9a92]'
              }`}>
                {item.note}
              </div>
            )}
          </div>
        </div>
      ))}
      {data.actions && (
        <div className="px-3.5 py-2.5 bg-terminal-panel border-t border-[#e8e6e1] flex gap-1.5">
          {data.actions.map((a, i) => (
            <button
              key={i}
              onClick={() => alert(`${a.label} action acknowledged.`)}
              className={`px-3.5 py-[6px] rounded-lg text-[11px] font-semibold transition-colors ${
                a.variant === 'primary'
                  ? 'text-white bg-[#7c3aed] hover:bg-[#6d28d9]'
                  : 'bg-terminal-panel text-[#6b6b65] border-[1.5px] border-[#e8e6e1] hover:bg-[#f5f4f0]'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Email / RFI Card ───────────────────────────────────────────────────────────
function RFICard({ data }) {
  return (
    <div className="mt-2.5 bg-terminal-panel border border-[#e8e6e1] rounded-[10px] overflow-hidden">
      <div className="px-3.5 py-2.5 border-b border-[#f0eeea] text-[11px] text-[#9a9a92] space-y-0.5">
        <div><strong className="text-terminal-text">To:</strong> {data.to}</div>
        <div><strong className="text-terminal-text">Subject:</strong> {data.subject}</div>
      </div>
      <div className="px-3.5 py-3.5 text-[13px] text-terminal-text leading-[1.6] whitespace-pre-line">{data.body}</div>
    </div>
  );
}

// ─── Demo Messages ──────────────────────────────────────────────────────────────
const DEMO_MESSAGES = [
  {
    id: 1, role: 'user',
    content: "I just uploaded the McKinney Town Center specs from Austin Commercial. Can you analyze the scope?",
    time: '10:14 AM',
  },
  {
    id: 2, role: 'agent',
    content: "I'm parsing the 48-page spec document now...",
    time: '10:14 AM',
  },
  {
    id: 3, role: 'agent',
    content: "Done. I found 8 scope items across the spec. Here's what I extracted:",
    time: '10:15 AM',
    scopeCard: {
      title: 'McKinney Town Center \u2014 Scope Extraction',
      badge: '3 of 8 priced',
      items: [
        { name: 'SOG 6" (4000 PSI)', quantity: '22,000 SF', section: 'Section 03 30 00', status: 'priced' },
        { name: 'Curb & gutter (standard)', quantity: '1,800 LF', section: 'Section 32 16 00', status: 'priced' },
        { name: 'Sidewalk 6" ADA', quantity: '3,400 SF', section: 'Section 32 13 00', status: 'priced' },
        { name: 'Drilled piers 24" dia', quantity: '28 each', status: 'clarification', note: 'Depth not specified \u2014 need clarification' },
        { name: 'Grade beams 24"\u00d730"', quantity: '600 LF', status: 'clarification', note: 'Reinforcement schedule on S-4, not included' },
        { name: 'Retaining wall (cantilever)', quantity: '180 LF', status: 'none', note: "Height varies 4'-8'" },
        { name: 'Decorative stamped concrete', quantity: '2,200 SF', status: 'warning', note: "Outside DACP's typical scope \u2014 subcontract?" },
        { name: 'Concrete testing (3rd party)', quantity: '12 sets', section: 'Section 01 45 00', status: 'none' },
      ],
      actions: [
        { label: 'Send to Estimating Bot', variant: 'primary' },
        { label: 'Flag for Review', variant: 'secondary' },
        { label: 'Download Extraction', variant: 'secondary' },
      ],
    },
  },
  {
    id: 4, role: 'agent',
    content: "Three items need your attention:\n\n**1. Drilled Piers (28 each)** \u2014 The spec calls for 24\" diameter piers but doesn't specify depth. Typical for this soil profile in McKinney is 25-30 ft, but Austin Commercial needs to confirm. This is a significant cost variable \u2014 difference between ~$2,800 and ~$4,200 per pier.\n\n**2. Grade Beams (600 LF)** \u2014 Reinforcement schedule references structural drawing S-4, which wasn't included in the spec package. We need that drawing to price the rebar. Without it, I'd estimate #5 @ 12\" O.C. based on similar projects.\n\n**3. Decorative Stamped Concrete (2,200 SF)** \u2014 DACP's win rate on stamped/decorative work is 18% vs 64% for standard flatwork. I'd recommend subcontracting this or flagging it as an alternate. Want me to generate an RFI for the missing info?",
    time: '10:15 AM',
  },
  {
    id: 5, role: 'user',
    content: 'Yes, send the standard items to estimating and draft the RFI',
    time: '10:16 AM',
  },
  {
    id: 6, role: 'agent',
    content: "Done. I've sent 3 standard items (SOG, curb & gutter, sidewalk) to the Estimating Bot and drafted the RFI:",
    time: '10:16 AM',
    rfi: {
      to: 'estimating@austincommercial.com',
      subject: 'RFI \u2014 McKinney Town Center Concrete Package',
      body: "Hi,\n\nWe're reviewing the McKinney Town Center concrete spec package and have the following items requiring clarification before we can finalize our bid:\n\n1. Drilled Piers (Section 03 30 00) \u2014 Spec calls for 24\" dia. piers but does not specify depth. Please confirm required pier depth or reference the geotech report.\n\n2. Grade Beams (Drawing S-4) \u2014 Reinforcement schedule references structural drawing S-4, which was not included in the bid package. Please provide.\n\n3. Decorative Stamped Concrete \u2014 Please confirm pattern, color, and whether this is base bid or alternate.\n\nWe'd appreciate a response by March 18 to meet the bid deadline.\n\nBest,\nDACP Construction\nestimating@dacpconstruction.com",
    },
    actions: [
      { label: 'Approve & Send RFI', variant: 'primary' },
      { label: 'Edit', variant: 'secondary' },
    ],
  },
];

// ─── Demo Context ───────────────────────────────────────────────────────────────
const DEMO_CONTEXT = {
  currentDoc: {
    title: 'McKinney Town Center',
    rows: [
      { label: 'GC', value: 'Austin Commercial' },
      { label: 'Pages', value: '48' },
      { label: 'Sections', value: '12 CSI divisions' },
      { label: 'Flags', value: '2', warn: true },
      { label: 'RFIs', value: '1 drafted' },
      { label: 'Bid Due', value: 'Mar 22', danger: true },
    ],
  },
  extractionStatus: {
    standard: 3,
    clarification: 2,
    outsideScope: 1,
    unpriced: 2,
  },
  specSections: [
    { code: '01 45 00', name: 'Quality Control' },
    { code: '03 30 00', name: 'Cast-in-Place Concrete' },
    { code: '03 41 00', name: 'Precast Structural' },
    { code: '31 63 00', name: 'Bored Piles' },
    { code: '32 13 00', name: 'Rigid Paving' },
    { code: '32 16 00', name: 'Curbs & Gutters' },
  ],
};

// ─── Demo Documents ─────────────────────────────────────────────────────────────
const DEMO_DOCUMENTS = [
  { id: 1, name: 'McKinney Town Center Specs', gc: 'Austin Commercial', pages: 48, date: 'Today', progress: 60, status: 'In Progress' },
  { id: 2, name: 'I-35 Retaining Walls SOW', gc: 'Hensel Phelps', pages: 12, date: 'Yesterday', progress: 100, status: 'Complete' },
  { id: 3, name: 'Bishop Arts Mixed-Use SOW', gc: "Rogers-O'Brien", pages: 8, date: 'Today', progress: 100, status: 'Complete' },
  { id: 4, name: 'Memorial Hermann Ph2 Specs', gc: 'Turner', pages: 24, date: '3 days ago', progress: 100, status: 'Complete' },
  { id: 5, name: 'Samsung Fab Equipment Pads', gc: 'DPR', pages: 6, date: '5 days ago', progress: 100, status: 'Complete' },
];

const I35_EXTRACTION = [
  { item: 'Cantilever retaining wall', qty: '2,400 LF', section: '03 30 00', status: 'Priced' },
  { item: 'Grade beam (24"x36")', qty: '800 LF', section: '03 30 00', status: 'Priced' },
  { item: '#5 Rebar @ 12" O.C.', qty: '14,200 LF', section: '03 20 00', status: 'Priced' },
  { item: 'Form & strip', qty: '9,600 SF', section: '03 10 00', status: 'Priced' },
  { item: 'Concrete testing (3rd party)', qty: '18 sets', section: '01 45 00', status: 'Priced' },
  { item: 'Mobilization', qty: '1 LS', section: '01 50 00', status: 'Priced' },
];

// ─── Demo History ───────────────────────────────────────────────────────────────
const DEMO_HISTORY = [
  { date: 'Mar 9', document: 'McKinney Town Center Specs', gc: 'Austin Commercial', items: 8, flags: 2, rfis: 1, result: 'In Progress' },
  { date: 'Mar 8', document: 'I-35 Retaining Walls SOW', gc: 'Hensel Phelps', items: 6, flags: 0, rfis: 0, result: 'Sent to Estimating' },
  { date: 'Mar 9', document: 'Bishop Arts Mixed-Use SOW', gc: "Rogers-O'Brien", items: 5, flags: 1, rfis: 0, result: 'Sent to Estimating' },
  { date: 'Mar 6', document: 'Memorial Hermann Ph2 Specs', gc: 'Turner', items: 12, flags: 3, rfis: 2, result: 'Sent to Estimating' },
  { date: 'Mar 4', document: 'Samsung Fab Equipment Pads', gc: 'DPR', items: 4, flags: 0, rfis: 0, result: 'Sent to Estimating' },
  { date: 'Feb 28', document: 'UT Dallas Science Bldg', gc: 'Balfour Beatty', items: 15, flags: 4, rfis: 3, result: 'Sent to Estimating' },
];

// ─── Chat Message ───────────────────────────────────────────────────────────────
function ChatMessage({ msg }) {
  const isUser = msg.role === 'user';
  const accent = '#7c3aed';

  return (
    <div className={`flex gap-2.5 max-w-[85%] ${isUser ? 'self-end flex-row-reverse' : 'self-start'}`}>
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold text-white shrink-0 mt-0.5"
        style={{ backgroundColor: isUser ? '#6b6b65' : accent }}
      >
        {isUser ? 'A' : 'S'}
      </div>

      <div className="min-w-0">
        <div className={`flex items-center gap-2 mb-1 ${isUser ? 'flex-row-reverse' : ''}`}>
          <span className="text-[11px] font-semibold text-[#6b6b65]">{isUser ? 'Admin' : 'Scope Analyzer'}</span>
          <span className="text-[10px] text-[#c5c5bc] font-mono">{msg.time}</span>
        </div>

        {msg.content && (
          <div
            className={`px-4 py-3 text-[13px] leading-[1.6] ${
              isUser
                ? 'text-white rounded-[14px] rounded-tr-[4px]'
                : 'bg-terminal-panel border border-[#e8e6e1] text-[#333330] rounded-[14px] rounded-tl-[4px]'
            }`}
            style={isUser ? { backgroundColor: '#1e3a5f' } : undefined}
          >
            {formatContent(msg.content)}
          </div>
        )}

        {msg.scopeCard && <ScopeExtractionCard data={msg.scopeCard} />}
        {msg.rfi && <RFICard data={msg.rfi} />}

        {msg.afterContent && (
          <div className="mt-2.5 px-4 py-3 bg-terminal-panel border border-[#e8e6e1] text-[13px] text-[#333330] leading-[1.6] rounded-[14px]">
            {formatContent(msg.afterContent)}
          </div>
        )}

        {msg.actions && (
          <div className="flex gap-1.5 mt-2.5">
            {msg.actions.map((a, i) => (
              <button
                key={i}
                className={`px-3.5 py-[6px] rounded-lg text-[11px] font-semibold transition-colors ${
                  a.variant === 'primary'
                    ? 'text-white bg-[#7c3aed] hover:bg-[#6d28d9]'
                    : 'bg-terminal-panel text-[#6b6b65] border-[1.5px] border-[#e8e6e1] hover:bg-[#f5f4f0]'
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Context Panel ──────────────────────────────────────────────────────────────
function ContextSection({ title, meta, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-[#f0eeea]">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-[#f0eeea]/50 transition-colors">
        <span className="text-[11px] font-bold text-[#6b6b65] uppercase tracking-[0.8px]">{title}</span>
        <span className="text-[10px] text-[#c5c5bc]">{meta}</span>
      </button>
      {open && <div className="px-4 pb-3.5">{children}</div>}
    </div>
  );
}

function ScopeContextPanel() {
  const ctx = DEMO_CONTEXT;
  const es = ctx.extractionStatus;

  return (
    <>
      {/* Current Document */}
      <ContextSection title="Current Document" meta={ctx.currentDoc.title}>
        {ctx.currentDoc.rows.map((r, i) => (
          <div key={i} className="flex justify-between py-[6px] text-[12px] border-b border-[#f0eeea] last:border-b-0">
            <span className="text-[#6b6b65]">{r.label}</span>
            <span className={`font-mono font-semibold text-[11px] ${
              r.danger ? 'text-[#c0392b]' : r.warn ? 'text-[#b8860b]' : r.green ? 'text-[#1a6b3c]' : 'text-terminal-text'
            }`}>{r.value}</span>
          </div>
        ))}
      </ContextSection>

      {/* Extraction Status */}
      <ContextSection title="Extraction Status" meta={`${es.standard + es.clarification + es.outsideScope + es.unpriced} items`}>
        <div className="space-y-1.5">
          {[
            { label: 'Standard (priceable)', count: es.standard, color: '#1a6b3c', bg: '#edf7f0' },
            { label: 'Needs clarification', count: es.clarification, color: '#b8860b', bg: '#fdf6e8' },
            { label: 'Outside scope', count: es.outsideScope, color: '#c0392b', bg: '#fbeae8' },
            { label: 'Unpriced', count: es.unpriced, color: '#9a9a92', bg: '#f5f4f0' },
          ].map((s, i) => (
            <div key={i} className="flex items-center justify-between py-[5px] text-[12px]">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                <span className="text-terminal-text">{s.label}</span>
              </div>
              <span
                className="text-[10px] font-bold px-2 py-[2px] rounded-[5px]"
                style={{ backgroundColor: s.bg, color: s.color }}
              >
                {s.count}
              </span>
            </div>
          ))}
        </div>
      </ContextSection>

      {/* Spec Sections Referenced */}
      <ContextSection title="Spec Sections" meta="Referenced">
        <div className="space-y-1">
          {ctx.specSections.map((s, i) => (
            <div key={i} className="flex items-center gap-2.5 py-[5px] text-[11px] border-b border-[#f0eeea] last:border-b-0">
              <span className="font-mono text-[10px] text-[#9a9a92] shrink-0 w-14">{s.code}</span>
              <span className="text-terminal-text">{s.name}</span>
            </div>
          ))}
        </div>
      </ContextSection>
    </>
  );
}

// ─── Documents Tab ──────────────────────────────────────────────────────────────
function DocumentsTab() {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-5 py-5">
        <div className="grid grid-cols-2 gap-3 mb-5">
          {DEMO_DOCUMENTS.map(doc => (
            <div key={doc.id} className="bg-terminal-panel border border-terminal-border rounded-[14px] p-4 hover:border-[#7c3aed33] transition-colors cursor-pointer">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-[10px] bg-[#f3f0ff] flex items-center justify-center">
                    <span className="text-[12px] font-bold text-[#7c3aed]">S</span>
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold text-terminal-text">{doc.name}</div>
                    <div className="text-[11px] text-[#9a9a92]">{doc.gc} &middot; {doc.pages} pages</div>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between mt-3">
                <span className="text-[10px] text-[#9a9a92]">{doc.date}</span>
                {doc.progress < 100 ? (
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-1.5 rounded-full bg-[#f0eeea] overflow-hidden">
                      <div className="h-full rounded-full bg-[#7c3aed]" style={{ width: `${doc.progress}%` }} />
                    </div>
                    <span className="text-[10px] font-mono text-[#7c3aed] font-semibold">{doc.progress}%</span>
                  </div>
                ) : (
                  <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#edf7f0] text-[#1a6b3c]">Complete</span>
                )}
              </div>
            </div>
          ))}

          {/* Upload card */}
          <div className="border-2 border-dashed border-[#e8e6e1] rounded-[14px] p-4 flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-[#7c3aed] hover:bg-[#f3f0ff]/30 transition-colors min-h-[120px]">
            <div className="w-10 h-10 rounded-full bg-[#f5f4f0] flex items-center justify-center">
              <span className="text-[20px] text-[#9a9a92]">+</span>
            </div>
            <span className="text-[12px] font-semibold text-[#6b6b65]">Upload new spec document</span>
            <span className="text-[10px] text-[#9a9a92]">PDF, DOCX, TXT, DWG</span>
          </div>
        </div>

        {/* I-35 extraction table */}
        <div className="mb-2">
          <div className="text-[13px] font-semibold text-terminal-text mb-3">I-35 Retaining Walls \u2014 Extraction</div>
          <div className="bg-terminal-panel border border-terminal-border rounded-xl overflow-hidden">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-terminal-border">
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Item</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Quantity</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Section</th>
                  <th className="text-center px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody>
                {I35_EXTRACTION.map((row, i) => (
                  <tr key={i} className="border-b border-terminal-border/50 hover:bg-[#f5f4f0]">
                    <td className="px-4 py-2.5 font-semibold text-terminal-text">{row.item}</td>
                    <td className="px-4 py-2.5 font-mono text-[#6b6b65]">{row.qty}</td>
                    <td className="px-4 py-2.5 font-mono text-[#9a9a92]">{row.section}</td>
                    <td className="px-4 py-2.5 text-center">
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#edf7f0] text-[#1a6b3c]">{row.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── History Tab ────────────────────────────────────────────────────────────────
function HistoryTab() {
  const resultBadge = (r) => {
    if (r === 'Sent to Estimating') return 'bg-[#edf7f0] text-[#1a6b3c]';
    if (r === 'In Progress') return 'bg-[#fdf6e8] text-[#b8860b]';
    return 'bg-[#f5f4f0] text-[#6b6b65]';
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Stats row */}
      <div className="grid grid-cols-4 gap-px bg-terminal-border border-b border-terminal-border">
        {[
          { label: 'Documents Analyzed', value: '23' },
          { label: 'Scope Items Extracted', value: '142' },
          { label: 'RFIs Generated', value: '11' },
          { label: 'Out-of-Scope Flags', value: '4' },
        ].map((s, i) => (
          <div key={i} className="bg-terminal-panel px-5 py-4 text-center">
            <div className="text-[18px] font-bold text-terminal-text">{s.value}</div>
            <div className="text-[10px] text-[#9a9a92] font-semibold uppercase tracking-wider">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="px-5 py-4">
        <div className="text-[13px] font-semibold text-terminal-text mb-3">Analysis History</div>
        <div className="bg-terminal-panel border border-terminal-border rounded-xl overflow-hidden">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-terminal-border">
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Date</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Document</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">GC</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Items</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Flags</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">RFIs</th>
                <th className="text-center px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Result</th>
              </tr>
            </thead>
            <tbody>
              {DEMO_HISTORY.map((h, i) => (
                <tr key={i} className="border-b border-terminal-border/50 hover:bg-[#f5f4f0]">
                  <td className="px-4 py-2.5 font-mono text-[#9a9a92]">{h.date}</td>
                  <td className="px-4 py-2.5 font-semibold text-terminal-text">{h.document}</td>
                  <td className="px-4 py-2.5 text-[#6b6b65]">{h.gc}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-terminal-text">{h.items}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-terminal-text">{h.flags > 0 ? h.flags : '\u2014'}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-terminal-text">{h.rfis > 0 ? h.rfis : '\u2014'}</td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${resultBadge(h.result)}`}>{h.result}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Config Tab ─────────────────────────────────────────────────────────────────
function ConfigTab() {
  const [mode, setMode] = useState('copilot');
  const [flagThreshold, setFlagThreshold] = useState('25');
  const [autoRFI, setAutoRFI] = useState(true);
  const [competencies, setCompetencies] = useState('SOG, Curb & Gutter, Sidewalk, Retaining Walls, Drilled Piers, Grade Beams');
  const [csiDivisions, setCsiDivisions] = useState('03, 31, 32');
  const [fileTypes, setFileTypes] = useState('PDF, DOCX, TXT, DWG');

  const accent = '#7c3aed';

  const Toggle = ({ on, setOn }) => (
    <button onClick={() => setOn(v => !v)} className={`w-9 h-5 rounded-full relative transition-colors ${on ? '' : 'bg-[#d4d4d0]'}`} style={on ? { backgroundColor: accent } : undefined}>
      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-5 py-5 space-y-5">
        {/* Operating Mode */}
        <div className="bg-terminal-panel border border-terminal-border rounded-xl p-5">
          <div className="text-[13px] font-semibold text-terminal-text mb-1">Operating Mode</div>
          <div className="text-[11px] text-[#9a9a92] mb-4">Controls how the Scope Analyzer handles extractions</div>
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: 'copilot', label: 'Copilot', desc: 'Extracts for review' },
              { id: 'autonomous', label: 'Autonomous', desc: 'Extracts & sends automatically' },
            ].map(m => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`p-3 rounded-xl border text-center transition-colors ${
                  mode === m.id
                    ? 'border-transparent text-white'
                    : 'bg-white border-terminal-border text-terminal-text hover:bg-[#f5f4f0]'
                }`}
                style={mode === m.id ? { backgroundColor: accent } : undefined}
              >
                <div className="text-[12px] font-semibold">{m.label}</div>
                <div className={`text-[10px] mt-0.5 ${mode === m.id ? 'text-white/70' : 'text-[#9a9a92]'}`}>{m.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Scope Detection */}
        <div className="bg-terminal-panel border border-terminal-border rounded-xl p-5 space-y-4">
          <div className="text-[13px] font-semibold text-terminal-text mb-1">Scope Detection</div>
          <div>
            <label className="text-[12px] font-semibold text-terminal-text block mb-1.5">Core Competencies</label>
            <input
              value={competencies}
              onChange={e => setCompetencies(e.target.value)}
              className="w-full px-3 py-2 rounded-[8px] border border-terminal-border bg-[#f5f4f0] text-[12px] text-terminal-text focus:outline-none focus:border-[#7c3aed]"
            />
            <div className="text-[10px] text-[#9a9a92] mt-1">Items outside these competencies will be flagged</div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[12px] font-semibold text-terminal-text">Flag threshold</div>
              <div className="text-[10px] text-[#9a9a92]">Win rate below this triggers a flag</div>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                value={flagThreshold}
                onChange={e => setFlagThreshold(e.target.value)}
                className="w-14 px-2 py-1.5 rounded-lg border border-terminal-border bg-[#f5f4f0] text-[12px] text-terminal-text text-center font-mono focus:outline-none focus:border-[#7c3aed]"
              />
              <span className="text-[11px] text-[#9a9a92]">%</span>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[12px] font-semibold text-terminal-text">Auto-generate RFIs</div>
              <div className="text-[10px] text-[#9a9a92]">Draft RFIs when clarification items are found</div>
            </div>
            <Toggle on={autoRFI} setOn={setAutoRFI} />
          </div>
        </div>

        {/* Spec Parsing */}
        <div className="bg-terminal-panel border border-terminal-border rounded-xl p-5 space-y-4">
          <div className="text-[13px] font-semibold text-terminal-text mb-1">Spec Parsing</div>
          <div>
            <label className="text-[12px] font-semibold text-terminal-text block mb-1.5">Target CSI Divisions</label>
            <input
              value={csiDivisions}
              onChange={e => setCsiDivisions(e.target.value)}
              className="w-full px-3 py-2 rounded-[8px] border border-terminal-border bg-[#f5f4f0] text-[12px] text-terminal-text font-mono focus:outline-none focus:border-[#7c3aed]"
            />
            <div className="text-[10px] text-[#9a9a92] mt-1">Only parse sections within these CSI divisions</div>
          </div>
          <div>
            <label className="text-[12px] font-semibold text-terminal-text block mb-1.5">Accepted File Types</label>
            <input
              value={fileTypes}
              onChange={e => setFileTypes(e.target.value)}
              className="w-full px-3 py-2 rounded-[8px] border border-terminal-border bg-[#f5f4f0] text-[12px] text-terminal-text font-mono focus:outline-none focus:border-[#7c3aed]"
            />
          </div>
        </div>

        {/* Save */}
        <button onClick={() => alert('Configuration saved.')} className="w-full py-3 rounded-xl text-[13px] font-semibold text-white transition-opacity hover:opacity-90" style={{ backgroundColor: accent }}>
          Save Configuration
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────
export default function ScopeAnalyzerChat() {
  const [activeTab, setActiveTab] = useState('Chat');
  const [input, setInput] = useState('');

  const tabs = ['Chat', 'Documents', 'History', 'Config'];
  const accent = '#7c3aed';

  const handleSend = () => {
    if (!input.trim()) return;
    setInput('');
  };

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      {/* ── Top Bar ────────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-terminal-border bg-terminal-panel shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-[10px] bg-[#f3f0ff] flex items-center justify-center">
            <span className="text-[14px]" role="img" aria-label="scope">&#128269;</span>
          </div>
          <div>
            <div className="text-[15px] font-semibold text-terminal-text">Scope Analyzer</div>
            <div className="text-[11px] text-[#9a9a92] flex items-center gap-[5px]">
              <span className="w-[5px] h-[5px] rounded-full bg-[#b8860b]" />
              Copilot &mdash; requires approval for extractions
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-[9px] font-bold px-2.5 py-[4px] rounded-[6px] uppercase tracking-[0.5px] bg-[#fdf6e8] text-[#b8860b]">
            COPILOT
          </span>
          <div className="flex items-center gap-1.5">
            {tabs.map(t => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`px-2.5 py-[5px] rounded-[7px] text-[10px] font-semibold border transition-colors ${
                  activeTab === t
                    ? 'border-transparent'
                    : 'bg-terminal-panel text-[#9a9a92] border-terminal-border hover:bg-[#f5f4f0]'
                }`}
                style={activeTab === t ? { backgroundColor: accent + '12', color: accent, borderColor: accent + '33' } : undefined}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Chat Tab ──────────────────────────────────────────────────────────── */}
      {activeTab === 'Chat' && (
        <div className="flex flex-1 min-h-0">
          {/* Chat area */}
          <div className="flex-1 flex flex-col border-r border-terminal-border min-w-0 min-h-0">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-4">
              {DEMO_MESSAGES.map(msg => (
                <ChatMessage key={msg.id} msg={msg} />
              ))}
            </div>

            {/* Input */}
            <div className="px-5 py-3.5 border-t border-terminal-border bg-terminal-panel shrink-0">
              <div className="flex items-end gap-2.5">
                <div className="flex-1 relative">
                  <textarea
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder="Upload a spec document or ask about an extraction..."
                    rows={1}
                    className="w-full px-4 py-3 pr-11 border-[1.5px] border-terminal-border rounded-[14px] text-[13px] text-terminal-text bg-[#f5f4f0] outline-none resize-none min-h-[44px] max-h-[120px] focus:bg-terminal-panel transition-colors placeholder:text-[#c5c5bc]"
                    onFocus={e => e.target.style.borderColor = accent}
                    onBlur={e => e.target.style.borderColor = ''}
                  />
                  <button onClick={() => alert('File upload not available in demo mode.')} className="absolute right-3 bottom-2.5 text-[#c5c5bc] hover:text-[#6b6b65] transition-colors">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                    </svg>
                  </button>
                </div>
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  className="w-11 h-11 rounded-xl text-white flex items-center justify-center transition-colors disabled:opacity-40 shrink-0"
                  style={{ backgroundColor: '#1e3a5f' }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="22" y1="2" x2="11" y2="13" />
                    <polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              </div>
              <div className="text-[10px] text-[#c5c5bc] text-center mt-1.5">
                Scope Analyzer parses construction specs, extracts scope items, flags out-of-scope work, and generates RFIs.
              </div>
            </div>
          </div>

          {/* Context panel */}
          <div className="w-[280px] shrink-0 min-h-0 overflow-y-auto bg-[#f5f4f0]">
            <ScopeContextPanel />
          </div>
        </div>
      )}

      {/* ── Documents Tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'Documents' && <DocumentsTab />}

      {/* ── History Tab ───────────────────────────────────────────────────────── */}
      {activeTab === 'History' && <HistoryTab />}

      {/* ── Config Tab ────────────────────────────────────────────────────────── */}
      {activeTab === 'Config' && <ConfigTab />}
    </div>
  );
}

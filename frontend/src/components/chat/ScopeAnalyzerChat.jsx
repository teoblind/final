import React, { useState, useEffect } from 'react';
import api, { putApi } from '../../lib/hooks/useApi';

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
              <span className="text-[#6b6b65]">- {item.quantity}</span>
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

// ─── Demo Messages (initial chat context) ────────────────────────────────────
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

function ScopeContextPanel({ inbox, estimates, stats }) {
  // Build context from the most recent inbox item (or fall back to placeholder)
  const latestBid = inbox.length > 0 ? inbox[0] : null;
  const scope = latestBid?.scope || {};
  const scopeItems = scope.items || scope.lineItems || [];

  // Count extraction statuses from scope items
  const standard = scopeItems.filter(i => i.status === 'priced' || i.status === 'standard').length;
  const clarification = scopeItems.filter(i => i.status === 'clarification').length;
  const outsideScope = scopeItems.filter(i => i.status === 'warning' || i.status === 'outside_scope').length;
  const unpriced = scopeItems.filter(i => !i.status || i.status === 'none' || i.status === 'unpriced').length;
  const totalItems = scopeItems.length || (standard + clarification + outsideScope + unpriced);

  const docTitle = latestBid?.subject || latestBid?.gc_name || 'No documents yet';
  const missingInfo = latestBid?.missing_info || [];

  const rows = latestBid ? [
    { label: 'GC', value: latestBid.gc_name || latestBid.from_name || '\u2014' },
    { label: 'Status', value: latestBid.status || 'new' },
    { label: 'Urgency', value: latestBid.urgency || '\u2014', danger: latestBid.urgency === 'high' },
    { label: 'Scope Items', value: String(totalItems) },
    { label: 'Missing Info', value: String(missingInfo.length), warn: missingInfo.length > 0 },
    { label: 'Bid Due', value: latestBid.due_date ? new Date(latestBid.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '\u2014', danger: true },
  ] : [
    { label: 'Status', value: 'No RFQs in inbox' },
  ];

  // Spec sections from scope data
  const specSections = [];
  const sectionSet = new Set();
  for (const item of scopeItems) {
    const sec = item.section || item.csi_section;
    if (sec && !sectionSet.has(sec)) {
      sectionSet.add(sec);
      specSections.push({ code: sec, name: item.name || item.description || sec });
    }
  }

  return (
    <>
      <ContextSection title="Current Document" meta={docTitle}>
        {rows.map((r, i) => (
          <div key={i} className="flex justify-between py-[6px] text-[12px] border-b border-[#f0eeea] last:border-b-0">
            <span className="text-[#6b6b65]">{r.label}</span>
            <span className={`font-mono font-semibold text-[11px] ${
              r.danger ? 'text-[#c0392b]' : r.warn ? 'text-[#b8860b]' : r.green ? 'text-[#1a6b3c]' : 'text-terminal-text'
            }`}>{r.value}</span>
          </div>
        ))}
      </ContextSection>

      <ContextSection title="Extraction Status" meta={`${totalItems} items`}>
        <div className="space-y-1.5">
          {[
            { label: 'Standard (priceable)', count: standard, color: '#1a6b3c', bg: '#edf7f0' },
            { label: 'Needs clarification', count: clarification, color: '#b8860b', bg: '#fdf6e8' },
            { label: 'Outside scope', count: outsideScope, color: '#c0392b', bg: '#fbeae8' },
            { label: 'Unpriced', count: unpriced, color: '#9a9a92', bg: '#f5f4f0' },
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

      {specSections.length > 0 && (
        <ContextSection title="Spec Sections" meta="Referenced">
          <div className="space-y-1">
            {specSections.map((s, i) => (
              <div key={i} className="flex items-center gap-2.5 py-[5px] text-[11px] border-b border-[#f0eeea] last:border-b-0">
                <span className="font-mono text-[10px] text-[#9a9a92] shrink-0 w-14">{s.code}</span>
                <span className="text-terminal-text">{s.name}</span>
              </div>
            ))}
          </div>
        </ContextSection>
      )}

      {/* Stats summary if available */}
      {stats && (
        <ContextSection title="Pipeline Stats" meta="Live" defaultOpen={false}>
          <div className="space-y-1.5">
            {[
              { label: 'Open RFQs', value: stats.openRfqs },
              { label: 'Draft Estimates', value: stats.draftEstimates },
              { label: 'Sent Estimates', value: stats.sentEstimates },
              { label: 'Active Jobs', value: stats.activeJobs },
              { label: 'Win Rate', value: `${stats.winRate}%` },
            ].map((s, i) => (
              <div key={i} className="flex justify-between py-[5px] text-[12px] border-b border-[#f0eeea] last:border-b-0">
                <span className="text-[#6b6b65]">{s.label}</span>
                <span className="font-mono font-semibold text-[11px] text-terminal-text">{s.value}</span>
              </div>
            ))}
          </div>
        </ContextSection>
      )}
    </>
  );
}

// ─── Documents Tab ──────────────────────────────────────────────────────────────
function DocumentsTab({ inbox, loading }) {
  // Build document cards from real inbox (bid requests)
  const documents = inbox.map(bid => ({
    id: bid.id,
    name: bid.subject || bid.gc_name || 'Untitled RFQ',
    gc: bid.gc_name || bid.from_name || '\u2014',
    pages: bid.attachments?.length ? `${bid.attachments.length} files` : '\u2014',
    date: bid.received_at ? formatRelativeDate(bid.received_at) : '\u2014',
    progress: bid.status === 'new' ? 30 : bid.status === 'reviewing' ? 60 : 100,
    status: bid.status || 'new',
    scope: bid.scope || {},
  }));

  // Pick the first document with scope items to show extraction detail
  const detailDoc = documents.find(d => {
    const items = d.scope.items || d.scope.lineItems || [];
    return items.length > 0;
  });
  const extractionItems = detailDoc ? (detailDoc.scope.items || detailDoc.scope.lineItems || []) : [];

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-5 py-5">
        {loading ? (
          <div className="text-center py-12 text-[13px] text-[#9a9a92]">Loading documents...</div>
        ) : documents.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-[13px] text-[#9a9a92] mb-2">No bid requests in inbox yet</div>
            <div className="text-[11px] text-[#c5c5bc]">Upload a spec document to get started</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 mb-5">
            {documents.map(doc => (
              <div key={doc.id} className="bg-terminal-panel border border-terminal-border rounded-[14px] p-4 hover:border-[#7c3aed33] transition-colors cursor-pointer">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-[10px] bg-[#f3f0ff] flex items-center justify-center">
                      <span className="text-[12px] font-bold text-[#7c3aed]">S</span>
                    </div>
                    <div>
                      <div className="text-[13px] font-semibold text-terminal-text">{doc.name}</div>
                      <div className="text-[11px] text-[#9a9a92]">{doc.gc} &middot; {doc.pages}</div>
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
                    <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-[#edf7f0] text-[#1a6b3c]">
                      {doc.status === 'estimated' ? 'Estimated' : 'Complete'}
                    </span>
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
        )}

        {/* Extraction table for the first document with scope items */}
        {extractionItems.length > 0 && (
          <div className="mb-2">
            <div className="text-[13px] font-semibold text-terminal-text mb-3">{detailDoc.name} - Extraction</div>
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
                  {extractionItems.map((row, i) => (
                    <tr key={i} className="border-b border-terminal-border/50 hover:bg-[#f5f4f0]">
                      <td className="px-4 py-2.5 font-semibold text-terminal-text">{row.name || row.item || row.description || '\u2014'}</td>
                      <td className="px-4 py-2.5 font-mono text-[#6b6b65]">{row.quantity || row.qty || '\u2014'}</td>
                      <td className="px-4 py-2.5 font-mono text-[#9a9a92]">{row.section || row.csi_section || '\u2014'}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
                          row.status === 'priced' || row.status === 'standard' ? 'bg-[#edf7f0] text-[#1a6b3c]' :
                          row.status === 'clarification' ? 'bg-[#fdf6e8] text-[#b8860b]' :
                          row.status === 'warning' || row.status === 'outside_scope' ? 'bg-[#fbeae8] text-[#c0392b]' :
                          'bg-[#f5f4f0] text-[#6b6b65]'
                        }`}>
                          {(row.status || 'unpriced').charAt(0).toUpperCase() + (row.status || 'unpriced').slice(1)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── History Tab ────────────────────────────────────────────────────────────────
function HistoryTab({ estimates, stats, loading }) {
  const resultBadge = (status) => {
    if (status === 'sent') return 'bg-[#edf7f0] text-[#1a6b3c]';
    if (status === 'draft') return 'bg-[#fdf6e8] text-[#b8860b]';
    return 'bg-[#f5f4f0] text-[#6b6b65]';
  };

  const resultLabel = (status) => {
    if (status === 'sent') return 'Sent to GC';
    if (status === 'draft') return 'Draft';
    if (status === 'approved') return 'Approved';
    if (status === 'rejected') return 'Rejected';
    return status ? status.charAt(0).toUpperCase() + status.slice(1) : '\u2014';
  };

  // Build history rows from real estimates
  const historyRows = estimates.map(est => {
    const lineItems = est.line_items || [];
    return {
      date: est.created_at ? new Date(est.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '\u2014',
      document: est.project_name || '\u2014',
      gc: est.gc_name || '\u2014',
      items: lineItems.length,
      flags: lineItems.filter(li => !li.pricingId && !li.pricing_id).length,
      result: est.status,
      totalBid: est.total_bid,
    };
  });

  // Stats from real API data
  const statsRow = stats ? [
    { label: 'Total Bid Requests', value: String(stats.totalBidRequests || 0) },
    { label: 'Estimates Created', value: String(stats.totalEstimates || 0) },
    { label: 'Estimates Sent', value: String(stats.sentEstimates || 0) },
    { label: 'Win Rate', value: `${stats.winRate || 0}%` },
  ] : [
    { label: 'Total Bid Requests', value: '0' },
    { label: 'Estimates Created', value: '0' },
    { label: 'Estimates Sent', value: '0' },
    { label: 'Win Rate', value: '0%' },
  ];

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Stats row */}
      <div className="grid grid-cols-4 gap-px bg-terminal-border border-b border-terminal-border">
        {statsRow.map((s, i) => (
          <div key={i} className="bg-terminal-panel px-5 py-4 text-center">
            <div className="text-[18px] font-bold text-terminal-text">{s.value}</div>
            <div className="text-[10px] text-[#9a9a92] font-semibold uppercase tracking-wider">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="px-5 py-4">
        <div className="text-[13px] font-semibold text-terminal-text mb-3">Analysis History</div>
        {loading ? (
          <div className="text-center py-8 text-[13px] text-[#9a9a92]">Loading history...</div>
        ) : historyRows.length === 0 ? (
          <div className="text-center py-8 text-[13px] text-[#9a9a92]">No estimates yet</div>
        ) : (
          <div className="bg-terminal-panel border border-terminal-border rounded-xl overflow-hidden">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-terminal-border">
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Date</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Document</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">GC</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Items</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Flags</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Total Bid</th>
                  <th className="text-center px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Result</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map((h, i) => (
                  <tr key={i} className="border-b border-terminal-border/50 hover:bg-[#f5f4f0]">
                    <td className="px-4 py-2.5 font-mono text-[#9a9a92]">{h.date}</td>
                    <td className="px-4 py-2.5 font-semibold text-terminal-text">{h.document}</td>
                    <td className="px-4 py-2.5 text-[#6b6b65]">{h.gc}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-terminal-text">{h.items}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-terminal-text">{h.flags > 0 ? h.flags : '\u2014'}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-terminal-text">
                      {h.totalBid ? `$${Number(h.totalBid).toLocaleString()}` : '\u2014'}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${resultBadge(h.result)}`}>{resultLabel(h.result)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const accent = '#7c3aed';

  const Toggle = ({ on, setOn }) => (
    <button onClick={() => setOn(v => !v)} className={`w-9 h-5 rounded-full relative transition-colors ${on ? '' : 'bg-[#d4d4d0]'}`} style={on ? { backgroundColor: accent } : undefined}>
      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg('');
    try {
      await putApi('/v1/tenant', {
        settings: {
          scopeAnalyzer: {
            mode,
            flagThreshold: Number(flagThreshold),
            autoRFI,
            competencies: competencies.split(',').map(s => s.trim()).filter(Boolean),
            csiDivisions: csiDivisions.split(',').map(s => s.trim()).filter(Boolean),
            fileTypes: fileTypes.split(',').map(s => s.trim()).filter(Boolean),
          },
        },
      });
      setSaveMsg('Configuration saved.');
    } catch (err) {
      console.error('Save config error:', err);
      setSaveMsg(err?.response?.data?.error || 'Failed to save configuration.');
    } finally {
      setSaving(false);
    }
  };

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
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3 rounded-xl text-[13px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          style={{ backgroundColor: accent }}
        >
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
        {saveMsg && (
          <div className={`text-center text-[12px] ${saveMsg.includes('Failed') ? 'text-[#c0392b]' : 'text-[#1a6b3c]'}`}>
            {saveMsg}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────────
function formatRelativeDate(dateStr) {
  if (!dateStr) return '\u2014';
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Main Component ─────────────────────────────────────────────────────────────
export default function ScopeAnalyzerChat() {
  const [activeTab, setActiveTab] = useState('Chat');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState(DEMO_MESSAGES);

  // Real API data
  const [inbox, setInbox] = useState([]);
  const [estimates, setEstimates] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/v1/estimates/inbox').catch(() => ({ data: {} })),
      api.get('/v1/estimates/estimates').catch(() => ({ data: {} })),
      api.get('/v1/estimates/stats').catch(() => ({ data: {} })),
    ]).then(([inboxRes, estRes, statsRes]) => {
      setInbox(inboxRes.data.bidRequests || inboxRes.data || []);
      setEstimates(estRes.data.estimates || estRes.data || []);
      setStats(statsRes.data.stats || statsRes.data || null);
    }).finally(() => setLoading(false));
  }, []);

  const tabs = ['Chat', 'Documents', 'History', 'Config'];
  const accent = '#7c3aed';

  const handleSend = () => {
    if (!input.trim()) return;
    const now = new Date();
    const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const newMsg = {
      id: Date.now(),
      role: 'user',
      content: input,
      time,
    };
    setMessages(prev => [...prev, newMsg]);
    setInput('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
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
              {messages.map(msg => (
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
                    onKeyDown={handleKeyDown}
                    placeholder="Upload a spec document or ask about an extraction..."
                    rows={1}
                    className="w-full px-4 py-3 pr-11 border-[1.5px] border-terminal-border rounded-[14px] text-[13px] text-terminal-text bg-[#f5f4f0] outline-none resize-none min-h-[44px] max-h-[120px] focus:bg-terminal-panel transition-colors placeholder:text-[#c5c5bc]"
                    onFocus={e => e.target.style.borderColor = accent}
                    onBlur={e => e.target.style.borderColor = ''}
                  />
                  <button onClick={() => alert('File upload not available yet.')} className="absolute right-3 bottom-2.5 text-[#c5c5bc] hover:text-[#6b6b65] transition-colors">
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
            <ScopeContextPanel inbox={inbox} estimates={estimates} stats={stats} />
          </div>
        </div>
      )}

      {/* ── Documents Tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'Documents' && <DocumentsTab inbox={inbox} loading={loading} />}

      {/* ── History Tab ───────────────────────────────────────────────────────── */}
      {activeTab === 'History' && <HistoryTab estimates={estimates} stats={stats} loading={loading} />}

      {/* ── Config Tab ────────────────────────────────────────────────────────── */}
      {activeTab === 'Config' && <ConfigTab />}
    </div>
  );
}

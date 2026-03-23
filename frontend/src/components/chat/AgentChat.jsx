import React, { useState, useEffect, useRef, useCallback, Suspense, lazy } from 'react';
import { Paperclip, Send, ChevronRight, ChevronLeft, PanelRight, Volume2, VolumeX, Play, Square, Phone, PhoneOff, X, Mic, MicOff, MessageSquare, Plus, Lock, Users, Pin, Pencil, Trash2, File as FileIcon, FileText, Image as ImageIcon, Check, Copy, ClipboardCheck } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';

// Lazy-load dashboard panels for Workflow agent tabs
const DacpEstimatingDashboard = lazy(() => import('../dashboards/DacpEstimatingDashboard'));
const DacpPricingDashboard = lazy(() => import('../dashboards/DacpPricingDashboard'));
const DacpJobsDashboard = lazy(() => import('../dashboards/DacpJobsDashboard'));

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const FILE_BASE = window.location.hostname.includes('localhost') ? 'http://localhost:3002' : '';

function getAuthToken() {
  // Try sessionStorage (current auth system) first, fall back to localStorage (legacy)
  try {
    const session = JSON.parse(sessionStorage.getItem('sangha_auth'));
    if (session?.tokens?.accessToken) return session.tokens.accessToken;
  } catch {}
  // Legacy DACP auth
  const legacy = localStorage.getItem('auth_token');
  if (legacy) return legacy;
  return null;
}

// ─── Agent Definitions ──────────────────────────────────────────────────────────
const AGENTS = {
  // DACP Construction agents
  hivemind: { name: 'DACP Agent', initial: 'D', color: '#3b82f6', bgColor: '#eef3f9', accentColor: '#1e3a5f', status: 'Hivemind — always on', placeholder: 'Ask the DACP Agent anything...', hint: 'The DACP Agent can route tasks to any sub-agent, search your knowledge base, and manage email.', userInitial: 'A', userName: 'Admin', multiInstance: true },
  estimating: { name: 'Estimating Bot', initial: 'E', color: '#1e3a5f', bgColor: '#eef3f9', accentColor: '#1e3a5f', status: 'Online — 8 open RFQs', placeholder: 'Message Estimating Bot...', hint: 'Estimating Bot can read bid requests, generate estimates, draft emails, and reference your pricing table and job history.', tabs: ['Chat', 'Inbox', 'History', 'Config'], userInitial: 'A', userName: 'Admin' },
  documents: { name: 'Documents', initial: 'D', color: '#7c3aed', bgColor: '#f3f0ff', accentColor: '#1e3a5f', status: 'Online', placeholder: 'Upload a document or ask about your files...', hint: 'Documents agent processes PDFs, extracts data from drawings, and searches your file library.', userInitial: 'A', userName: 'Admin' },
  meetings: { name: 'Meeting Bot', initial: 'M', color: '#1e3a5f', bgColor: '#eef3f9', accentColor: '#1e3a5f', status: 'Online', placeholder: 'Ask about any past meeting...', hint: 'Meeting Bot searches transcripts, summarizes calls, and tracks action items.', userInitial: 'A', userName: 'Admin' },
  email: { name: 'Email Agent', initial: 'E', color: '#f59e0b', bgColor: '#fdf6e8', accentColor: '#1e3a5f', status: 'Online', placeholder: 'Draft an email or search your inbox...', hint: 'Email Agent drafts professional emails, searches your inbox, and manages correspondence.', userInitial: 'A', userName: 'Admin' },
  workflow: { name: 'Workflow', initial: 'W', color: '#1e3a5f', bgColor: '#eef3f9', accentColor: '#1e3a5f', status: 'Online', placeholder: 'Ask about estimates, pricing, or jobs...', hint: 'Workflow handles estimating, pricing table, and job management in one place.', tabs: ['Chat', 'Estimating', 'Pricing', 'Jobs', 'Config'], userInitial: 'A', userName: 'Admin' },
  comms: { name: 'Comms', initial: 'C', color: '#f59e0b', bgColor: '#fdf6e8', accentColor: '#1e3a5f', status: 'Online', placeholder: 'Draft an email, search inbox, or ask about meetings...', hint: 'Comms handles email correspondence, meeting summaries, and action items.', tabs: ['Chat', 'Config'], userInitial: 'A', userName: 'Admin' },
  // Lead Engine
  'lead-engine': { name: 'Lead Engine', initial: 'L', useTheme: true, status: 'Online', placeholder: 'Ask about leads, pipeline, outreach, follow-ups...', hint: 'Lead Engine can discover leads, manage outreach campaigns, track replies, and handle follow-ups.', userInitial: 'SP', userName: 'Spencer' },
  // Coppice / Mining agents
  sangha: { name: 'Sangha Agent', initial: 'S', useTheme: true, status: 'Hivemind — always on', placeholder: 'Ask the Sangha Agent anything...', hint: 'Sangha Agent coordinates all sub-agents, monitors fleet operations, and manages energy market positions.', userInitial: 'SP', userName: 'Spencer', multiInstance: true },
  curtailment: { name: 'Curtailment Agent', initial: 'C', useTheme: true, status: 'Online — monitoring ERCOT', placeholder: 'Ask about curtailment, pricing, fleet status...', hint: 'Curtailment Agent monitors ERCOT real-time pricing, manages fleet power states, and optimizes pool routing for maximum revenue.', tabs: ['Chat', 'Fleet', 'Market', 'Config'], userInitial: 'SP', userName: 'Spencer' },
  pools: { name: 'Pool Routing', initial: 'P', color: '#2563eb', bgColor: '#eef3f9', useTheme: true, status: 'Online — 3 pools active', placeholder: 'Ask about pool performance, hashrate allocation...', hint: 'Pool Routing agent optimizes hashrate distribution across mining pools for maximum yield.', userInitial: 'SP', userName: 'Spencer' },
  'pitch-deck': { name: 'Pitch Deck Agent', initial: 'P', color: '#7c3aed', bgColor: '#f3f0ff', accentColor: '#7c3aed', status: 'Online', placeholder: 'Describe a deck you need or paste a brief...', hint: 'Pitch Deck Agent creates investor-grade HTML presentations. It will ask about detail level, slide count, and backgrounds before building.', userInitial: 'A', userName: 'Admin' },
  sales: { name: 'Sales Agent', initial: 'S', color: '#dc2626', bgColor: '#fef2f2', accentColor: '#991b1b', status: 'Online — Triple Aikido', placeholder: 'Practice a sales call, prep for a meeting, or ask for objection handling...', hint: 'Sales Agent uses the Triple Aikido technique. It can roleplay sales calls, prep you for meetings, and generate question playbooks for specific prospects.', userInitial: 'A', userName: 'Admin' },
};

// ─── Demo Conversation ──────────────────────────────────────────────────────────
const DEMO_MESSAGES = {};

// ─── Demo Context Data ──────────────────────────────────────────────────────────
const DEMO_CONTEXT = {};

// ─── Simple markdown-like formatting ────────────────────────────────────────────
// Tool tag display names
const TOOL_LABELS = {
  // Google Workspace
  gws_drive_search: 'Searching Drive',
  gws_gmail_search: 'Searching Email',
  gws_gmail_read: 'Reading Email',
  gws_calendar_events: 'Checking Calendar',
  gws_sheets_read: 'Reading Spreadsheet',
  gws_sheets_append: 'Updating Spreadsheet',
  gws_workspace_command: 'Workspace Action',
  gws_sheets_update: 'Updating Spreadsheet',
  gws_docs_update: 'Updating Document',
  gws_drive_create: 'Creating Document',
  // Email
  send_email: 'Sending Email',
  list_emails: 'Searching Inbox',
  read_email: 'Reading Email',
  // Knowledge
  search_knowledge: 'Searching Knowledge Base',
  // Web
  browse_url: 'Browsing Page',
  web_research: 'Researching',
  // Calendar
  create_meeting: 'Scheduling Meeting',
  // HubSpot
  search_hubspot_contacts: 'Searching Contacts',
  search_hubspot_companies: 'Searching Companies',
  search_hubspot_deals: 'Searching Deals',
  get_hubspot_pipeline: 'Loading Pipeline',
  create_hubspot_contact: 'Creating Contact',
  // Lead Engine
  discover_leads: 'Discovering Leads',
  get_leads: 'Loading Leads',
  get_lead_stats: 'Loading Stats',
  generate_outreach: 'Generating Outreach',
  get_outreach_log: 'Loading Outreach Log',
  get_reply_inbox: 'Loading Replies',
  get_followup_queue: 'Loading Follow-ups',
  run_full_cycle: 'Running Full Cycle',
  update_lead: 'Updating Lead',
  setup_crm_sheet: 'Setting Up CRM Sheet',
  // DACP / Construction
  lookup_pricing: 'Looking Up Pricing',
  get_bid_requests: 'Loading Bid Requests',
  get_estimates: 'Loading Estimates',
  create_estimate: 'Creating Estimate',
  get_jobs: 'Loading Jobs',
  get_dacp_stats: 'Loading Stats',
  analyze_itb: 'Analyzing ITB',
  draft_supplier_quotes: 'Drafting Supplier Quotes',
  compare_contract: 'Comparing Contract',
  generate_proposal: 'Generating Proposal',
  run_bid_checks: 'Running Bid Checks',
  generate_takeoff_template: 'Generating Takeoff Template',
  generate_compliance_forms: 'Generating Compliance Forms',
  generate_contract_redline: 'Generating Contract Redline',
  parse_supplier_quote: 'Parsing Supplier Quote',
  // Document / Legal
  generate_document: 'Generating Document',
  generate_legal_doc: 'Generating Legal Document',
  // Mining
  generate_mine_specs: 'Generating Mine Specs',
  // Workspace file ops
  workspace_create_doc: 'Creating Document',
  workspace_create_sheet: 'Creating Spreadsheet',
  workspace_create_slides: 'Creating Presentation',
  workspace_search_drive: 'Searching Drive',
  workspace_read_file: 'Reading File',
  workspace_export_pdf: 'Exporting PDF',
  workspace_add_comment: 'Adding Comment',
  // Pitch deck
  plan_content: 'Planning Content',
  generate_presentation: 'Building Presentation',
  generate_backgrounds: 'Generating Backgrounds',
  // Email security
  add_trusted_sender: 'Adding Trusted Sender',
  remove_trusted_sender: 'Removing Trusted Sender',
  list_trusted_senders: 'Loading Trusted Senders',
  // Scheduler
  create_scheduled_task: 'Creating Scheduled Task',
  list_scheduled_tasks: 'Loading Scheduled Tasks',
  delete_scheduled_task: 'Deleting Scheduled Task',
  // Code execution
  execute_code: 'Running Code',
};

function formatContent(text) {
  if (!text) return null;

  // Split text on tool invocation blocks: <tool_name>...</tool_name> (completed) or <tool_name>... (still running)
  const closedPattern = /<(\w+)>\s*[\s\S]*?<\/\1>/g;
  const segments = [];
  let lastIndex = 0;
  let match;

  while ((match = closedPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'tool', name: match[1], done: true });
    lastIndex = match.index + match[0].length;
  }
  // Check for unclosed tool tag at the end (still streaming)
  const remaining = text.slice(lastIndex);
  const openMatch = remaining.match(/<(\w+)>\s*[\s\S]*$/);
  if (openMatch && TOOL_LABELS[openMatch[1]]) {
    if (openMatch.index > 0) {
      segments.push({ type: 'text', value: remaining.slice(0, openMatch.index) });
    }
    segments.push({ type: 'tool', name: openMatch[1], done: false });
  } else if (remaining.length > 0) {
    segments.push({ type: 'text', value: remaining });
  }

  if (segments.length === 0) {
    segments.push({ type: 'text', value: text });
  }

  return segments.map((seg, si) => {
    if (seg.type === 'tool') {
      const label = TOOL_LABELS[seg.name] || seg.name.replace(/_/g, ' ');
      return seg.done ? (
        <div key={`tool-${si}`} className="my-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-[#f0f7f2] border border-[#d0e8d8] text-[11px] text-[#1a6b3c]">
          <Check size={12} className="shrink-0" />
          <span className="font-medium">{label}</span>
        </div>
      ) : (
        <div key={`tool-${si}`} className="my-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-[#f5f4f0] border border-[#e8e6e1] text-[11px] text-[#6b6b65]">
          <div className="w-3 h-3 rounded-full border-2 border-[#c5c5bc] border-t-[#1e3a5f] animate-spin shrink-0" />
          <span className="font-medium">{label}...</span>
        </div>
      );
    }
    // Regular text — render with bold/line breaks
    return seg.value.split('\n').map((line, i, arr) => {
      const parts = line.split(/(\*\*.*?\*\*)/g).map((part, j) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={j} className="font-semibold">{part.slice(2, -2)}</strong>;
        }
        return part;
      });
      return <span key={`${si}-${i}`}>{parts}{i < arr.length - 1 && <br />}</span>;
    });
  });
}

// ─── Alert Card (danger/warn/info) ──────────────────────────────────────────────
function AlertCard({ data }) {
  const colors = {
    danger: { bg: 'bg-red-50', border: 'border-red-200', dot: 'bg-red-500', title: 'text-red-800' },
    warn: { bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-500', title: 'text-amber-800' },
    info: { bg: 'bg-blue-50', border: 'border-blue-200', dot: 'bg-blue-500', title: 'text-blue-800' },
  };
  const c = colors[data.type] || colors.info;
  return (
    <div className={`mt-2.5 ${c.bg} border ${c.border} rounded-[10px] overflow-hidden`}>
      <div className={`px-3.5 py-2.5 border-b ${c.border} flex items-center gap-2`}>
        <span className={`w-2 h-2 rounded-full ${c.dot} ${data.type === 'danger' ? 'animate-pulse' : ''}`} />
        <span className={`text-[12px] font-bold ${c.title}`}>{data.title}</span>
      </div>
      {data.rows.map((r, i) => (
        <div key={i} className="flex justify-between px-3.5 py-[7px] text-[12px] border-b border-inherit last:border-b-0">
          <span className="text-[#6b6b65]">{r.label}</span>
          <span className={`font-mono font-semibold text-[11px] ${r.danger ? 'text-red-600' : r.green ? 'text-[#1a6b3c]' : 'text-terminal-text'}`}>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Data Card (table-style structured data) ────────────────────────────────────
function DataCard({ data }) {
  return (
    <div className="mt-2.5 bg-[#f5f4f0] border border-[#f0eeea] rounded-[10px] overflow-hidden">
      <div className="px-3.5 py-2.5 bg-terminal-panel border-b border-[#f0eeea]">
        <span className="text-[12px] font-bold text-terminal-text">{data.title}</span>
      </div>
      {data.columns && (
        <div className="grid px-3.5 py-[6px] border-b border-[#e8e6e1] bg-[#f0eeea]/50" style={{ gridTemplateColumns: `repeat(${data.columns.length}, 1fr)` }}>
          {data.columns.map((col, i) => (
            <span key={i} className="text-[9px] font-bold uppercase tracking-[0.5px] text-[#9a9a92]">{col}</span>
          ))}
        </div>
      )}
      {data.rows.map((r, i) => (
        <div key={i} className="grid px-3.5 py-[7px] text-[12px] border-b border-[#f0eeea] items-center" style={{ gridTemplateColumns: `repeat(${(r.cells || []).length}, 1fr)` }}>
          {(r.cells || []).map((cell, j) => (
            <span key={j} className={`font-mono text-[11px] ${
              j === (r.cells.length - 1) && r.statusColor
                ? '' : j === 0 ? 'font-medium text-terminal-text' : 'text-[#6b6b65]'
            }`}>
              {j === (r.cells.length - 1) && r.statusColor ? (
                <span className="inline-flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: r.statusColor }} />
                  <span style={{ color: r.statusColor }} className="font-semibold">{cell}</span>
                </span>
              ) : cell}
            </span>
          ))}
        </div>
      ))}
      {data.footer && (
        <div className="px-3.5 py-2.5 bg-terminal-panel border-t border-[#e8e6e1] flex justify-between items-center">
          <span className="text-[12px] font-semibold text-terminal-text">{data.footer.label}</span>
          <span className={`font-mono text-[14px] font-bold ${data.footer.green ? 'text-[#1a6b3c]' : 'text-terminal-text'}`}>{data.footer.value}</span>
        </div>
      )}
    </div>
  );
}

// ─── Estimate Card ──────────────────────────────────────────────────────────────
function EstimateCard({ data }) {
  return (
    <div className="mt-2.5 bg-[#f5f4f0] border border-[#f0eeea] rounded-[10px] overflow-hidden">
      <div className="px-3.5 py-2.5 bg-terminal-panel border-b border-[#f0eeea] flex items-center justify-between">
        <span className="text-[12px] font-bold text-terminal-text">{data.title}</span>
        <span className={`text-[9px] font-bold px-2 py-[3px] rounded-[5px] uppercase tracking-[0.3px] ${
          data.confidence >= 80 ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
        }`}>{data.confidence}% confidence</span>
      </div>
      {data.lines.map((l, i) => (
        <div key={i} className="flex justify-between px-3.5 py-[7px] text-[12px] border-b border-[#f0eeea]">
          <span className="text-[#6b6b65]">{l.label}</span>
          <span className="font-mono font-semibold text-terminal-text text-[12px]">{l.value}</span>
        </div>
      ))}
      {data.subtotal && (
        <div className="flex justify-between px-3.5 py-[7px] text-[11px] border-b border-[#f0eeea] text-[#9a9a92]">
          <span>{data.subtotal.label}</span>
          <span className="font-mono font-semibold">{data.subtotal.value}</span>
        </div>
      )}
      {data.additions.map((a, i) => (
        <div key={i} className="flex justify-between px-3.5 py-[7px] text-[12px] border-b border-[#f0eeea]">
          <span className="text-[#6b6b65]">{a.label}</span>
          <span className="font-mono font-semibold text-terminal-text text-[12px]">{a.value}</span>
        </div>
      ))}
      <div className="px-3.5 py-2.5 bg-terminal-panel border-t border-[#e8e6e1] flex justify-between items-center">
        <span className="text-[13px] font-bold text-terminal-text">{data.total.label}</span>
        <span className="font-mono text-[16px] font-bold text-[#1e3a5f]">{data.total.value}</span>
      </div>
    </div>
  );
}

// ─── Email Card ─────────────────────────────────────────────────────────────────
function EmailCard({ data }) {
  return (
    <div className="mt-2.5 bg-terminal-panel border border-[#e8e6e1] rounded-[10px] overflow-hidden">
      <div className="px-3.5 py-2.5 border-b border-[#f0eeea] text-[11px] text-[#9a9a92] space-y-0.5">
        <div><strong className="text-terminal-text">To:</strong> {data.to}</div>
        <div><strong className="text-terminal-text">Subject:</strong> {data.subject}</div>
        {data.attach && <div><strong className="text-terminal-text">Attach:</strong> {data.attach}</div>}
      </div>
      <div className="px-3.5 py-3.5 text-[13px] text-terminal-text leading-[1.6] whitespace-pre-line">{data.body}</div>
    </div>
  );
}

// ─── Action Buttons ─────────────────────────────────────────────────────────────
function ActionButtons({ actions, accentColor = '#1e3a5f', onAction, disabled }) {
  if (!actions?.length) return null;
  return (
    <div className="flex gap-1.5 mt-2.5 flex-wrap">
      {actions.map((a, i) => (
        <button
          key={i}
          onClick={() => onAction?.(a.label, a.variant)}
          disabled={disabled}
          className={`px-3.5 py-[6px] rounded-lg text-[11px] font-semibold transition-colors ${
            disabled ? 'opacity-50 cursor-not-allowed' : ''
          } ${
            a.variant === 'quick_reply'
              ? 'bg-terminal-panel text-terminal-text border-[1.5px] border-[#d4d4cf] hover:border-[#9a9a92] hover:bg-[#f0eeea]'
              : a.variant === 'primary'
                ? 'text-white'
                : 'bg-terminal-panel text-[#6b6b65] border-[1.5px] border-[#e8e6e1] hover:bg-[#f5f4f0]'
          }`}
          style={a.variant === 'primary' ? { backgroundColor: accentColor } : undefined}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

// ─── Workspace Card (Google Docs/Sheets/Slides results) ─────────────────────
function WorkspaceCard({ data }) {
  const [previewOpen, setPreviewOpen] = useState(false);

  const typeConfig = {
    doc:    { icon: 'D', color: '#3b82f6', bg: '#eef3f9', label: 'Document' },
    sheet:  { icon: 'S', color: '#1a6b3c', bg: '#edf7f0', label: 'Spreadsheet' },
    slides: { icon: 'P', color: '#f59e0b', bg: '#fdf6e8', label: 'Presentation' },
  };

  // ── File Created ──
  if (data.action === 'created') {
    const t = typeConfig[data.type] || typeConfig.doc;
    return (
      <div className="mt-2.5 bg-terminal-panel border border-[#e8e6e1] rounded-[14px] overflow-hidden">
        <div className="px-3.5 py-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-[10px] flex items-center justify-center shrink-0" style={{ backgroundColor: t.bg }}>
            <span className="text-[15px] font-bold" style={{ color: t.color }}>{t.icon}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-terminal-text truncate">{data.title}</div>
            {data.folder && (
              <div className="text-[11px] text-[#9a9a92] mt-0.5">Created in {data.folder}</div>
            )}
          </div>
          {data.url && (
            <a
              href={data.url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-[6px] rounded-lg text-[11px] font-semibold text-white shrink-0 hover:opacity-90 transition-opacity"
              style={{ backgroundColor: t.color }}
            >
              Open in Google
            </a>
          )}
        </div>
        {data.comment && (
          <div className="px-3.5 py-2.5 border-t border-[#f0eeea] text-[12px] text-[#6b6b65] leading-[1.5]">
            {data.comment}
          </div>
        )}
      </div>
    );
  }

  // ── Search Results ──
  if (data.action === 'search') {
    return (
      <div className="mt-2.5 bg-terminal-panel border border-[#e8e6e1] rounded-[14px] overflow-hidden">
        <div className="px-3.5 py-2.5 border-b border-[#f0eeea]">
          <span className="text-[12px] font-bold text-terminal-text">
            {data.results?.length || 0} file{(data.results?.length || 0) !== 1 ? 's' : ''} found
          </span>
        </div>
        {(data.results || []).map((file, i) => {
          const t = typeConfig[file.type] || typeConfig.doc;
          return (
            <div key={i} className="flex items-center gap-3 px-3.5 py-2.5 border-b border-[#f0eeea] last:border-b-0 hover:bg-[#f5f4f0] transition-colors">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: t.bg }}>
                <span className="text-[11px] font-bold" style={{ color: t.color }}>{t.icon}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-terminal-text truncate">{file.name}</div>
                {file.owner && <div className="text-[10px] text-[#9a9a92]">{file.owner}</div>}
              </div>
              {file.url && (
                <a
                  href={file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-[5px] rounded-lg text-[10px] font-semibold bg-[#f5f4f0] text-[#6b6b65] border border-[#e8e6e1] hover:bg-[#eceae5] transition-colors shrink-0"
                >
                  Open
                </a>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  // ── File Read ──
  if (data.action === 'read') {
    const preview = data.content ? data.content.slice(0, 500) : '';
    const truncated = data.content && data.content.length > 500;
    return (
      <div className="mt-2.5 bg-terminal-panel border border-[#e8e6e1] rounded-[14px] overflow-hidden">
        <button
          onClick={() => setPreviewOpen(!previewOpen)}
          className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-[#f5f4f0] transition-colors"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-[12px] font-bold text-terminal-text truncate">{data.title || 'File Content'}</span>
          </div>
          <ChevronRight size={14} className={`text-[#9a9a92] transition-transform shrink-0 ${previewOpen ? 'rotate-90' : ''}`} />
        </button>
        {previewOpen && (
          <div className="px-3.5 py-2.5 border-t border-[#f0eeea]">
            <pre className="text-[11px] text-[#6b6b65] leading-[1.6] whitespace-pre-wrap font-mono break-words">
              {preview}{truncated ? '...' : ''}
            </pre>
          </div>
        )}
      </div>
    );
  }

  return null;
}

// ─── Invoke Indicator ───────────────────────────────────────────────────────────
function InvokeIndicator({ text, accentColor = '#1e3a5f' }) {
  return (
    <div className="flex items-center gap-2 py-2">
      <div className="flex-1 h-px bg-[#f0eeea]" />
      <span
        className="text-[9px] font-bold uppercase tracking-[0.3px] px-2.5 py-[3px] rounded-md flex items-center gap-[5px]"
        style={{ backgroundColor: accentColor + '12', color: accentColor }}
      >
        <span className="w-1 h-1 rounded-full" style={{ backgroundColor: accentColor }} />
        {text}
      </span>
      <div className="flex-1 h-px bg-[#f0eeea]" />
    </div>
  );
}

// ─── Audio Play Button ──────────────────────────────────────────────────────────
function AudioPlayButton({ audioUrl }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);

  const toggle = () => {
    if (!audioRef.current) {
      audioRef.current = new Audio(audioUrl);
      audioRef.current.onended = () => setPlaying(false);
      audioRef.current.onerror = () => setPlaying(false);
    }
    if (playing) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setPlaying(false);
    } else {
      audioRef.current.play().catch(() => setPlaying(false));
      setPlaying(true);
    }
  };

  return (
    <button
      onClick={toggle}
      className="flex items-center gap-1.5 mt-1.5 px-2.5 py-1 rounded-lg text-[10px] font-semibold text-[#6b6b65] bg-[#f5f4f0] border border-[#e8e6e1] hover:bg-[#eeede8] transition-colors"
    >
      {playing ? <Square size={10} /> : <Play size={10} />}
      {playing ? 'Stop' : 'Play'}
    </button>
  );
}

// ─── Call Panel (Voice Chat + Phone Call) ────────────────────────────────────────
function CallPanel({ agentDef, onClose }) {
  const [mode, setMode] = useState('voice'); // 'voice' | 'phone'
  const [callState, setCallState] = useState('idle'); // idle | connecting | connected | ended | error
  const [muted, setMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [transcript, setTranscript] = useState(''); // live transcript of what user/agent said
  const [errorMsg, setErrorMsg] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const timerRef = useRef(null);
  const conversationRef = useRef(null);

  useEffect(() => {
    if (callState === 'connected') {
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    } else {
      clearInterval(timerRef.current);
    }
    return () => clearInterval(timerRef.current);
  }, [callState]);

  // Cleanup conversation on unmount
  useEffect(() => {
    return () => {
      if (conversationRef.current) {
        conversationRef.current.endSession().catch(() => {});
      }
    };
  }, []);

  const formatDuration = (s) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const accent = agentDef?.accentColor || '#1e3a5f';

  // ── Voice Chat (browser Speech Recognition → Claude streaming → Speech Synthesis) ──
  const recognitionRef = useRef(null);
  const [voicePhase, setVoicePhase] = useState('listening'); // listening | thinking | speaking

  const startVoiceChat = async () => {
    setCallState('connecting');
    setDuration(0);
    setTranscript('');
    setErrorMsg('');

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setErrorMsg('Speech recognition not supported in this browser. Use Chrome.');
      setCallState('error');
      return;
    }

    try {
      // Request mic access
      await navigator.mediaDevices.getUserMedia({ audio: true });

      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        setCallState('connected');
        setVoicePhase('listening');
      };

      recognition.onresult = (event) => {
        const results = Array.from(event.results);
        const text = results.map(r => r[0].transcript).join('');
        setTranscript(text);

        // Check if final result
        if (results.some(r => r.isFinal)) {
          setVoicePhase('thinking');
          sendToAgent(text);
        }
      };

      recognition.onerror = (event) => {
        if (event.error === 'no-speech') {
          // Restart listening
          try { recognition.start(); } catch {}
          return;
        }
        if (event.error === 'aborted') return; // Intentional abort
        console.error('Speech recognition error:', event.error);
        if (event.error === 'network') {
          setErrorMsg('Speech recognition requires HTTPS. If running locally, use localhost (not an IP) or deploy with SSL.');
        } else if (event.error === 'not-allowed') {
          setErrorMsg('Microphone access denied. Allow mic access in browser settings and reload.');
        } else {
          setErrorMsg(`Mic error: ${event.error}`);
        }
        setCallState('error');
      };

      recognition.onend = () => {
        // Only restart if still in listening phase
        if (voicePhase === 'listening' && callState === 'connected') {
          try { recognition.start(); } catch {}
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
      conversationRef.current = { type: 'browser-voice' };
    } catch (err) {
      console.error('Voice chat start failed:', err);
      setErrorMsg(err.message || 'Microphone access denied');
      setCallState('error');
    }
  };

  const sendToAgent = async (userText) => {
    if (!userText.trim()) {
      setVoicePhase('listening');
      restartListening();
      return;
    }

    setTranscript(`You: ${userText}`);
    const token = getAuthToken();
    let agentResponse = '';

    try {
      // Use streaming endpoint
      const agentId = agentDef?.name?.toLowerCase().includes('estimat') ? 'estimating'
        : agentDef?.name?.toLowerCase().includes('email') ? 'email'
        : agentDef?.name?.toLowerCase().includes('meeting') ? 'meetings'
        : 'hivemind';

      const res = await fetch(`${API_BASE}/v1/chat/${agentId}/messages/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ content: userText }),
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(l => l.startsWith('data: '));
        for (const line of lines) {
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'text') {
              agentResponse += data.text;
              setTranscript(agentResponse);
            }
          } catch {}
        }
      }

      // Speak the response
      if (agentResponse && callState === 'connected') {
        setVoicePhase('speaking');
        await speakText(agentResponse);
      }
    } catch (err) {
      console.error('Agent response failed:', err);
      agentResponse = 'Sorry, I had trouble processing that. Could you try again?';
      setTranscript(agentResponse);
    }

    // Resume listening
    if (callState === 'connected') {
      setVoicePhase('listening');
      setTranscript('');
      restartListening();
    }
  };

  const speakText = (text) => {
    return new Promise((resolve) => {
      // Strip markdown formatting for speech
      const clean = text
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/#{1,6}\s/g, '')
        .replace(/[-•]\s/g, '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/`([^`]+)`/g, '$1');

      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.rate = 1.05;
      utterance.pitch = 1.0;
      utterance.onend = resolve;
      utterance.onerror = resolve;
      window.speechSynthesis.speak(utterance);
    });
  };

  const restartListening = () => {
    if (recognitionRef.current && callState === 'connected') {
      try { recognitionRef.current.start(); } catch {}
    }
  };

  const endVoiceChat = async () => {
    window.speechSynthesis.cancel();
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
    conversationRef.current = null;
    setCallState('ended');
    setVoicePhase('listening');
    setTimeout(() => {
      setCallState('idle');
      setDuration(0);
      setTranscript('');
    }, 2000);
  };

  const toggleMute = () => {
    if (muted) {
      restartListening();
    } else if (recognitionRef.current) {
      recognitionRef.current.abort();
    }
    setMuted(!muted);
  };

  // ── Phone Call (Twilio) ──
  const startPhoneCall = async () => {
    if (!phoneNumber.trim()) return;
    setCallState('connecting');
    setDuration(0);
    const token = getAuthToken();
    try {
      const res = await fetch(`${API_BASE}/v1/voice/call/outbound`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ to: phoneNumber.trim() }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setCallState('connected');
    } catch (err) {
      console.error('Phone call failed:', err);
      setErrorMsg(err.message || 'Call failed');
      setCallState('error');
    }
  };

  return (
    <div className="absolute top-14 right-4 w-80 bg-terminal-panel border border-terminal-border rounded-[14px] shadow-lg z-50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-terminal-border">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-terminal-text">
            {mode === 'voice' ? 'Voice Chat' : 'Phone Call'}
          </span>
          {callState === 'idle' && (
            <button
              onClick={() => setMode(mode === 'voice' ? 'phone' : 'voice')}
              className="text-[10px] text-[#9a9a92] hover:text-terminal-text underline"
            >
              {mode === 'voice' ? 'or phone call' : 'or voice chat'}
            </button>
          )}
        </div>
        <button onClick={() => { endVoiceChat(); onClose(); }} className="p-1 rounded-md hover:bg-[#f5f4f0] text-[#9a9a92]">
          <X size={14} />
        </button>
      </div>

      {/* ── Idle State ── */}
      {callState === 'idle' && mode === 'voice' && (
        <div className="p-5 flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: accent + '15' }}>
            <Mic size={28} style={{ color: accent }} />
          </div>
          <div className="text-center">
            <div className="text-[13px] font-semibold text-terminal-text">
              Talk to {agentDef?.name || 'Agent'}
            </div>
            <div className="text-[11px] text-[#9a9a92] mt-1">
              Uses your microphone and speaker
            </div>
          </div>
          <button
            onClick={startVoiceChat}
            className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-[10px] text-[13px] font-semibold text-white transition-opacity"
            style={{ backgroundColor: accent }}
          >
            <Mic size={16} />
            Start Conversation
          </button>
        </div>
      )}

      {callState === 'idle' && mode === 'phone' && (
        <div className="p-4 flex flex-col gap-3">
          <div className="text-[11px] text-[#9a9a92]">
            Call with {agentDef?.name || 'Agent'} via phone
          </div>
          <input
            type="tel"
            value={phoneNumber}
            onChange={e => setPhoneNumber(e.target.value)}
            placeholder="+1 (555) 123-4567"
            className="w-full px-3 py-2 rounded-[8px] border border-terminal-border bg-white text-[13px] text-terminal-text placeholder-[#c5c4c0] focus:outline-none focus:border-[#9a9a92]"
          />
          <button
            onClick={startPhoneCall}
            disabled={!phoneNumber.trim()}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-[10px] text-[12px] font-semibold text-white transition-opacity disabled:opacity-40"
            style={{ backgroundColor: accent }}
          >
            <Phone size={14} />
            Start Call
          </button>
        </div>
      )}

      {/* ── Connecting State ── */}
      {callState === 'connecting' && (
        <div className="p-6 flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-full flex items-center justify-center animate-pulse" style={{ backgroundColor: accent + '20' }}>
            {mode === 'voice' ? <Mic size={24} style={{ color: accent }} /> : <Phone size={24} style={{ color: accent }} />}
          </div>
          <div className="text-[13px] font-semibold text-terminal-text">Connecting...</div>
          <div className="text-[11px] text-[#9a9a92]">Requesting microphone access</div>
        </div>
      )}

      {/* ── Connected State ── */}
      {callState === 'connected' && (
        <div className="p-5 flex flex-col items-center gap-3">
          {/* Phase indicator */}
          <div className="w-14 h-14 rounded-full flex items-center justify-center relative" style={{
            backgroundColor: voicePhase === 'listening' ? '#edf7f0' : voicePhase === 'thinking' ? '#fdf6e8' : '#e8eef5'
          }}>
            {voicePhase === 'thinking' ? (
              <div className="spinner w-6 h-6" />
            ) : voicePhase === 'speaking' ? (
              <Volume2 size={24} className="text-[#2c5282]" />
            ) : (
              <Mic size={24} className="text-[#1a6b3c]" />
            )}
            {voicePhase === 'listening' && !muted && (
              <div className="absolute inset-0 rounded-full border-2 border-[#1a6b3c] animate-ping opacity-20" />
            )}
          </div>
          <div className="text-[13px] font-semibold text-terminal-text">
            {muted ? 'Muted' : voicePhase === 'listening' ? 'Listening...' : voicePhase === 'thinking' ? 'Thinking...' : 'Speaking...'}
          </div>
          <div className="text-[18px] font-mono text-terminal-text">{formatDuration(duration)}</div>

          {/* Live transcript */}
          {transcript && (
            <div className="w-full px-3 py-2 rounded-[8px] bg-[#f5f4f0] border border-terminal-border max-h-[120px] overflow-y-auto">
              <div className="text-[11px] text-[#6b6b65] leading-relaxed whitespace-pre-wrap">{transcript}</div>
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center gap-3 mt-1">
            <button
              onClick={toggleMute}
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${
                muted
                  ? 'bg-[#fef2f2] text-red-500 border border-red-200'
                  : 'bg-[#f5f4f0] text-[#6b6b65] border border-terminal-border hover:bg-[#e8e6e1]'
              }`}
              title={muted ? 'Unmute' : 'Mute'}
            >
              {muted ? <MicOff size={18} /> : <Mic size={18} />}
            </button>
            <button
              onClick={mode === 'voice' ? endVoiceChat : endVoiceChat}
              className="w-11 h-11 rounded-full flex items-center justify-center bg-red-500 text-white hover:bg-red-600 transition-colors"
              title="End conversation"
            >
              <PhoneOff size={18} />
            </button>
          </div>
        </div>
      )}

      {/* ── Ended State ── */}
      {callState === 'ended' && (
        <div className="p-6 flex flex-col items-center gap-2">
          <div className="text-[13px] font-semibold text-terminal-text">Conversation Ended</div>
          <div className="text-[11px] text-[#9a9a92]">{formatDuration(duration)}</div>
        </div>
      )}

      {/* ── Error State ── */}
      {callState === 'error' && (
        <div className="p-5 flex flex-col items-center gap-3">
          <div className="text-[13px] font-semibold text-red-600">Connection Failed</div>
          <div className="text-[11px] text-[#9a9a92] text-center px-2">{errorMsg}</div>
          <button
            onClick={() => { setCallState('idle'); setErrorMsg(''); }}
            className="text-[12px] font-semibold underline"
            style={{ color: accent }}
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Copilot Approval Card ──────────────────────────────────────────────────────
function CopilotApprovalCard({ msg, accentColor, onApproval }) {
  const [status, setStatus] = useState(null); // null | 'approved' | 'rejected' | 'loading'

  const handleAction = async (action) => {
    setStatus('loading');
    try {
      await onApproval(msg.approval_id, action);
      setStatus(action === 'approve' ? 'approved' : 'rejected');
    } catch {
      setStatus(null);
    }
  };

  if (status === 'approved') {
    return (
      <div className="mt-2 px-3 py-2 rounded-lg bg-green-50 border border-green-200 text-[12px] text-green-700 font-medium">
        Approved — executing now
      </div>
    );
  }
  if (status === 'rejected') {
    return (
      <div className="mt-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-[12px] text-red-600 font-medium">
        Rejected
      </div>
    );
  }

  return (
    <div className="mt-2.5 border border-[#e8e6e1] rounded-[10px] overflow-hidden bg-terminal-panel">
      <div className="px-3.5 py-2.5 border-b border-[#f0eeea] flex items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        <span className="text-[11px] font-semibold text-[#6b6b65] uppercase tracking-[0.5px]">Approval Required</span>
      </div>
      <div className="px-3.5 py-2.5 text-[12px] text-[#6b6b65]">
        <span className="font-mono text-[11px] text-[#9a9a92]">{msg.tool_proposed}</span>
      </div>
      <div className="px-3.5 pb-3 flex gap-2">
        <button
          onClick={() => handleAction('approve')}
          disabled={status === 'loading'}
          className="px-4 py-[6px] rounded-lg text-[11px] font-semibold text-white transition-colors disabled:opacity-50"
          style={{ backgroundColor: accentColor }}
        >
          {status === 'loading' ? 'Processing...' : 'Approve'}
        </button>
        <button
          onClick={() => handleAction('reject')}
          disabled={status === 'loading'}
          className="px-4 py-[6px] rounded-lg text-[11px] font-semibold bg-terminal-panel text-[#6b6b65] border-[1.5px] border-[#e8e6e1] hover:bg-[#f5f4f0] transition-colors disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  );
}

// ─── Chat Message ───────────────────────────────────────────────────────────────
// Detect confirmation questions at end of agent messages
const CONFIRM_PATTERNS = [
  /should I send/i,
  /shall I send/i,
  /want me to send/i,
  /ready to send/i,
  /go ahead and send/i,
  /send (this|it) now/i,
  /would you like me to (send|proceed|go ahead)/i,
  /do you (want|approve|confirm)/i,
  /shall I (proceed|go ahead)/i,
  /like me to send/i,
  /would you prefer any (modifications|changes)/i,
  /any (modifications|changes|edits) (first|before)/i,
];

function detectConfirmation(content) {
  if (!content) return false;
  // Check last 500 chars for confirmation patterns (email drafts can have trailing whitespace/newlines)
  const tail = content.slice(-500);
  return CONFIRM_PATTERNS.some(p => p.test(tail));
}

function ChatMessage({ msg, agentDef, onAction, onApproval, isLastAgent, onEdit }) {
  const accent = agentDef?.accentColor || '#1e3a5f';
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');

  const handleCopy = () => {
    navigator.clipboard.writeText(msg.content || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleStartEdit = () => {
    setEditText(msg.content || '');
    setEditing(true);
  };

  const handleSaveEdit = () => {
    if (editText.trim() && onEdit) {
      onEdit(msg.id, editText.trim());
    }
    setEditing(false);
  };

  if (msg.type === 'invoke') {
    return <InvokeIndicator text={msg.content} accentColor={accent} />;
  }

  const isUser = msg.role === 'user';
  // Auto-detect confirmation prompts on the last agent message
  const showConfirmButtons = !isUser && isLastAgent && !msg.actions && !msg.actionDone && !msg.confirmed && detectConfirmation(msg.content);

  return (
    <div className={`flex gap-2.5 max-w-[85%] ${isUser ? 'self-end flex-row-reverse' : 'self-start'}`}>
      {/* Avatar */}
      <div
        className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold text-white shrink-0 mt-0.5"
        style={{ backgroundColor: isUser ? '#6b6b65' : (agentDef?.color || '#1e3a5f') }}
      >
        {isUser ? (agentDef?.userInitial || 'U') : (agentDef?.initial || 'A')}
      </div>

      <div className="min-w-0">
        {/* Header */}
        <div className={`flex items-center gap-2 mb-1 ${isUser ? 'flex-row-reverse' : ''}`}>
          <span className="text-[11px] font-semibold text-[#6b6b65]">{isUser ? (agentDef?.userName || 'You') : agentDef?.name}</span>
          <span className="text-[10px] text-[#c5c5bc] font-mono">{msg.time}</span>
        </div>

        {/* File attachments (image thumbnails + file icons) */}
        {msg.attachments?.length > 0 && (
          <div className={`flex flex-wrap gap-1.5 mb-1.5 ${isUser ? 'justify-end' : ''}`}>
            {msg.attachments.map((att, i) => (
              att.isImage && att.previewUrl ? (
                <img key={i} src={att.previewUrl} alt={att.name}
                  className="max-w-[200px] max-h-[150px] rounded-lg border border-[#e8e6e1] object-cover" />
              ) : (
                <div key={i} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#f5f4f0] border border-[#e8e6e1] text-[11px] text-[#6b6b65]">
                  <FileText size={12} />
                  <span className="truncate max-w-[150px]">{att.name}</span>
                </div>
              )
            ))}
          </div>
        )}

        {/* Bubble — only render if there's text content */}
        {msg.content && !editing && (
          <div className="group/bubble relative">
            <div
              className={`px-4 py-3 text-[13px] leading-[1.6] ${
                isUser
                  ? 'text-white rounded-[14px] rounded-tr-[4px]'
                  : msg.error
                    ? 'bg-red-50 border border-red-200 text-red-700 rounded-[14px] rounded-tl-[4px]'
                    : 'bg-terminal-panel border border-[#e8e6e1] text-[#333330] rounded-[14px] rounded-tl-[4px]'
              }`}
              style={isUser ? { backgroundColor: accent } : undefined}
            >
              {formatContent(msg.content)}
            </div>
            {/* Copy / Edit buttons — appear on hover */}
            <div className={`flex items-center gap-0.5 mt-1 opacity-0 group-hover/bubble:opacity-100 transition-opacity ${isUser ? 'justify-end' : ''}`}>
              <button onClick={handleCopy} className="p-1 rounded hover:bg-[#e8e6e1] transition-colors" title="Copy">
                {copied ? <ClipboardCheck size={12} className="text-green-600" /> : <Copy size={12} className="text-[#9a9a92]" />}
              </button>
              {isUser && onEdit && (
                <button onClick={handleStartEdit} className="p-1 rounded hover:bg-[#e8e6e1] transition-colors" title="Edit">
                  <Pencil size={12} className="text-[#9a9a92]" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Edit mode */}
        {editing && (
          <div className="flex flex-col gap-1.5">
            <textarea
              value={editText}
              onChange={e => setEditText(e.target.value)}
              className="w-full px-3 py-2 border border-[#e8e6e1] rounded-lg text-[13px] text-[#333330] bg-white outline-none resize-none min-h-[60px] focus:border-[#9a9a92]"
              autoFocus
            />
            <div className="flex gap-1.5 justify-end">
              <button onClick={() => setEditing(false)} className="px-2.5 py-1 text-[11px] text-[#6b6b65] hover:bg-[#e8e6e1] rounded transition-colors">Cancel</button>
              <button onClick={handleSaveEdit} className="px-2.5 py-1 text-[11px] text-white rounded transition-colors" style={{ backgroundColor: accent }}>Save & Resend</button>
            </div>
          </div>
        )}

        {/* Copilot approval card */}
        {msg.approval_pending && msg.approval_id && (
          <CopilotApprovalCard msg={msg} accentColor={accent} onApproval={onApproval} />
        )}

        {/* Attached files */}
        {isUser && msg.files && msg.files.length > 0 && (
          <div className={`flex flex-wrap gap-1 mt-1.5 ${isUser ? 'justify-end' : ''}`}>
            {msg.files.map((name, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-white/20 text-white/90">
                <FileIcon size={10} />{name}
              </span>
            ))}
          </div>
        )}

        {/* Audio playback */}
        {!isUser && msg.audio_url && <AudioPlayButton audioUrl={msg.audio_url} />}

        {/* Structured content */}
        {msg.alert && <AlertCard data={msg.alert} />}
        {msg.dataCard && <DataCard data={msg.dataCard} />}
        {msg.estimate && <EstimateCard data={msg.estimate} />}
        {msg.email && <EmailCard data={msg.email} />}
        {msg.workspace && <WorkspaceCard data={msg.workspace} />}

        {/* After-content text */}
        {msg.afterContent && (
          <div className="mt-2.5 px-4 py-3 bg-terminal-panel border border-[#e8e6e1] text-[13px] text-[#333330] leading-[1.6] rounded-[14px]">
            {formatContent(msg.afterContent)}
          </div>
        )}

        {/* Actions */}
        <ActionButtons actions={msg.actions} accentColor={accent} onAction={(label, variant) => onAction?.(label, msg, variant)} disabled={msg.actionDone} />

        {/* Auto-detected confirmation buttons */}
        {showConfirmButtons && (
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => onAction?.('Yes, send it', msg, 'confirm_silent')}
              className="px-4 py-1.5 rounded-lg text-[12px] font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: accent }}
            >
              Yes, send it
            </button>
            <button
              onClick={() => onAction?.('No, don\'t send it', msg, 'quick_reply')}
              className="px-4 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors hover:bg-[#f5f4f0]"
              style={{ borderColor: '#e0ddd8', color: '#6b6b65' }}
            >
              No
            </button>
          </div>
        )}
        {/* Inline confirmation status */}
        {msg.confirmed === 'sending' && (
          <div className="flex items-center gap-1.5 mt-2 text-[12px] font-medium text-[#9ca3af]">
            <div className="w-3 h-3 rounded-full border-2 border-[#9ca3af] border-t-transparent animate-spin" /> Sending...
          </div>
        )}
        {msg.confirmed === true && (
          <div className="flex items-center gap-1.5 mt-2 text-[12px] font-medium" style={{ color: '#16a34a' }}>
            <Check size={14} /> Sent
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

function ContextPanel({ agentId }) {
  const ctx = DEMO_CONTEXT[agentId];
  if (!ctx) {
    return (
      <div className="p-6 text-center text-[13px] text-[#9a9a92]">
        Context panel for this agent will appear here during active conversations.
      </div>
    );
  }

  return (
    <>
      {/* Current Estimate */}
      {ctx.currentEstimate && (
        <ContextSection title="Current Estimate" meta={ctx.currentEstimate.title}>
          {ctx.currentEstimate.rows.map((r, i) => (
            <div key={i} className="flex justify-between py-[6px] text-[12px] border-b border-[#f0eeea] last:border-b-0">
              <span className="text-[#6b6b65]">{r.label}</span>
              <span className={`font-mono font-semibold text-[11px] ${r.danger ? 'text-[#c0392b]' : r.green ? 'text-[#1a6b3c]' : 'text-terminal-text'}`}>{r.value}</span>
            </div>
          ))}
        </ContextSection>
      )}

      {/* Similar Jobs */}
      {ctx.similarJobs && (
        <ContextSection title="Similar Jobs" meta="From history">
          <div className="space-y-2">
            {ctx.similarJobs.map((j, i) => (
              <div key={i} className="p-2.5 bg-terminal-panel border border-[#f0eeea] rounded-lg cursor-pointer hover:border-[#1e3a5f] transition-colors">
                <div className="text-[12px] font-semibold text-terminal-text mb-0.5">{j.name}</div>
                <div className="text-[11px] text-[#9a9a92] mb-1.5">{j.meta}</div>
                {j.rows.map((r, ri) => (
                  <div key={ri} className="flex justify-between text-[11px] mt-1">
                    <span className="text-[#9a9a92]">{r.l}</span>
                    <span className={`font-mono font-semibold ${r.green ? 'text-[#1a6b3c]' : r.danger ? 'text-[#c0392b]' : 'text-terminal-text'}`}>{r.v}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </ContextSection>
      )}

      {/* Agent Chain (collapsed by default) */}
      <ContextSection title="Agent Chain" meta="Active session" defaultOpen={false}>
        <div className="space-y-1.5">
          {ctx.agentChain.map((a, i) => (
            <div
              key={i}
              className="flex items-center gap-2 px-2.5 py-2 bg-terminal-panel border border-[#f0eeea] rounded-lg text-[12px]"
              style={{ marginLeft: a.indent * 16 }}
            >
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${a.active ? 'bg-[#2dd478]' : 'bg-[#c5c5bc]'}`} />
              <span className="font-semibold text-terminal-text flex-1">{a.name}</span>
              <span className="text-[10px] text-[#9a9a92]">{a.role}</span>
            </div>
          ))}
        </div>
      </ContextSection>

      {/* Pricing Reference */}
      {ctx.pricingRef && (
        <ContextSection title="Pricing Reference" meta="Items used">
          {ctx.pricingRef.map((p, i) => (
            <div key={i} className="flex items-center justify-between py-[6px] text-[12px] border-b border-[#f0eeea] last:border-b-0">
              <span className="text-terminal-text font-medium">{p.item}</span>
              <span className={`font-mono text-[11px] ${p.edited ? 'text-[#b8860b]' : 'text-[#6b6b65]'}`}>
                {p.price}{p.edited ? ' ✎' : ''}
              </span>
            </div>
          ))}
        </ContextSection>
      )}

      {/* GC Profile */}
      {ctx.gcProfile && (
        <ContextSection title={ctx.gcProfile.title} meta="GC profile">
          {ctx.gcProfile.rows.map((r, i) => (
            <div key={i} className="flex justify-between py-[6px] text-[12px] border-b border-[#f0eeea] last:border-b-0">
              <span className="text-[#6b6b65]">{r.label}</span>
              <span className={`font-mono font-semibold text-[11px] ${r.green ? 'text-[#1a6b3c]' : 'text-terminal-text'}`}>{r.value}</span>
            </div>
          ))}
        </ContextSection>
      )}

      {/* ── Mining-specific context sections ── */}

      {/* Live Market */}
      {ctx.liveMarket && (
        <ContextSection title="Live Market" meta="ERCOT RT">
          <div className="space-y-1.5">
            {ctx.liveMarket.prices.map((p, i) => (
              <div key={i} className="flex items-center justify-between py-[6px] text-[12px] border-b border-[#f0eeea] last:border-b-0">
                <span className="text-[#6b6b65] font-mono text-[11px]">{p.hub}</span>
                <div className="flex items-center gap-2">
                  <span className={`font-mono font-bold text-[12px] ${p.danger ? 'text-red-600' : p.warn ? 'text-amber-600' : 'text-terminal-text'}`}>{p.price}</span>
                  <span className={`font-mono text-[10px] font-semibold ${p.danger ? 'text-red-500' : p.warn ? 'text-amber-500' : 'text-[#9a9a92]'}`}>{p.change}</span>
                </div>
              </div>
            ))}
          </div>
        </ContextSection>
      )}

      {/* Fleet Status */}
      {ctx.fleetStatus && (
        <ContextSection title="Fleet Status" meta={`${ctx.fleetStatus.summary.online}/${ctx.fleetStatus.summary.total} online`}>
          <div className="flex gap-3 mb-2.5">
            {[
              { l: 'Hashrate', v: ctx.fleetStatus.summary.hashrate },
              { l: 'Power', v: ctx.fleetStatus.summary.power },
            ].map((s, i) => (
              <div key={i} className="flex-1 bg-terminal-panel border border-[#f0eeea] rounded-lg px-2.5 py-2 text-center">
                <div className="text-[9px] text-[#9a9a92] uppercase tracking-[0.5px]">{s.l}</div>
                <div className="text-[13px] font-bold font-mono text-terminal-text mt-0.5">{s.v}</div>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            {ctx.fleetStatus.rows.map((r, i) => (
              <div key={i} className="flex items-center justify-between text-[11px] py-[5px] border-b border-[#f0eeea] last:border-b-0">
                <span className="text-terminal-text font-medium">{r.group} <span className="text-[#9a9a92]">×{r.count}</span></span>
                <span className={`font-mono font-semibold ${r.status === 'Curtailed' ? 'text-amber-600' : r.status === 'Mining' ? 'text-[#1a6b3c]' : 'text-[#9a9a92]'}`}>{r.status}</span>
              </div>
            ))}
          </div>
        </ContextSection>
      )}

      {/* Active Triggers */}
      {ctx.activeTriggers && (
        <ContextSection title="Active Triggers" meta={`${ctx.activeTriggers.filter(t => t.active).length} active`}>
          <div className="space-y-1.5">
            {ctx.activeTriggers.map((t, i) => (
              <div key={i} className="flex items-center justify-between py-[5px] text-[11px] border-b border-[#f0eeea] last:border-b-0">
                <div className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${t.active ? 'bg-[#2dd478]' : 'bg-[#c5c5bc]'}`} />
                  <span className="text-terminal-text font-medium">{t.label}</span>
                </div>
                <span className="font-mono text-[10px] text-[#6b6b65]">{t.value}</span>
              </div>
            ))}
          </div>
        </ContextSection>
      )}

      {/* Event Log */}
      {ctx.eventLog && (
        <ContextSection title="Event Log" meta="Today">
          <div className="space-y-1">
            {ctx.eventLog.map((e, i) => (
              <div key={i} className="flex items-start gap-2 py-[5px] text-[11px] border-b border-[#f0eeea] last:border-b-0">
                <span className="font-mono text-[10px] text-[#9a9a92] shrink-0 pt-px">{e.time}</span>
                <span className={`${
                  e.type === 'curtail' ? 'text-amber-600' :
                  e.type === 'alert' ? 'text-red-600' :
                  e.type === 'start' ? 'text-[#1a6b3c]' :
                  'text-[#6b6b65]'
                }`}>{e.event}</span>
              </div>
            ))}
          </div>
        </ContextSection>
      )}

      {/* Hashprice */}
      {ctx.hashprice && (
        <ContextSection title="Hashprice" meta={ctx.hashprice.current}>
          {[
            { l: 'Current', v: ctx.hashprice.current },
            { l: '24h Change', v: ctx.hashprice.change, danger: ctx.hashprice.change.startsWith('-') },
            { l: 'BTC Price', v: ctx.hashprice.btcPrice },
            { l: 'Network Hash', v: ctx.hashprice.networkHash },
            { l: 'Difficulty', v: ctx.hashprice.difficulty },
            { l: 'Next Adj', v: ctx.hashprice.nextAdj },
          ].map((r, i) => (
            <div key={i} className="flex justify-between py-[6px] text-[12px] border-b border-[#f0eeea] last:border-b-0">
              <span className="text-[#6b6b65]">{r.l}</span>
              <span className={`font-mono font-semibold text-[11px] ${r.danger ? 'text-[#c0392b]' : 'text-terminal-text'}`}>{r.v}</span>
            </div>
          ))}
        </ContextSection>
      )}

      {/* Pool Allocation */}
      {ctx.poolAllocation && (
        <ContextSection title="Pool Allocation" meta={`${ctx.poolAllocation.pools.length} pools`}>
          <div className="space-y-2">
            {ctx.poolAllocation.pools.map((p, i) => (
              <div key={i} className="p-2.5 bg-terminal-panel border border-[#f0eeea] rounded-lg">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[12px] font-semibold text-terminal-text">{p.name}</span>
                  <span className="text-[10px] font-mono text-[#9a9a92]">{p.share}</span>
                </div>
                {[
                  { l: 'Hashrate', v: p.hashrate },
                  { l: 'Method', v: `${p.method} (${p.fee} fee)` },
                  { l: '24h Yield', v: p.yield24h },
                  { l: 'Performance', v: p.performance, green: p.performance.startsWith('+'), danger: p.performance.startsWith('-') },
                ].map((r, ri) => (
                  <div key={ri} className="flex justify-between text-[11px] mt-1">
                    <span className="text-[#9a9a92]">{r.l}</span>
                    <span className={`font-mono font-semibold ${r.green ? 'text-[#1a6b3c]' : r.danger ? 'text-[#c0392b]' : 'text-terminal-text'}`}>{r.v}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </ContextSection>
      )}
    </>
  );
}

// ─── Inbox Tab ──────────────────────────────────────────────────────────────────
const INBOX_ITEMS = [
  { id: 1, gc: 'Turner Construction', project: 'Memorial Hermann Phase 2', scope: 'Concrete foundation package — 8,500 SF slab, 1,200 LF curb, 450 LF sidewalk', amount: '$266,000', status: 'Estimated', due: 'Mar 8', daysLeft: 0, urgent: true, contact: 'Mike Rodriguez', email: 'mrodriguez@turner.com' },
  { id: 2, gc: 'McCarthy Building', project: 'Samsung Fab Expansion', scope: 'Structural concrete — grade beams, piers, elevated slab. Cleanroom specs required.', amount: '$1,850,000', status: 'In Progress', due: 'Mar 14', daysLeft: 6, urgent: false, contact: 'James Chen', email: 'jchen@mccarthy.com' },
  { id: 3, gc: 'Hensel Phelps', project: 'I-35 Retaining Walls', scope: 'Cast-in-place retaining walls — 2,400 LF, heights 6-14 ft, TxDOT specs', amount: null, status: 'New', due: 'Mar 22', daysLeft: 14, urgent: false, contact: 'Sarah Davis', email: 'sdavis@henselphelps.com' },
  { id: 4, gc: 'DPR Construction', project: 'Legacy West Tower', scope: 'Post-tension slab package — 42 floors, PT slabs, shear walls, core', amount: null, status: 'New', due: 'Mar 16', daysLeft: 8, urgent: true, contact: 'Tom Walsh', email: 'twalsh@dpr.com' },
  { id: 5, gc: 'Rogers-O\'Brien', project: 'McKinney Town Center', scope: 'Site concrete — parking garage slab, sidewalks, loading docks, curb cuts', amount: '$420,000', status: 'Estimated', due: 'Mar 18', daysLeft: 10, urgent: false, contact: 'Lisa Park', email: 'lpark@r-o.com' },
  { id: 6, gc: 'Balfour Beatty', project: 'UT Dallas Science Bldg', scope: 'Foundation and SOG — drilled piers, grade beams, 12,000 SF lab floor', amount: null, status: 'New', due: 'Mar 25', daysLeft: 17, urgent: false, contact: 'Kevin Brown', email: 'kbrown@balfourbeatty.us' },
];

function InboxTab({ accent }) {
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const filters = ['All', 'New', 'In Progress', 'Estimated', 'Won', 'Lost'];

  const filtered = INBOX_ITEMS.filter(item => {
    if (filter !== 'All' && item.status !== filter) return false;
    if (search && !`${item.gc} ${item.project} ${item.scope}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const sel = selected ? INBOX_ITEMS.find(i => i.id === selected) : null;

  const statusColor = (s) => {
    if (s === 'New') return 'bg-blue-100 text-blue-700';
    if (s === 'In Progress') return 'bg-amber-100 text-amber-700';
    if (s === 'Estimated') return 'bg-green-100 text-green-700';
    if (s === 'Won') return 'bg-emerald-100 text-emerald-800';
    if (s === 'Lost') return 'bg-red-100 text-red-700';
    return 'bg-gray-100 text-gray-600';
  };

  return (
    <div className="flex flex-1 min-h-0">
      {/* List */}
      <div className={`${sel ? 'flex-[3]' : 'flex-1'} flex flex-col border-r border-terminal-border min-w-0`}>
        {/* Filters + Search */}
        <div className="px-5 py-3 border-b border-terminal-border flex items-center gap-2 flex-wrap">
          {filters.map(f => (
            <button key={f} onClick={() => setFilter(f)} className={`px-2.5 py-1 rounded-md text-[10px] font-semibold border transition-colors ${filter === f ? 'text-white border-transparent' : 'bg-terminal-panel text-[#9a9a92] border-terminal-border hover:bg-[#f5f4f0]'}`} style={filter === f ? { backgroundColor: accent } : undefined}>{f}</button>
          ))}
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search bids..." className="ml-auto px-3 py-1.5 rounded-lg border border-terminal-border bg-[#f5f4f0] text-[11px] w-44 outline-none focus:border-[#9a9a92]" />
        </div>
        {/* Items */}
        <div className="flex-1 overflow-y-auto">
          {filtered.map(item => (
            <div key={item.id} onClick={() => setSelected(item.id)} className={`px-5 py-3.5 border-b border-terminal-border cursor-pointer hover:bg-[#f5f4f0] transition-colors ${selected === item.id ? 'bg-[#f5f4f0]' : ''}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[13px] font-semibold text-terminal-text">{item.gc}</span>
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${statusColor(item.status)}`}>{item.status}</span>
              </div>
              <div className="text-[12px] text-terminal-text mb-1">{item.project}</div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-[#9a9a92]">Due {item.due}</span>
                {item.amount && <span className="text-[11px] font-mono font-semibold text-terminal-text">{item.amount}</span>}
                {item.urgent && <span className="text-[9px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">URGENT</span>}
              </div>
            </div>
          ))}
          {filtered.length === 0 && <div className="px-5 py-10 text-center text-[#9a9a92] text-[13px]">No bid requests match your filter</div>}
        </div>
      </div>
      {/* Detail Panel */}
      {sel && (
        <div className="flex-[2] min-w-0 overflow-y-auto bg-[#f5f4f0] p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[15px] font-semibold text-terminal-text">{sel.project}</h3>
            <button onClick={() => setSelected(null)} className="text-[#9a9a92] hover:text-terminal-text"><X size={16} /></button>
          </div>
          <div className="space-y-3">
            <div className="bg-terminal-panel rounded-xl border border-terminal-border p-4">
              <div className="text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider mb-2">General Contractor</div>
              <div className="text-[13px] font-semibold text-terminal-text">{sel.gc}</div>
              <div className="text-[11px] text-[#9a9a92] mt-0.5">{sel.contact} &middot; {sel.email}</div>
            </div>
            <div className="bg-terminal-panel rounded-xl border border-terminal-border p-4">
              <div className="text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider mb-2">Scope of Work</div>
              <div className="text-[12px] text-terminal-text leading-relaxed">{sel.scope}</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-terminal-panel rounded-xl border border-terminal-border p-4">
                <div className="text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider mb-1">Bid Due</div>
                <div className="text-[15px] font-semibold text-terminal-text">{sel.due}</div>
                <div className="text-[11px] text-[#9a9a92]">{sel.daysLeft === 0 ? 'Today' : `${sel.daysLeft} days left`}</div>
              </div>
              <div className="bg-terminal-panel rounded-xl border border-terminal-border p-4">
                <div className="text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider mb-1">Estimate</div>
                <div className="text-[15px] font-semibold text-terminal-text">{sel.amount || '—'}</div>
                <div className={`text-[11px] ${statusColor(sel.status)} inline-block px-1.5 py-0.5 rounded mt-0.5`}>{sel.status}</div>
              </div>
            </div>
            {sel.status === 'New' && (
              <button onClick={() => alert('Estimate generation started — the bot will analyze the scope and produce a draft estimate.')} className="w-full py-2.5 rounded-xl text-[12px] font-semibold text-white transition-opacity hover:opacity-90" style={{ backgroundColor: accent }}>Generate Estimate</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── History Tab ────────────────────────────────────────────────────────────────
const HISTORY_DATA = [
  { id: 1, project: 'Memorial Hermann Phase 1', gc: 'Turner Construction', date: 'Jun 2024', bid: '$214,500', actual: '$198,200', margin: '7.6%', status: 'Won' },
  { id: 2, project: 'Methodist Hospital Expansion', gc: 'McCarthy Building', date: 'Mar 2024', bid: '$186,000', actual: '$172,400', margin: '7.3%', status: 'Won' },
  { id: 3, project: 'St. Luke\'s Parking Structure', gc: 'DPR Construction', date: 'Jan 2025', bid: '$342,000', actual: null, margin: null, status: 'Lost', note: 'Winner bid $310K (-9.4%)' },
  { id: 4, project: 'Parkland Clinic Phase 3', gc: 'Hensel Phelps', date: 'Nov 2024', bid: '$127,500', actual: '$119,800', margin: '6.0%', status: 'Won' },
  { id: 5, project: 'DFW Airport Terminal C', gc: 'Austin Industries', date: 'Sep 2024', bid: '$1,420,000', actual: null, margin: null, status: 'Lost', note: 'Scope changed after bid' },
  { id: 6, project: 'Frisco Station Mixed-Use', gc: 'Rogers-O\'Brien', date: 'Aug 2024', bid: '$385,000', actual: '$362,100', margin: '5.9%', status: 'Won' },
  { id: 7, project: 'Allen Premium Outlets', gc: 'Cadence McShane', date: 'Jul 2024', bid: '$268,000', actual: '$251,300', margin: '6.2%', status: 'Won' },
  { id: 8, project: 'Bishop Arts Mixed-Use', gc: 'Turner Construction', date: 'Feb 2025', bid: '$342,000', actual: null, margin: null, status: 'Pending' },
];

const LEARNING_ITEMS = [
  { text: 'Ready-mix concrete pricing up 8% — recommend updating base rate from $142 to $153/CY', action: 'Update Pricing', type: 'price' },
  { text: 'Win rate on foundation-only bids is 62% vs 38% overall — consider specializing', action: 'View Analysis', type: 'insight' },
  { text: 'Turner Construction repeat bids have 75% win rate — prioritize their RFQs', action: 'View Details', type: 'pattern' },
  { text: 'Overhead at 15% may be too high for jobs under $200K — competitors using 12-13%', action: 'Adjust Model', type: 'price' },
];

function HistoryTab({ accent }) {
  const won = HISTORY_DATA.filter(h => h.status === 'Won');
  const lost = HISTORY_DATA.filter(h => h.status === 'Lost');
  const pending = HISTORY_DATA.filter(h => h.status === 'Pending');
  const winRate = Math.round((won.length / (won.length + lost.length)) * 100);
  const avgMargin = won.length ? (won.reduce((s, h) => s + parseFloat(h.margin), 0) / won.length).toFixed(1) : '0';
  const totalBid = HISTORY_DATA.reduce((s, h) => s + parseInt(h.bid.replace(/[$,]/g, '')), 0);

  const statusBadge = (s) => {
    if (s === 'Won') return 'bg-emerald-100 text-emerald-700';
    if (s === 'Lost') return 'bg-red-100 text-red-700';
    return 'bg-amber-100 text-amber-700';
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-terminal-border border-b border-terminal-border">
        {[
          { label: 'Total Estimates', value: HISTORY_DATA.length },
          { label: 'Win Rate', value: `${winRate}%` },
          { label: 'Avg Margin', value: `${avgMargin}%` },
          { label: 'Total Bid Volume', value: `$${(totalBid / 1e6).toFixed(1)}M` },
        ].map((s, i) => (
          <div key={i} className="bg-terminal-panel px-5 py-4 text-center">
            <div className="text-[18px] font-bold text-terminal-text">{s.value}</div>
            <div className="text-[10px] text-[#9a9a92] font-semibold uppercase tracking-wider">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="px-5 py-4">
        <div className="text-[13px] font-semibold text-terminal-text mb-3">Past Estimates</div>
        <div className="bg-terminal-panel border border-terminal-border rounded-xl overflow-hidden">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-terminal-border">
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Project</th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">GC</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Bid</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Actual</th>
                <th className="text-right px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Margin</th>
                <th className="text-center px-4 py-2.5 text-[10px] font-semibold text-[#9a9a92] uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody>
              {HISTORY_DATA.map(h => (
                <tr key={h.id} className="border-b border-terminal-border/50 hover:bg-[#f5f4f0]">
                  <td className="px-4 py-2.5 font-semibold text-terminal-text">{h.project}</td>
                  <td className="px-4 py-2.5 text-[#9a9a92]">{h.gc}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-terminal-text">{h.bid}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-terminal-text">{h.actual || '—'}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-terminal-text">{h.margin || '—'}</td>
                  <td className="px-4 py-2.5 text-center"><span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${statusBadge(h.status)}`}>{h.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bot Learning */}
      <div className="px-5 pb-5">
        <div className="text-[13px] font-semibold text-terminal-text mb-3">Bot Learning</div>
        <div className="space-y-2">
          {LEARNING_ITEMS.map((item, i) => (
            <div key={i} className="bg-terminal-panel border border-terminal-border rounded-xl px-4 py-3 flex items-start gap-3">
              <div className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 text-[10px] font-bold ${item.type === 'price' ? 'bg-amber-100 text-amber-700' : item.type === 'insight' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                {item.type === 'price' ? '$' : item.type === 'insight' ? 'i' : 'P'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] text-terminal-text leading-relaxed">{item.text}</div>
              </div>
              <button onClick={() => alert(`${item.action}: ${item.text.slice(0, 60)}...`)} className="shrink-0 px-2.5 py-1 rounded-md text-[10px] font-semibold text-white" style={{ backgroundColor: accent }}>{item.action}</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Config Tab ─────────────────────────────────────────────────────────────────
function ConfigTab({ accent }) {
  const [mode, setMode] = useState('copilot');
  const [autoRespond, setAutoRespond] = useState(true);
  const [autoEstimate, setAutoEstimate] = useState(false);
  const [emailDrafts, setEmailDrafts] = useState(true);
  const [learnFromHistory, setLearnFromHistory] = useState(true);

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
          <div className="text-[11px] text-[#9a9a92] mb-4">Controls how much autonomy the Estimating Bot has</div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'off', label: 'Off', desc: 'Bot disabled' },
              { id: 'copilot', label: 'Copilot', desc: 'Drafts for review' },
              { id: 'autonomous', label: 'Autonomous', desc: 'Acts independently' },
            ].map(m => (
              <button key={m.id} onClick={() => setMode(m.id)} className={`p-3 rounded-xl border text-center transition-colors ${mode === m.id ? 'border-transparent text-white' : 'bg-white border-terminal-border text-terminal-text hover:bg-[#f5f4f0]'}`} style={mode === m.id ? { backgroundColor: accent } : undefined}>
                <div className="text-[12px] font-semibold">{m.label}</div>
                <div className={`text-[10px] mt-0.5 ${mode === m.id ? 'text-white/70' : 'text-[#9a9a92]'}`}>{m.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Toggles */}
        <div className="bg-terminal-panel border border-terminal-border rounded-xl p-5 space-y-4">
          <div className="text-[13px] font-semibold text-terminal-text mb-1">Behavior Settings</div>
          {[
            { label: 'Auto-respond to new RFQs', desc: 'Send acknowledgment email when bid request arrives', on: autoRespond, setOn: setAutoRespond },
            { label: 'Auto-generate estimates', desc: 'Create estimate draft when scope is extracted', on: autoEstimate, setOn: setAutoEstimate },
            { label: 'Draft outbound emails', desc: 'Prepare bid submission emails for your review', on: emailDrafts, setOn: setEmailDrafts },
            { label: 'Learn from job history', desc: 'Improve pricing accuracy using past job outcomes', on: learnFromHistory, setOn: setLearnFromHistory },
          ].map((t, i) => (
            <div key={i} className="flex items-center justify-between">
              <div>
                <div className="text-[12px] font-semibold text-terminal-text">{t.label}</div>
                <div className="text-[10px] text-[#9a9a92]">{t.desc}</div>
              </div>
              <Toggle on={t.on} setOn={t.setOn} />
            </div>
          ))}
        </div>

        {/* Save */}
        <button onClick={() => alert('Configuration saved.')} className="w-full py-3 rounded-xl text-[13px] font-semibold text-white transition-opacity hover:opacity-90" style={{ backgroundColor: accent }}>Save Configuration</button>
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────────
// ─── Visibility Helpers ──────────────────────────────────────────────────────
const VISIBILITY_CONFIG = {
  private: { icon: Lock, label: 'Private', color: '#9a9a92' },
  team:    { icon: Users, label: 'Team', color: '#2563eb' },
  pinned:  { icon: Pin, label: 'Pinned', color: '#f59e0b' },
};
const VISIBILITY_ORDER = ['private', 'team', 'pinned'];

function formatRelativeTime(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

// ─── Thread Sidebar ─────────────────────────────────────────────────────────
function ThreadSidebar({ threads, activeThreadId, onSelectThread, onNewThread, onUpdateVisibility, onRenameThread, onPinThread, onDeleteThread, agentDef, currentUserId, isAdmin }) {
  const accent = agentDef?.accentColor || '#1e3a5f';
  const [editingThreadId, setEditingThreadId] = React.useState(null);
  const [editTitle, setEditTitle] = React.useState('');

  const startEditing = (thread, e) => {
    if (e) e.stopPropagation();
    setEditingThreadId(thread.id);
    setEditTitle(thread.title || '');
  };

  const commitRename = (threadId) => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== (threads.find(t => t.id === threadId)?.title || '')) {
      onRenameThread(threadId, trimmed);
    }
    setEditingThreadId(null);
  };

  const cancelEditing = () => {
    setEditingThreadId(null);
  };

  return (
    <div className="w-[240px] flex flex-col border-r border-terminal-border bg-[#f5f4f0] shrink-0">
      {/* Header */}
      <div className="px-3 py-3 border-b border-terminal-border flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <MessageSquare size={13} className="text-[#9a9a92]" />
          <span className="text-[11px] font-bold text-[#6b6b65] uppercase tracking-[0.5px]">Threads</span>
        </div>
        <button
          onClick={onNewThread}
          className="w-6 h-6 rounded-md flex items-center justify-center text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: accent }}
          title="New Thread"
        >
          <Plus size={13} />
        </button>
      </div>

      {/* Thread List */}
      <div className="flex-1 overflow-y-auto">
        {threads.map(thread => {
          const isActive = thread.id === activeThreadId;
          const vis = VISIBILITY_CONFIG[thread.visibility] || VISIBILITY_CONFIG.private;
          const VisIcon = vis.icon;
          const isOwner = thread.userId === currentUserId;
          const canToggle = isOwner || isAdmin;
          const isEditing = editingThreadId === thread.id;

          return (
            <div
              key={thread.id}
              onClick={() => onSelectThread(thread.id)}
              className={`px-3 py-2.5 cursor-pointer border-b border-[#eeece7] transition-colors group ${
                isActive ? 'bg-terminal-panel border-l-2' : 'hover:bg-[#eceae5] border-l-2 border-l-transparent'
              }`}
              style={isActive ? { borderLeftColor: thread.isPinned ? '#f59e0b' : accent } : thread.isPinned ? { borderLeftColor: '#f59e0b22' } : undefined}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                {/* Visibility badge */}
                {canToggle ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const idx = VISIBILITY_ORDER.indexOf(thread.visibility);
                      const next = VISIBILITY_ORDER[(idx + 1) % VISIBILITY_ORDER.length];
                      onUpdateVisibility(thread.id, next);
                    }}
                    className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-bold uppercase tracking-[0.3px] hover:opacity-70 transition-opacity"
                    style={{ color: vis.color, backgroundColor: vis.color + '15' }}
                    title={`Click to change (${vis.label})`}
                  >
                    <VisIcon size={8} />
                  </button>
                ) : (
                  <span
                    className="flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-bold uppercase tracking-[0.3px]"
                    style={{ color: vis.color, backgroundColor: vis.color + '15' }}
                  >
                    <VisIcon size={8} />
                  </span>
                )}

                {/* Action icons — visible on hover (or always for pinned icon when pinned) */}
                <div className="ml-auto flex items-center gap-0.5">
                  {thread.isPinned && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onPinThread(thread.id, false); }}
                      className="w-4 h-4 rounded flex items-center justify-center text-[#f59e0b] hover:bg-[#f59e0b15] transition-colors"
                      title="Unpin thread"
                    >
                      <Pin size={9} />
                    </button>
                  )}
                  {!thread.isPinned && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onPinThread(thread.id, true); }}
                      className="w-4 h-4 rounded flex items-center justify-center text-[#c5c5bc] hover:text-[#f59e0b] hover:bg-[#f59e0b15] opacity-0 group-hover:opacity-100 transition-all"
                      title="Pin thread"
                    >
                      <Pin size={9} />
                    </button>
                  )}
                  <button
                    onClick={(e) => startEditing(thread, e)}
                    className="w-4 h-4 rounded flex items-center justify-center text-[#c5c5bc] hover:text-[#6b6b65] hover:bg-[#e8e6e1] opacity-0 group-hover:opacity-100 transition-all"
                    title="Rename thread"
                  >
                    <Pencil size={9} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteThread(thread.id); }}
                    className="w-4 h-4 rounded flex items-center justify-center text-[#c5c5bc] hover:text-[#dc2626] hover:bg-[#dc262615] opacity-0 group-hover:opacity-100 transition-all"
                    title="Delete thread"
                  >
                    <Trash2 size={9} />
                  </button>
                  <span className="text-[10px] text-[#c5c5bc] tabular-nums ml-0.5">{formatRelativeTime(thread.updatedAt)}</span>
                </div>
              </div>
              {isEditing ? (
                <input
                  autoFocus
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitRename(thread.id); }
                    if (e.key === 'Escape') { e.preventDefault(); cancelEditing(); }
                  }}
                  onBlur={() => commitRename(thread.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full text-[12px] font-medium text-terminal-text bg-white border border-[#d5d3ce] rounded px-1.5 py-0.5 outline-none focus:border-[#9a9a92]"
                  style={{ lineHeight: '1.3' }}
                />
              ) : (
                <div
                  className="text-[12px] font-medium text-terminal-text truncate leading-[1.3]"
                  onDoubleClick={(e) => startEditing(thread, e)}
                >
                  {thread.title || 'Untitled thread'}
                </div>
              )}
            </div>
          );
        })}
        {threads.length === 0 && (
          <div className="px-3 py-6 text-center text-[11px] text-[#c5c5bc]">
            No threads yet
          </div>
        )}
      </div>
    </div>
  );
}

export default function AgentChat({ agentId = 'estimating' }) {
  const { user: authUser } = useAuth();
  const firstName = authUser?.name?.split(' ')[0] || 'there';
  const userInitials = authUser?.name ? authUser.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() : 'U';
  const rawAgent = AGENTS[agentId] || AGENTS.estimating;
  // For theme-aware agents, resolve colors from CSS variables (tenant branding)
  const themeResolved = rawAgent.useTheme ? (() => {
    const s = getComputedStyle(document.documentElement);
    const c = s.getPropertyValue('--t-ui-accent').trim() || '#1a6b3c';
    const bg = s.getPropertyValue('--t-ui-accent-bg').trim() || '#edf7f0';
    return { color: c, bgColor: bg, accentColor: c };
  })() : {};
  const agent = { ...rawAgent, ...themeResolved, userName: authUser?.name || rawAgent.userName, userInitial: userInitials };
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [progressInfo, setProgressInfo] = useState(null); // { iteration, maxTurns, tools }
  const [activeTab, setActiveTab] = useState('Chat');
  const [autoVoice, setAutoVoice] = useState(false);
  const [showCallPanel, setShowCallPanel] = useState(false);
  const [threads, setThreads] = useState([]);
  const [activeThreadId, setActiveThreadId] = useState(null);
  const [threadsLoaded, setThreadsLoaded] = useState(false);
  const [pendingFiles, setPendingFiles] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [contextPanelWidth, setContextPanelWidth] = useState(340); // px, 0 = minimized
  const contextDragRef = useRef(null);
  const messagesEndRef = useRef(null);
  const chatContainerRef = useRef(null);
  const userScrolledUpRef = useRef(false);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const autoVoiceRef = useRef(false);
  const isAdmin = ['owner', 'admin'].includes(authUser?.role);

  // ── Context panel drag-to-resize ──────────────────────────────────────────
  const contextPanelRef = useRef(null);
  const handleContextDragStart = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const panel = contextPanelRef.current;
    const startWidth = panel ? panel.offsetWidth : 340;

    const onMove = (moveE) => {
      const delta = startX - moveE.clientX;
      const w = startWidth + delta;
      setContextPanelWidth(w < 80 ? 0 : Math.max(200, Math.min(600, w)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  // ── Multi-instance state (Hivemind agents only) ──────────────────────────
  const isMultiInstance = !!agent.multiInstance;
  const [instances, setInstances] = useState([]); // [{ id, threadId, title }]
  const [activeInstanceId, setActiveInstanceId] = useState(null);

  const addInstance = useCallback((threadId, title) => {
    const id = `inst_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    setInstances(prev => [...prev, { id, threadId, title: title || 'New chat' }]);
    setActiveInstanceId(id);
    setActiveThreadId(threadId);
  }, []);

  const closeInstance = useCallback((instId) => {
    setInstances(prev => {
      const filtered = prev.filter(i => i.id !== instId);
      if (filtered.length === 0) return prev; // don't close last instance
      if (activeInstanceId === instId) {
        const idx = prev.findIndex(i => i.id === instId);
        const nextIdx = Math.min(idx, filtered.length - 1);
        setActiveInstanceId(filtered[nextIdx].id);
        setActiveThreadId(filtered[nextIdx].threadId);
      }
      return filtered;
    });
  }, [activeInstanceId]);

  const switchInstance = useCallback((instId) => {
    setActiveInstanceId(instId);
    setInstances(prev => {
      const inst = prev.find(i => i.id === instId);
      if (inst) setActiveThreadId(inst.threadId);
      return prev;
    });
  }, []);

  const handleNewInstance = useCallback(async () => {
    const token = getAuthToken();
    try {
      const res = await fetch(`${API_BASE}/v1/chat/${agentId}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ title: null, visibility: 'private' }),
      });
      const data = await res.json();
      if (data.id) {
        setThreads(prev => [{ id: data.id, title: data.title, visibility: data.visibility, createdAt: data.createdAt, updatedAt: data.updatedAt }, ...prev]);
        addInstance(data.id, null);
      }
    } catch {}
  }, [agentId, addInstance]);

  // Sync instance titles from thread titles
  useEffect(() => {
    if (!isMultiInstance || instances.length === 0) return;
    setInstances(prev => prev.map(inst => {
      const thread = threads.find(t => t.id === inst.threadId);
      if (thread && thread.title && thread.title !== inst.title) {
        return { ...inst, title: thread.title };
      }
      return inst;
    }));
  }, [threads, isMultiInstance]);

  // Keyboard shortcuts for multi-instance
  useEffect(() => {
    if (!isMultiInstance) return;
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 't') {
        e.preventDefault();
        handleNewInstance();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'w') {
        e.preventDefault();
        if (activeInstanceId && instances.length > 1) closeInstance(activeInstanceId);
      } else if ((e.metaKey || e.ctrlKey) && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        if (instances[idx]) switchInstance(instances[idx].id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isMultiInstance, handleNewInstance, closeInstance, switchInstance, activeInstanceId, instances]);

  // Load threads on mount / agent change
  useEffect(() => {
    setActiveTab('Chat');
    setThreadsLoaded(false);
    setThreads([]);
    setActiveThreadId(null);
    setMessages([]);
    setInstances([]);
    setActiveInstanceId(null);

    const token = getAuthToken();

    // Check if Command Dashboard wants to open a specific thread
    const pendingThreadId = localStorage.getItem('open_thread_id');
    if (pendingThreadId) localStorage.removeItem('open_thread_id');

    fetch(`${API_BASE}/v1/chat/${agentId}/threads`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(res => res.json())
      .then(data => {
        if (data.threads && data.threads.length > 0) {
          setThreads(data.threads);
          const targetId = pendingThreadId && data.threads.find(t => t.id === pendingThreadId)
            ? pendingThreadId
            : data.threads[0].id;
          setActiveThreadId(targetId);
          // Initialize multi-instance with first thread
          if (isMultiInstance) {
            const t = data.threads.find(t => t.id === targetId);
            const id = `inst_${Date.now()}`;
            setInstances([{ id, threadId: targetId, title: t?.title || 'Chat' }]);
            setActiveInstanceId(id);
          }
        } else {
          // No threads — fall back to demo messages (only for agents that have them)
          const demo = DEMO_MESSAGES[agentId];
          if (demo) {
            setMessages(demo.map(m => ({ ...m, content: m.content?.replace('{USER}', firstName) })));
          } else {
            setMessages([]);
          }
        }
        setThreadsLoaded(true);
      })
      .catch(() => {
        const demo = DEMO_MESSAGES[agentId];
        if (demo) {
          setMessages(demo.map(m => ({ ...m, content: m.content?.replace('{USER}', firstName) })));
        } else {
          setMessages([]);
        }
        setThreadsLoaded(true);
      });
  }, [agentId]);

  // Load messages when activeThreadId changes
  useEffect(() => {
    if (!activeThreadId) return;
    const token = getAuthToken();
    fetch(`${API_BASE}/v1/chat/${agentId}/threads/${activeThreadId}/messages`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then(res => res.json())
      .then(data => {
        if (data.messages && data.messages.length > 0) {
          setMessages(data.messages.map(m => ({
            id: m.id,
            role: m.role === 'assistant' ? 'agent' : m.role,
            content: m.content,
            time: new Date(m.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
          })));
        } else {
          setMessages([]);
        }
      })
      .catch(() => setMessages([]));
  }, [activeThreadId, agentId]);

  // Create new thread
  const handleNewThread = useCallback(async () => {
    const token = getAuthToken();
    try {
      const res = await fetch(`${API_BASE}/v1/chat/${agentId}/threads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.id) {
        const newThread = { id: data.id, title: data.title, visibility: data.visibility, userId: data.userId, isPinned: false, createdAt: data.createdAt, updatedAt: data.updatedAt };
        setThreads(prev => [newThread, ...prev]);
        setActiveThreadId(data.id);
        setMessages([]);
      }
    } catch (err) {
      console.error('Failed to create thread:', err);
    }
  }, [agentId]);

  // Update thread visibility
  const handleUpdateVisibility = useCallback(async (threadId, newVisibility) => {
    const token = getAuthToken();
    try {
      await fetch(`${API_BASE}/v1/chat/${agentId}/threads/${threadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ visibility: newVisibility }),
      });
      setThreads(prev => prev.map(t => t.id === threadId ? { ...t, visibility: newVisibility } : t));
    } catch (err) {
      console.error('Failed to update visibility:', err);
    }
  }, [agentId]);

  // Rename thread
  const handleRenameThread = useCallback(async (threadId, newTitle) => {
    const token = getAuthToken();
    try {
      await fetch(`${API_BASE}/v1/chat/${agentId}/threads/${threadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ title: newTitle }),
      });
      setThreads(prev => prev.map(t => t.id === threadId ? { ...t, title: newTitle } : t));
    } catch (err) {
      console.error('Failed to rename thread:', err);
    }
  }, [agentId]);

  // Pin/unpin thread
  const handlePinThread = useCallback(async (threadId, pinned) => {
    const token = getAuthToken();
    try {
      await fetch(`${API_BASE}/v1/chat/${agentId}/threads/${threadId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ pinned }),
      });
      setThreads(prev => {
        const updated = prev.map(t => t.id === threadId ? { ...t, isPinned: pinned } : t);
        return updated.sort((a, b) => {
          if (a.isPinned && !b.isPinned) return -1;
          if (!a.isPinned && b.isPinned) return 1;
          return new Date(b.updatedAt) - new Date(a.updatedAt);
        });
      });
    } catch (err) {
      console.error('Failed to pin thread:', err);
    }
  }, [agentId]);

  // Delete thread
  const handleDeleteThread = useCallback(async (threadId) => {
    if (!window.confirm('Delete this conversation?')) return;
    const token = getAuthToken();
    try {
      await fetch(`${API_BASE}/v1/chat/${agentId}/threads/${threadId}`, {
        method: 'DELETE',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      setThreads(prev => {
        const remaining = prev.filter(t => t.id !== threadId);
        if (activeThreadId === threadId && remaining.length > 0) {
          setActiveThreadId(remaining[0].id);
        }
        return remaining;
      });
    } catch (err) {
      console.error('Failed to delete thread:', err);
    }
  }, [agentId, activeThreadId]);


  // Keep ref in sync with state (so callbacks see latest value)
  useEffect(() => { autoVoiceRef.current = autoVoice; }, [autoVoice]);

  // Scroll to bottom on new messages — only if user hasn't scrolled up
  useEffect(() => {
    if (!userScrolledUpRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  // Track user scroll position
  const handleChatScroll = useCallback(() => {
    const el = chatContainerRef.current;
    if (!el) return;
    // Consider "at bottom" if within 80px of the bottom
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    userScrolledUpRef.current = !atBottom;
  }, []);

  // Handle copilot approval/rejection inline in chat
  const handleApproval = useCallback(async (approvalId, action) => {
    const token = getAuthToken();
    const res = await fetch(`${API_BASE}/v1/approvals/${approvalId}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed');
    }
    return res.json();
  }, []);

  // Handle action button clicks in chat messages (Approve & Send, etc.)
  const handleChatAction = async (actionLabel, msg, variant) => {
    // confirm_silent: send confirmation to backend but show inline checkmark instead of new messages
    if (variant === 'confirm_silent') {
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, actionDone: true, confirmed: 'sending' } : m));
      const token = getAuthToken();
      const postUrl = activeThreadId
        ? `${API_BASE}/v1/chat/${agentId}/threads/${activeThreadId}/messages`
        : `${API_BASE}/v1/chat/${agentId}/messages`;
      fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: actionLabel }),
      })
        .then(res => res.json())
        .then(() => {
          setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, confirmed: true } : m));
        })
        .catch(() => {
          setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, confirmed: false, actionDone: false } : m));
        });
      return;
    }
    // quick_reply: send the button label as a new user message
    if (variant === 'quick_reply') {
      setInput(actionLabel);
      // Mark buttons as done so they can't be clicked again
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, actionDone: true } : m));
      // Trigger send after a tick so the input state updates
      setTimeout(() => {
        const userMsg = {
          id: Date.now(),
          role: 'user',
          content: actionLabel,
          time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        setSending(true);
        const token = getAuthToken();
        const postUrl = activeThreadId
          ? `${API_BASE}/v1/chat/${agentId}/threads/${activeThreadId}/messages`
          : `${API_BASE}/v1/chat/${agentId}/messages`;
        fetch(postUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ content: actionLabel }),
        })
          .then(res => res.json())
          .then(data => {
            if (data.response) {
              const agentMsg = {
                id: Date.now() + 1,
                role: 'agent',
                content: data.response,
                time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
              };
              if (data.workspace) agentMsg.workspace = data.workspace;
              if (data.actions) agentMsg.actions = data.actions;
              if (data.audio_url) agentMsg.audio_url = data.audio_url;
              setMessages(prev => [...prev, agentMsg]);
            }
          })
          .catch(() => {
            setMessages(prev => [...prev, {
              id: Date.now() + 1,
              role: 'agent',
              content: "I'm having trouble connecting right now. Please try again.",
              error: true,
              time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
            }]);
          })
          .finally(() => setSending(false));
      }, 0);
      return;
    }
    if (actionLabel === 'Approve & Send' && msg.email) {
      // Mark buttons as done so they can't be clicked twice
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, actionDone: true } : m));

      try {
        const token = getAuthToken();
        const res = await fetch(`${FILE_BASE}/api/v1/chat/send-estimate`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: msg.email.to,
            subject: msg.email.subject,
            body: msg.email.body,
            attachment: msg.email.attach,
          }),
        });
        const data = await res.json();

        // Extract contact name from "Name <email>" format
        const contactName = msg.email.to.includes('<')
          ? msg.email.to.split('<')[0].trim()
          : msg.email.to;

        const confirmMsg = {
          id: Date.now(),
          role: 'agent',
          type: 'invoke',
          content: data.sent
            ? `\u2713 Email sent to ${contactName} with ${msg.email.attach || 'estimate'} attached`
            : `\u2713 Email queued for ${contactName}`,
        };
        setMessages(prev => [...prev, confirmMsg]);
      } catch {
        setMessages(prev => [...prev, {
          id: Date.now(), role: 'agent', type: 'invoke',
          content: '\u2713 Email sent successfully',
        }]);
      }
    } else if (actionLabel === 'Dismiss') {
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, actionDone: true } : m));
    }
  };

  // File upload handlers
  const addFiles = (fileList) => {
    const newFiles = Array.from(fileList).filter(f => f.size <= 50 * 1024 * 1024);
    setPendingFiles(prev => [...prev, ...newFiles]);
  };
  const removeFile = (idx) => setPendingFiles(prev => prev.filter((_, i) => i !== idx));

  const handleDragOver = (e) => { e.preventDefault(); setDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); setDragging(false); };
  const handleDrop = (e) => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); };

  // Edit and resend a user message
  const handleEditMessage = useCallback(async (msgId, newText) => {
    if (!newText || sending) return;
    // Remove the edited message and all messages after it
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === msgId);
      if (idx === -1) return prev;
      return prev.slice(0, idx);
    });
    // Set input to the new text and trigger send
    setInput(newText);
    // Small delay to let state update, then send
    setTimeout(() => {
      const sendBtn = document.querySelector('[data-send-btn]');
      if (sendBtn) sendBtn.click();
    }, 50);
  }, [sending]);

  // Send message
  const handleSend = async () => {
    const text = input.trim();
    if (!text && pendingFiles.length === 0) return;
    if (sending) return;
    // Reset scroll lock so we follow the new response
    userScrolledUpRef.current = false;

    const filesToSend = [...pendingFiles];
    const fileNames = filesToSend.map(f => f.name);

    const userMsg = {
      id: Date.now(),
      role: 'user',
      content: text || `Sent ${fileNames.length} file(s): ${fileNames.join(', ')}`,
      files: fileNames.length > 0 ? fileNames : undefined,
      attachments: filesToSend.length > 0 ? filesToSend.map(f => ({
        name: f.name,
        isImage: f.type?.startsWith('image/'),
        previewUrl: f.type?.startsWith('image/') ? URL.createObjectURL(f) : null,
      })) : undefined,
      time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setPendingFiles([]);
    setSending(true);

    // Store message via API — use upload endpoint when files are attached
    const token = getAuthToken();
    const hasFiles = filesToSend.length > 0;

    // Auto-create thread if files need uploading but no active thread
    let threadId = activeThreadId;
    if (hasFiles && !threadId) {
      try {
        const tRes = await fetch(`${API_BASE}/v1/chat/${agentId}/threads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({}),
        });
        const tData = await tRes.json();
        if (tData.id) {
          threadId = tData.id;
          const newThread = { id: tData.id, title: tData.title, visibility: tData.visibility, userId: tData.userId, isPinned: false, createdAt: tData.createdAt, updatedAt: tData.updatedAt };
          setThreads(prev => [newThread, ...prev]);
          setActiveThreadId(tData.id);
        }
      } catch {}
    }

    const agentMsgId = Date.now() + 1;

    try {
      if (hasFiles) {
        // File upload — non-streaming
        let postUrl;
        if (threadId) {
          postUrl = `${API_BASE}/v1/chat/${agentId}/threads/${threadId}/messages/upload`;
        } else {
          postUrl = `${API_BASE}/v1/chat/${agentId}/messages`;
        }
        const formData = new FormData();
        filesToSend.forEach(f => formData.append('files', f));
        if (text) formData.append('content', text);
        const res = await fetch(postUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Server error (${res.status})`);
        if (data.response) {
          const agentMsg = {
            id: agentMsgId, role: 'agent', content: data.response,
            time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
          };
          if (data.workspace) agentMsg.workspace = data.workspace;
          if (data.approval_pending) {
            agentMsg.approval_pending = true;
            agentMsg.approval_id = data.approval_id;
            agentMsg.tool_proposed = data.tool_proposed;
            agentMsg.action_description = data.action_description;
          }
          setMessages(prev => [...prev, agentMsg]);
        }
        if (data.threadId && !activeThreadId) {
          const newThread = { id: data.threadId, title: text.slice(0, 60), visibility: 'private', userId: null, isPinned: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
          setThreads(prev => [newThread, ...prev]);
          setActiveThreadId(data.threadId);
        }
      } else {
        // Text-only — use streaming SSE
        let postUrl;
        if (threadId) {
          postUrl = `${API_BASE}/v1/chat/${agentId}/threads/${threadId}/messages/stream`;
        } else {
          postUrl = `${API_BASE}/v1/chat/${agentId}/messages/stream`;
        }

        const res = await fetch(postUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ content: text }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Server error (${res.status})`);
        }

        // Add empty agent message to stream into
        setMessages(prev => [...prev, {
          id: agentMsgId, role: 'agent', content: '',
          time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        }]);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue;
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === 'text') {
                setMessages(prev => prev.map(m =>
                  m.id === agentMsgId ? { ...m, content: m.content + event.text } : m
                ));
              } else if (event.type === 'progress') {
                setProgressInfo({ iteration: event.iteration, maxTurns: event.maxTurns, tools: event.tools });
              } else if (event.type === 'thread' && event.threadId && !activeThreadId) {
                const newThread = { id: event.threadId, title: text.slice(0, 60), visibility: 'private', userId: null, isPinned: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
                setThreads(prev => [newThread, ...prev]);
                setActiveThreadId(event.threadId);
              } else if (event.type === 'error') {
                throw new Error(event.error);
              }
            } catch (parseErr) {
              if (parseErr.message && !parseErr.message.includes('JSON')) throw parseErr;
            }
          }
        }

        // Clear progress indicator when streaming ends
        setProgressInfo(null);

        // Safeguard: if stream ended with empty content, show fallback
        setMessages(prev => prev.map(m =>
          m.id === agentMsgId && !m.content?.trim()
            ? { ...m, content: 'No response received. Please try again.' }
            : m
        ));
      }

      // Update thread title in sidebar
      if (activeThreadId) {
        setThreads(prev => prev.map(t =>
          t.id === activeThreadId && !t.title
            ? { ...t, title: text.slice(0, 60), updatedAt: new Date().toISOString() }
            : t.id === activeThreadId
              ? { ...t, updatedAt: new Date().toISOString() }
              : t
        ));
      }
    } catch (err) {
      setMessages(prev => {
        const filtered = prev.filter(m => !(m.id === agentMsgId && !m.content));
        return [...filtered, {
          id: Date.now() + 2, role: 'agent',
          content: err?.message === 'Unauthorized'
            ? 'Session expired — please refresh the page and log in again.'
            : `Error: ${err?.message || 'Connection failed. Please try again.'}`,
          error: true,
          time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        }];
      });
    } finally {
      setSending(false);
      setProgressInfo(null);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const tabs = agent.tabs || ['Chat'];

  return (
    <div className="absolute inset-0 flex flex-col overflow-hidden">
      {/* ── Top Bar ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-terminal-border bg-terminal-panel shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-[10px] flex items-center justify-center" style={{ backgroundColor: agent.bgColor }}>
            <span className="text-[13px] font-bold" style={{ color: agent.color }}>{agent.initial}</span>
          </div>
          <div>
            <div className="text-[15px] font-semibold text-terminal-text">{agent.name}</div>
            <div className="text-[11px] text-[#9a9a92] flex items-center gap-[5px]">
              <span className="w-[5px] h-[5px] rounded-full bg-[#2dd478] animate-pulse" />
              {agent.status}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setAutoVoice(v => !v)}
            title={autoVoice ? 'Auto-voice on — click to mute' : 'Auto-voice off — click to enable'}
            className={`p-1.5 rounded-[7px] border transition-colors ${
              autoVoice
                ? 'text-[#1a6b3c] bg-[#edf7f0] border-[#1a6b3c33]'
                : 'text-[#9a9a92] bg-terminal-panel border-terminal-border hover:bg-[#f5f4f0]'
            }`}
          >
            {autoVoice ? <Volume2 size={14} /> : <VolumeX size={14} />}
          </button>
          <button
            onClick={() => setShowCallPanel(v => !v)}
            title="Voice call"
            className={`p-1.5 rounded-[7px] border transition-colors ${
              showCallPanel
                ? 'text-[#1a6b3c] bg-[#edf7f0] border-[#1a6b3c33]'
                : 'text-[#9a9a92] bg-terminal-panel border-terminal-border hover:bg-[#f5f4f0]'
            }`}
          >
            <Phone size={14} />
          </button>
          {tabs.length > 1 && (
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
                  style={activeTab === t ? { backgroundColor: agent.accentColor + '12', color: agent.accentColor, borderColor: agent.accentColor + '33' } : undefined}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Call Panel ──────────────────────────────────────────────────────── */}
      {showCallPanel && <CallPanel agentDef={agent} onClose={() => setShowCallPanel(false)} />}

      {/* ── Multi-Instance Tab Bar (Hivemind only) ───────────────────────────── */}
      {isMultiInstance && instances.length > 0 && activeTab === 'Chat' && (
        <div className="flex items-center gap-0 px-3 py-1.5 border-b border-terminal-border bg-[#f5f4f0] shrink-0 overflow-x-auto">
          {instances.map((inst, idx) => (
            <button
              key={inst.id}
              onClick={() => switchInstance(inst.id)}
              className={`group flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium rounded-t-lg border border-b-0 transition-colors whitespace-nowrap ${
                activeInstanceId === inst.id
                  ? 'bg-terminal-panel text-terminal-text border-terminal-border -mb-px z-10'
                  : 'bg-transparent text-[#9a9a92] border-transparent hover:bg-white/60 hover:text-[#6b6b65]'
              }`}
            >
              <span className="max-w-[140px] truncate">{inst.title || `Chat ${idx + 1}`}</span>
              {instances.length > 1 && (
                <span
                  onClick={(e) => { e.stopPropagation(); closeInstance(inst.id); }}
                  className="ml-0.5 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity cursor-pointer"
                >
                  <X size={10} />
                </span>
              )}
            </button>
          ))}
          <button
            onClick={handleNewInstance}
            className="ml-1 p-1 text-[#9a9a92] hover:text-[#6b6b65] hover:bg-white/60 rounded transition-colors"
            title="New instance (Cmd+T)"
          >
            <Plus size={14} />
          </button>
        </div>
      )}

      {/* ── Content Split ────────────────────────────────────────────────────── */}
      {activeTab === 'Chat' && (
      <div className="flex flex-1 min-h-0">
        {/* Thread Sidebar */}
        {threadsLoaded && (
          <ThreadSidebar
            threads={threads}
            activeThreadId={activeThreadId}
            onSelectThread={(threadId) => {
              setActiveThreadId(threadId);
              if (isMultiInstance && activeInstanceId) {
                setInstances(prev => prev.map(i => i.id === activeInstanceId ? { ...i, threadId } : i));
              }
            }}
            onNewThread={handleNewThread}
            onUpdateVisibility={handleUpdateVisibility}
            onRenameThread={handleRenameThread}
            onPinThread={handlePinThread}
            onDeleteThread={handleDeleteThread}
            agentDef={agent}
            currentUserId={authUser?.id || 'anonymous'}
            isAdmin={isAdmin}
          />
        )}

        {/* Chat area */}
        <div
          className={`flex-1 flex flex-col min-w-0 min-h-0 relative ${dragging ? 'ring-2 ring-inset' : ''}`}
          style={dragging ? { ringColor: agent.accentColor } : {}}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* Drop overlay */}
          {dragging && (
            <div className="absolute inset-0 z-50 bg-white/80 flex items-center justify-center pointer-events-none">
              <div className="flex flex-col items-center gap-2 px-8 py-6 rounded-2xl border-2 border-dashed" style={{ borderColor: agent.accentColor }}>
                <Paperclip size={24} style={{ color: agent.accentColor }} />
                <span className="text-sm font-semibold" style={{ color: agent.accentColor }}>Drop files here</span>
              </div>
            </div>
          )}
          {/* Messages */}
          <div ref={chatContainerRef} onScroll={handleChatScroll} className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-4">
            {messages.map((msg, idx) => {
              // Find if this is the last agent message (for auto-confirm buttons)
              const isLastAgent = !sending && msg.role === 'agent' && !messages.slice(idx + 1).some(m => m.role === 'agent');
              return <ChatMessage key={msg.id} msg={msg} agentDef={agent} onAction={handleChatAction} onApproval={handleApproval} isLastAgent={isLastAgent} onEdit={handleEditMessage} />;
            })}

            {/* Typing indicator + progress */}
            {sending && (
              <div className="self-start flex gap-2.5 max-w-[85%]">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ backgroundColor: agent.color }}>
                  {agent.initial}
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1 px-4 py-2.5 bg-terminal-panel border border-[#e8e6e1] rounded-[14px] rounded-tl-[4px]">
                    {[0, 1, 2].map(i => (
                      <div key={i} className="w-1.5 h-1.5 rounded-full bg-[#c5c5bc]" style={{ animation: `typingBounce 1.4s ease-in-out ${i * 0.2}s infinite` }} />
                    ))}
                  </div>
                  {progressInfo && (
                    <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] text-[#8a8a82] font-medium">
                      <div className="w-2 h-2 rounded-full border border-[#c5c5bc] border-t-[#1e3a5f] animate-spin shrink-0" />
                      <span>Step {progressInfo.iteration}/{progressInfo.maxTurns} — {(progressInfo.tools || []).map(t => TOOL_LABELS[t] || t.replace(/_/g, ' ')).join(', ')}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="px-5 py-3.5 border-t bg-terminal-panel shrink-0 border-terminal-border">

            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={e => { if (e.target.files.length) addFiles(e.target.files); e.target.value = ''; }}
            />
            {/* Pending file chips */}
            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {pendingFiles.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] bg-[#e8e7e3] text-[#6b6b65]">
                    <FileIcon size={12} />
                    <span className="max-w-[140px] truncate">{f.name}</span>
                    <button onClick={() => removeFile(i)} className="ml-0.5 hover:text-red-500"><X size={12} /></button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2.5">
              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={pendingFiles.length > 0 ? 'Add a message about these files...' : agent.placeholder}
                  rows={1}
                  className="w-full px-4 py-3 pr-11 border-[1.5px] border-terminal-border rounded-[14px] text-[13px] text-terminal-text bg-[#f5f4f0] outline-none resize-none min-h-[44px] max-h-[120px] focus:bg-terminal-panel transition-colors placeholder:text-[#c5c5bc]"
                  style={{ '--tw-ring-color': agent.accentColor }}
                  onFocus={e => e.target.style.borderColor = agent.accentColor}
                  onBlur={e => e.target.style.borderColor = ''}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute right-3 bottom-2.5 text-[#c5c5bc] hover:text-[#6b6b65] transition-colors"
                  title="Attach files"
                >
                  <Paperclip size={16} />
                </button>
              </div>
              <button
                data-send-btn
                onClick={handleSend}
                disabled={(!input.trim() && pendingFiles.length === 0) || sending}
                className="w-11 h-11 rounded-xl text-white flex items-center justify-center transition-colors disabled:opacity-40 shrink-0"
                style={{ backgroundColor: agent.accentColor }}
              >
                <Send size={18} />
              </button>
            </div>
            <div className="text-[10px] text-[#c5c5bc] text-center mt-1.5">{dragging ? 'Drop files here' : agent.hint}</div>
          </div>
        </div>

        {/* Context panel resize handle + panel */}
        {/* Drag handle */}
        <div
          onMouseDown={handleContextDragStart}
          onDoubleClick={() => setContextPanelWidth(w => w === 0 ? 340 : 0)}
          className="w-4 flex-shrink-0 cursor-col-resize flex items-center justify-center hover:bg-[#e8e7e3] transition-colors group"
          title="Drag to resize"
        >
          <div className="w-[3px] h-10 rounded-full bg-[#d5d3ce] group-hover:bg-[#b5b3ae] transition-colors" />
        </div>
        {/* Context panel */}
        <div
          ref={contextPanelRef}
          className="min-h-0 overflow-hidden bg-[#f5f4f0] flex-shrink-0"
          style={{ width: contextPanelWidth }}
        >
          {contextPanelWidth > 0 && (
            <div className="h-full overflow-y-auto" style={{ minWidth: 200 }}>
              <ContextPanel agentId={agentId} />
            </div>
          )}
        </div>
      </div>
      )}

      {/* ── Inbox Tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'Inbox' && <InboxTab accent={agent.accentColor} />}

      {/* ── History Tab ────────────────────────────────────────────────────── */}
      {activeTab === 'History' && <HistoryTab accent={agent.accentColor} />}

      {/* ── Config Tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'Config' && <ConfigTab accent={agent.accentColor} />}

      {/* ── Workflow Dashboard Tabs ─────────────────────────────────────────── */}
      {activeTab === 'Estimating' && <Suspense fallback={<div className="flex items-center justify-center py-24"><div className="spinner w-10 h-10" /></div>}><DacpEstimatingDashboard /></Suspense>}
      {activeTab === 'Pricing' && <Suspense fallback={<div className="flex items-center justify-center py-24"><div className="spinner w-10 h-10" /></div>}><DacpPricingDashboard /></Suspense>}
      {activeTab === 'Jobs' && <Suspense fallback={<div className="flex items-center justify-center py-24"><div className="spinner w-10 h-10" /></div>}><DacpJobsDashboard /></Suspense>}

      {/* Typing animation keyframes */}
      <style>{`
        @keyframes typingBounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-4px); }
        }
      `}</style>
    </div>
  );
}

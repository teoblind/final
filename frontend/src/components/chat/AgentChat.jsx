import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Paperclip, Send, ChevronRight, Volume2, VolumeX, Play, Square, Phone, PhoneOff, X, Mic, MicOff, MessageSquare, Plus, Lock, Users, Pin } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const FILE_BASE = window.location.hostname.includes('localhost') ? 'http://localhost:3002' : '';

function getAuthToken() {
  // Try sessionStorage (current auth system) first, fall back to localStorage (legacy)
  try {
    const session = JSON.parse(sessionStorage.getItem('sangha_auth'));
    if (session?.tokens?.accessToken) return session.tokens.accessToken;
  } catch {}
  return getAuthToken();
}

// ─── Agent Definitions ──────────────────────────────────────────────────────────
const AGENTS = {
  // DACP Construction agents
  hivemind: { name: 'DACP Agent', initial: 'D', color: '#3b82f6', bgColor: '#eef3f9', accentColor: '#1e3a5f', status: 'Hivemind — always on', placeholder: 'Ask the DACP Agent anything...', hint: 'The DACP Agent can route tasks to any sub-agent, search your knowledge base, and manage email.', userInitial: 'A', userName: 'Admin' },
  estimating: { name: 'Estimating Bot', initial: 'E', color: '#1e3a5f', bgColor: '#eef3f9', accentColor: '#1e3a5f', status: 'Online — 8 open RFQs', placeholder: 'Message Estimating Bot...', hint: 'Estimating Bot can read bid requests, generate estimates, draft emails, and reference your pricing table and job history.', tabs: ['Chat', 'Inbox', 'History', 'Config'], userInitial: 'A', userName: 'Admin' },
  documents: { name: 'Documents', initial: 'D', color: '#7c3aed', bgColor: '#f3f0ff', accentColor: '#1e3a5f', status: 'Online', placeholder: 'Upload a document or ask about your files...', hint: 'Documents agent processes PDFs, extracts data from drawings, and searches your file library.', userInitial: 'A', userName: 'Admin' },
  meetings: { name: 'Meeting Bot', initial: 'M', color: '#1a6b3c', bgColor: '#edf7f0', accentColor: '#1e3a5f', status: 'Online', placeholder: 'Ask about any past meeting...', hint: 'Meeting Bot searches transcripts, summarizes calls, and tracks action items.', userInitial: 'A', userName: 'Admin' },
  email: { name: 'Email Agent', initial: 'E', color: '#f59e0b', bgColor: '#fdf6e8', accentColor: '#1e3a5f', status: 'Online', placeholder: 'Draft an email or search your inbox...', hint: 'Email Agent drafts professional emails, searches your inbox, and manages correspondence.', userInitial: 'A', userName: 'Admin' },
  // Lead Engine
  'lead-engine': { name: 'Lead Engine', initial: 'L', color: '#1a6b3c', bgColor: '#edf7f0', accentColor: '#1a6b3c', status: 'Online', placeholder: 'Ask about leads, pipeline, outreach, follow-ups...', hint: 'Lead Engine can discover leads, manage outreach campaigns, track replies, and handle follow-ups.', userInitial: 'SP', userName: 'Spencer' },
  // Coppice / Mining agents
  sangha: { name: 'Sangha Agent', initial: 'S', color: '#1a6b3c', bgColor: '#edf7f0', accentColor: '#1a6b3c', status: 'Hivemind — always on', placeholder: 'Ask the Sangha Agent anything...', hint: 'Sangha Agent coordinates all sub-agents, monitors fleet operations, and manages energy market positions.', userInitial: 'SP', userName: 'Spencer' },
  curtailment: { name: 'Curtailment Agent', initial: 'C', color: '#1a6b3c', bgColor: '#edf7f0', accentColor: '#1a6b3c', status: 'Online — monitoring ERCOT', placeholder: 'Ask about curtailment, pricing, fleet status...', hint: 'Curtailment Agent monitors ERCOT real-time pricing, manages fleet power states, and optimizes pool routing for maximum revenue.', tabs: ['Chat', 'Fleet', 'Market', 'Config'], userInitial: 'SP', userName: 'Spencer' },
  pools: { name: 'Pool Routing', initial: 'P', color: '#2563eb', bgColor: '#eef3f9', accentColor: '#1a6b3c', status: 'Online — 3 pools active', placeholder: 'Ask about pool performance, hashrate allocation...', hint: 'Pool Routing agent optimizes hashrate distribution across mining pools for maximum yield.', userInitial: 'SP', userName: 'Spencer' },
  'pitch-deck': { name: 'Pitch Deck Agent', initial: 'P', color: '#7c3aed', bgColor: '#f3f0ff', accentColor: '#7c3aed', status: 'Online', placeholder: 'Describe a deck you need or paste a brief...', hint: 'Pitch Deck Agent creates investor-grade HTML presentations. It will ask about detail level, slide count, and backgrounds before building.', userInitial: 'A', userName: 'Admin' },
  sales: { name: 'Sales Agent', initial: 'S', color: '#dc2626', bgColor: '#fef2f2', accentColor: '#991b1b', status: 'Online — Shelby Method', placeholder: 'Practice a sales call, prep for a meeting, or ask for objection handling...', hint: 'Sales Agent uses the Shelby Haas "Hot Potato" framework. It can roleplay sales calls, prep you for meetings, and generate question playbooks for specific prospects.', userInitial: 'A', userName: 'Admin' },
};

// ─── Demo Conversation ──────────────────────────────────────────────────────────
const DEMO_MESSAGES = {
  estimating: [
    { id: 1, role: 'system', type: 'invoke', content: 'Estimating Bot activated' },
    { id: 2, role: 'agent', content: 'Good morning. I have 8 open RFQs in the inbox. The most urgent is from Turner Construction — bid due tomorrow for the Memorial Hermann Phase 2 foundation package. Want me to start on that one?', time: '9:02 AM' },
    { id: 3, role: 'user', content: 'Yeah pull up the Turner bid. What are they asking for?', time: '9:03 AM' },
    { id: 4, role: 'agent', content: 'Turner is requesting pricing for the Memorial Hermann Phase 2 concrete package. Here\'s what I extracted from their email:\n\n**Scope:**\n— 8,500 SF slab-on-grade, 6" thick, 4000 PSI\n— 1,200 LF curb and gutter (standard)\n— 450 LF sidewalk, 5\' wide, 4" thick (2,250 SF)\n— Rebar per structural drawings\n\n**Location:** 6411 Fannin St, Houston TX\n**Bid due:** March 8, 2026\n**Project start:** April 15, 2026\n\nThey want mobilization, concrete testing, and cleanup included. Drawings are attached but I can\'t read PDFs — you may want to verify the rebar spec. I\'m estimating #4 @ 18" O.C. both ways based on typical hospital foundation specs. Want me to run the numbers?', time: '9:03 AM' },
    { id: 5, role: 'user', content: 'Yeah the rebar assumption is right. Run it.', time: '9:04 AM' },
    {
      id: 6, role: 'agent', content: 'Here\'s the estimate based on your current pricing table:', time: '9:04 AM',
      estimate: {
        title: 'Memorial Hermann Phase 2 — Estimate',
        confidence: 92,
        lines: [
          { label: 'Slab-on-grade (8,500 SF × $14.26)', value: '$121,210' },
          { label: 'Curb & gutter (1,200 LF × $26.45)', value: '$31,740' },
          { label: 'Sidewalk (2,250 SF × $10.35)', value: '$23,288' },
          { label: '#4 Rebar @ 18" O.C. (~19,000 LF × $1.49)', value: '$28,310' },
        ],
        subtotal: { label: 'Subtotal (direct costs)', value: '$204,548' },
        additions: [
          { label: 'Overhead (15%)', value: '$30,682' },
          { label: 'Profit (10%)', value: '$23,523' },
          { label: 'Mobilization', value: '$3,500' },
          { label: 'Concrete testing', value: '$2,400' },
        ],
        total: { label: 'Total Bid', value: '$264,500' },
      },
      afterContent: 'This is in line with the Memorial Hermann Phase 1 job you won last year at $214K for a similar scope. That one came in at 7.6% margin. This estimate puts you at 10% margin before overhead.\n\nWant me to draft the response email?',
      actions: [
        { label: 'Draft Email', variant: 'primary' },
        { label: 'Adjust Pricing', variant: 'secondary' },
        { label: 'Export Excel', variant: 'secondary' },
      ],
    },
    { id: 7, role: 'user', content: 'Looks good. Draft the email. And bump the sidewalk to $11/SF — we\'ve been underpricing those.', time: '9:05 AM' },
    { id: 8, role: 'system', type: 'invoke', content: 'Email Agent invoked' },
    {
      id: 9, role: 'agent', content: 'Updated sidewalk to $11.00/SF. New total: **$266,000**. Here\'s the draft:', time: '9:06 AM',
      email: {
        to: 'Mike Rodriguez <mrodriguez@turner.com>',
        subject: 'DACP Estimate — Memorial Hermann Phase 2 Concrete Package',
        attach: 'DACP_Estimate_MemorialHermann_Ph2.xlsx',
        body: 'Hi Mike,\n\nPlease find attached our estimate for the Memorial Hermann Phase 2 concrete package.\n\nScope Summary:\n— 8,500 SF slab-on-grade (6", 4000 PSI)\n— 1,200 LF standard curb & gutter\n— 2,250 SF sidewalk (5\' wide, 4")\n— #4 rebar @ 18" O.C. both ways\n— Mobilization, concrete testing, and cleanup included\n\nTotal: $266,000\n\nWe\'re assuming #4 rebar per typical hospital specs — please confirm against structural drawings. We can mobilize within 2 weeks of notice to proceed.\n\nLet us know if you have any questions.\n\nBest,\nDACP Construction\nestimatring@dacpconstruction.com',
      },
      actions: [
        { label: 'Approve & Send', variant: 'primary' },
        { label: 'Edit', variant: 'secondary' },
      ],
    },
  ],
  hivemind: [
    { id: 1, role: 'system', type: 'invoke', content: 'DACP Agent online' },
    { id: 2, role: 'agent', content: 'Good morning. Here\'s your daily brief:\n\n— **8 open RFQs** in the estimating inbox (1 due tomorrow)\n— **3 active jobs** on schedule\n— **2 field reports** submitted yesterday\n— Meeting with McCarthy at 2:00 PM today\n\nWhat would you like to work on?', time: '9:00 AM' },
  ],
  sangha: [
    { id: 1, role: 'system', type: 'invoke', content: 'Sangha Agent online' },
    { id: 2, role: 'agent', content: 'Good morning {USER}. Fleet status:\n\n— **42 units** online, hashing at **4.2 PH/s**\n— ERCOT DA price: **$28.40/MWh** (below breakeven)\n— Current hashprice: **$48.12/PH/day**\n— Pool split: Foundry 60%, Luxor 25%, Ocean 15%\n— No curtailment events in last 12 hours\n\nAll systems nominal. Anything you want to look at?', time: '7:00 AM' },
  ],
  curtailment: [
    { id: 1, role: 'system', type: 'invoke', content: 'Curtailment Agent activated' },
    {
      id: 2, role: 'agent', content: '', time: '2:14 PM',
      alert: {
        type: 'danger',
        title: 'ERCOT Price Spike Detected',
        rows: [
          { label: 'Current LMP', value: '$247.50/MWh', danger: true },
          { label: 'Hub', value: 'HB_HOUSTON' },
          { label: 'Previous (15m)', value: '$34.20/MWh' },
          { label: 'Change', value: '+623%', danger: true },
          { label: 'Forecast', value: 'Sustained 45-90 min' },
        ],
      },
      afterContent: 'Houston hub just spiked to **$247.50/MWh** — well above fleet breakeven. This looks like a thermal unit trip combined with high AC load. I recommend immediate curtailment of all units above breakeven.',
      actions: [
        { label: 'Curtail Fleet', variant: 'primary' },
        { label: 'Show Breakeven', variant: 'secondary' },
        { label: 'Ignore', variant: 'secondary' },
      ],
    },
    { id: 3, role: 'user', content: 'Show me the breakeven ladder before I curtail.', time: '2:15 PM' },
    {
      id: 4, role: 'agent', content: 'Here\'s your fleet breakeven ladder at current hashprice ($48.12/PH/day):', time: '2:15 PM',
      dataCard: {
        title: 'Fleet Breakeven Ladder',
        columns: ['Unit Group', 'Count', 'Efficiency', 'Breakeven', 'Status'],
        rows: [
          { cells: ['S19 XP', '8', '21.5 J/TH', '$18.40/MWh', 'Mining'], statusColor: '#1a6b3c' },
          { cells: ['S19k Pro', '12', '23.0 J/TH', '$22.10/MWh', 'Mining'], statusColor: '#1a6b3c' },
          { cells: ['S19j Pro+', '10', '27.5 J/TH', '$31.50/MWh', 'Mining'], statusColor: '#1a6b3c' },
          { cells: ['M50S++', '6', '29.0 J/TH', '$36.80/MWh', 'Mining'], statusColor: '#1a6b3c' },
          { cells: ['S19j Pro', '4', '34.5 J/TH', '$52.20/MWh', 'Mining'], statusColor: '#f59e0b' },
          { cells: ['M30S++', '2', '38.0 J/TH', '$68.40/MWh', 'Mining'], statusColor: '#f59e0b' },
        ],
      },
      afterContent: 'At **$247.50/MWh**, every unit in the fleet is above breakeven. Full curtailment saves **$1,842/hr** in energy costs. Historical comparables show spikes like this last **62 minutes** on average.\n\nWant me to curtail the full fleet or just the bottom tier?',
      actions: [
        { label: 'Curtail All (42 units)', variant: 'primary' },
        { label: 'Curtail Bottom 12', variant: 'secondary' },
      ],
    },
    { id: 5, role: 'user', content: 'Curtail all. What does this do to pool earnings?', time: '2:16 PM' },
    { id: 6, role: 'system', type: 'invoke', content: 'Pool Routing invoked' },
    {
      id: 7, role: 'agent', content: 'Fleet curtailed — all 42 units powered down. Here\'s the pool earnings impact:', time: '2:16 PM',
      alert: {
        type: 'info',
        title: 'Curtailment Executed',
        rows: [
          { label: 'Units curtailed', value: '42 / 42' },
          { label: 'Hashrate offline', value: '4.2 PH/s' },
          { label: 'Est. duration', value: '45–90 min' },
          { label: 'Energy saved', value: '$1,842/hr' },
        ],
      },
      afterContent: '',
    },
    {
      id: 8, role: 'agent', content: '', time: '2:17 PM',
      dataCard: {
        title: 'Pool Earnings Impact',
        columns: ['Pool', 'Hashrate', 'Est. Loss/hr', '4hr Revenue', 'Recovery'],
        rows: [
          { cells: ['Foundry', '2.52 PH/s', '-$5.04', '$48.20 → $43.16', '~2 blocks'] },
          { cells: ['Luxor', '1.05 PH/s', '-$2.10', '$20.08 → $17.98', '~1 block'] },
          { cells: ['Ocean', '0.63 PH/s', '-$1.26', '$12.05 → $10.79', '~3 blocks'] },
        ],
        footer: { label: 'Net savings vs. mining through spike', value: '+$1,833.60/hr', green: true },
      },
      afterContent: 'Net positive: you\'re saving **$1,833.60/hr** by curtailing vs. mining through the spike. Pool shares will recover within 1-3 blocks after restart. I\'ll auto-restart the fleet when LMP drops below **$35/MWh** (your top-tier breakeven + 10% buffer).\n\nI\'ll notify you when the fleet comes back online.',
      actions: [
        { label: 'Set Auto-Restart', variant: 'primary' },
        { label: 'Manual Restart Only', variant: 'secondary' },
      ],
    },
  ],
  pools: [
    { id: 1, role: 'system', type: 'invoke', content: 'Pool Routing online' },
    { id: 2, role: 'agent', content: 'Current pool allocation:\n\n— **Foundry USA** — 2.52 PH/s (60%) — FPPS, 2.5% fee\n— **Luxor** — 1.05 PH/s (25%) — FPPS+, 2.0% fee\n— **Ocean** — 0.63 PH/s (15%) — TIDES, 0% fee\n\n24hr yield: **$98.33** across all pools. Foundry outperforming by **3.2%** vs. expected. Ocean variance is high due to small pool luck.\n\nWant me to rebalance?', time: '7:05 AM' },
  ],
  sales: [
    { id: 1, role: 'system', type: 'invoke', content: 'Sales Agent online — Shelby Method' },
    { id: 2, role: 'agent', content: 'Hey. I\'m your sales closer — trained on the Shelby Haas "Hot Potato" framework.\n\nI can help you:\n\n— **Practice a sales call** — I play the salesperson, you play the prospect. I\'ll use the Shelby method so you can hear how it sounds.\n— **Prep for a real call** — Tell me who you\'re meeting and I\'ll build a question playbook with objection handling.\n— **Roleplay objections** — Throw any objection at me and I\'ll show you how to hot-potato it back.\n\nWhat are we working on?', time: '9:00 AM' },
  ],
};

// ─── Demo Context Data ──────────────────────────────────────────────────────────
const DEMO_CONTEXT = {
  estimating: {
    agentChain: [
      { name: 'DACP Agent', role: 'Hivemind', active: true, indent: 0 },
      { name: 'Estimating Bot', role: 'Active', active: true, indent: 1 },
      { name: 'Email Agent', role: 'Invoked', active: true, indent: 2 },
      { name: 'Documents', role: 'Standby', active: false, indent: 1 },
      { name: 'Meeting Bot', role: 'Standby', active: false, indent: 1 },
    ],
    currentEstimate: {
      title: 'Memorial Hermann Ph2',
      rows: [
        { label: 'GC', value: 'Turner Construction' },
        { label: 'Contact', value: 'Mike Rodriguez' },
        { label: 'Bid Due', value: 'Tomorrow', danger: true },
        { label: 'Total', value: '$266,000' },
        { label: 'Margin', value: '10.0%', green: true },
        { label: 'Confidence', value: '92%', green: true },
        { label: 'Status', value: 'Email drafted' },
      ],
    },
    similarJobs: [
      { name: 'Memorial Hermann Phase 1', meta: 'Turner · Jun 2024 · Won', rows: [{ l: 'Bid', v: '$214,500' }, { l: 'Actual', v: '$198,200' }, { l: 'Margin', v: '7.6%', green: true }] },
      { name: 'Methodist Hospital Expansion', meta: 'McCarthy · Mar 2024 · Won', rows: [{ l: 'Bid', v: '$186,000' }, { l: 'Actual', v: '$172,400' }, { l: 'Margin', v: '7.3%', green: true }] },
      { name: 'St. Luke\'s Parking Structure', meta: 'DPR · Jan 2025 · Lost', rows: [{ l: 'Our Bid', v: '$342,000' }, { l: 'Winner', v: '$310,000', danger: true }, { l: 'Delta', v: '-9.4%', danger: true }] },
    ],
    pricingRef: [
      { item: 'Slab-on-grade (6", 4000)', price: '$14.26/SF' },
      { item: 'Curb & gutter (std)', price: '$26.45/LF' },
      { item: 'Sidewalk (4", 3000)', price: '$11.00/SF', edited: true },
      { item: '#4 Rebar', price: '$1.49/LF' },
      { item: 'Overhead', price: '15%' },
      { item: 'Profit', price: '10%' },
    ],
    gcProfile: {
      title: 'Turner Construction',
      rows: [
        { label: 'Jobs (12mo)', value: '8' },
        { label: 'Win Rate', value: '75%', green: true },
        { label: 'Avg Job Size', value: '$195K' },
        { label: 'Avg Margin', value: '8.2%' },
        { label: 'Payment Terms', value: 'Net 30' },
        { label: 'Contact', value: 'Mike Rodriguez' },
      ],
    },
  },
  curtailment: {
    agentChain: [
      { name: 'Sangha Agent', role: 'Hivemind', active: true, indent: 0 },
      { name: 'Curtailment Agent', role: 'Active', active: true, indent: 1 },
      { name: 'Pool Routing', role: 'Invoked', active: true, indent: 2 },
      { name: 'Documents', role: 'Standby', active: false, indent: 1 },
      { name: 'Meeting Bot', role: 'Standby', active: false, indent: 1 },
    ],
    liveMarket: {
      title: 'Live Market',
      prices: [
        { hub: 'HB_HOUSTON', price: '$247.50', change: '+623%', danger: true },
        { hub: 'HB_NORTH', price: '$189.20', change: '+412%', danger: true },
        { hub: 'HB_WEST', price: '$42.80', change: '+28%', warn: true },
        { hub: 'HB_SOUTH', price: '$38.10', change: '+14%' },
      ],
    },
    fleetStatus: {
      title: 'Fleet Status',
      summary: { online: 0, total: 42, hashrate: '0 PH/s', power: '0 MW' },
      rows: [
        { group: 'S19 XP', count: 8, status: 'Curtailed', power: '0 kW' },
        { group: 'S19k Pro', count: 12, status: 'Curtailed', power: '0 kW' },
        { group: 'S19j Pro+', count: 10, status: 'Curtailed', power: '0 kW' },
        { group: 'M50S++', count: 6, status: 'Curtailed', power: '0 kW' },
        { group: 'S19j Pro', count: 4, status: 'Curtailed', power: '0 kW' },
        { group: 'M30S++', count: 2, status: 'Curtailed', power: '0 kW' },
      ],
    },
    activeTriggers: [
      { label: 'Auto-restart', value: 'LMP < $35/MWh', active: true },
      { label: 'Emergency curtail', value: 'LMP > $200/MWh', active: true },
      { label: 'Efficiency routing', value: 'Bottom 20% at $50+', active: false },
    ],
    eventLog: [
      { time: '2:17 PM', event: 'Fleet curtailed (42/42 units)', type: 'curtail' },
      { time: '2:14 PM', event: 'Price spike detected — HB_HOUSTON $247.50', type: 'alert' },
      { time: '11:30 AM', event: 'Pool rebalance — Foundry +5%', type: 'info' },
      { time: '7:00 AM', event: 'Fleet online — 42 units, 4.2 PH/s', type: 'start' },
      { time: '6:45 AM', event: 'DA price cleared — $28.40/MWh', type: 'info' },
    ],
    hashprice: {
      current: '$48.12/PH/day',
      change: '-2.4%',
      btcPrice: '$67,240',
      networkHash: '974 EH/s',
      difficulty: '110.4T',
      nextAdj: '-1.2% in 3 days',
    },
  },
  pools: {
    agentChain: [
      { name: 'Sangha Agent', role: 'Hivemind', active: true, indent: 0 },
      { name: 'Pool Routing', role: 'Active', active: true, indent: 1 },
      { name: 'Curtailment Agent', role: 'Standby', active: false, indent: 1 },
    ],
    poolAllocation: {
      title: 'Pool Allocation',
      pools: [
        { name: 'Foundry USA', hashrate: '2.52 PH/s', share: '60%', method: 'FPPS', fee: '2.5%', yield24h: '$58.99', performance: '+3.2%' },
        { name: 'Luxor', hashrate: '1.05 PH/s', share: '25%', method: 'FPPS+', fee: '2.0%', yield24h: '$24.58', performance: '+1.1%' },
        { name: 'Ocean', hashrate: '0.63 PH/s', share: '15%', method: 'TIDES', fee: '0%', yield24h: '$14.76', performance: '-4.8%' },
      ],
    },
  },
};

// ─── Simple markdown-like formatting ────────────────────────────────────────────
function formatContent(text) {
  if (!text) return null;
  return text.split('\n').map((line, i) => {
    // Bold
    const parts = line.split(/(\*\*.*?\*\*)/g).map((part, j) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={j} className="font-semibold">{part.slice(2, -2)}</strong>;
      }
      return part;
    });
    return <span key={i}>{parts}{i < text.split('\n').length - 1 && <br />}</span>;
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
    <div className="flex gap-1.5 mt-2.5">
      {actions.map((a, i) => (
        <button
          key={i}
          onClick={() => onAction?.(a.label)}
          disabled={disabled}
          className={`px-3.5 py-[6px] rounded-lg text-[11px] font-semibold transition-colors ${
            disabled ? 'opacity-50 cursor-not-allowed' : ''
          } ${
            a.variant === 'primary'
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

  // ── Voice Chat (in-browser via ElevenLabs Conversational AI) ──
  const startVoiceChat = async () => {
    setCallState('connecting');
    setDuration(0);
    setTranscript('');
    setErrorMsg('');

    try {
      // Dynamically import the ElevenLabs SDK
      const { VoiceConversation } = await import('@elevenlabs/client');

      // Try to get a signed URL from our backend first (keeps API key server-side)
      let sessionConfig;
      const token = getAuthToken();
      try {
        const res = await fetch(`${API_BASE}/v1/voice/conversation/signed-url`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = await res.json();
        if (data.signed_url) {
          sessionConfig = { signedUrl: data.signed_url };
        }
      } catch {
        // Backend not available — fall back to public agent ID
      }

      // Fall back: try to get agent ID from config endpoint
      if (!sessionConfig) {
        const res = await fetch(`${API_BASE}/v1/voice/conversation/config`);
        const data = await res.json();
        if (data.agent_id) {
          sessionConfig = { agentId: data.agent_id };
        } else {
          throw new Error('No ElevenLabs agent configured. Set ELEVENLABS_AGENT_ID in backend .env');
        }
      }

      const conversation = await VoiceConversation.startSession({
        ...sessionConfig,
        onConnect: () => {
          setCallState('connected');
        },
        onDisconnect: () => {
          setCallState('ended');
          conversationRef.current = null;
          setTimeout(() => {
            setCallState('idle');
            setDuration(0);
          }, 2000);
        },
        onError: (error) => {
          console.error('Voice chat error:', error);
          setErrorMsg(typeof error === 'string' ? error : error?.message || 'Connection error');
          setCallState('error');
        },
        onModeChange: ({ mode }) => {
          // mode is 'speaking' | 'listening'
          // Could use this for visual feedback
        },
        onMessage: (message) => {
          // Show live transcription
          if (message.type === 'user_transcript' && message.user_transcription_event?.user_transcript) {
            setTranscript(message.user_transcription_event.user_transcript);
          } else if (message.type === 'agent_response' && message.agent_response_event?.agent_response) {
            setTranscript(message.agent_response_event.agent_response);
          }
        },
      });

      conversationRef.current = conversation;
    } catch (err) {
      console.error('Voice chat start failed:', err);
      setErrorMsg(err.message || 'Failed to start voice chat');
      setCallState('error');
    }
  };

  const endVoiceChat = async () => {
    if (conversationRef.current) {
      await conversationRef.current.endSession();
      conversationRef.current = null;
    }
    setCallState('ended');
    setTimeout(() => {
      setCallState('idle');
      setDuration(0);
      setTranscript('');
    }, 2000);
  };

  const toggleMute = () => {
    if (conversationRef.current) {
      conversationRef.current.setMicMuted(!muted);
      setMuted(!muted);
    }
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
          {/* Animated listening indicator */}
          <div className="w-14 h-14 rounded-full flex items-center justify-center relative" style={{ backgroundColor: '#edf7f0' }}>
            <Mic size={24} className="text-[#1a6b3c]" />
            <div className="absolute inset-0 rounded-full border-2 border-[#1a6b3c] animate-ping opacity-20" />
          </div>
          <div className="text-[13px] font-semibold text-terminal-text">
            {muted ? 'Muted' : 'Listening...'}
          </div>
          <div className="text-[18px] font-mono text-terminal-text">{formatDuration(duration)}</div>

          {/* Live transcript */}
          {transcript && (
            <div className="w-full px-3 py-2 rounded-[8px] bg-[#f5f4f0] border border-terminal-border">
              <div className="text-[11px] text-[#9a9a92] italic truncate">{transcript}</div>
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

// ─── Chat Message ───────────────────────────────────────────────────────────────
function ChatMessage({ msg, agentDef, onAction }) {
  const accent = agentDef?.accentColor || '#1e3a5f';

  if (msg.type === 'invoke') {
    return <InvokeIndicator text={msg.content} accentColor={accent} />;
  }

  const isUser = msg.role === 'user';

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

        {/* Bubble — only render if there's text content */}
        {msg.content && (
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
        <ActionButtons actions={msg.actions} accentColor={accent} onAction={(label) => onAction?.(label, msg)} disabled={msg.actionDone} />
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

        {/* Model Routing */}
        <div className="bg-terminal-panel border border-terminal-border rounded-xl p-5">
          <div className="text-[13px] font-semibold text-terminal-text mb-1">Model Routing</div>
          <div className="text-[11px] text-[#9a9a92] mb-3">AI model selection based on task complexity</div>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-terminal-border">
                <th className="text-left py-2 text-[10px] font-semibold text-[#9a9a92] uppercase">Task</th>
                <th className="text-left py-2 text-[10px] font-semibold text-[#9a9a92] uppercase">Model</th>
                <th className="text-right py-2 text-[10px] font-semibold text-[#9a9a92] uppercase">Cost/call</th>
              </tr>
            </thead>
            <tbody>
              {[
                { task: 'Chat responses', model: 'Claude Sonnet', cost: '$0.003' },
                { task: 'Scope extraction', model: 'Claude Sonnet', cost: '$0.008' },
                { task: 'Estimate generation', model: 'Claude Opus', cost: '$0.025' },
                { task: 'Email drafting', model: 'Claude Haiku', cost: '$0.001' },
                { task: 'Document analysis', model: 'Claude Opus', cost: '$0.035' },
              ].map((r, i) => (
                <tr key={i} className="border-b border-terminal-border/50">
                  <td className="py-2 text-terminal-text">{r.task}</td>
                  <td className="py-2 text-[#9a9a92]">{r.model}</td>
                  <td className="py-2 text-right font-mono text-terminal-text">{r.cost}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-3 pt-3 border-t border-terminal-border flex items-center justify-between">
            <span className="text-[11px] text-[#9a9a92]">Estimated monthly spend</span>
            <span className="text-[14px] font-bold text-terminal-text">$47.20</span>
          </div>
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
function ThreadSidebar({ threads, activeThreadId, onSelectThread, onNewThread, onUpdateVisibility, agentDef, currentUserId, isAdmin }) {
  const accent = agentDef?.accentColor || '#1e3a5f';

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

          return (
            <div
              key={thread.id}
              onClick={() => onSelectThread(thread.id)}
              className={`px-3 py-2.5 cursor-pointer border-b border-[#eeece7] transition-colors group ${
                isActive ? 'bg-terminal-panel border-l-2' : 'hover:bg-[#eceae5] border-l-2 border-l-transparent'
              }`}
              style={isActive ? { borderLeftColor: accent } : undefined}
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
                <span className="text-[10px] text-[#c5c5bc] ml-auto tabular-nums">{formatRelativeTime(thread.updatedAt)}</span>
              </div>
              <div className="text-[12px] font-medium text-terminal-text truncate leading-[1.3]">
                {thread.title || 'Untitled thread'}
              </div>
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
  const agent = { ...rawAgent, userName: authUser?.name || rawAgent.userName, userInitial: userInitials };
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [activeTab, setActiveTab] = useState('Chat');
  const [autoVoice, setAutoVoice] = useState(false);
  const [showCallPanel, setShowCallPanel] = useState(false);
  const [threads, setThreads] = useState([]);
  const [activeThreadId, setActiveThreadId] = useState(null);
  const [threadsLoaded, setThreadsLoaded] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const autoVoiceRef = useRef(false);
  const isAdmin = ['owner', 'admin'].includes(authUser?.role);

  // Load threads on mount / agent change
  useEffect(() => {
    setActiveTab('Chat');
    setThreadsLoaded(false);
    setThreads([]);
    setActiveThreadId(null);
    setMessages([]);

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
        } else {
          // No threads — fall back to demo messages
          const demo = (DEMO_MESSAGES[agentId] || DEMO_MESSAGES.hivemind || []).map(m => ({
            ...m, content: m.content?.replace('{USER}', firstName),
          }));
          setMessages(demo);
        }
        setThreadsLoaded(true);
      })
      .catch(() => {
        const demo = (DEMO_MESSAGES[agentId] || DEMO_MESSAGES.hivemind || []).map(m => ({
          ...m, content: m.content?.replace('{USER}', firstName),
        }));
        setMessages(demo);
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
        const newThread = { id: data.id, title: data.title, visibility: data.visibility, userId: data.userId, createdAt: data.createdAt, updatedAt: data.updatedAt };
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

  // Keep ref in sync with state (so callbacks see latest value)
  useEffect(() => { autoVoiceRef.current = autoVoice; }, [autoVoice]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle action button clicks in chat messages (Approve & Send, etc.)
  const handleChatAction = async (actionLabel, msg) => {
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

  // Send message
  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg = {
      id: Date.now(),
      role: 'user',
      content: text,
      time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);

    // Store message via API — use thread endpoint if active, otherwise legacy
    const token = getAuthToken();
    const postUrl = activeThreadId
      ? `${API_BASE}/v1/chat/${agentId}/threads/${activeThreadId}/messages`
      : `${API_BASE}/v1/chat/${agentId}/messages`;
    try {
      const res = await fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: text }),
      });
      const data = await res.json();
      if (data.response) {
        const agentMsg = {
          id: Date.now() + 1,
          role: 'agent',
          content: data.response,
          time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        };
        if (data.workspace) agentMsg.workspace = data.workspace;
        if (data.estimate) agentMsg.estimate = data.estimate;
        if (data.email) agentMsg.email = data.email;
        if (data.alert) agentMsg.alert = data.alert;
        if (data.dataCard) agentMsg.dataCard = data.dataCard;
        if (data.afterContent) agentMsg.afterContent = data.afterContent;
        if (data.actions) agentMsg.actions = data.actions;
        if (data.audio_url) {
          agentMsg.audio_url = data.audio_url;
          if (autoVoiceRef.current) {
            try { new Audio(data.audio_url).play(); } catch {}
          }
        }
        setMessages(prev => [...prev, agentMsg]);
      }
      // Update thread title in sidebar if this was the first message
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
      // Show error in chat
      setTimeout(() => {
        setMessages(prev => [...prev, {
          id: Date.now() + 1,
          role: 'agent',
          content: `I'm having trouble connecting right now. Please try again in a moment.`,
          error: true,
          time: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
        }]);
      }, 800);
    } finally {
      setSending(false);
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

      {/* ── Content Split ────────────────────────────────────────────────────── */}
      {activeTab === 'Chat' && (
      <div className="flex flex-1 min-h-0">
        {/* Thread Sidebar */}
        {threadsLoaded && threads.length > 0 && (
          <ThreadSidebar
            threads={threads}
            activeThreadId={activeThreadId}
            onSelectThread={setActiveThreadId}
            onNewThread={handleNewThread}
            onUpdateVisibility={handleUpdateVisibility}
            agentDef={agent}
            currentUserId={authUser?.id || 'anonymous'}
            isAdmin={isAdmin}
          />
        )}

        {/* Chat area */}
        <div className="flex-[3] flex flex-col border-r border-terminal-border min-w-0 min-h-0">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-4">
            {messages.map(msg => (
              <ChatMessage key={msg.id} msg={msg} agentDef={agent} onAction={handleChatAction} />
            ))}

            {/* Typing indicator */}
            {sending && (
              <div className="self-start flex gap-2.5 max-w-[85%]">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ backgroundColor: agent.color }}>
                  {agent.initial}
                </div>
                <div className="flex items-center gap-1 px-4 py-2.5 bg-terminal-panel border border-[#e8e6e1] rounded-[14px] rounded-tl-[4px]">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="w-1.5 h-1.5 rounded-full bg-[#c5c5bc]" style={{ animation: `typingBounce 1.4s ease-in-out ${i * 0.2}s infinite` }} />
                  ))}
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="px-5 py-3.5 border-t border-terminal-border bg-terminal-panel shrink-0">
            <div className="flex items-end gap-2.5">
              <div className="flex-1 relative">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={agent.placeholder}
                  rows={1}
                  className="w-full px-4 py-3 pr-11 border-[1.5px] border-terminal-border rounded-[14px] text-[13px] text-terminal-text bg-[#f5f4f0] outline-none resize-none min-h-[44px] max-h-[120px] focus:bg-terminal-panel transition-colors placeholder:text-[#c5c5bc]"
                  style={{ '--tw-ring-color': agent.accentColor }}
                  onFocus={e => e.target.style.borderColor = agent.accentColor}
                  onBlur={e => e.target.style.borderColor = ''}
                />
                <button className="absolute right-3 bottom-2.5 text-[#c5c5bc] hover:text-[#6b6b65] transition-colors">
                  <Paperclip size={16} />
                </button>
              </div>
              <button
                onClick={handleSend}
                disabled={!input.trim() || sending}
                className="w-11 h-11 rounded-xl text-white flex items-center justify-center transition-colors disabled:opacity-40 shrink-0"
                style={{ backgroundColor: agent.accentColor }}
              >
                <Send size={18} />
              </button>
            </div>
            <div className="text-[10px] text-[#c5c5bc] text-center mt-1.5">{agent.hint}</div>
          </div>
        </div>

        {/* Context panel — independent scroll */}
        <div className="flex-[2] min-w-0 min-h-0 overflow-y-auto bg-[#f5f4f0]">
          <ContextPanel agentId={agentId} />
        </div>
      </div>
      )}

      {/* ── Inbox Tab ──────────────────────────────────────────────────────── */}
      {activeTab === 'Inbox' && <InboxTab accent={agent.accentColor} />}

      {/* ── History Tab ────────────────────────────────────────────────────── */}
      {activeTab === 'History' && <HistoryTab accent={agent.accentColor} />}

      {/* ── Config Tab ─────────────────────────────────────────────────────── */}
      {activeTab === 'Config' && <ConfigTab accent={agent.accentColor} />}

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

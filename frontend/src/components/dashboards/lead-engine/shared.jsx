import React from 'react';

export const STAGE_CLS = {
  new: 'bg-[#f5f4f0] text-[#9a9a92]',
  enriched: 'bg-[#f0f0ff] text-[#6366f1]',
  contacted: 'bg-[#eff6ff] text-[#2563eb]',
  responded: 'bg-[#fdf6e8] text-[#b8860b]',
  meeting: 'bg-[#edf7f0] text-[#1a6b3c]',
  qualified: 'bg-[#f3f0ff] text-[#7c3aed]',
  closed: 'bg-[#edf7f0] text-[#1a6b3c]',
  declined: 'bg-[#fef2f2] text-[#c0392b]',
};

export const OUTREACH_STATUS_CLS = {
  draft: 'bg-[#f5f4f0] text-[#9a9a92]',
  pending_approval: 'bg-[#fdf6e8] text-[#b8860b]',
  approved: 'bg-[#eff6ff] text-[#2563eb]',
  sent: 'bg-[#edf7f0] text-[#1a6b3c]',
  bounced: 'bg-[#fef2f2] text-[#c0392b]',
  responded: 'bg-[#f3f0ff] text-[#7c3aed]',
};

export const SUB_CLS = { green: 'text-[#1a6b3c]', warn: 'text-[#b8860b]', danger: 'text-[#c0392b]', flat: 'text-terminal-muted' };

export function Card({ title, meta, children }) {
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

export function KVRow({ label, value, cls = '' }) {
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

export function timeAgo(dateStr) {
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

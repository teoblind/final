import React, { useState } from 'react';

// ─── Shared Modal Shell ─────────────────────────────────────────────────────

function ModalShell({ title, subtitle, children, footer, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />
      <div
        className="relative bg-white border border-[#e8e6e1] rounded-[20px] max-w-[560px] w-full shadow-[0_24px_80px_rgba(0,0,0,0.12)] max-h-[90vh] flex flex-col animate-[modalIn_0.2s_ease-out]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-5 border-b border-[#f0eeea] flex items-center justify-between shrink-0">
          <div>
            <div className="text-[16px] font-bold text-[#111110]">{title}</div>
            {subtitle && <div className="text-[12px] text-[#9a9a92] mt-0.5">{subtitle}</div>}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg border border-[#e8e6e1] bg-white flex items-center justify-center text-[14px] text-[#9a9a92] hover:text-[#333] hover:border-[#ccc] transition-colors"
          >
            &#x2715;
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 overflow-y-auto flex-1">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="px-6 py-4 border-t border-[#f0eeea] flex gap-2 justify-end shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

function Btn({ variant = 'secondary', children, onClick, disabled }) {
  const base = 'px-5 py-[9px] rounded-[10px] text-[13px] font-semibold border-none cursor-pointer font-[Instrument_Sans,sans-serif] transition-opacity disabled:opacity-50';
  const styles = {
    primary: `${base} bg-[#1e3a5f] text-white hover:opacity-90`,
    green: `${base} bg-[#1a6b3c] text-white hover:opacity-90`,
    danger: `${base} bg-[#c0392b] text-white hover:opacity-90`,
    secondary: `${base} bg-[#f5f4f0] text-[#6b6b65] border border-[#e8e6e1]`,
  };
  return <button className={styles[variant] || styles.secondary} onClick={onClick} disabled={disabled}>{children}</button>;
}

// ─── Modal 1: Price Update ──────────────────────────────────────────────────

function PriceUpdateModal({ onClose, onAction }) {
  const prices = [
    { material: '3000 PSI Ready-Mix', current: '$142/CY', next: '$149/CY', change: '+4.9%' },
    { material: '4000 PSI Ready-Mix', current: '$149/CY', next: '$158/CY', change: '+6.0%' },
    { material: '5000 PSI Ready-Mix', current: '$163/CY', next: '$172/CY', change: '+5.5%' },
  ];
  const affected = [
    { name: 'Bishop Arts Mixed-Use', gc: 'Rogers-O\'Brien', status: 'Pending', impact: '+$4,200' },
    { name: 'I-35 Retaining Walls', gc: 'Hensel Phelps', status: 'Pending', impact: '+$1,800' },
    { name: 'McKinney Town Center', gc: 'Austin Commercial', status: 'Draft', impact: 'TBD' },
  ];

  return (
    <ModalShell
      title="Update Pricing Table"
      subtitle="TXI price increase effective March 1, 2026"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={() => onAction('update_prices')}>Update All Prices</Btn>
        </>
      }
    >
      <Table
        headers={['Material', 'Current', 'New', 'Change']}
        rows={prices.map((p) => [
          p.material,
          <span className="font-mono text-[11px]">{p.current}</span>,
          <span className="font-mono text-[11px]">{p.next}</span>,
          <span className="font-mono text-[11px] text-[#c0392b] font-semibold">{p.change}</span>,
        ])}
      />

      <ImpactBar variant="warning">
        <strong>3 active estimates</strong> use the old pricing and may need recalculation.
      </ImpactBar>

      <Table
        headers={['Estimate', 'GC', 'Status', 'Impact']}
        rows={affected.map((a) => [
          a.name,
          a.gc,
          <StatusBadge status={a.status} />,
          <span className={`font-mono text-[11px] font-semibold ${a.impact === 'TBD' ? 'text-[#b8860b]' : 'text-[#c0392b]'}`}>{a.impact}</span>,
        ])}
      />
    </ModalShell>
  );
}

// ─── Modal 2: Labor Detail ──────────────────────────────────────────────────

function LaborDetailModal({ onClose, onAction }) {
  const rows = [
    { item: 'Concrete (CY)', est: '780', actual: '312', pct: '40%', variance: 'On track', cls: 'pos' },
    { item: 'Labor Hours', est: '1,200', actual: '510', pct: '43%', variance: '1.3x projected', cls: 'warn', highlight: true },
    { item: 'Rebar #4 (LF)', est: '2,000', actual: '2,400', pct: '120%', variance: '+18% over', cls: 'neg' },
    { item: 'Wire Mesh (SF)', est: '11,000', actual: '4,200', pct: '38%', variance: 'On track', cls: 'pos' },
    { item: 'Mobilization', est: '$3,500', actual: '$3,500', pct: '100%', variance: 'Complete', cls: '' },
  ];
  const varCls = { pos: 'text-[#1a6b3c]', warn: 'text-[#b8860b]', neg: 'text-[#c0392b]' };

  return (
    <ModalShell
      title="Job Cost Detail — Westpark Retail"
      subtitle="McCarthy Building · 40% complete · J-009"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={() => onAction('acknowledge')}>Acknowledge</Btn>
          <Btn variant="primary" onClick={() => onAction('view_full_job')}>View Full Job</Btn>
        </>
      }
    >
      {/* Stat Cards */}
      <div className="flex gap-3 mb-4">
        <StatCard value="$412K" label="Total Budget" color="text-[#1e3a5f]" />
        <StatCard value="$225.6K" label="Spent to Date" color="text-[#b8860b]" />
        <StatCard value="40%" label="Complete" />
      </div>

      {/* Table */}
      <table className="w-full border-collapse text-[12px] my-3">
        <thead>
          <tr>
            {['Item', 'Estimated', 'Actual', '% Used', 'Variance'].map((h) => (
              <th key={h} className="text-left px-2.5 py-2 bg-[#f5f4f0] border-b border-[#e8e6e1] font-bold text-[#6b6b65] text-[10px] uppercase tracking-[0.5px]">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.item} className={r.highlight ? 'bg-[#fdf6e8]' : ''}>
              <td className="px-2.5 py-2 border-b border-[#f0eeea]">{r.highlight ? <strong>{r.item}</strong> : r.item}</td>
              <td className="px-2.5 py-2 border-b border-[#f0eeea] font-mono text-[11px]">{r.est}</td>
              <td className="px-2.5 py-2 border-b border-[#f0eeea] font-mono text-[11px]">{r.actual}</td>
              <td className="px-2.5 py-2 border-b border-[#f0eeea] font-mono text-[11px]">{r.pct}</td>
              <td className={`px-2.5 py-2 border-b border-[#f0eeea] font-semibold ${varCls[r.cls] || ''}`}>{r.variance}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <ImpactBar variant="warning">
        If labor trend continues at 1.3x through completion: <strong>+$12,000 projected overrun</strong>
      </ImpactBar>

      <div className="text-[12px] text-[#9a9a92] leading-[1.5] mt-3 p-[10px_14px] bg-[#f5f4f0] rounded-lg border border-[#f0eeea]">
        Labor trending 1.3x started after slab section B (Mar 4). Possible causes: crew unfamiliarity with post-tension layout, weather delays compressing schedule, or foreman under-reporting on prior sections.
      </div>
    </ModalShell>
  );
}

// ─── Modal 3: Deadline Calendar ─────────────────────────────────────────────

function DeadlineCalendarModal({ onClose, onAction }) {
  const deadlines = [
    { name: 'Memorial Hermann Phase 2', gc: 'Turner Construction · Mike Rodriguez · Due Mar 14', days: 5, badge: 'Sent' },
    { name: 'Bishop Arts Mixed-Use', gc: 'Rogers-O\'Brien · David Kim · Due Mar 19', days: 10, badge: 'Estimated' },
    { name: 'I-35 Retaining Walls', gc: 'Hensel Phelps · Lisa Chen · Due Mar 21', days: 12, badge: 'Estimated' },
    { name: 'McKinney Town Center', gc: 'Austin Commercial · Due Mar 25', days: 16, badge: 'Parsing' },
  ];

  const daysColor = (d) => d <= 3 ? 'red' : d <= 7 ? 'amber' : 'green';
  const colorMap = {
    red: 'bg-[#fbeae8] text-[#c0392b]',
    amber: 'bg-[#fdf6e8] text-[#b8860b]',
    green: 'bg-[#edf7f0] text-[#1a6b3c]',
  };
  const badgeMap = {
    Sent: 'bg-[#eef3f9] text-[#1e3a5f]',
    Estimated: 'bg-[#edf7f0] text-[#1a6b3c]',
    Parsing: 'bg-[#fdf6e8] text-[#b8860b]',
    Draft: 'bg-[#eef3f9] text-[#1e3a5f]',
    'Not Started': 'bg-[#f5f4f0] text-[#9a9a92]',
  };

  return (
    <ModalShell
      title="Upcoming Bid Deadlines"
      subtitle="3 bids due in the next 14 days"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Close</Btn>
          <Btn variant="primary" onClick={() => onAction('go_to_estimating')}>Go to Estimating Inbox</Btn>
        </>
      }
    >
      <div className="space-y-0">
        {deadlines.map((d) => {
          const c = daysColor(d.days);
          return (
            <div key={d.name} className="flex items-center py-3 border-b border-[#f0eeea] last:border-b-0 gap-3 cursor-pointer hover:bg-[#f5f4f0] -mx-1 px-1 rounded-lg transition-colors" onClick={() => onAction('select_bid', d.name)}>
              <div className={`w-12 h-12 rounded-xl flex flex-col items-center justify-center shrink-0 ${colorMap[c]}`}>
                <span className="font-mono text-[18px] font-bold leading-none">{d.days}</span>
                <span className="text-[8px] font-bold uppercase tracking-[0.5px]">days</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold text-[#111110]">{d.name}</div>
                <div className="text-[11px] text-[#9a9a92]">{d.gc}</div>
              </div>
              <span className={`text-[9px] font-bold py-[3px] px-2 rounded-[5px] uppercase tracking-[0.3px] ${badgeMap[d.badge] || 'bg-[#f5f4f0] text-[#9a9a92]'}`}>
                {d.badge}
              </span>
            </div>
          );
        })}
      </div>

      <ImpactBar variant="success">
        2 of 3 upcoming bids are already estimated. McKinney is still being parsed (3 of 8 items extracted).
      </ImpactBar>
    </ModalShell>
  );
}

// ─── Modal 4: Win Rate Analysis ─────────────────────────────────────────────

function WinRateAnalysisModal({ onClose, onAction }) {
  const jobs = [
    { project: 'Memorial Hermann Ph1', gc: 'Turner', bid: '$214,500', margin: '7.6%', result: 'Won' },
    { project: 'Methodist Hospital', gc: 'McCarthy', bid: '$186,000', margin: '7.3%', result: 'Won' },
    { project: 'Cypress Creek Elem', gc: 'Rogers-O\'Brien', bid: '$328,000', margin: '6.8%', result: 'Won' },
    { project: 'Galleria Retail', gc: 'Turner', bid: '$198,000', margin: '4.3%', result: 'Won' },
    { project: 'TMC Building 7', gc: 'DPR', bid: '$445,000', margin: '3.1%', result: 'Won' },
    { project: 'Westchase Office Tower', gc: 'Skanska', bid: '$892,000', margin: '\u2014', result: 'Lost' },
    { project: 'Legacy West Tower', gc: 'Hensel Phelps', bid: '$624,000', margin: '\u2014', result: 'Lost' },
  ];

  return (
    <ModalShell
      title="Win Rate Analysis — Foundation Work"
      subtitle="Based on 48 historical estimates"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={() => onAction('dismiss')}>Dismiss</Btn>
          <Btn variant="green" onClick={() => onAction('update_lead_engine')}>Update Lead Engine Targeting</Btn>
        </>
      }
    >
      <div className="flex gap-3 mb-4">
        <StatCard value="62%" label="Foundation Bids" color="text-[#1a6b3c]" highlight />
        <StatCard value="38%" label="All Bids Overall" color="text-[#6b6b65]" />
        <StatCard value="7.1%" label="Avg Margin (Foundation)" color="text-[#1a6b3c]" />
      </div>

      <Table
        headers={['Project', 'GC', 'Bid', 'Margin', 'Result']}
        rows={jobs.map((j) => [
          j.project,
          j.gc,
          <span className="font-mono text-[11px]">{j.bid}</span>,
          <span className="font-mono text-[11px]">{j.margin}</span>,
          <span className={`font-semibold ${j.result === 'Won' ? 'text-[#1a6b3c]' : 'text-[#c0392b]'}`}>{j.result}</span>,
        ])}
      />

      <ImpactBar variant="success">
        Targeting foundation-specific RFQs could increase overall win rate by <strong>8-12%</strong>. Consider adding foundation keywords to Lead Engine search queries.
      </ImpactBar>
    </ModalShell>
  );
}

// ─── Modal 5: Send Reminder ─────────────────────────────────────────────────

function SendReminderModal({ onClose, onAction }) {
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState(false);
  const [emailBody, setEmailBody] = useState(
    `Hi,\n\nFollowing up on our request from March 5 for updated boring logs for the pier P-5 area at Frisco Station (Job J-002).\n\nOur crew encountered rock at 28' which differs significantly from the original geotech report indication of 35'+. We need updated boring data for this area to:\n\n1. Finalize our change order documentation for DPR Construction\n2. Assess whether adjacent piers (P-3, P-4, P-6) may encounter similar conditions\n\nCould you provide the updated data by end of this week? The cost impact is currently estimated at $8,000 and growing with each pier drilled without updated information.\n\nThank you,\nDACP Construction\ncoppice@dacpconstruction.com`
  );

  const handleSend = async () => {
    setSending(true);
    await onAction('send_reminder');
  };

  return (
    <ModalShell
      title="Send Follow-up Reminder"
      subtitle="Geotech report — Frisco Station pier P-5"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={() => setEditing(!editing)}>{editing ? 'Preview' : 'Edit'}</Btn>
          <Btn variant="primary" onClick={handleSend} disabled={sending}>{sending ? 'Sending...' : 'Send Reminder'}</Btn>
        </>
      }
    >
      <div className="bg-[#f5f4f0] border border-[#f0eeea] rounded-xl overflow-hidden">
        <div className="px-4 py-2 text-[12px] text-[#6b6b65] border-b border-[#f0eeea]">
          <strong className="text-[#111110]">To:</strong> geotech@texasgeoservices.com
        </div>
        <div className="px-4 py-2 text-[12px] text-[#6b6b65] border-b border-[#f0eeea]">
          <strong className="text-[#111110]">Subject:</strong> Follow-up: Updated Boring Logs — Frisco Station Pier P-5
        </div>
        {editing ? (
          <textarea
            value={emailBody}
            onChange={(e) => setEmailBody(e.target.value)}
            className="w-full px-4 py-4 text-[13px] text-[#333330] leading-[1.7] bg-white border-none outline-none resize-y min-h-[200px] font-[Instrument_Sans,sans-serif]"
          />
        ) : (
          <div className="px-4 py-4 text-[13px] text-[#333330] leading-[1.7] whitespace-pre-line">
            {emailBody}
          </div>
        )}
      </div>

      <div className="text-[12px] text-[#9a9a92] leading-[1.5] mt-3 p-[10px_14px] bg-[#f5f4f0] rounded-lg border border-[#f0eeea]">
        This email will be sent from agent@zhan.coppice.ai. Logged to audit trail.
      </div>
    </ModalShell>
  );
}

// ─── Shared Sub-Components ──────────────────────────────────────────────────

function Table({ headers, rows }) {
  return (
    <table className="w-full border-collapse text-[12px] my-3">
      <thead>
        <tr>
          {headers.map((h) => (
            <th key={h} className="text-left px-2.5 py-2 bg-[#f5f4f0] border-b border-[#e8e6e1] font-bold text-[#6b6b65] text-[10px] uppercase tracking-[0.5px]">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i}>
            {row.map((cell, j) => (
              <td key={j} className="px-2.5 py-2 border-b border-[#f0eeea]">{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function StatCard({ value, label, color = 'text-[#111110]', highlight }) {
  return (
    <div className={`flex-1 bg-[#f5f4f0] border rounded-xl p-3.5 text-center ${highlight ? 'border-[rgba(26,107,60,0.2)] border-[1.5px]' : 'border-[#f0eeea]'}`}>
      <div className={`font-mono text-[28px] font-bold leading-none ${color}`}>{value}</div>
      <div className="text-[11px] text-[#9a9a92] mt-1">{label}</div>
    </div>
  );
}

function StatusBadge({ status }) {
  const styles = {
    Pending: 'bg-[#fdf6e8] text-[#b8860b]',
    Draft: 'bg-[#eef3f9] text-[#1e3a5f]',
    Estimated: 'bg-[#edf7f0] text-[#1a6b3c]',
    Sent: 'bg-[#eef3f9] text-[#1e3a5f]',
  };
  return (
    <span className={`text-[9px] font-bold py-[3px] px-2 rounded-[5px] uppercase tracking-[0.3px] ${styles[status] || 'bg-[#f5f4f0] text-[#9a9a92]'}`}>
      {status}
    </span>
  );
}

function ImpactBar({ variant, children }) {
  const styles = {
    warning: 'bg-[#fdf6e8] text-[#b8860b]',
    success: 'bg-[#edf7f0] text-[#1a6b3c]',
  };
  const icons = { warning: '\u26A0\uFE0F', success: '\uD83D\uDCA1' };
  return (
    <div className={`my-3 p-3 px-4 rounded-[10px] text-[13px] flex items-start gap-2 ${styles[variant]}`}>
      <span className="text-[16px] leading-none shrink-0 mt-px">{icons[variant]}</span>
      <span>{children}</span>
    </div>
  );
}

// ─── Main Export ─────────────────────────────────────────────────────────────

export default function InsightModal({ insight, onClose, onAction }) {
  if (!insight) return null;

  const MODAL_MAP = {
    'Update Prices': PriceUpdateModal,
    'View Details': LaborDetailModal,
    'View Calendar': DeadlineCalendarModal,
    'View Analysis': WinRateAnalysisModal,
    'Send Reminder': SendReminderModal,
  };

  const Component = MODAL_MAP[insight.action];
  if (!Component) return null;

  return <Component insight={insight} onClose={onClose} onAction={onAction} />;
}

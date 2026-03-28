import React, { useState } from 'react';
import { useApi, postApi } from '../../../hooks/useApi';
import { Card, OUTREACH_STATUS_CLS, SUB_CLS, timeAgo } from './shared';

export default function OutreachTab() {
  const [selectedOutreachId, setSelectedOutreachId] = useState(null);

  const { data: statsData } = useApi('/lead-engine/stats', { refreshInterval: 30000 });
  const { data: outreachData, refetch: refetchOutreach } = useApi('/lead-engine/outreach', { refreshInterval: 30000 });
  const { data: repliesData } = useApi('/lead-engine/replies', { refreshInterval: 30000 });
  const { data: followupsData } = useApi('/lead-engine/followups', { refreshInterval: 30000 });
  const { data: leadsData } = useApi('/lead-engine/leads', { refreshInterval: 30000 });

  const stats = statsData || {};
  const outreach = outreachData?.outreach || [];
  const replies = repliesData?.replies || [];
  const followups = followupsData?.followups || [];
  const leads = leadsData?.leads || [];

  const selectedEmail = outreach.find(o => o.id === selectedOutreachId) || replies.find(r => r.id === selectedOutreachId);

  const handleApprove = async (outreachId) => {
    try {
      await postApi(`/lead-engine/outreach/${outreachId}/approve`);
      refetchOutreach();
    } catch (err) {
      console.error('Approve failed:', err);
    }
  };

  // Compute geographic breakdown from leads
  const geoMap = {};
  leads.forEach(l => {
    const r = l.region || 'Unknown';
    geoMap[r] = (geoMap[r] || 0) + 1;
  });
  const geoEntries = Object.entries(geoMap).sort((a, b) => b[1] - a[1]);
  const geoMax = geoEntries.length > 0 ? geoEntries[0][1] : 1;

  const STAT_CELLS = [
    { label: 'Leads Discovered', val: stats.totalLeads || 0, sub: stats.newLeads ? `+${stats.newLeads} new` : null, subCls: 'green', highlight: true },
    { label: 'Emails Sent', val: stats.totalEmailsSent || 0, sub: stats.sentToday ? `+${stats.sentToday} today` : null, subCls: 'green' },
    { label: 'Reply Rate', val: stats.responseRate || 0, unit: '%', sub: (stats.responseRate || 0) >= 5 ? 'Above industry avg' : null, subCls: 'green' },
    { label: 'Replies', val: stats.totalResponded || 0, sub: null, subCls: 'flat' },
    { label: 'Meetings Booked', val: stats.meetingLeads || 0, sub: 'From outreach', subCls: 'flat' },
    { label: 'Pending Drafts', val: stats.pendingDrafts || 0, sub: (stats.pendingDrafts || 0) > 0 ? 'Needs review' : 'All clear', subCls: (stats.pendingDrafts || 0) > 0 ? 'warn' : 'green' },
  ];

  return (
    <div className="p-6 lg:px-7 lg:py-6">
      {/* Stats ticker */}
      <div className="flex gap-[1px] bg-terminal-border border border-terminal-border rounded-[14px] overflow-hidden mb-4">
        {STAT_CELLS.map((s, i) => (
          <div key={i} className="bg-terminal-panel p-[14px_18px] flex-1" style={s.highlight ? { background: 'linear-gradient(135deg, var(--t-panel, #fff), var(--t-ui-accent-bg))' } : undefined}>
            <div className="text-[9px] font-bold text-terminal-muted uppercase tracking-[1px] mb-[3px]">{s.label}</div>
            <div className="text-xl font-bold tabular-nums font-mono leading-none text-terminal-text">
              {s.val}{s.unit && <span className="text-[11px] font-medium text-terminal-muted">{s.unit}</span>}
            </div>
            {s.sub && <div className={`text-[10px] font-semibold mt-[3px] ${SUB_CLS[s.subCls]}`}>{s.sub}</div>}
          </div>
        ))}
      </div>

      {/* Outreach Log + Email Viewer */}
      <div className="grid grid-cols-1 lg:grid-cols-[5fr_3fr] gap-4 mb-4">
        <Card title="Outreach Log" meta={`${outreach.length} emails`}>
          <div className="grid px-[18px] py-[10px] text-[10px] font-bold text-terminal-muted uppercase tracking-[0.8px] border-b border-terminal-border" style={{ gridTemplateColumns: '2fr 1.5fr 1fr 1fr 100px' }}>
            <div>Contact</div><div>Subject</div><div>Type</div><div>Status</div><div>Date</div>
          </div>
          {outreach.length === 0 && (
            <div className="px-[18px] py-6 text-center text-sm text-terminal-muted">No outreach yet</div>
          )}
          {outreach.slice(0, 20).map((o, i) => (
            <div key={i} onClick={() => setSelectedOutreachId(o.id)} className={`grid px-[18px] py-[11px] border-b border-[#f0eeea] last:border-b-0 items-center text-[13px] hover:bg-[#f5f4f0] transition-colors cursor-pointer ${selectedOutreachId === o.id ? 'bg-ui-accent-light' : ''}`} style={{ gridTemplateColumns: '2fr 1.5fr 1fr 1fr 100px' }}>
              <div>
                <div className="font-semibold text-terminal-text">{o.contact_name || '-'}</div>
                <div className="text-[11px] text-[#9a9a92]">{o.venue_name}</div>
              </div>
              <div className="text-xs text-[#6b6b65] truncate">{o.subject || '-'}</div>
              <div className="text-xs text-[#6b6b65]">{o.email_type === 'initial' ? 'Initial' : o.email_type?.replace('_', ' ')}</div>
              <div>
                <span className={`text-[10px] font-semibold px-[9px] py-[3px] rounded-md uppercase ${OUTREACH_STATUS_CLS[o.status] || ''}`}>{o.status}</span>
              </div>
              <div className="font-mono text-[11px] text-[#9a9a92]">{o.sent_at ? new Date(o.sent_at).toLocaleDateString() : timeAgo(o.created_at)}</div>
            </div>
          ))}
        </Card>

        {/* Email Viewer */}
        <Card title={selectedEmail ? `Email - ${selectedEmail.contact_name || selectedEmail.venue_name}` : 'Email Viewer'} meta={selectedEmail ? selectedEmail.status : null}>
          <div className="p-[18px]">
            {!selectedEmail && (
              <div className="text-center py-8 text-sm text-terminal-muted">Select an email to view</div>
            )}
            {selectedEmail && (
              <div className={`border rounded-[10px] p-[14px_16px] ${selectedEmail.status === 'sent' ? 'border-[#f0eeea] border-l-[3px] border-l-ui-accent bg-terminal-panel' : selectedEmail.status === 'draft' ? 'border-dashed border-[#c5c5bc] border-l-[3px] border-l-[#c5c5bc] bg-[#f5f4f0]' : 'border-[#f0eeea]'}`}>
                <div className="flex items-center justify-between mb-[2px]">
                  <div className="text-xs font-semibold text-terminal-text">
                    {selectedEmail.status === 'draft' ? 'Draft - Pending Approval' : `To: ${selectedEmail.contact_name || selectedEmail.contact_email}`}
                  </div>
                  <span className={`text-[9px] font-semibold px-2 py-0.5 rounded-md uppercase ${OUTREACH_STATUS_CLS[selectedEmail.status] || ''}`}>{selectedEmail.status}</span>
                </div>
                <div className="text-[10px] text-[#9a9a92] mb-2">
                  {selectedEmail.email_type === 'initial' ? 'Initial outreach' : selectedEmail.email_type?.replace('_', ' ')}
                  {selectedEmail.sent_at && ` · Sent ${new Date(selectedEmail.sent_at).toLocaleDateString()}`}
                  {selectedEmail.responded_at && ` · Reply ${timeAgo(selectedEmail.responded_at)}`}
                </div>
                <div className="text-xs font-semibold text-terminal-text mb-1">{selectedEmail.subject}</div>
                <div className="text-[13px] text-terminal-text leading-relaxed whitespace-pre-line">{selectedEmail.body}</div>
                {selectedEmail.status === 'draft' && (
                  <div className="flex gap-2 mt-[10px]">
                    <button onClick={() => handleApprove(selectedEmail.id)} className="text-[11px] font-semibold px-[14px] py-[5px] rounded-lg bg-ui-accent text-white border border-ui-accent hover:opacity-90 transition-colors">Approve & Send</button>
                    <button className="text-[11px] font-semibold px-[14px] py-[5px] rounded-lg bg-terminal-panel text-[#6b6b65] border border-terminal-border hover:bg-[#f5f4f0] transition-colors">Edit Draft</button>
                    <button className="text-[11px] font-semibold px-[14px] py-[5px] rounded-lg bg-terminal-panel text-[#6b6b65] border border-terminal-border hover:bg-[#f5f4f0] transition-colors">Dismiss</button>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Reply Inbox + Follow-ups + Geography */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Reply Inbox */}
        <Card title="Reply Inbox" meta={`${replies.length} replies`}>
          <div>
            {replies.length === 0 && (
              <div className="px-[18px] py-6 text-center text-sm text-terminal-muted">No replies yet</div>
            )}
            {replies.map((r, i) => (
              <div key={i} onClick={() => setSelectedOutreachId(r.id)} className="flex items-start gap-3 px-[18px] py-[14px] border-b border-[#f0eeea] last:border-b-0 cursor-pointer transition-colors hover:bg-[#f5f4f0]">
                <div className="w-2 h-2 rounded-full shrink-0 mt-[5px] bg-[#b8860b]" />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-terminal-text">{r.contact_name}</div>
                  <div className="text-[11px] text-[#9a9a92]">{r.venue_name}</div>
                  <div className="text-xs text-[#6b6b65] mt-1 leading-[1.5] line-clamp-2">{r.subject}</div>
                </div>
                <div className="font-mono text-[10px] text-[#c5c5bc] shrink-0 mt-[2px]">{timeAgo(r.responded_at)}</div>
              </div>
            ))}
          </div>
        </Card>

        {/* Follow-Up Queue */}
        <Card title="Follow-Up Queue" meta={`${followups.length} overdue`}>
          <div>
            {followups.length === 0 && (
              <div className="px-[18px] py-6 text-center text-sm text-terminal-muted">No follow-ups due</div>
            )}
            {followups.map((fu, i) => (
              <div key={i} className="grid items-center px-[18px] py-[11px] border-b border-[#f0eeea] last:border-b-0 text-[13px] hover:bg-[#f5f4f0] transition-colors" style={{ gridTemplateColumns: '2.5fr 1.5fr 1fr' }}>
                <div>
                  <div className="font-semibold text-terminal-text">{fu.contact_name || '-'}</div>
                  <div className="text-[11px] text-[#9a9a92]">{fu.venue_name}</div>
                </div>
                <div className="text-xs text-[#6b6b65]">{fu.email_type === 'initial' ? 'Initial outreach' : fu.email_type?.replace('_', ' ')}</div>
                <div className={`font-mono text-xs font-semibold ${fu.days_since_sent >= 7 ? 'text-[#c0392b]' : fu.days_since_sent >= 5 ? 'text-[#b8860b]' : 'text-[#9a9a92]'}`}>{fu.days_since_sent}d ago</div>
              </div>
            ))}
          </div>
        </Card>

        {/* Geographic Breakdown */}
        <Card title="Target Geography" meta="Leads by region">
          <div className="py-3">
            {geoEntries.length === 0 && (
              <div className="px-[18px] py-6 text-center text-sm text-terminal-muted">No lead data</div>
            )}
            {geoEntries.map(([region, count], i) => (
              <div key={i} className="flex items-center gap-3 px-[18px] py-[10px] border-b border-[#f0eeea] last:border-b-0">
                <div className="text-[13px] font-medium text-terminal-text w-[80px] shrink-0">{region}</div>
                <div className="flex-1 h-2 bg-[#f5f4f0] rounded overflow-hidden">
                  <div className="h-full rounded bg-ui-accent" style={{ width: `${(count / geoMax) * 100}%` }} />
                </div>
                <div className="font-mono text-xs font-semibold text-terminal-text min-w-[30px] text-right">{count}</div>
                <div className="font-mono text-[11px] text-[#9a9a92] min-w-[36px] text-right">{leads.length > 0 ? `${((count / leads.length) * 100).toFixed(1)}%` : '-'}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

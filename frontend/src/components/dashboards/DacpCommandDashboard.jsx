import React, { useState, useEffect } from 'react';
import { Calendar, ClipboardList, DollarSign, HardHat, TrendingUp } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

function getAuthHeaders() {
  try {
    const session = JSON.parse(sessionStorage.getItem('sangha_auth'));
    if (session?.tokens?.accessToken) return { Authorization: `Bearer ${session.tokens.accessToken}` };
  } catch {}
  const legacy = localStorage.getItem('auth_token');
  if (legacy) return { Authorization: `Bearer ${legacy}` };
  return {};
}

const DELTA_COLORS = {
  up: 'text-[#1e3a5f]',
  warn: 'text-terminal-amber',
  flat: 'text-terminal-muted',
};

const URGENCY_BADGE = {
  high: 'bg-red-50 text-terminal-red border-red-200',
  medium: 'bg-amber-50 text-terminal-amber border-amber-200',
  low: 'bg-gray-50 text-terminal-muted border-gray-200',
};

export default function DacpCommandDashboard({ onNavigate }) {
  const [stats, setStats] = useState(null);
  const [bids, setBids] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const headers = getAuthHeaders();
    Promise.all([
      fetch(`${API_BASE}/v1/estimates/stats`, { headers }).then(r => r.json()).catch(() => ({})),
      fetch(`${API_BASE}/v1/estimates/inbox`, { headers }).then(r => r.json()).catch(() => ({})),
      fetch(`${API_BASE}/v1/meetings?range=week`, { headers }).then(r => r.json()).catch(() => ({})),
    ]).then(([statsRes, inboxRes, meetingsRes]) => {
      setStats(statsRes.stats || null);
      setBids(inboxRes.bidRequests || []);
      setMeetings(meetingsRes.meetings || []);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const metrics = stats ? [
    { label: 'Open RFQs', value: stats.openRfqs, delta: `${stats.totalBidRequests} total`, type: 'up', bar: Math.min((stats.openRfqs / Math.max(stats.totalBidRequests, 1)) * 100, 100), icon: ClipboardList },
    { label: 'Active Bids', value: stats.totalEstimates, delta: `${stats.draftEstimates} draft`, type: 'up', bar: Math.min((stats.totalEstimates / Math.max(stats.totalBidRequests, 1)) * 100, 100), icon: TrendingUp },
    { label: 'Win Rate', value: `${stats.winRate}%`, delta: `${stats.wonJobs}W / ${stats.lostJobs}L`, type: stats.winRate > 50 ? 'up' : 'warn', bar: stats.winRate, icon: TrendingUp },
    { label: 'Active Jobs', value: stats.activeJobs, delta: `${stats.completeJobs} complete`, type: 'flat', bar: Math.min((stats.activeJobs / Math.max(stats.totalJobs, 1)) * 100, 100), icon: HardHat },
    { label: 'Total Revenue', value: `$${(stats.totalRevenue / 1000).toFixed(0)}K`, delta: `${stats.avgMargin}% avg margin`, type: 'up', bar: Math.min(stats.avgMargin * 5, 100), icon: DollarSign },
  ] : [];

  const upcoming = bids
    .filter(b => b.status === 'new' || b.status === 'estimated')
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))
    .slice(0, 8);

  // This week's deadlines
  const now = new Date();
  const endOfWeek = new Date(now);
  endOfWeek.setDate(now.getDate() + (7 - now.getDay()));
  const bidsThisWeek = bids.filter(b => {
    const d = new Date(b.due_date);
    return d >= now && d <= endOfWeek;
  });

  if (loading) {
    return <div className="flex items-center justify-center py-24"><div className="spinner w-10 h-10" /></div>;
  }

  return (
    <div className="p-6 lg:px-7 lg:py-6">
      {/* This Week Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
        <div
          className="bg-terminal-panel border border-terminal-border rounded-[14px] p-5 cursor-pointer hover:bg-[#f5f4f0] transition-colors"
          onClick={() => onNavigate?.('meetings-chat')}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[10px] bg-[#e8eef5] flex items-center justify-center">
              <Calendar size={18} className="text-[#1e3a5f]" />
            </div>
            <div>
              <div className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px]">Meetings This Week</div>
              <div className="text-xl font-bold text-terminal-text tabular-nums">{meetings.length}</div>
            </div>
          </div>
        </div>

        <div
          className="bg-terminal-panel border border-terminal-border rounded-[14px] p-5 cursor-pointer hover:bg-[#f5f4f0] transition-colors"
          onClick={() => onNavigate?.('estimating')}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[10px] bg-[#fdf6e8] flex items-center justify-center">
              <ClipboardList size={18} className="text-[#b8860b]" />
            </div>
            <div>
              <div className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px]">Bids Due This Week</div>
              <div className="text-xl font-bold text-terminal-text tabular-nums">{bidsThisWeek.length}</div>
            </div>
          </div>
        </div>

        <div
          className="bg-terminal-panel border border-terminal-border rounded-[14px] p-5 cursor-pointer hover:bg-[#f5f4f0] transition-colors"
          onClick={() => onNavigate?.('jobs')}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-[10px] bg-[#e8f5ee] flex items-center justify-center">
              <HardHat size={18} className="text-[#1a6b3c]" />
            </div>
            <div>
              <div className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px]">Active Jobs</div>
              <div className="text-xl font-bold text-terminal-text tabular-nums">{stats?.activeJobs || 0}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Metrics Strip */}
      {metrics.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 border border-terminal-border rounded-[14px] overflow-hidden mb-5" style={{ gap: '1px', background: 'var(--t-border)' }}>
          {metrics.map((m) => (
            <div key={m.label} className="bg-terminal-panel p-[18px_20px] relative">
              <div className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px] mb-1.5">{m.label}</div>
              <div className="text-2xl font-bold text-terminal-text tabular-nums leading-none">{m.value}</div>
              <div className={`text-[11px] font-semibold mt-1 ${DELTA_COLORS[m.type]}`}>{m.delta}</div>
              <div className="absolute bottom-0 left-5 right-5 h-[3px] rounded-[3px] bg-[#f0eeea] overflow-hidden">
                <div className="h-full rounded-[3px] transition-all duration-1000" style={{ width: `${m.bar}%`, background: '#1e3a5f' }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Two-column: Bid Deadlines + Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Upcoming Deadlines */}
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
            <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Bid Deadlines</span>
            <span className="text-[11px] text-terminal-muted">{upcoming.length} pending</span>
          </div>
          <div>
            {upcoming.length === 0 ? (
              <div className="px-[18px] py-8 text-center text-[#9a9a92] text-[13px]">No upcoming bid deadlines</div>
            ) : upcoming.map((bid, i) => {
              const days = Math.ceil((new Date(bid.due_date) - new Date()) / (1000 * 60 * 60 * 24));
              const urgClass = days <= 7 ? 'high' : days <= 14 ? 'medium' : 'low';
              return (
                <div key={i} className="flex items-center justify-between px-[18px] py-[9px] border-b border-[#f0eeea] last:border-b-0 text-[13px]">
                  <div className="min-w-0 flex-1">
                    <span className="text-terminal-text truncate block font-medium">{bid.project_name || bid.gc_name}</span>
                    {bid.gc_name && bid.project_name && (
                      <span className="text-[11px] text-terminal-muted">{bid.gc_name}</span>
                    )}
                  </div>
                  <span className={`text-[11px] px-2 py-0.5 rounded border ${URGENCY_BADGE[urgClass]}`}>
                    {days <= 0 ? 'Today' : `${days}d`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Summary */}
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
            <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Summary</span>
            <span className="text-[11px] text-terminal-muted">All time</span>
          </div>
          <div>
            {[
              { label: 'Total Bids', value: stats?.totalBidRequests || 0 },
              { label: 'Estimates', value: stats?.totalEstimates || 0 },
              { label: 'Jobs Won', value: stats?.wonJobs || 0 },
              { label: 'Jobs Lost', value: stats?.lostJobs || 0 },
              { label: 'Avg Margin', value: `${stats?.avgMargin || 0}%`, color: 'text-[#1e3a5f]' },
              { label: 'Win Rate', value: `${stats?.winRate || 0}%`, color: (stats?.winRate || 0) >= 50 ? 'text-[#1e3a5f]' : 'text-terminal-amber' },
            ].map((item, i) => (
              <div key={i} className="flex items-center justify-between px-[18px] py-[9px] border-b border-[#f0eeea] last:border-b-0 text-[13px]">
                <span className="text-[#6b6b65]">{item.label}</span>
                <span className={`font-semibold tabular-nums ${item.color || 'text-terminal-text'}`}>{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

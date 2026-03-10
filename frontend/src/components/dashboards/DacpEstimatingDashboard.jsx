import React, { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const STATUS_BADGE = {
  new: 'bg-blue-50 text-blue-700 border-blue-200',
  estimated: 'bg-green-50 text-green-700 border-green-200',
  sent: 'bg-purple-50 text-purple-700 border-purple-200',
  'in_progress': 'bg-amber-50 text-amber-700 border-amber-200',
};

const URGENCY_BADGE = {
  high: 'bg-red-50 text-terminal-red border-red-200',
  medium: 'bg-amber-50 text-terminal-amber border-amber-200',
  low: 'bg-gray-50 text-terminal-muted border-gray-200',
};

const CONFIDENCE_BADGE = {
  high: 'bg-green-50 text-green-700 border-green-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-red-50 text-red-700 border-red-200',
};

const DELTA_COLORS = {
  up: 'text-[#1e3a5f]',
  warn: 'text-terminal-amber',
  flat: 'text-terminal-muted',
};

export default function DacpEstimatingDashboard() {
  const [bids, setBids] = useState([]);
  const [estimates, setEstimates] = useState([]);
  const [stats, setStats] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [filterTab, setFilterTab] = useState('all');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const token = localStorage.getItem('auth_token');
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/v1/estimates/inbox`, { headers }).then(r => r.json()),
      fetch(`${API_BASE}/v1/estimates/estimates`, { headers }).then(r => r.json()),
      fetch(`${API_BASE}/v1/estimates/stats`, { headers }).then(r => r.json()),
    ]).then(([inboxRes, estRes, statsRes]) => {
      setBids(inboxRes.bidRequests || []);
      setEstimates(estRes.estimates || []);
      setStats(statsRes.stats);
      if (inboxRes.bidRequests?.length > 0) setSelectedId(inboxRes.bidRequests[0].id);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const filteredBids = filterTab === 'all' ? bids
    : bids.filter(b => b.status === filterTab);

  const selected = bids.find(b => b.id === selectedId);
  const selectedEstimate = selected ? estimates.find(e => e.bid_request_id === selected.id) : null;

  const handleGenerate = async () => {
    if (!selected) return;
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/v1/estimates/inbox/${selected.id}/estimate`, {
        method: 'POST', headers,
      });
      const data = await res.json();
      if (data.estimate) {
        setEstimates(prev => [data.estimate, ...prev]);
        setBids(prev => prev.map(b => b.id === selected.id ? { ...b, status: 'estimated' } : b));
      }
    } catch (e) { console.error(e); }
    setGenerating(false);
  };

  const tabs = [
    { id: 'all', label: 'All', count: bids.length },
    { id: 'new', label: 'New', count: bids.filter(b => b.status === 'new').length },
    { id: 'estimated', label: 'Estimated', count: bids.filter(b => b.status === 'estimated').length },
    { id: 'sent', label: 'Sent', count: bids.filter(b => b.status === 'sent').length },
  ];

  const statMetrics = stats ? [
    { label: 'Open RFQs', value: stats.openRfqs, delta: 'inbox', type: 'up' },
    { label: 'Due This Week', value: bids.filter(b => { const d = Math.ceil((new Date(b.due_date) - new Date()) / 86400000); return d >= 0 && d <= 7; }).length, delta: 'urgent', type: 'warn' },
    { label: 'Avg Response', value: '1.2d', delta: 'target 2d', type: 'up' },
    { label: 'Bids Out', value: stats.sentEstimates || 0, delta: 'sent', type: 'flat' },
    { label: 'Hit Rate', value: `${stats.winRate}%`, delta: `${stats.wonJobs}W/${stats.lostJobs}L`, type: stats.winRate > 50 ? 'up' : 'warn' },
    { label: 'Pipeline $', value: `$${((estimates.reduce((s, e) => s + (e.total_bid || 0), 0)) / 1000).toFixed(0)}K`, delta: `${estimates.length} bids`, type: 'up' },
  ] : [];

  if (loading) {
    return <div className="flex items-center justify-center py-24"><div className="spinner w-10 h-10" /></div>;
  }

  return (
    <div className="p-6 lg:px-7 lg:py-6">
      {/* Stats Strip */}
      {statMetrics.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 border border-terminal-border rounded-[14px] overflow-hidden mb-5" style={{ gap: '1px', background: 'var(--t-border)' }}>
          {statMetrics.map((m) => (
            <div key={m.label} className="bg-terminal-panel p-[14px_16px]">
              <div className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px] mb-1">{m.label}</div>
              <div className="text-xl font-bold text-terminal-text tabular-nums leading-none">{m.value}</div>
              <div className={`text-[11px] font-semibold mt-1 ${DELTA_COLORS[m.type]}`}>{m.delta}</div>
            </div>
          ))}
        </div>
      )}

      {/* Split Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-4">
        {/* Left — Inbox */}
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-[18px] py-[14px] border-b border-[#f0eeea]">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Inbox</span>
              <span className="text-[11px] text-terminal-muted">{bids.length} RFQs</span>
            </div>
            <div className="flex gap-1">
              {tabs.map(t => (
                <button
                  key={t.id}
                  onClick={() => setFilterTab(t.id)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all ${
                    filterTab === t.id
                      ? 'bg-[#1e3a5f] text-white'
                      : 'bg-[#f5f4f0] text-terminal-muted hover:bg-[#eeedea]'
                  }`}
                >
                  {t.label} ({t.count})
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-[600px] overflow-y-auto">
            {filteredBids.map((bid) => {
              const days = Math.ceil((new Date(bid.due_date) - new Date()) / 86400000);
              const isSelected = bid.id === selectedId;
              return (
                <div
                  key={bid.id}
                  onClick={() => setSelectedId(bid.id)}
                  className={`px-[18px] py-3 border-b border-[#f0eeea] cursor-pointer transition-colors ${
                    isSelected ? 'bg-[#e8eef5]' : 'hover:bg-[#f5f4f0]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[13px] font-medium text-terminal-text truncate flex-1 mr-2">{bid.gc_name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${STATUS_BADGE[bid.status] || STATUS_BADGE.new}`}>
                      {bid.status}
                    </span>
                  </div>
                  <div className="text-[11px] text-terminal-muted truncate mb-1">
                    {bid.subject.replace(/^(RFQ|ITB|RFP|Pricing Request|Budget Pricing|Budget Request|Quick Turn|Bid|Pre-Qual \+ RFQ|FYI):?\s*/i, '')}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${URGENCY_BADGE[bid.urgency]}`}>
                      {bid.urgency}
                    </span>
                    <span className="text-[10px] text-terminal-muted">
                      {days <= 0 ? 'Due today' : `${days}d left`}
                    </span>
                  </div>
                </div>
              );
            })}
            {filteredBids.length === 0 && (
              <div className="px-[18px] py-8 text-center text-terminal-muted text-sm">No bid requests</div>
            )}
          </div>
        </div>

        {/* Right — Estimate Preview */}
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          {selected ? (
            <>
              <div className="px-[18px] py-[14px] border-b border-[#f0eeea]">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-terminal-text">{selected.gc_name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${URGENCY_BADGE[selected.urgency]}`}>
                    Due {selected.due_date}
                  </span>
                </div>
                <div className="text-[13px] text-terminal-text">{selected.subject}</div>
                <div className="text-[11px] text-terminal-muted mt-1">{selected.from_name} &lt;{selected.from_email}&gt;</div>
              </div>

              {/* Scope Summary */}
              <div className="px-[18px] py-3 border-b border-[#f0eeea]">
                <div className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px] mb-2">Scope</div>
                {(() => {
                  const scope = selected.scope || (selected.scope_json ? JSON.parse(selected.scope_json) : {});
                  const items = scope.items || [];
                  return items.length > 0 ? (
                    <ul className="space-y-1">
                      {items.map((item, i) => (
                        <li key={i} className="text-[12px] text-[#6b6b65] flex items-start gap-1.5">
                          <span className="text-terminal-muted mt-0.5">•</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-[12px] text-terminal-muted">No scope details provided</div>
                  );
                })()}
              </div>

              {/* Missing Info */}
              {(() => {
                const missing = selected.missing_info || (selected.missing_info_json ? JSON.parse(selected.missing_info_json) : []);
                if (missing.length === 0) return null;
                return (
                  <div className="px-[18px] py-3 border-b border-[#f0eeea] bg-amber-50/50">
                    <div className="text-[10px] font-bold text-terminal-amber uppercase tracking-[1px] mb-1">Missing Info</div>
                    {missing.map((m, i) => (
                      <div key={i} className="text-[12px] text-terminal-amber">⚠ {m}</div>
                    ))}
                  </div>
                );
              })()}

              {/* Estimate / Line Items */}
              {selectedEstimate ? (
                <>
                  <div className="px-[18px] py-3 border-b border-[#f0eeea]">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px]">Estimate</div>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${CONFIDENCE_BADGE[selectedEstimate.confidence] || CONFIDENCE_BADGE.medium}`}>
                        {selectedEstimate.confidence} confidence
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[12px]">
                        <thead>
                          <tr className="border-b border-[#f0eeea]">
                            <th className="text-left py-1.5 font-semibold text-terminal-muted">Item</th>
                            <th className="text-right py-1.5 font-semibold text-terminal-muted w-16">Qty</th>
                            <th className="text-right py-1.5 font-semibold text-terminal-muted w-14">Unit</th>
                            <th className="text-right py-1.5 font-semibold text-terminal-muted w-20">Unit $</th>
                            <th className="text-right py-1.5 font-semibold text-terminal-muted w-24">Extended</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(selectedEstimate.line_items || (selectedEstimate.line_items_json ? JSON.parse(selectedEstimate.line_items_json) : [])).map((li, i) => (
                            <tr key={i} className="border-b border-[#f0eeea] last:border-b-0">
                              <td className="py-1.5 text-[#6b6b65] truncate max-w-[200px]">{li.pricingItem || li.description}</td>
                              <td className="py-1.5 text-right tabular-nums text-terminal-text">{li.quantity?.toLocaleString()}</td>
                              <td className="py-1.5 text-right text-terminal-muted">{li.unit}</td>
                              <td className="py-1.5 text-right tabular-nums text-terminal-text">${li.unitPrice?.toFixed(2)}</td>
                              <td className="py-1.5 text-right tabular-nums font-medium text-terminal-text">${li.extended?.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Totals */}
                  <div className="px-[18px] py-3 border-b border-[#f0eeea]">
                    <div className="space-y-1 text-[12px]">
                      <div className="flex justify-between"><span className="text-[#6b6b65]">Subtotal</span><span className="tabular-nums">${selectedEstimate.subtotal?.toLocaleString()}</span></div>
                      <div className="flex justify-between"><span className="text-[#6b6b65]">Overhead ({selectedEstimate.overhead_pct}%)</span><span className="tabular-nums">${Math.round(selectedEstimate.subtotal * (selectedEstimate.overhead_pct / 100))?.toLocaleString()}</span></div>
                      <div className="flex justify-between"><span className="text-[#6b6b65]">Profit ({selectedEstimate.profit_pct}%)</span><span className="tabular-nums">${Math.round((selectedEstimate.subtotal * (1 + selectedEstimate.overhead_pct / 100)) * (selectedEstimate.profit_pct / 100))?.toLocaleString()}</span></div>
                      <div className="flex justify-between"><span className="text-[#6b6b65]">Mobilization + Testing</span><span className="tabular-nums">${selectedEstimate.mobilization?.toLocaleString()}</span></div>
                      <div className="flex justify-between pt-2 border-t border-[#f0eeea] text-[14px] font-bold">
                        <span className="text-terminal-text">Total Bid</span>
                        <span className="text-[#1e3a5f] tabular-nums">${selectedEstimate.total_bid?.toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="px-[18px] py-8 text-center">
                  <div className="text-sm text-terminal-muted mb-3">No estimate generated yet</div>
                  <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="px-4 py-2 bg-[#1e3a5f] text-white rounded-lg text-sm font-semibold hover:bg-[#2a4f7a] disabled:opacity-50 transition-colors"
                  >
                    {generating ? 'Generating...' : 'Generate Estimate'}
                  </button>
                </div>
              )}

              {/* Actions */}
              <div className="px-[18px] py-3 flex gap-2">
                {!selectedEstimate && (
                  <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="px-3 py-1.5 bg-[#1e3a5f] text-white rounded-lg text-[12px] font-semibold hover:bg-[#2a4f7a] disabled:opacity-50"
                  >
                    {generating ? 'Generating...' : 'Generate Estimate'}
                  </button>
                )}
                {selectedEstimate && (
                  <>
                    <button onClick={() => alert('Opening estimate editor...')} className="px-3 py-1.5 bg-terminal-panel border border-terminal-border rounded-lg text-[12px] font-semibold text-terminal-text hover:bg-[#f5f4f0]">
                      Edit
                    </button>
                    <button onClick={() => alert('Quote sent to GC.')} className="px-3 py-1.5 bg-[#1e3a5f] text-white rounded-lg text-[12px] font-semibold hover:bg-[#2a4f7a]">
                      Send Quote
                    </button>
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center py-24 text-terminal-muted text-sm">
              Select a bid request to view details
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

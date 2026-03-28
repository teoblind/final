import React, { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const MARGIN_COLOR = (pct) => {
  if (pct == null) return 'text-terminal-muted';
  if (pct >= 15) return 'text-green-600';
  if (pct >= 5) return 'text-terminal-amber';
  return 'text-terminal-red';
};

const STATUS_BADGE = {
  complete: 'bg-green-50 text-green-700 border-green-200',
  active: 'bg-blue-50 text-blue-700 border-blue-200',
  lost: 'bg-red-50 text-red-700 border-red-200',
  on_hold: 'bg-amber-50 text-amber-700 border-amber-200',
};

const PROJECT_TYPE_BADGE = {
  commercial: 'bg-blue-50 text-blue-600',
  residential: 'bg-green-50 text-green-600',
  industrial: 'bg-purple-50 text-purple-600',
  infrastructure: 'bg-amber-50 text-amber-600',
  municipal: 'bg-orange-50 text-orange-600',
};

export default function DacpJobsDashboard() {
  const [jobs, setJobs] = useState([]);
  const [stats, setStats] = useState(null);
  const [filterTab, setFilterTab] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [expandedReports, setExpandedReports] = useState({});
  const [loading, setLoading] = useState(true);

  const token = localStorage.getItem('auth_token');
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/v1/estimates/jobs`, { headers }).then(r => r.json()),
      fetch(`${API_BASE}/v1/estimates/stats`, { headers }).then(r => r.json()),
    ]).then(([jobsRes, statsRes]) => {
      setJobs(jobsRes.jobs || []);
      setStats(statsRes.stats);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const filteredJobs = filterTab === 'all' ? jobs
    : jobs.filter(j => j.status === filterTab);

  const wonJobs = jobs.filter(j => j.status === 'complete' && j.margin_pct != null);
  const totalContractValue = wonJobs.reduce((s, j) => s + (j.bid_amount || 0), 0);
  const avgMargin = wonJobs.length > 0 ? wonJobs.reduce((s, j) => s + j.margin_pct, 0) / wonJobs.length : 0;
  const overbudget = wonJobs.filter(j => j.actual_cost > j.estimated_cost).length;

  const tabs = [
    { id: 'all', label: 'All', count: jobs.length },
    { id: 'complete', label: 'Complete', count: jobs.filter(j => j.status === 'complete').length },
    { id: 'lost', label: 'Lost', count: jobs.filter(j => j.status === 'lost').length },
  ];

  const loadReports = async (jobId) => {
    if (expandedReports[jobId]) return;
    try {
      const res = await fetch(`${API_BASE}/v1/estimates/jobs/${jobId}`, { headers });
      const data = await res.json();
      setExpandedReports(prev => ({ ...prev, [jobId]: data.fieldReports || [] }));
    } catch (e) { console.error(e); }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-24"><div className="spinner w-10 h-10" /></div>;
  }

  return (
    <div className="p-6 lg:px-7 lg:py-6">
      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 border border-terminal-border rounded-[14px] overflow-hidden mb-5" style={{ gap: '1px', background: 'var(--t-border)' }}>
        {[
          { label: 'Won Jobs', value: wonJobs.length, delta: `${jobs.filter(j => j.status === 'lost').length} lost` },
          { label: 'Total Contract Value', value: `$${(totalContractValue / 1000).toFixed(0)}K`, delta: `${wonJobs.length} projects` },
          { label: 'Avg Margin', value: `${avgMargin.toFixed(1)}%`, delta: avgMargin >= 15 ? 'healthy' : 'below target' },
          { label: 'Overbudget', value: overbudget, delta: `of ${wonJobs.length} won` },
        ].map((m) => (
          <div key={m.label} className="bg-terminal-panel p-[18px_20px]">
            <div className="text-[10px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1.5">{m.label}</div>
            <div className="text-2xl font-display text-terminal-text tabular-nums leading-none">{m.value}</div>
            <div className="text-[11px] font-mono font-semibold mt-1 text-terminal-muted">{m.delta}</div>
          </div>
        ))}
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 mb-4">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setFilterTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-heading font-semibold transition-all ${
              filterTab === t.id
                ? 'bg-[#1e3a5f] text-white'
                : 'bg-terminal-panel text-terminal-muted border border-terminal-border hover:bg-[#f5f4f0]'
            }`}
          >
            {t.label} (<span className="font-mono">{t.count}</span>)
          </button>
        ))}
      </div>

      {/* Jobs Grid */}
      <div className="space-y-2">
        {filteredJobs.map((job) => {
          const isExpanded = expandedId === job.id;
          const budgetPct = job.estimated_cost && job.actual_cost
            ? Math.round((job.actual_cost / job.estimated_cost) * 100)
            : null;
          const isOverBudget = budgetPct != null && budgetPct > 100;

          return (
            <div key={job.id} className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
              <div
                className="px-[18px] py-3 cursor-pointer hover:bg-[#f5f4f0] transition-colors"
                onClick={() => {
                  setExpandedId(isExpanded ? null : job.id);
                  if (!isExpanded) loadReports(job.id);
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[13px] font-semibold text-terminal-text">{job.project_name}</span>
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${STATUS_BADGE[job.status] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                        {job.status}
                      </span>
                      {job.project_type && (
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${PROJECT_TYPE_BADGE[job.project_type] || 'bg-gray-50 text-gray-600'}`}>
                          {job.project_type}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-terminal-muted">
                      <span>{job.gc_name}</span>
                      <span>•</span>
                      <span>{job.location}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-6 shrink-0">
                    {job.bid_amount && (
                      <div className="text-right">
                        <div className="text-[10px] font-heading text-terminal-muted uppercase">Bid</div>
                        <div className="text-[13px] font-mono font-semibold tabular-nums">${(job.bid_amount / 1000).toFixed(0)}K</div>
                      </div>
                    )}
                    {budgetPct != null && (
                      <div className="text-right">
                        <div className="text-[10px] font-heading text-terminal-muted uppercase">Budget</div>
                        <div className={`text-[13px] font-mono font-semibold tabular-nums ${isOverBudget ? 'text-terminal-red' : 'text-green-600'}`}>
                          {budgetPct}%
                        </div>
                      </div>
                    )}
                    {job.margin_pct != null && (
                      <div className="text-right">
                        <div className="text-[10px] font-heading text-terminal-muted uppercase">Margin</div>
                        <div className={`text-[13px] font-mono font-semibold tabular-nums ${MARGIN_COLOR(job.margin_pct)}`}>
                          {job.margin_pct}%
                        </div>
                      </div>
                    )}
                    <span className={`text-[#c5c5bc] text-sm transition-transform ${isExpanded ? 'rotate-90' : ''}`}>&rsaquo;</span>
                  </div>
                </div>
              </div>

              {isExpanded && (
                <div className="px-[18px] pb-4 pt-1 border-t border-[#f0eeea]">
                  {/* Cost Breakdown */}
                  {job.status === 'complete' && job.estimated_cost && (
                    <div className="grid grid-cols-3 gap-4 mb-4">
                      <div className="text-center p-3 bg-[#f5f4f0] rounded-lg">
                        <div className="text-[10px] font-heading text-terminal-muted uppercase mb-1">Estimated</div>
                        <div className="text-[14px] font-mono font-semibold tabular-nums">${job.estimated_cost?.toLocaleString()}</div>
                      </div>
                      <div className="text-center p-3 bg-[#f5f4f0] rounded-lg">
                        <div className="text-[10px] font-heading text-terminal-muted uppercase mb-1">Actual</div>
                        <div className={`text-[14px] font-mono font-semibold tabular-nums ${isOverBudget ? 'text-terminal-red' : 'text-green-600'}`}>
                          ${job.actual_cost?.toLocaleString()}
                        </div>
                      </div>
                      <div className="text-center p-3 bg-[#f5f4f0] rounded-lg">
                        <div className="text-[10px] font-heading text-terminal-muted uppercase mb-1">Profit</div>
                        <div className={`text-[14px] font-mono font-semibold tabular-nums ${MARGIN_COLOR(job.margin_pct)}`}>
                          ${((job.bid_amount || 0) - (job.actual_cost || 0)).toLocaleString()}
                        </div>
                      </div>
                    </div>
                  )}

                  {job.notes && (
                    <div className="text-[12px] text-[#6b6b65] mb-3">{job.notes}</div>
                  )}

                  {/* Field Reports */}
                  {expandedReports[job.id] && expandedReports[job.id].length > 0 && (
                    <div>
                      <div className="text-[10px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-2">Field Reports</div>
                      <div className="space-y-1.5">
                        {expandedReports[job.id].slice(0, 5).map((r, i) => (
                          <div key={i} className="flex items-start gap-2 text-[12px] p-2 bg-[#f5f4f0] rounded-lg">
                            <span className="text-terminal-muted font-mono shrink-0 tabular-nums">{r.date}</span>
                            <div className="flex-1 min-w-0">
                              <span className="text-[#6b6b65]">{r.reported_by} - </span>
                              <span className="text-terminal-text">{(r.work || []).join('; ').slice(0, 100)}</span>
                              {r.issues && r.issues.length > 0 && (
                                <div className="text-terminal-red mt-0.5">⚠ {r.issues.join(', ')}</div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {expandedReports[job.id] && expandedReports[job.id].length === 0 && (
                    <div className="text-[12px] text-terminal-muted">No field reports</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filteredJobs.length === 0 && (
        <div className="text-center py-12 text-terminal-muted text-sm">No jobs match this filter</div>
      )}
    </div>
  );
}

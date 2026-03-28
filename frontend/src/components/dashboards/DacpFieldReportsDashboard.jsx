import React, { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

export default function DacpFieldReportsDashboard() {
  const [reports, setReports] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [filterJobId, setFilterJobId] = useState('');
  const [loading, setLoading] = useState(true);

  const token = localStorage.getItem('auth_token');
  const headers = { Authorization: `Bearer ${token}` };

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/v1/estimates/field-reports`, { headers }).then(r => r.json()),
      fetch(`${API_BASE}/v1/estimates/jobs`, { headers }).then(r => r.json()),
    ]).then(([reportsRes, jobsRes]) => {
      setReports(reportsRes.fieldReports || []);
      setJobs(jobsRes.jobs || []);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const filteredReports = filterJobId
    ? reports.filter(r => r.job_id === filterJobId)
    : reports;

  // Roll-up stats
  const totalLaborHours = filteredReports.reduce((s, r) => {
    const labor = r.labor || (r.labor_json ? JSON.parse(r.labor_json) : {});
    return s + (labor.hours || 0);
  }, 0);
  const totalLaborCost = filteredReports.reduce((s, r) => {
    const labor = r.labor || (r.labor_json ? JSON.parse(r.labor_json) : {});
    return s + (labor.cost || 0);
  }, 0);
  const totalMaterialsCost = filteredReports.reduce((s, r) => {
    const materials = r.materials || (r.materials_json ? JSON.parse(r.materials_json) : []);
    return s + materials.reduce((ms, m) => ms + (m.quantity || 0) * (m.unit === 'CY' ? 130 : 0), 0);
  }, 0);
  const totalIssues = filteredReports.reduce((s, r) => {
    const issues = r.issues || (r.issues_json ? JSON.parse(r.issues_json) : []);
    return s + issues.length;
  }, 0);
  const totalCY = filteredReports.reduce((s, r) => {
    const materials = r.materials || (r.materials_json ? JSON.parse(r.materials_json) : []);
    return s + materials.filter(m => m.unit === 'CY').reduce((ms, m) => ms + (m.quantity || 0), 0);
  }, 0);

  const jobMap = {};
  for (const j of jobs) jobMap[j.id] = j;

  if (loading) {
    return <div className="flex items-center justify-center py-24"><div className="spinner w-10 h-10" /></div>;
  }

  return (
    <div className="p-6 lg:px-7 lg:py-6">
      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 border border-terminal-border rounded-[14px] overflow-hidden mb-5" style={{ gap: '1px', background: 'var(--t-border)' }}>
        {[
          { label: 'Total Reports', value: filteredReports.length, delta: `${reports.length} all time` },
          { label: 'Total Labor Hours', value: totalLaborHours.toLocaleString(), delta: `$${totalLaborCost.toLocaleString()} cost` },
          { label: 'Concrete Poured', value: `${totalCY.toLocaleString()} CY`, delta: 'total volume' },
          { label: 'Issues Flagged', value: totalIssues, delta: totalIssues > 0 ? 'requires attention' : 'none' },
        ].map((m) => (
          <div key={m.label} className="bg-terminal-panel p-[18px_20px]">
            <div className="text-[10px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1.5">{m.label}</div>
            <div className="text-2xl font-display text-terminal-text tabular-nums leading-none">{m.value}</div>
            <div className="text-[11px] font-mono font-semibold mt-1 text-terminal-muted">{m.delta}</div>
          </div>
        ))}
      </div>

      {/* Job Filter */}
      <div className="flex items-center gap-3 mb-4">
        <select
          value={filterJobId}
          onChange={(e) => setFilterJobId(e.target.value)}
          className="px-3 py-1.5 bg-terminal-panel border border-terminal-border rounded-lg text-[12px] text-terminal-text min-w-[200px]"
        >
          <option value="">All Jobs</option>
          {jobs.map(j => (
            <option key={j.id} value={j.id}>{j.id} - {j.project_name}</option>
          ))}
        </select>
        <span className="text-[11px] font-mono text-terminal-muted">{filteredReports.length} reports</span>
      </div>

      {/* Report Cards */}
      <div className="space-y-2">
        {filteredReports.map((report) => {
          const labor = report.labor || (report.labor_json ? JSON.parse(report.labor_json) : {});
          const materials = report.materials || (report.materials_json ? JSON.parse(report.materials_json) : []);
          const work = report.work || (report.work_json ? JSON.parse(report.work_json) : []);
          const equipment = report.equipment || (report.equipment_json ? JSON.parse(report.equipment_json) : []);
          const issues = report.issues || (report.issues_json ? JSON.parse(report.issues_json) : []);
          const job = jobMap[report.job_id];

          return (
            <div key={report.id} className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
              <div className="px-[18px] py-3">
                {/* Header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <span className="text-[13px] font-mono font-semibold text-terminal-text tabular-nums">{report.date}</span>
                    <span className="text-[11px] text-terminal-muted">{report.reported_by}</span>
                    {job && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#e8eef5] text-[#1e3a5f]">
                        {job.project_name}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-terminal-muted">
                    <span>{report.weather}</span>
                  </div>
                </div>

                {/* Work Performed */}
                <div className="mb-2">
                  {work.map((w, i) => (
                    <div key={i} className="text-[12px] text-[#6b6b65] flex items-start gap-1.5">
                      <span className="text-terminal-muted mt-0.5">•</span>
                      <span>{w}</span>
                    </div>
                  ))}
                </div>

                {/* Stats Row */}
                <div className="flex items-center gap-4 flex-wrap">
                  {labor.crew_size && (
                    <div className="text-[11px]">
                      <span className="text-terminal-muted">Crew: </span>
                      <span className="text-terminal-text font-medium">{labor.crew_size}</span>
                    </div>
                  )}
                  {labor.hours && (
                    <div className="text-[11px]">
                      <span className="text-terminal-muted">Hours: </span>
                      <span className="text-terminal-text font-medium">{labor.hours}h</span>
                      {labor.overtime > 0 && <span className="text-terminal-amber ml-1">({labor.overtime}h OT)</span>}
                    </div>
                  )}
                  {labor.cost && (
                    <div className="text-[11px]">
                      <span className="text-terminal-muted">Labor $: </span>
                      <span className="text-terminal-text font-mono font-medium tabular-nums">${labor.cost.toLocaleString()}</span>
                    </div>
                  )}
                  {materials.length > 0 && (
                    <div className="text-[11px]">
                      <span className="text-terminal-muted">Materials: </span>
                      <span className="text-terminal-text font-medium">
                        {materials.map(m => `${m.quantity} ${m.unit} ${m.item}`).join(', ').slice(0, 80)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Equipment */}
                {equipment.length > 0 && (
                  <div className="mt-1 text-[11px] text-terminal-muted">
                    Equipment: {equipment.join(', ')}
                  </div>
                )}

                {/* Issues */}
                {issues.length > 0 && (
                  <div className="mt-2 p-2 bg-red-50 rounded-lg border border-red-100">
                    {issues.map((issue, i) => (
                      <div key={i} className="text-[12px] text-terminal-red flex items-start gap-1.5">
                        <span className="mt-0.5">⚠</span>
                        <span>{issue}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Notes */}
                {report.notes && (
                  <div className="mt-1 text-[11px] text-terminal-muted italic">{report.notes}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {filteredReports.length === 0 && (
        <div className="text-center py-12 text-terminal-muted text-sm">No field reports found</div>
      )}

      {/* Roll-up Summary */}
      {filteredReports.length > 0 && (
        <div className="mt-6 bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-[18px] py-[14px] border-b border-[#f0eeea]">
            <span className="text-xs font-heading font-bold text-terminal-text tracking-[0.3px]">Roll-Up Summary</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-[#f0eeea]">
            {[
              { label: 'Total CY Poured', value: `${totalCY.toLocaleString()} CY` },
              { label: 'Labor Hours', value: totalLaborHours.toLocaleString() },
              { label: 'Labor Cost', value: `$${totalLaborCost.toLocaleString()}` },
              { label: 'Issues', value: totalIssues },
            ].map((m) => (
              <div key={m.label} className="p-4 text-center">
                <div className="text-[10px] font-heading text-terminal-muted uppercase tracking-[1px] mb-1">{m.label}</div>
                <div className="text-lg font-display text-terminal-text tabular-nums">{m.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

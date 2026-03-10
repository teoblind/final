import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import Panel from '../Panel';
import { useApi, postApi } from '../../hooks/useApi';
import { formatNumber, formatDate, exportToCSV } from '../../utils/formatters';

export default function DatacenterPanel() {
  const [showProjectModal, setShowProjectModal] = useState(false);

  const { data, loading, error, lastFetched, isStale, refetch } = useApi(
    '/datacenter',
    { refreshInterval: 60 * 60 * 1000 }
  );

  const regions = data?.regions || [];
  const projects = data?.projects || [];
  const totals = data?.totals || {};

  // Prepare chart data
  const chartData = regions.map(r => ({
    region: r.code,
    name: r.name,
    demand: r.currentDemand || 0,
    planned: r.plannedAdditions || 0,
    headroom: r.gridHeadroom || 0
  })).filter(r => r.demand > 0 || r.planned > 0 || r.headroom > 0);

  const handleExport = () => {
    if (projects.length) {
      exportToCSV(projects, 'datacenter_projects');
    }
  };

  return (
    <Panel
      title="Data Center Power Demand"
      source="EIA + PJM + Manual"
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
      onExport={handleExport}
      headerRight={
        <button
          onClick={() => setShowProjectModal(true)}
          className="text-xs text-terminal-green hover:underline"
        >
          + Add Project
        </button>
      }
    >
      {/* Regional Capacity Chart */}
      {chartData.length > 0 ? (
        <div className="h-40 mb-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical">
              <XAxis
                type="number"
                stroke="#666"
                fontSize={10}
                tickFormatter={(v) => `${v} MW`}
              />
              <YAxis
                type="category"
                dataKey="region"
                stroke="#666"
                fontSize={10}
                width={50}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#111',
                  border: '1px solid #333',
                  borderRadius: '4px'
                }}
                formatter={(value) => [`${formatNumber(value, 0)} MW`]}
                labelFormatter={(label) => regions.find(r => r.code === label)?.name || label}
              />
              <Legend />
              <Bar dataKey="demand" name="Current" fill="#00d26a" stackId="a" />
              <Bar dataKey="planned" name="Planned" fill="#ffb800" stackId="a" />
              <Bar dataKey="headroom" name="Headroom" fill="#333" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-40 flex items-center justify-center text-terminal-muted">
          <div className="text-center">
            <p>No capacity data yet.</p>
            <p className="text-xs mt-1">Add regional capacity data using the Data Entry page.</p>
          </div>
        </div>
      )}

      {/* Region Details */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        {regions.slice(0, 4).map((region) => (
          <div key={region.code} className="bg-terminal-bg/50 rounded p-2">
            <p className="text-xs text-terminal-muted">{region.name}</p>
            <p className="font-sans text-lg">
              {region.currentDemand ? `${formatNumber(region.currentDemand, 0)} MW` : '-'}
            </p>
            <p className="text-xs text-terminal-muted">{region.description}</p>
          </div>
        ))}
      </div>

      {/* Project Pipeline */}
      <div className="border-t border-terminal-border pt-3">
        <div className="flex justify-between items-center mb-2">
          <p className="text-xs text-terminal-muted uppercase">Project Pipeline</p>
          <span className="text-terminal-green font-sans">
            {formatNumber(totals.totalPlannedMW, 0)} MW Total
          </span>
        </div>

        {projects.length > 0 ? (
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {projects.slice(0, 5).map((project, i) => (
              <div key={i} className="flex justify-between items-center text-sm bg-terminal-bg/50 rounded p-2">
                <div>
                  <p className="font-medium">{project.company}</p>
                  <p className="text-xs text-terminal-muted">{project.location}</p>
                </div>
                <div className="text-right">
                  {project.capacityMW && (
                    <p className="text-terminal-green">{formatNumber(project.capacityMW, 0)} MW</p>
                  )}
                  <p className={`text-xs ${
                    project.status === 'operating' ? 'text-terminal-green' :
                    project.status === 'construction' ? 'text-terminal-amber' :
                    'text-terminal-muted'
                  }`}>
                    {project.status}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-terminal-muted text-sm">No projects tracked yet.</p>
        )}
      </div>

      {/* Context */}
      <p className="text-xs text-terminal-muted mt-3">
        {data?.context?.bottleneck}
      </p>

      {/* Add Project Modal */}
      {showProjectModal && (
        <ProjectModal
          regions={regions.map(r => r.code)}
          onClose={() => setShowProjectModal(false)}
          onSuccess={refetch}
        />
      )}
    </Panel>
  );
}

function ProjectModal({ regions, onClose, onSuccess }) {
  const [form, setForm] = useState({
    company: '',
    location: '',
    region: 'PJM',
    capacity_mw: '',
    status: 'announced',
    expected_online: '',
    notes: ''
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await postApi('/datacenter/project', form);
      onSuccess();
      onClose();
    } catch (err) {
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-terminal-panel border border-terminal-border rounded-lg p-6 w-full max-w-md">
        <h3 className="text-lg font-bold mb-4">Add Data Center Project</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-terminal-muted mb-1">Company</label>
              <input
                type="text"
                value={form.company}
                onChange={(e) => setForm({ ...form, company: e.target.value })}
                className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm"
                placeholder="AWS"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-terminal-muted mb-1">Region</label>
              <select
                value={form.region}
                onChange={(e) => setForm({ ...form, region: e.target.value })}
                className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm"
              >
                {regions.map(r => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-terminal-muted mb-1">Location</label>
            <input
              type="text"
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm"
              placeholder="Ashburn, VA"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-terminal-muted mb-1">Capacity (MW)</label>
              <input
                type="number"
                value={form.capacity_mw}
                onChange={(e) => setForm({ ...form, capacity_mw: e.target.value })}
                className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm"
                placeholder="500"
              />
            </div>
            <div>
              <label className="block text-xs text-terminal-muted mb-1">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm"
              >
                <option value="announced">Announced</option>
                <option value="planning">Planning</option>
                <option value="construction">Construction</option>
                <option value="operating">Operating</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-terminal-muted mb-1">Expected Online</label>
            <input
              type="date"
              value={form.expected_online}
              onChange={(e) => setForm({ ...form, expected_online: e.target.value })}
              className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-terminal-border rounded hover:bg-terminal-border"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-terminal-green/20 border border-terminal-green/30 text-terminal-green rounded hover:bg-terminal-green/30 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Add Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

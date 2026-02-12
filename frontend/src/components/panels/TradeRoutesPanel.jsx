import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import Panel from '../Panel';
import { useApi, postApi } from '../../hooks/useApi';
import { formatNumber, formatDate, formatPercent, exportToCSV } from '../../utils/formatters';

export default function TradeRoutesPanel() {
  const [showMilestoneModal, setShowMilestoneModal] = useState(false);

  const { data, loading, error, lastFetched, isStale, refetch } = useApi(
    '/trade',
    { refreshInterval: 24 * 60 * 60 * 1000 }
  );

  const suez = data?.suez || {};
  const imec = data?.imec || {};

  const handleExport = () => {
    if (suez.transits?.length) {
      exportToCSV(suez.transits, 'suez_transits');
    }
  };

  return (
    <Panel
      title="Trade Route Monitor"
      source="Suez Canal Authority + Manual"
      lastUpdated={lastFetched}
      isStale={isStale}
      loading={loading}
      error={error}
      onRefresh={refetch}
      onExport={handleExport}
    >
      {/* Suez Canal Section */}
      <div className="mb-4">
        <p className="text-xs text-terminal-muted uppercase mb-2">Suez Canal Traffic</p>

        {/* Current Stats */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="bg-terminal-bg/50 rounded p-3">
            <p className="text-xs text-terminal-muted">Latest Month Transits</p>
            <p className="text-2xl font-bold">
              {suez.currentMonth ? formatNumber(suez.currentMonth.value, 0) : '-'}
            </p>
            {suez.yoyChange && (
              <p className={`text-xs ${suez.yoyChange.percentage > 0 ? 'text-terminal-green' : 'text-terminal-red'}`}>
                {formatPercent(suez.yoyChange.percentage)} YoY
              </p>
            )}
          </div>
          <div className="bg-terminal-bg/50 rounded p-3">
            <p className="text-xs text-terminal-muted">Date</p>
            <p className="text-lg font-mono">
              {suez.currentMonth ? formatDate(suez.currentMonth.date, 'MMM yyyy') : '-'}
            </p>
          </div>
        </div>

        {/* Transit History */}
        {suez.transits?.length > 0 ? (
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={suez.transits.slice(-12).reverse()}>
                <XAxis
                  dataKey="date"
                  tickFormatter={(d) => formatDate(d, 'MMM')}
                  stroke="#666"
                  fontSize={10}
                  tickLine={false}
                />
                <YAxis
                  stroke="#666"
                  fontSize={10}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#111',
                    border: '1px solid #333',
                    borderRadius: '4px'
                  }}
                  formatter={(value) => [formatNumber(value, 0), 'Transits']}
                  labelFormatter={(label) => formatDate(label, 'MMM yyyy')}
                />
                <Bar dataKey="value" fill="#00d26a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-32 flex items-center justify-center text-terminal-muted text-sm">
            No transit data. Add monthly statistics manually.
          </div>
        )}

        <p className="text-xs text-terminal-muted mt-2">{suez.context}</p>
      </div>

      {/* IMEC Section */}
      <div className="border-t border-terminal-border pt-4">
        <div className="flex justify-between items-center mb-3">
          <div>
            <p className="text-xs text-terminal-muted uppercase">IMEC Progress Tracker</p>
            <p className="text-sm">{imec.description}</p>
          </div>
          <button
            onClick={() => setShowMilestoneModal(true)}
            className="text-xs text-terminal-green hover:underline"
          >
            + Add
          </button>
        </div>

        {/* Partners */}
        <div className="flex flex-wrap gap-1 mb-3">
          {imec.partners?.map((partner, i) => (
            <span key={i} className="px-2 py-0.5 bg-terminal-bg rounded text-xs">
              {partner}
            </span>
          ))}
        </div>

        {/* Timeline */}
        <div className="relative pl-4 border-l-2 border-terminal-border space-y-3">
          {imec.milestones?.length > 0 ? (
            imec.milestones.map((milestone, i) => (
              <MilestoneItem key={i} milestone={milestone} />
            ))
          ) : (
            <p className="text-terminal-muted text-sm py-2">
              No milestones tracked. Add milestones to track IMEC progress.
            </p>
          )}
        </div>
      </div>

      {/* Add Milestone Modal */}
      {showMilestoneModal && (
        <MilestoneModal onClose={() => setShowMilestoneModal(false)} onSuccess={refetch} />
      )}
    </Panel>
  );
}

function MilestoneItem({ milestone }) {
  const statusColors = {
    planned: 'bg-terminal-muted',
    'in-progress': 'bg-terminal-amber',
    completed: 'bg-terminal-green'
  };

  return (
    <div className="relative">
      <div className={`absolute -left-[21px] w-3 h-3 rounded-full ${statusColors[milestone.status] || 'bg-terminal-muted'}`} />
      <div className="ml-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{milestone.title}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${
            milestone.status === 'completed' ? 'bg-terminal-green/20 text-terminal-green' :
            milestone.status === 'in-progress' ? 'bg-terminal-amber/20 text-terminal-amber' :
            'bg-terminal-muted/20 text-terminal-muted'
          }`}>
            {milestone.status}
          </span>
        </div>
        <p className="text-xs text-terminal-muted">{formatDate(milestone.date)}</p>
        {milestone.description && (
          <p className="text-xs text-terminal-muted mt-1">{milestone.description}</p>
        )}
      </div>
    </div>
  );
}

function MilestoneModal({ onClose, onSuccess }) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    date: new Date().toISOString().split('T')[0],
    status: 'planned'
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await postApi('/trade/imec', form);
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
        <h3 className="text-lg font-bold mb-4">Add IMEC Milestone</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-terminal-muted mb-1">Title</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm"
              placeholder="MoU Signed"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-terminal-muted mb-1">Date</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-terminal-muted mb-1">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm"
              >
                <option value="planned">Planned</option>
                <option value="in-progress">In Progress</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-terminal-muted mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm"
              rows={2}
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
              {saving ? 'Saving...' : 'Add Milestone'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

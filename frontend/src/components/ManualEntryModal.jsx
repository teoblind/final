import React, { useState } from 'react';
import { Database, X } from 'lucide-react';
import { useApi, postApi } from '../hooks/useApi';
import { formatDate } from '../utils/formatters';

export default function ManualEntryModal({ onClose }) {
  const [category, setCategory] = useState('uranium');
  const [metric, setMetric] = useState('spot');
  const [value, setValue] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [recentEntries, setRecentEntries] = useState([]);

  const { data: categories } = useApi('/manual/categories');

  const categoryInfo = categories?.categories || {};
  const currentCategory = categoryInfo[category] || { metrics: [], description: '' };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await postApi('/manual', { category, metric, value: parseFloat(value), date, notes });
      setRecentEntries([{ category, metric, value, date, notes, time: new Date().toISOString() }, ...recentEntries.slice(0, 4)]);
      setValue('');
      setNotes('');
    } catch (err) {
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-terminal-panel border border-terminal-border rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-terminal-border">
          <div className="flex items-center gap-2">
            <Database className="text-terminal-green" size={20} />
            <h2 className="text-lg font-bold">Manual Data Entry</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-terminal-border rounded"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Category Selection */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-terminal-muted mb-1">Category</label>
                <select
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    const newCat = categoryInfo[e.target.value];
                    if (newCat?.metrics?.length > 0) {
                      setMetric(newCat.metrics[0]);
                    }
                  }}
                  className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm"
                >
                  {Object.keys(categoryInfo).map(cat => (
                    <option key={cat} value={cat}>
                      {cat.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-terminal-muted mb-1">Metric</label>
                <select
                  value={metric}
                  onChange={(e) => setMetric(e.target.value)}
                  className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm"
                >
                  {currentCategory.metrics.map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>

            <p className="text-xs text-terminal-muted">
              {currentCategory.description}
            </p>

            {/* Value and Date */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-terminal-muted mb-1">Value</label>
                <input
                  type="number"
                  step="any"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm"
                  placeholder="Enter value"
                  required
                />
              </div>
              <div>
                <label className="block text-xs text-terminal-muted mb-1">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm"
                  required
                />
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs text-terminal-muted mb-1">Notes / Source</label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm"
                placeholder="e.g., From UxC weekly report"
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={saving || !value}
              className="w-full px-4 py-2 bg-terminal-green/20 border border-terminal-green/30 text-terminal-green rounded hover:bg-terminal-green/30 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Add Entry'}
            </button>
          </form>

          {/* Recent Entries */}
          {recentEntries.length > 0 && (
            <div className="mt-6 pt-4 border-t border-terminal-border">
              <h3 className="text-xs text-terminal-muted uppercase mb-2">Recent Entries (this session)</h3>
              <div className="space-y-2">
                {recentEntries.map((entry, i) => (
                  <div key={i} className="flex justify-between text-sm bg-terminal-bg/50 rounded p-2">
                    <div>
                      <span className="font-medium">{entry.category}/{entry.metric}</span>
                      <span className="text-terminal-muted ml-2">{entry.date}</span>
                    </div>
                    <span className="text-terminal-green">{entry.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick Entry Templates */}
          <div className="mt-6 pt-4 border-t border-terminal-border">
            <h3 className="text-xs text-terminal-muted uppercase mb-2">Quick Entry Templates</h3>
            <div className="grid grid-cols-2 gap-2">
              <QuickButton
                label="Uranium Spot"
                onClick={() => { setCategory('uranium'); setMetric('spot'); }}
              />
              <QuickButton
                label="Uranium Term"
                onClick={() => { setCategory('uranium'); setMetric('term'); }}
              />
              <QuickButton
                label="NdPr Price"
                onClick={() => { setCategory('rareearth'); setMetric('NdPr'); }}
              />
              <QuickButton
                label="Brazil SELIC"
                onClick={() => { setCategory('brazil_macro'); setMetric('selic'); }}
              />
              <QuickButton
                label="US PMI"
                onClick={() => { setCategory('pmi'); setMetric('US_headline'); }}
              />
              <QuickButton
                label="JGB 10Y"
                onClick={() => { setCategory('japan'); setMetric('jgb_10y'); }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function QuickButton({ label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-2 text-sm bg-terminal-bg border border-terminal-border rounded hover:border-terminal-green/50 text-left"
    >
      {label}
    </button>
  );
}

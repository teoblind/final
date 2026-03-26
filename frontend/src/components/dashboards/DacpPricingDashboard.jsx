import React, { useState, useEffect, useRef, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const CATEGORIES = ['All', 'Flatwork', 'Foundations', 'Curb & Gutter', 'Walls', 'Structural', 'Decorative', 'Demolition', 'Rebar', 'Accessories'];

const CATEGORY_PREFIXES = {
  'Flatwork': 'FW',
  'Foundations': 'FN',
  'Curb & Gutter': 'CG',
  'Walls': 'WL',
  'Structural': 'ST',
  'Decorative': 'DC',
  'Demolition': 'DM',
  'Rebar': 'RB',
  'Accessories': 'AC',
};

const fmt = (v) => {
  if (v == null || isNaN(v)) return '$0.00';
  return `$${Number(v).toFixed(2)}`;
};

function EditableCell({ value, onSave, type = 'text', align = 'left' }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const inputRef = useRef(null);

  useEffect(() => { setDraft(value ?? ''); }, [value]);
  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);

  const commit = () => {
    setEditing(false);
    const parsed = type === 'number' ? parseFloat(draft) || 0 : draft;
    if (parsed !== value) onSave(parsed);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type={type === 'number' ? 'number' : 'text'}
        step={type === 'number' ? '0.01' : undefined}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') { setDraft(value ?? ''); setEditing(false); }
          if (e.key === 'Tab') commit();
        }}
        className={`w-full bg-white border border-[#1e3a5f] rounded px-1.5 py-0.5 text-[12px] outline-none ${align === 'right' ? 'text-right' : 'text-left'}`}
      />
    );
  }

  return (
    <span
      onClick={() => setEditing(true)}
      className="cursor-pointer hover:bg-[#e8eef5] rounded px-1.5 py-0.5 -mx-1.5 -my-0.5 block transition-colors"
      title="Click to edit"
    >
      {type === 'number' ? fmt(value) : (value || '\u2014')}
    </span>
  );
}

export default function DacpPricingDashboard() {
  const [pricing, setPricing] = useState([]);
  const [activeCategory, setActiveCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [newItem, setNewItem] = useState({ category: '', item: '', unit: '', material_cost: 0, labor_cost: 0, equipment_cost: 0, unit_price: 0, notes: '' });

  const token = localStorage.getItem('auth_token');
  const headers = { Authorization: `Bearer ${token}` };

  const fetchPricing = useCallback(() => {
    fetch(`${API_BASE}/v1/estimates/pricing`, { headers })
      .then(r => r.json())
      .then(data => setPricing(data.pricing || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchPricing(); }, [fetchPricing]);

  // Derive visible categories from data
  const allCategories = [...new Set(pricing.map(p => p.category))].sort();
  const tabs = ['All', ...allCategories];

  const filtered = pricing.filter(p => {
    if (activeCategory !== 'All' && p.category !== activeCategory) return false;
    if (search) {
      const q = search.toLowerCase();
      return p.item.toLowerCase().includes(q) || p.category.toLowerCase().includes(q) || (p.notes || '').toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
    }
    return true;
  });

  // Group by category for totals
  const categoryGroups = {};
  for (const p of filtered) {
    if (!categoryGroups[p.category]) categoryGroups[p.category] = [];
    categoryGroups[p.category].push(p);
  }

  const handleUpdate = async (id, field, value) => {
    setSaving(id);
    try {
      const res = await fetch(`${API_BASE}/v1/estimates/pricing/${id}`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      });
      const data = await res.json();
      if (data.pricing) setPricing(data.pricing);
    } catch (e) { console.error(e); }
    setSaving(null);
  };

  const handleCreate = async () => {
    const cat = newItem.category || (activeCategory !== 'All' ? activeCategory : '');
    if (!cat || !newItem.item || !newItem.unit) return;
    const prefix = CATEGORY_PREFIXES[cat] || cat.substring(0, 2).toUpperCase();
    const existingInCat = pricing.filter(p => p.category === cat);
    const nextNum = existingInCat.length + 1;
    const id = `${prefix}-${String(nextNum).padStart(3, '0')}`;

    try {
      const res = await fetch(`${API_BASE}/v1/estimates/pricing`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newItem, category: cat, id }),
      });
      const data = await res.json();
      if (data.pricing) setPricing(data.pricing);
      setShowAdd(false);
      setNewItem({ category: '', item: '', unit: '', material_cost: 0, labor_cost: 0, equipment_cost: 0, unit_price: 0, notes: '' });
    } catch (e) { console.error(e); }
  };

  const handleDelete = async (id) => {
    try {
      await fetch(`${API_BASE}/v1/estimates/pricing/${id}`, {
        method: 'DELETE',
        headers,
      });
      setPricing(prev => prev.filter(p => p.id !== id));
      setDeleteConfirm(null);
    } catch (e) { console.error(e); }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-24"><div className="spinner w-10 h-10" /></div>;
  }

  return (
    <div className="p-6 lg:px-7 lg:py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-lg font-heading font-bold text-terminal-text tracking-tight">Pricing Table</h1>
          <p className="text-[12px] text-terminal-muted mt-0.5"><span className="font-mono">{pricing.length}</span> items across <span className="font-mono">{allCategories.length}</span> categories</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="px-3.5 py-1.5 bg-[#1e3a5f] text-white rounded-lg text-[12px] font-heading font-semibold hover:bg-[#2a4f7a] transition-colors"
        >
          + Add Item
        </button>
      </div>

      {/* Stats Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 border border-terminal-border rounded-[14px] overflow-hidden mb-5" style={{ gap: '1px', background: 'var(--t-border)' }}>
        {allCategories.slice(0, 6).map(cat => {
          const items = pricing.filter(p => p.category === cat);
          const avgPrice = items.length > 0 ? items.reduce((s, p) => s + (p.unit_price || 0), 0) / items.length : 0;
          return (
            <div key={cat} className="bg-terminal-panel p-[14px_16px]">
              <div className="text-[10px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1">{cat}</div>
              <div className="text-xl font-display text-terminal-text tabular-nums leading-none">{items.length}</div>
              <div className="text-[11px] font-mono font-semibold mt-1 text-[#1e3a5f]">avg {fmt(avgPrice)}/{items[0]?.unit || 'unit'}</div>
            </div>
          );
        })}
      </div>

      {/* Search + Category Tabs */}
      <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
        <div className="px-[18px] py-[14px] border-b border-[#f0eeea]">
          <div className="flex items-center gap-3 mb-3">
            <div className="relative flex-1 max-w-xs">
              <input
                type="text"
                placeholder="Search items..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-3 pr-3 py-1.5 bg-[#f5f4f0] border border-terminal-border rounded-lg text-[12px] text-terminal-text placeholder:text-terminal-muted outline-none focus:border-[#1e3a5f] transition-colors"
              />
            </div>
            <span className="text-[11px] font-mono text-terminal-muted">{filtered.length} items</span>
          </div>
          <div className="flex gap-1 flex-wrap">
            {tabs.map(cat => {
              const count = cat === 'All' ? pricing.length : pricing.filter(p => p.category === cat).length;
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-heading font-semibold transition-all ${
                    activeCategory === cat
                      ? 'bg-[#1e3a5f] text-white'
                      : 'bg-[#f5f4f0] text-terminal-muted hover:bg-[#eeedea]'
                  }`}
                >
                  {cat} (<span className="font-mono">{count}</span>)
                </button>
              );
            })}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {Object.entries(categoryGroups).map(([category, items]) => (
            <div key={category}>
              {/* Category Header */}
              <div className="px-[18px] py-2 bg-[#f5f4f0] border-b border-[#f0eeea] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-heading font-bold text-[#1e3a5f] uppercase tracking-[0.5px]">{category}</span>
                  <span className="text-[10px] font-mono text-terminal-muted">{items.length} items</span>
                </div>
                <span className="text-[10px] text-terminal-muted font-mono font-medium tabular-nums">
                  avg unit price: {fmt(items.reduce((s, p) => s + (p.unit_price || 0), 0) / items.length)}
                </span>
              </div>

              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-[#f0eeea] bg-terminal-panel">
                    <th className="text-left py-2 px-[18px] font-heading font-semibold text-terminal-muted w-8">ID</th>
                    <th className="text-left py-2 px-2 font-heading font-semibold text-terminal-muted">Item</th>
                    <th className="text-left py-2 px-2 font-heading font-semibold text-terminal-muted w-14">Unit</th>
                    <th className="text-right py-2 px-2 font-heading font-semibold text-terminal-muted w-24">Material $</th>
                    <th className="text-right py-2 px-2 font-heading font-semibold text-terminal-muted w-24">Labor $</th>
                    <th className="text-right py-2 px-2 font-heading font-semibold text-terminal-muted w-24">Equipment $</th>
                    <th className="text-right py-2 px-2 font-heading font-semibold text-terminal-muted w-24">Total $/Unit</th>
                    <th className="text-left py-2 px-2 font-heading font-semibold text-terminal-muted">Notes</th>
                    <th className="py-2 px-2 w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((p) => (
                    <tr key={p.id} className={`border-b border-[#f0eeea] hover:bg-[#fafaf8] transition-colors ${saving === p.id ? 'opacity-60' : ''}`}>
                      <td className="py-2 px-[18px] text-terminal-muted font-mono text-[10px]">{p.id}</td>
                      <td className="py-2 px-2 text-terminal-text font-medium">
                        <EditableCell value={p.item} onSave={(v) => handleUpdate(p.id, 'item', v)} />
                      </td>
                      <td className="py-2 px-2 text-terminal-muted">
                        <EditableCell value={p.unit} onSave={(v) => handleUpdate(p.id, 'unit', v)} />
                      </td>
                      <td className="py-2 px-2 text-right font-mono tabular-nums text-terminal-text">
                        <EditableCell value={p.material_cost} type="number" align="right" onSave={(v) => handleUpdate(p.id, 'material_cost', v)} />
                      </td>
                      <td className="py-2 px-2 text-right font-mono tabular-nums text-terminal-text">
                        <EditableCell value={p.labor_cost} type="number" align="right" onSave={(v) => handleUpdate(p.id, 'labor_cost', v)} />
                      </td>
                      <td className="py-2 px-2 text-right font-mono tabular-nums text-terminal-text">
                        <EditableCell value={p.equipment_cost} type="number" align="right" onSave={(v) => handleUpdate(p.id, 'equipment_cost', v)} />
                      </td>
                      <td className="py-2 px-2 text-right font-mono tabular-nums font-semibold text-[#1e3a5f]">
                        <EditableCell value={p.unit_price} type="number" align="right" onSave={(v) => handleUpdate(p.id, 'unit_price', v)} />
                      </td>
                      <td className="py-2 px-2 text-[#6b6b65] max-w-[200px]">
                        <EditableCell value={p.notes} onSave={(v) => handleUpdate(p.id, 'notes', v)} />
                      </td>
                      <td className="py-2 px-2 text-center">
                        {deleteConfirm === p.id ? (
                          <div className="flex items-center gap-1">
                            <button onClick={() => handleDelete(p.id)} className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-semibold hover:bg-red-200">Yes</button>
                            <button onClick={() => setDeleteConfirm(null)} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-semibold hover:bg-gray-200">No</button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeleteConfirm(p.id)}
                            className="text-terminal-muted hover:text-red-600 transition-colors text-[11px]"
                            title="Delete item"
                          >
                            &times;
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {filtered.length === 0 && (
            <div className="px-[18px] py-12 text-center text-terminal-muted text-sm">
              {search ? 'No items match your search' : 'No pricing items found'}
            </div>
          )}
        </div>
      </div>

      {/* Add Item Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowAdd(false)}>
          <div className="bg-terminal-panel border border-terminal-border rounded-[14px] w-full max-w-lg p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-heading font-bold text-terminal-text">Add Pricing Item</h2>
              <button onClick={() => setShowAdd(false)} className="text-terminal-muted hover:text-terminal-text text-lg">&times;</button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1 block">Category</label>
                  <select
                    value={newItem.category || (activeCategory !== 'All' ? activeCategory : '')}
                    onChange={e => setNewItem(p => ({ ...p, category: e.target.value }))}
                    className="w-full px-2.5 py-1.5 bg-[#f5f4f0] border border-terminal-border rounded-lg text-[12px] text-terminal-text outline-none focus:border-[#1e3a5f]"
                  >
                    <option value="">Select...</option>
                    {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
                    <option value="__new">+ New Category</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1 block">Unit</label>
                  <input
                    type="text"
                    placeholder="SF, LF, EA, CY..."
                    value={newItem.unit}
                    onChange={e => setNewItem(p => ({ ...p, unit: e.target.value }))}
                    className="w-full px-2.5 py-1.5 bg-[#f5f4f0] border border-terminal-border rounded-lg text-[12px] text-terminal-text outline-none focus:border-[#1e3a5f]"
                  />
                </div>
              </div>

              {newItem.category === '__new' && (
                <div>
                  <label className="text-[10px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1 block">New Category Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Waterproofing"
                    onChange={e => setNewItem(p => ({ ...p, category: e.target.value }))}
                    className="w-full px-2.5 py-1.5 bg-[#f5f4f0] border border-terminal-border rounded-lg text-[12px] text-terminal-text outline-none focus:border-[#1e3a5f]"
                  />
                </div>
              )}

              <div>
                <label className="text-[10px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1 block">Item Description</label>
                <input
                  type="text"
                  placeholder='e.g. 4" Slab on Grade'
                  value={newItem.item}
                  onChange={e => setNewItem(p => ({ ...p, item: e.target.value }))}
                  className="w-full px-2.5 py-1.5 bg-[#f5f4f0] border border-terminal-border rounded-lg text-[12px] text-terminal-text outline-none focus:border-[#1e3a5f]"
                />
              </div>

              <div className="grid grid-cols-4 gap-3">
                <div>
                  <label className="text-[10px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1 block">Material $</label>
                  <input type="number" step="0.01" value={newItem.material_cost} onChange={e => setNewItem(p => ({ ...p, material_cost: parseFloat(e.target.value) || 0 }))} className="w-full px-2.5 py-1.5 bg-[#f5f4f0] border border-terminal-border rounded-lg text-[12px] font-mono text-terminal-text outline-none focus:border-[#1e3a5f] text-right tabular-nums" />
                </div>
                <div>
                  <label className="text-[10px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1 block">Labor $</label>
                  <input type="number" step="0.01" value={newItem.labor_cost} onChange={e => setNewItem(p => ({ ...p, labor_cost: parseFloat(e.target.value) || 0 }))} className="w-full px-2.5 py-1.5 bg-[#f5f4f0] border border-terminal-border rounded-lg text-[12px] font-mono text-terminal-text outline-none focus:border-[#1e3a5f] text-right tabular-nums" />
                </div>
                <div>
                  <label className="text-[10px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1 block">Equip $</label>
                  <input type="number" step="0.01" value={newItem.equipment_cost} onChange={e => setNewItem(p => ({ ...p, equipment_cost: parseFloat(e.target.value) || 0 }))} className="w-full px-2.5 py-1.5 bg-[#f5f4f0] border border-terminal-border rounded-lg text-[12px] font-mono text-terminal-text outline-none focus:border-[#1e3a5f] text-right tabular-nums" />
                </div>
                <div>
                  <label className="text-[10px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1 block">Unit Price</label>
                  <input type="number" step="0.01" value={newItem.unit_price} onChange={e => setNewItem(p => ({ ...p, unit_price: parseFloat(e.target.value) || 0 }))} className="w-full px-2.5 py-1.5 bg-[#f5f4f0] border border-terminal-border rounded-lg text-[12px] font-mono text-terminal-text outline-none focus:border-[#1e3a5f] text-right tabular-nums" />
                </div>
              </div>

              <div>
                <label className="text-[10px] font-heading font-bold text-terminal-muted uppercase tracking-[1px] mb-1 block">Notes</label>
                <input
                  type="text"
                  placeholder="Mix spec, rebar, finish..."
                  value={newItem.notes}
                  onChange={e => setNewItem(p => ({ ...p, notes: e.target.value }))}
                  className="w-full px-2.5 py-1.5 bg-[#f5f4f0] border border-terminal-border rounded-lg text-[12px] text-terminal-text outline-none focus:border-[#1e3a5f]"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowAdd(false)} className="px-3.5 py-1.5 bg-[#f5f4f0] border border-terminal-border rounded-lg text-[12px] font-heading font-semibold text-terminal-muted hover:bg-[#eeedea]">
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newItem.item || !newItem.unit || (!newItem.category && activeCategory === 'All')}
                className="px-3.5 py-1.5 bg-[#1e3a5f] text-white rounded-lg text-[12px] font-heading font-semibold hover:bg-[#2a4f7a] disabled:opacity-40 transition-colors"
              >
                Add Item
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

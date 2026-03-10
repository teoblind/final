import React, { useState } from 'react';
import { FileText, Plus, Trash2, Edit2, Tag, Search } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useApi, postApi, putApi, deleteApi } from '../hooks/useApi';
import { formatDate } from '../utils/formatters';

const PANELS = [
  { value: '', label: 'All Panels' },
  { value: 'hashprice', label: 'Hashprice' },
  { value: 'eu_us_tech', label: 'EU/US Tech' },
  { value: 'btc_reserve', label: 'BTC Reserve' },
  { value: 'fiber_infrastructure', label: 'Fiber Infrastructure' },
  { value: 'japan_macro', label: 'Japan Macro' },
  { value: 'uranium', label: 'Uranium' },
  { value: 'brazil_compute', label: 'Brazil Compute' },
  { value: 'pmi', label: 'PMI' },
  { value: 'rare_earths', label: 'Rare Earths' },
  { value: 'iran_hashrate', label: 'Iran Hashrate' },
  { value: 'trade_routes', label: 'Trade Routes' },
  { value: 'datacenter_power', label: 'Data Centers' },
  { value: 'correlation', label: 'Correlations' },
  { value: 'general', label: 'General' }
];

export default function NotesPanel() {
  const [selectedPanel, setSelectedPanel] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingNote, setEditingNote] = useState(null);
  const [viewingNote, setViewingNote] = useState(null);

  const { data, loading, refetch } = useApi('/notes', {
    params: selectedPanel ? { panel: selectedPanel } : {}
  });

  const notes = data?.notes || [];
  const filteredNotes = searchQuery
    ? notes.filter(n =>
        n.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.tags?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : notes;

  const handleDelete = async (id) => {
    if (!confirm('Delete this note?')) return;
    try {
      await deleteApi(`/notes/${id}`);
      refetch();
    } catch (err) {
      alert('Failed to delete: ' + err.message);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="bg-terminal-panel border border-terminal-border rounded-lg">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-terminal-border">
          <div className="flex items-center gap-2">
            <FileText className="text-terminal-green" size={20} />
            <h2 className="text-lg font-bold">Trading Notes & Journal</h2>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-terminal-green/20 border border-terminal-green/30 text-terminal-green rounded hover:bg-terminal-green/30"
          >
            <Plus size={14} />
            New Note
          </button>
        </div>

        {/* Filters */}
        <div className="flex gap-4 p-4 border-b border-terminal-border">
          <div className="flex-1 relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-terminal-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search notes..."
              className="w-full bg-terminal-bg border border-terminal-border rounded pl-9 pr-3 py-2 text-sm"
            />
          </div>
          <select
            value={selectedPanel}
            onChange={(e) => setSelectedPanel(e.target.value)}
            className="bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm"
          >
            {PANELS.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        {/* Notes List */}
        <div className="p-4">
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="spinner w-6 h-6" />
            </div>
          ) : filteredNotes.length === 0 ? (
            <p className="text-terminal-muted text-center py-8">
              No notes yet. Click "New Note" to create one.
            </p>
          ) : (
            <div className="space-y-3">
              {filteredNotes.map((note) => (
                <div
                  key={note.id}
                  className="bg-terminal-bg/50 rounded p-4 border border-terminal-border hover:border-terminal-green/30 transition-colors"
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex-1">
                      <h4
                        className="font-medium cursor-pointer hover:text-terminal-green"
                        onClick={() => setViewingNote(note)}
                      >
                        {note.title || 'Untitled'}
                      </h4>
                      <div className="flex gap-2 text-xs text-terminal-muted mt-1">
                        <span>{formatDate(note.created_at)}</span>
                        {note.panel && (
                          <span className="px-1.5 py-0.5 bg-terminal-border rounded">
                            {PANELS.find(p => p.value === note.panel)?.label || note.panel}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEditingNote(note)}
                        className="p-1.5 hover:bg-terminal-border rounded"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(note.id)}
                        className="p-1.5 text-terminal-red hover:bg-terminal-red/10 rounded"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="text-sm text-terminal-muted line-clamp-2">
                    {note.content.slice(0, 200)}...
                  </div>

                  {note.tags && (
                    <div className="flex gap-1 mt-2">
                      {note.tags.split(',').map((tag, i) => (
                        <span key={i} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-terminal-border rounded text-xs">
                          <Tag size={10} />
                          {tag.trim()}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Add/Edit Modal */}
      {(showAddModal || editingNote) && (
        <NoteModal
          note={editingNote}
          onClose={() => {
            setShowAddModal(false);
            setEditingNote(null);
          }}
          onSuccess={refetch}
        />
      )}

      {/* View Modal */}
      {viewingNote && (
        <ViewNoteModal
          note={viewingNote}
          onClose={() => setViewingNote(null)}
          onEdit={() => {
            setEditingNote(viewingNote);
            setViewingNote(null);
          }}
        />
      )}
    </div>
  );
}

function NoteModal({ note, onClose, onSuccess }) {
  const [form, setForm] = useState({
    title: note?.title || '',
    content: note?.content || '',
    panel: note?.panel || '',
    tags: note?.tags || ''
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      if (note) {
        await putApi(`/notes/${note.id}`, form);
      } else {
        await postApi('/notes', form);
      }
      onSuccess();
      onClose();
    } catch (err) {
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-terminal-panel border border-terminal-border rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <h3 className="text-lg font-bold mb-4">{note ? 'Edit Note' : 'New Note'}</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-terminal-muted mb-1">Title</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm"
              placeholder="Note title"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-terminal-muted mb-1">Panel</label>
              <select
                value={form.panel}
                onChange={(e) => setForm({ ...form, panel: e.target.value })}
                className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm"
              >
                {PANELS.map(p => (
                  <option key={p.value} value={p.value}>{p.label || 'None'}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-terminal-muted mb-1">Tags (comma-separated)</label>
              <input
                type="text"
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
                className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm"
                placeholder="thesis, bitcoin, energy"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-terminal-muted mb-1">Content (Markdown supported)</label>
            <textarea
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-sm font-sans"
              rows={15}
              placeholder="Write your note here...&#10;&#10;Supports **markdown** formatting."
              required
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
              {saving ? 'Saving...' : 'Save Note'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ViewNoteModal({ note, onClose, onEdit }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-terminal-panel border border-terminal-border rounded-lg w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex justify-between items-center p-4 border-b border-terminal-border">
          <div>
            <h3 className="text-lg font-bold">{note.title || 'Untitled'}</h3>
            <p className="text-xs text-terminal-muted">{formatDate(note.created_at)}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onEdit}
              className="px-3 py-1.5 text-sm border border-terminal-border rounded hover:bg-terminal-border"
            >
              Edit
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm border border-terminal-border rounded hover:bg-terminal-border"
            >
              Close
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          <div className="markdown-content prose prose-invert max-w-none">
            <ReactMarkdown>{note.content}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../lib/hooks/useApi';

// ─── Helpers ────────────────────────────────────────────────────────────────

const TYPE_CLS = { meeting: 'bg-[#1a6b3c]', note: 'bg-[#2563eb]', email: 'bg-[#7c3aed]' };
const SUB_CLS = { green: 'text-[#1a6b3c]', warn: 'text-[#b8860b]', flat: 'text-terminal-muted' };
const PERSON_COLORS = ['bg-[#1a6b3c]', 'bg-[#2563eb]', 'bg-[#7c3aed]', 'bg-[#b8860b]', 'bg-[#64748b]', 'bg-[#c0392b]'];

function formatDuration(seconds) {
  if (!seconds) return '-';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatFullDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function initials(name) {
  return name.split(/\s+/).map(w => w[0]?.toUpperCase()).join('').slice(0, 2);
}

function dueMeta(item) {
  if (item.status === 'completed') {
    return { text: `Completed ${item.completed_at ? formatDate(item.completed_at) : ''}`, cls: 'text-[#1a6b3c]' };
  }
  if (!item.due_date) return { text: 'No due date', cls: 'text-[#9a9a92]' };
  const now = new Date();
  const due = new Date(item.due_date);
  const diffDays = Math.round((due - now) / 86400000);
  if (diffDays < 0) return { text: `Overdue - ${formatDate(item.due_date)}`, cls: 'text-[#c0392b]' };
  if (diffDays === 0) return { text: 'Due today', cls: 'text-[#b8860b]' };
  return { text: formatDate(item.due_date), cls: 'text-[#9a9a92]' };
}

// ─── Fireflies-style Summary Renderer ───────────────────────────────────────

const SECTION_ICONS = {
  'overview': '📋',
  'topics discussed': '💬',
  'key decisions': '⚡',
  'notable quotes': '💡',
  'next steps': '➡️',
};

const SECTION_COLORS = {
  'overview': { border: '#1a6b3c', bg: '#edf7f0', label: '#1a6b3c' },
  'topics discussed': { border: '#2563eb', bg: '#eff6ff', label: '#2563eb' },
  'key decisions': { border: '#7c3aed', bg: '#f5f0ff', label: '#7c3aed' },
  'notable quotes': { border: '#b8860b', bg: '#fdf6e8', label: '#b8860b' },
  'next steps': { border: '#1a6b3c', bg: '#edf7f0', label: '#1a6b3c' },
};

function SummaryRenderer({ summary }) {
  if (!summary) return null;

  // Parse structured markdown into sections
  const sections = [];
  const lines = summary.split('\n');
  let current = null;

  for (const line of lines) {
    const headerMatch = line.match(/^##\s+(.+)/);
    if (headerMatch) {
      if (current) sections.push(current);
      current = { title: headerMatch[1].trim(), lines: [] };
    } else if (current) {
      if (line.trim()) current.lines.push(line);
    }
  }
  if (current) sections.push(current);

  // If no sections parsed (old-style plain text summary), render as overview
  if (sections.length === 0) {
    return (
      <div className="bg-[#f5f4f0] rounded-[10px] p-[14px_16px] border-l-[3px] border-l-[#1a6b3c]">
        <div className="text-[10px] font-bold text-[#1a6b3c] tracking-[0.8px] uppercase mb-1.5 font-heading">AI Summary</div>
        <div className="text-[13px] text-terminal-text leading-relaxed">{summary}</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sections.map((section, i) => {
        const key = section.title.toLowerCase();
        const colors = SECTION_COLORS[key] || { border: '#9a9a92', bg: '#f5f4f0', label: '#6b6b65' };
        const icon = SECTION_ICONS[key] || '📌';
        const isQuotes = key === 'notable quotes';

        return (
          <div
            key={i}
            className="rounded-[10px] p-[14px_16px] border-l-[3px]"
            style={{ borderLeftColor: colors.border, background: colors.bg }}
          >
            <div className="text-[10px] font-bold tracking-[0.8px] uppercase mb-2 flex items-center gap-1.5 font-heading" style={{ color: colors.label }}>
              <span>{icon}</span>
              {section.title}
            </div>
            <div className="space-y-1.5">
              {section.lines.map((line, j) => {
                const trimmed = line.replace(/^[-*]\s*/, '').trim();
                if (!trimmed) return null;

                // Check if line starts with bullet
                const isBullet = /^[-*]\s/.test(line.trim());

                if (isQuotes && trimmed.startsWith('"')) {
                  // Render quotes with italic styling
                  return (
                    <div key={j} className="flex items-start gap-2 text-[13px] leading-relaxed">
                      <div className="w-[3px] h-[3px] rounded-full shrink-0 mt-[8px]" style={{ background: colors.border }} />
                      <div className="text-terminal-text italic">{trimmed}</div>
                    </div>
                  );
                }

                if (isBullet) {
                  // Bold text between ** markers
                  const parts = trimmed.split(/(\*\*[^*]+\*\*)/);
                  return (
                    <div key={j} className="flex items-start gap-2 text-[13px] leading-relaxed">
                      <div className="w-[3px] h-[3px] rounded-full shrink-0 mt-[8px]" style={{ background: colors.border }} />
                      <div className="text-terminal-text">
                        {parts.map((part, k) =>
                          part.startsWith('**') && part.endsWith('**')
                            ? <span key={k} className="font-semibold">{part.slice(2, -2)}</span>
                            : <span key={k}>{part}</span>
                        )}
                      </div>
                    </div>
                  );
                }

                // Plain paragraph text
                return <div key={j} className="text-[13px] text-terminal-text leading-relaxed">{trimmed}</div>;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Audio Player ─────────────────────────────────────────────────────────────

const SPEAKER_COLORS = ['#1a6b3c', '#2563eb', '#7c3aed', '#b8860b', '#c0392b', '#0891b2'];
const SPEAKER_BG = ['#edf7f0', '#eff6ff', '#f5f0ff', '#fdf6e8', '#fef2f2', '#ecfeff'];

const AudioPlayer = React.forwardRef(function AudioPlayer({ audioUrl, onTimeUpdate }, ref) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);

  const toggle = () => {
    if (!audioRef.current) return;
    if (playing) audioRef.current.pause();
    else audioRef.current.play();
    setPlaying(!playing);
  };

  const seek = (e) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = pct * duration;
  };

  const seekTo = useCallback((time) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = time;
    if (!playing) { audioRef.current.play(); setPlaying(true); }
  }, [playing]);

  React.useImperativeHandle(ref, () => ({ seekTo }), [seekTo]);

  const cycleSpeed = () => {
    const speeds = [1, 1.5, 2];
    const next = speeds[(speeds.indexOf(speed) + 1) % speeds.length];
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  };

  const fmt = (s) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    if (onTimeUpdate) onTimeUpdate(currentTime);
  }, [currentTime]);

  return (
    <div className="bg-[#f5f4f0] rounded-[10px] p-3 mb-4 border border-terminal-border">
      <audio
        ref={audioRef}
        src={audioUrl}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
        onEnded={() => setPlaying(false)}
      />
      <div className="flex items-center gap-3">
        <button onClick={toggle} className="w-8 h-8 rounded-full bg-[#1a6b3c] text-white flex items-center justify-center hover:opacity-80 transition-opacity shrink-0">
          {playing ? (
            <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor"><rect x="1" y="1" width="3" height="12" rx="1"/><rect x="8" y="1" width="3" height="12" rx="1"/></svg>
          ) : (
            <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor"><path d="M1 1.5v11l10-5.5z"/></svg>
          )}
        </button>
        <div className="flex-1">
          <div className="relative h-2 bg-[#e0ddd8] rounded-full cursor-pointer group" onClick={seek}>
            <div className="absolute h-full bg-[#1a6b3c] rounded-full transition-all" style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%' }} />
            <div className="absolute w-3 h-3 bg-[#1a6b3c] rounded-full -top-0.5 opacity-0 group-hover:opacity-100 transition-opacity" style={{ left: duration ? `calc(${(currentTime / duration) * 100}% - 6px)` : '0' }} />
          </div>
        </div>
        <span className="text-[11px] font-mono text-[#6b6b65] tabular-nums w-20 text-right">{fmt(currentTime)} / {fmt(duration)}</span>
        <button onClick={cycleSpeed} className="text-[11px] font-bold text-[#6b6b65] bg-[#e0ddd8] px-2 py-1 rounded-md hover:bg-[#d0cdc8] transition-colors">{speed}x</button>
      </div>
    </div>
  );
});

// ─── Diarized Transcript Viewer ───────────────────────────────────────────────

function DiarizedTranscript({ transcriptJson, currentTime, onSeek }) {
  const containerRef = useRef(null);
  let utterances = [];
  try { utterances = typeof transcriptJson === 'string' ? JSON.parse(transcriptJson) : transcriptJson || []; } catch { utterances = []; }

  if (!utterances.length) return null;

  const speakers = [...new Set(utterances.map(u => u.speaker))].filter(s => s !== 'UNKNOWN');
  const speakerIdx = {};
  speakers.forEach((s, i) => { speakerIdx[s] = i; });

  const fmt = (s) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div ref={containerRef}>
      <div className="text-[11px] font-bold text-[#6b6b65] tracking-[0.8px] uppercase mb-2 pb-1.5 border-b border-[#f0eeea] font-heading flex items-center justify-between">
        <span>Transcript ({utterances.length} segments, {speakers.length} speakers)</span>
        <div className="flex gap-2 normal-case tracking-normal">
          {speakers.map((s, i) => (
            <span key={s} className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md" style={{ background: SPEAKER_BG[i % SPEAKER_BG.length], color: SPEAKER_COLORS[i % SPEAKER_COLORS.length] }}>
              <span className="w-2 h-2 rounded-full" style={{ background: SPEAKER_COLORS[i % SPEAKER_COLORS.length] }} />
              {s}
            </span>
          ))}
        </div>
      </div>
      <div className="max-h-[500px] overflow-y-auto space-y-2">
        {utterances.map((u, i) => {
          const idx = speakerIdx[u.speaker] ?? speakers.length;
          const color = SPEAKER_COLORS[idx % SPEAKER_COLORS.length];
          const bg = SPEAKER_BG[idx % SPEAKER_BG.length];
          const isActive = currentTime >= u.start && currentTime < (u.end || u.start + 10);
          return (
            <div
              key={i}
              className={`flex gap-3 py-2 px-2 rounded-lg transition-colors ${isActive ? 'bg-[#edf7f0]' : 'hover:bg-[#fafaf8]'}`}
              style={isActive ? { borderLeft: `3px solid ${color}` } : { borderLeft: '3px solid transparent' }}
            >
              <button
                onClick={() => onSeek?.(u.start)}
                className="text-[11px] font-mono text-[#9a9a92] hover:text-[#1a6b3c] shrink-0 mt-0.5 cursor-pointer transition-colors"
                title="Jump to this point"
              >
                {fmt(u.start)}
              </button>
              <div className="flex-1">
                <span className="text-[11px] font-bold mr-2" style={{ color }}>{u.speaker}</span>
                <span className="text-[13px] text-terminal-text leading-relaxed">{u.text}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Share Modal ──────────────────────────────────────────────────────────────

function ShareModal({ entry, onClose }) {
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [enabled, setEnabled] = useState(!!entry.share_enabled);

  const generateLink = async () => {
    setLoading(true);
    try {
      const res = await api.post(`/v1/knowledge/entries/${entry.id}/share`);
      setShareUrl(res.data.share_url);
      setEnabled(true);
    } catch (err) {
      console.error('Share failed:', err);
    } finally { setLoading(false); }
  };

  const disableShare = async () => {
    try {
      await api.delete(`/v1/knowledge/entries/${entry.id}/share`);
      setEnabled(false);
      setShareUrl('');
    } catch (err) { console.error('Disable share failed:', err); }
  };

  const copy = () => {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  useEffect(() => {
    if (entry.share_token && entry.share_enabled) {
      setShareUrl(`${window.location.origin}/m/${entry.share_token}`);
      setEnabled(true);
    }
  }, [entry]);

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-2xl p-6 w-[420px] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-terminal-text">Share Meeting</h3>
          <button onClick={onClose} className="text-terminal-muted hover:text-terminal-text text-lg">&times;</button>
        </div>
        <p className="text-[13px] text-terminal-muted mb-4">Anyone with the link can view the transcript, summary, and audio recording.</p>
        {!enabled ? (
          <button onClick={generateLink} disabled={loading} className="w-full py-2.5 bg-[#1a6b3c] text-white rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50">
            {loading ? 'Generating...' : 'Generate Share Link'}
          </button>
        ) : (
          <>
            <div className="flex gap-2 mb-3">
              <input value={shareUrl} readOnly className="flex-1 px-3 py-2 border border-terminal-border rounded-lg text-[13px] bg-[#f5f4f0] text-terminal-text" />
              <button onClick={copy} className="px-4 py-2 bg-[#1a6b3c] text-white rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity shrink-0">
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <button onClick={disableShare} className="text-[12px] text-[#c0392b] hover:underline">Disable sharing</button>
          </>
        )}
      </div>
    </div>
  );
}

function Card({ title, meta, children }) {
  return (
    <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
      <div className="px-[18px] py-[14px] flex items-center justify-between border-b border-[#f0eeea]">
        <span className="text-xs font-bold text-terminal-text tracking-[0.3px] font-heading">{title}</span>
        {meta && <span className="text-[11px] text-terminal-muted font-mono">{meta}</span>}
      </div>
      {children}
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function MeetingsDashboard() {
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [meetings, setMeetings] = useState([]);
  const [actionItems, setActionItems] = useState([]);
  const [entities, setEntities] = useState([]);
  const [selectedDetail, setSelectedDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showShareModal, setShowShareModal] = useState(false);
  const [audioTime, setAudioTime] = useState(0);
  const searchRef = React.useRef(null);
  const audioPlayerRef = useRef(null);

  // ─── Fetch data ─────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      const [meetingsRes, actionsRes, entitiesRes] = await Promise.all([
        api.get('/v1/knowledge/recent', { params: { limit: 50 } }),
        api.get('/v1/knowledge/action-items', { params: { status: 'all', limit: 100 } }),
        api.get('/v1/knowledge/entities', { params: { type: 'person', limit: 50 } }),
      ]);
      setMeetings(meetingsRes.data || []);
      setActionItems(actionsRes.data || []);
      setEntities(entitiesRes.data || []);
    } catch (err) {
      console.error('MeetingsDashboard fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // ─── Derived data ───────────────────────────────────────────────────────
  const filteredMeetings = meetings.filter(m => {
    if (filter !== 'all' && m.type !== filter) return false;
    if (search && !m.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Fetch full detail when selection changes
  useEffect(() => {
    const entry = filteredMeetings[selectedIdx];
    if (!entry?.id) { setSelectedDetail(null); return; }
    let cancelled = false;
    api.get(`/v1/knowledge/entries/${entry.id}`).then(res => {
      if (!cancelled) setSelectedDetail(res.data);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [selectedIdx, meetings, filter, search]);

  const openActions = actionItems.filter(a => a.status !== 'completed');
  const totalHours = meetings.reduce((sum, m) => sum + (m.duration_seconds || 0), 0) / 3600;
  const avgMin = meetings.length ? Math.round(totalHours * 60 / meetings.length) : 0;

  const stats = [
    { label: 'Total Entries', val: String(meetings.length), sub: 'Knowledge base', subCls: 'flat', highlight: true },
    { label: 'Hours Captured', val: totalHours.toFixed(1), unit: ' hrs', sub: `Avg ${avgMin} min each`, subCls: 'flat' },
    { label: 'Action Items', val: String(actionItems.length), sub: `${openActions.length} open`, subCls: openActions.length > 0 ? 'warn' : 'green' },
    { label: 'People Tracked', val: String(entities.length), sub: 'From knowledge graph', subCls: 'flat' },
  ];

  // ─── Action item toggle ─────────────────────────────────────────────────
  const toggleAction = async (item) => {
    const newStatus = item.status === 'completed' ? 'open' : 'completed';
    try {
      await api.patch(`/v1/knowledge/action-items/${item.id}`, { status: newStatus });
      setActionItems(prev => prev.map(a =>
        a.id === item.id ? { ...a, status: newStatus, completed_at: newStatus === 'completed' ? new Date().toISOString() : null } : a
      ));
    } catch (err) {
      console.error('Toggle action item failed:', err);
    }
  };

  // ─── Action items count per meeting ─────────────────────────────────────
  const actionCountByEntry = {};
  actionItems.forEach(a => {
    if (!actionCountByEntry[a.entry_id]) actionCountByEntry[a.entry_id] = { open: 0, total: 0 };
    actionCountByEntry[a.entry_id].total++;
    if (a.status !== 'completed') actionCountByEntry[a.entry_id].open++;
  });

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="text-sm text-terminal-muted">Loading meetings data...</div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:px-7 lg:py-6">
      {/* Header pills */}
      <div className="flex items-center justify-end gap-2 mb-5">
        {['All', 'Meeting', 'Note', 'Email'].map(f => (
          <button
            key={f}
            onClick={() => { setFilter(f.toLowerCase()); setSelectedIdx(0); }}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all font-heading ${
              filter === f.toLowerCase()
                ? 'bg-terminal-text text-white border-terminal-text'
                : 'bg-terminal-panel text-terminal-muted border-terminal-border hover:bg-[#f5f4f0]'
            }`}
          >
            {f}
          </button>
        ))}
        <div className="w-px h-5 bg-terminal-border mx-1" />
        <button
          onClick={() => searchRef.current?.focus()}
          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-terminal-green text-white border border-terminal-green hover:opacity-90 transition-all font-heading"
        >
          Search Transcripts
        </button>
      </div>

      {/* Stats ticker */}
      <div className="flex gap-[1px] bg-terminal-border border border-terminal-border rounded-[14px] overflow-hidden mb-4">
        {stats.map((s, i) => (
          <div
            key={i}
            className="bg-terminal-panel p-[14px_18px] flex-1"
            style={s.highlight ? { background: 'linear-gradient(135deg, var(--t-panel, #fff), #edf7f0)' } : undefined}
          >
            <div className="text-[9px] font-bold text-terminal-muted uppercase tracking-[1px] mb-[3px] font-heading">{s.label}</div>
            <div className={`text-xl font-bold tabular-nums leading-none font-display ${s.valCls || 'text-terminal-text'}`}>
              {s.val}{s.unit && <span className="text-[11px] font-medium text-terminal-muted">{s.unit}</span>}
            </div>
            <div className={`text-[10px] font-semibold mt-[3px] ${SUB_CLS[s.subCls]}`}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Action Items + Meeting Library */}
      <div className="grid grid-cols-1 lg:grid-cols-[5fr_3fr] gap-4 mb-4">
        {/* Meeting Library */}
        <Card title="Meeting Library" meta={`${filteredMeetings.length} entries`}>
          {/* Search */}
          <div className="flex items-center gap-[10px] px-[18px] py-3 border-b border-[#f0eeea]">
            <input
              ref={searchRef}
              value={search}
              onChange={e => { setSearch(e.target.value); setSelectedIdx(0); }}
              className="flex-1 px-[14px] py-2 border-[1.5px] border-terminal-border rounded-[10px] text-[13px] text-terminal-text bg-[#f5f4f0] outline-none focus:border-[#1a6b3c] focus:bg-white transition-colors placeholder:text-[#c5c5bc]"
              placeholder="Search across all entries..."
            />
            <span className="text-[11px] text-terminal-muted whitespace-nowrap">{filteredMeetings.length} results</span>
          </div>
          {/* Header */}
          <div
            className="grid px-[18px] py-[10px] text-[10px] font-bold text-terminal-muted uppercase tracking-[0.8px] border-b border-terminal-border font-heading"
            style={{ gridTemplateColumns: '3fr 1.2fr 0.8fr 1fr 80px' }}
          >
            <div>Title</div><div>Date</div><div>Duration</div><div>Actions</div><div />
          </div>
          {filteredMeetings.length === 0 && (
            <div className="px-[18px] py-6 text-center text-sm text-terminal-muted">
              {meetings.length === 0 ? 'No knowledge entries yet. Meetings and notes will appear here once ingested.' : 'No entries match your search.'}
            </div>
          )}
          <div className="max-h-[420px] overflow-y-auto">
            {filteredMeetings.map((m, i) => {
              const ac = actionCountByEntry[m.id];
              const actionLabel = ac ? (ac.open > 0 ? `${ac.open} open` : 'All done') : '-';
              const actionCls = ac ? (ac.open > 0 ? 'bg-[#fdf6e8] text-[#b8860b]' : 'bg-[#edf7f0] text-[#1a6b3c]') : 'bg-[#f5f4f0] text-[#9a9a92]';
              return (
                <div
                  key={m.id}
                  onClick={() => setSelectedIdx(i)}
                  className={`grid px-[18px] py-[13px] border-b border-[#f0eeea] last:border-b-0 items-center text-[13px] hover:bg-[#f5f4f0] transition-colors cursor-pointer ${
                    selectedIdx === i ? 'bg-[#edf7f0]' : ''
                  }`}
                  style={{ gridTemplateColumns: '3fr 1.2fr 0.8fr 1fr 80px' }}
                >
                  <div className="font-semibold text-terminal-text flex items-center gap-2 truncate">
                    <div className={`w-2 h-2 rounded-[3px] shrink-0 ${TYPE_CLS[m.type] || 'bg-[#64748b]'}`} />
                    <span className="truncate">{m.title}</span>
                  </div>
                  <div className="text-xs text-[#6b6b65] font-mono">{formatDate(m.recorded_at || m.created_at)}</div>
                  <div className="font-mono text-xs text-terminal-text tabular-nums">{formatDuration(m.duration_seconds)}</div>
                  <div>
                    <span className={`text-[11px] font-semibold px-[9px] py-[3px] rounded-md ${actionCls}`}>{actionLabel}</span>
                  </div>
                  <div>
                    {m.drive_url ? (
                      <a href={m.drive_url} target="_blank" rel="noopener noreferrer" className="text-[11px] font-semibold text-[#1a6b3c] hover:opacity-70 transition-opacity" onClick={e => e.stopPropagation()}>Drive</a>
                    ) : (
                      <span className="text-[11px] font-semibold text-[#1a6b3c] hover:opacity-70 transition-opacity cursor-pointer">View</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Open Action Items */}
        <Card title="Open Action Items" meta={`${openActions.length} remaining`}>
          <div className="px-[18px] py-[14px] max-h-[500px] overflow-y-auto">
            {openActions.length === 0 && actionItems.length === 0 && (
              <div className="text-sm text-terminal-muted text-center py-4">No action items yet.</div>
            )}
            {openActions.length === 0 && actionItems.length > 0 && (
              <div className="text-sm text-[#1a6b3c] text-center py-4 font-semibold">All caught up!</div>
            )}
            {actionItems.map((ai) => {
              const done = ai.status === 'completed';
              const dm = dueMeta(ai);
              return (
                <div key={ai.id} className="flex items-start gap-[10px] py-[10px] border-b border-[#f0eeea] last:border-b-0">
                  <button
                    onClick={() => toggleAction(ai)}
                    className={`w-[18px] h-[18px] rounded-md border-[1.5px] shrink-0 mt-[1px] flex items-center justify-center cursor-pointer transition-all ${
                      done ? 'bg-[#1a6b3c] border-[#1a6b3c]' : 'border-terminal-border hover:border-[#1a6b3c]'
                    }`}
                  >
                    {done && <span className="text-[11px] text-white font-bold">✓</span>}
                  </button>
                  <div className="flex-1">
                    <div className={`text-[13px] leading-[1.4] ${done ? 'line-through text-terminal-muted' : 'text-terminal-text'}`}>{ai.title}</div>
                    <div className="flex gap-3 mt-[3px] text-[10px] flex-wrap">
                      {ai.assignee && <span className="font-semibold px-2 py-[2px] rounded-[5px] bg-[#f5f4f0] text-[#6b6b65]">{ai.assignee}</span>}
                      <span className={`font-semibold ${dm.cls}`}>{dm.text}</span>
                      {ai.source_title && <span className="text-[#c5c5bc]">from: {ai.source_title}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Transcript Preview + People */}
      <div className="grid grid-cols-1 lg:grid-cols-[5fr_3fr] gap-4 mb-4">
        {/* Transcript / Summary Preview */}
        <Card
          title={selectedDetail ? `Detail - ${selectedDetail.title}` : 'Select an entry'}
          meta={selectedDetail ? (
            <div className="flex items-center gap-2">
              {selectedDetail.drive_url && (
                <a href={selectedDetail.drive_url} target="_blank" rel="noopener noreferrer" className="text-[11px] font-semibold text-[#1a6b3c] hover:opacity-70">Open in Drive</a>
              )}
              <button
                onClick={() => setShowShareModal(true)}
                className="text-[11px] font-semibold text-[#2563eb] hover:opacity-70 transition-opacity flex items-center gap-1"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M13.5 1a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM11 2.5a2.5 2.5 0 1 1 .603 1.628l-6.718 3.12a2.499 2.499 0 0 1 0 1.504l6.718 3.12a2.5 2.5 0 1 1-.488.876l-6.718-3.12a2.5 2.5 0 1 1 0-3.256l6.718-3.12A2.5 2.5 0 0 1 11 2.5zm-8.5 4a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zm11 5.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"/></svg>
                Share
              </button>
            </div>
          ) : null}
        >
          <div className="p-[18px]">
            {!selectedDetail ? (
              <div className="text-sm text-terminal-muted text-center py-8">
                {meetings.length === 0 ? 'No entries yet.' : 'Select a meeting or entry from the library to preview.'}
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="mb-4">
                  <div className="font-serif text-lg text-terminal-text mb-1">{selectedDetail.title}</div>
                  <div className="text-xs text-terminal-muted">
                    {formatFullDate(selectedDetail.recorded_at || selectedDetail.created_at)}
                    {selectedDetail.duration_seconds ? ` - ${formatDuration(selectedDetail.duration_seconds)}` : ''}
                    {selectedDetail.source ? ` - ${selectedDetail.source}` : ''}
                  </div>
                  <div className="flex gap-1.5 mt-2">
                    <span className={`text-[10px] font-semibold px-[10px] py-[3px] rounded-md ${
                      selectedDetail.type === 'meeting' ? 'bg-[#edf7f0] text-[#1a6b3c]' :
                      selectedDetail.type === 'email' ? 'bg-[#eff6ff] text-[#2563eb]' :
                      'bg-[#f5f4f0] text-[#6b6b65]'
                    }`}>{selectedDetail.type}</span>
                    {selectedDetail.duration_seconds && (
                      <span className="text-[10px] font-semibold px-[10px] py-[3px] rounded-md bg-[#f5f4f0] text-[#6b6b65]">
                        {formatDuration(selectedDetail.duration_seconds)}
                      </span>
                    )}
                    {selectedDetail.processed ? (
                      <span className="text-[10px] font-semibold px-[10px] py-[3px] rounded-md bg-[#edf7f0] text-[#1a6b3c]">Processed</span>
                    ) : (
                      <span className="text-[10px] font-semibold px-[10px] py-[3px] rounded-md bg-[#fdf6e8] text-[#b8860b]">Processing...</span>
                    )}
                  </div>
                </div>

                {/* AI Summary - Fireflies style */}
                {selectedDetail.summary && (
                  <div className="mb-4">
                    <SummaryRenderer summary={selectedDetail.summary} />
                  </div>
                )}

                {/* Action items for this entry */}
                {selectedDetail.action_items?.length > 0 && (
                  <div className="mb-3.5">
                    <div className="text-[11px] font-bold text-[#6b6b65] tracking-[0.8px] uppercase mb-2 pb-1.5 border-b border-[#f0eeea] font-heading">
                      Action Items ({selectedDetail.action_items.length})
                    </div>
                    {selectedDetail.action_items.map((ai) => (
                      <div key={ai.id} className="flex items-start gap-[10px] py-2 border-b border-[#f0eeea] last:border-b-0">
                        <div className={`w-1.5 h-1.5 rounded-full mt-[7px] shrink-0 ${ai.status === 'completed' ? 'bg-[#9a9a92]' : 'bg-[#1a6b3c]'}`} />
                        <div className="flex-1">
                          <div className={`text-[13px] leading-relaxed ${ai.status === 'completed' ? 'line-through text-terminal-muted' : 'text-terminal-text'}`}>
                            {ai.title}
                          </div>
                          {ai.assignee && <span className="text-[10px] text-[#6b6b65]">{ai.assignee}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Linked entities */}
                {selectedDetail.entities?.length > 0 && (
                  <div className="mb-3.5">
                    <div className="text-[11px] font-bold text-[#6b6b65] tracking-[0.8px] uppercase mb-2 pb-1.5 border-b border-[#f0eeea] font-heading">
                      Mentioned Entities
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedDetail.entities.map(e => (
                        <span key={e.id} className="text-[11px] font-medium px-[10px] py-[3px] rounded-md bg-[#f5f4f0] text-[#6b6b65] border border-terminal-border">
                          {e.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Audio Player */}
                {selectedDetail.audio_url && (
                  <AudioPlayer
                    ref={audioPlayerRef}
                    audioUrl={selectedDetail.audio_url}
                    onTimeUpdate={setAudioTime}
                  />
                )}

                {/* Diarized Transcript (if available) or plain transcript */}
                {selectedDetail.transcript_json ? (
                  <div className="mb-3.5">
                    <DiarizedTranscript
                      transcriptJson={selectedDetail.transcript_json}
                      currentTime={audioTime}
                      onSeek={(t) => audioPlayerRef.current?.seekTo(t)}
                    />
                  </div>
                ) : selectedDetail.transcript ? (
                  <div>
                    <div className="text-[11px] font-bold text-[#6b6b65] tracking-[0.8px] uppercase mb-2 pb-1.5 border-b border-[#f0eeea] font-heading">Transcript</div>
                    <div className="text-[13px] text-terminal-text leading-relaxed whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                      {selectedDetail.transcript.length > 3000
                        ? selectedDetail.transcript.slice(0, 3000) + '\n\n[Truncated - view full transcript in Drive]'
                        : selectedDetail.transcript}
                    </div>
                  </div>
                ) : null}

                {/* Content (for non-transcript entries) */}
                {!selectedDetail.transcript && !selectedDetail.transcript_json && selectedDetail.content && (
                  <div>
                    <div className="text-[11px] font-bold text-[#6b6b65] tracking-[0.8px] uppercase mb-2 pb-1.5 border-b border-[#f0eeea] font-heading">Content</div>
                    <div className="text-[13px] text-terminal-text leading-relaxed whitespace-pre-wrap max-h-[300px] overflow-y-auto">
                      {selectedDetail.content.length > 3000
                        ? selectedDetail.content.slice(0, 3000) + '\n\n[Truncated]'
                        : selectedDetail.content}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </Card>

        {/* People */}
        <Card title="People - Knowledge Graph" meta={`${entities.length} tracked`}>
          <div className="flex flex-wrap gap-2 p-[18px]">
            {entities.length === 0 && (
              <div className="text-sm text-terminal-muted text-center py-4 w-full">No entities extracted yet.</div>
            )}
            {entities.map((p, idx) => (
              <div key={p.id} className="flex items-center gap-2 px-[14px] py-2 border border-terminal-border rounded-[10px] cursor-pointer hover:bg-[#f5f4f0] hover:border-[#9a9a92] transition-all">
                <div className={`w-6 h-6 rounded-[7px] flex items-center justify-center text-[10px] font-bold text-white shrink-0 ${PERSON_COLORS[idx % PERSON_COLORS.length]}`}>
                  {initials(p.name)}
                </div>
                <div>
                  <div className="text-xs font-semibold text-terminal-text">{p.name}</div>
                  <div className="text-[10px] text-terminal-muted">{p.entity_type}</div>
                </div>
                <div className="font-mono text-[11px] text-terminal-muted ml-1">{p.mention_count || 0}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Share Modal */}
      {showShareModal && selectedDetail && (
        <ShareModal entry={selectedDetail} onClose={() => setShowShareModal(false)} />
      )}
    </div>
  );
}

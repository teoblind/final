import React, { useState, useEffect, useRef, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const SPEAKER_COLORS = ['#1a6b3c', '#2563eb', '#7c3aed', '#b8860b', '#c0392b', '#0891b2'];
const SPEAKER_BG = ['#edf7f0', '#eff6ff', '#f5f0ff', '#fdf6e8', '#fef2f2', '#ecfeff'];

function formatDuration(seconds) {
  if (!seconds) return '';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem ? `${hrs}h ${rem}m` : `${hrs}h`;
}

function formatFullDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function fmt(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

// ─── Audio Player ─────────────────────────────────────────────────────────────

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

  useEffect(() => {
    if (onTimeUpdate) onTimeUpdate(currentTime);
  }, [currentTime]);

  return (
    <div className="bg-[#f5f4f0] rounded-xl p-4 mb-6 border border-[#e0ddd8]">
      <audio
        ref={audioRef}
        src={audioUrl}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime || 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
        onEnded={() => setPlaying(false)}
      />
      <div className="flex items-center gap-3">
        <button onClick={toggle} className="w-10 h-10 rounded-full bg-[#1a6b3c] text-white flex items-center justify-center hover:opacity-80 transition-opacity shrink-0">
          {playing ? (
            <svg width="14" height="16" viewBox="0 0 12 14" fill="currentColor"><rect x="1" y="1" width="3" height="12" rx="1"/><rect x="8" y="1" width="3" height="12" rx="1"/></svg>
          ) : (
            <svg width="14" height="16" viewBox="0 0 12 14" fill="currentColor"><path d="M1 1.5v11l10-5.5z"/></svg>
          )}
        </button>
        <div className="flex-1">
          <div className="relative h-2 bg-[#d8d5d0] rounded-full cursor-pointer group" onClick={seek}>
            <div className="absolute h-full bg-[#1a6b3c] rounded-full transition-all" style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%' }} />
            <div className="absolute w-3.5 h-3.5 bg-[#1a6b3c] rounded-full -top-[3px] opacity-0 group-hover:opacity-100 transition-opacity shadow-sm" style={{ left: duration ? `calc(${(currentTime / duration) * 100}% - 7px)` : '0' }} />
          </div>
        </div>
        <span className="text-xs font-mono text-[#6b6b65] tabular-nums w-24 text-right">{fmt(currentTime)} / {fmt(duration)}</span>
        <button onClick={cycleSpeed} className="text-xs font-bold text-[#6b6b65] bg-[#e0ddd8] px-2.5 py-1 rounded-lg hover:bg-[#d0cdc8] transition-colors">{speed}x</button>
      </div>
    </div>
  );
});

// ─── Summary Renderer ─────────────────────────────────────────────────────────

const SECTION_COLORS = {
  'overview': { border: '#1a6b3c', bg: '#edf7f0', label: '#1a6b3c' },
  'topics discussed': { border: '#2563eb', bg: '#eff6ff', label: '#2563eb' },
  'key decisions': { border: '#7c3aed', bg: '#f5f0ff', label: '#7c3aed' },
  'notable quotes': { border: '#b8860b', bg: '#fdf6e8', label: '#b8860b' },
  'next steps': { border: '#1a6b3c', bg: '#edf7f0', label: '#1a6b3c' },
};

function SummaryRenderer({ summary }) {
  if (!summary) return null;
  const sections = [];
  const lines = summary.split('\n');
  let current = null;
  for (const line of lines) {
    const m = line.match(/^##\s+(.+)/);
    if (m) { if (current) sections.push(current); current = { title: m[1].trim(), lines: [] }; }
    else if (current && line.trim()) current.lines.push(line);
  }
  if (current) sections.push(current);

  if (sections.length === 0) {
    return <div className="bg-[#f5f4f0] rounded-xl p-4 border-l-[3px] border-l-[#1a6b3c] text-sm text-[#2c2c28] leading-relaxed">{summary}</div>;
  }

  return (
    <div className="space-y-3">
      {sections.map((section, i) => {
        const key = section.title.toLowerCase();
        const colors = SECTION_COLORS[key] || { border: '#9a9a92', bg: '#f5f4f0', label: '#6b6b65' };
        return (
          <div key={i} className="rounded-xl p-4 border-l-[3px]" style={{ borderLeftColor: colors.border, background: colors.bg }}>
            <div className="text-[10px] font-bold tracking-[0.8px] uppercase mb-2" style={{ color: colors.label }}>{section.title}</div>
            <div className="space-y-1.5">
              {section.lines.map((line, j) => {
                const trimmed = line.replace(/^[-*]\s*/, '').trim();
                if (!trimmed) return null;
                const parts = trimmed.split(/(\*\*[^*]+\*\*)/);
                return (
                  <div key={j} className="flex items-start gap-2 text-sm leading-relaxed">
                    <div className="w-1 h-1 rounded-full shrink-0 mt-[9px]" style={{ background: colors.border }} />
                    <div className="text-[#2c2c28]">
                      {parts.map((part, k) =>
                        part.startsWith('**') && part.endsWith('**')
                          ? <span key={k} className="font-semibold">{part.slice(2, -2)}</span>
                          : <span key={k}>{part}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Diarized Transcript ──────────────────────────────────────────────────────

function DiarizedTranscript({ transcriptJson, currentTime, onSeek }) {
  let utterances = [];
  try { utterances = Array.isArray(transcriptJson) ? transcriptJson : JSON.parse(transcriptJson || '[]'); } catch { utterances = []; }
  if (!utterances.length) return null;

  const speakers = [...new Set(utterances.map(u => u.speaker))].filter(s => s !== 'UNKNOWN');
  const speakerIdx = {};
  speakers.forEach((s, i) => { speakerIdx[s] = i; });

  return (
    <div>
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-[#e0ddd8]">
        <span className="text-xs font-bold text-[#6b6b65] tracking-[0.8px] uppercase">Transcript ({utterances.length} segments)</span>
        <div className="flex gap-2">
          {speakers.map((s, i) => (
            <span key={s} className="flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md" style={{ background: SPEAKER_BG[i % SPEAKER_BG.length], color: SPEAKER_COLORS[i % SPEAKER_COLORS.length] }}>
              <span className="w-2 h-2 rounded-full" style={{ background: SPEAKER_COLORS[i % SPEAKER_COLORS.length] }} />
              {s}
            </span>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        {utterances.map((u, i) => {
          const idx = speakerIdx[u.speaker] ?? speakers.length;
          const color = SPEAKER_COLORS[idx % SPEAKER_COLORS.length];
          const isActive = currentTime >= u.start && currentTime < (u.end || u.start + 10);
          return (
            <div
              key={i}
              className={`flex gap-3 py-2.5 px-3 rounded-lg transition-colors ${isActive ? 'bg-[#edf7f0]' : 'hover:bg-[#fafaf8]'}`}
              style={isActive ? { borderLeft: `3px solid ${color}` } : { borderLeft: '3px solid transparent' }}
            >
              <button
                onClick={() => onSeek?.(u.start)}
                className="text-xs font-mono text-[#9a9a92] hover:text-[#1a6b3c] shrink-0 mt-0.5 cursor-pointer transition-colors"
              >
                {fmt(u.start)}
              </button>
              <div className="flex-1">
                <span className="text-xs font-bold mr-2" style={{ color }}>{u.speaker}</span>
                <span className="text-sm text-[#2c2c28] leading-relaxed">{u.text}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function SharedMeetingPage({ token }) {
  const [meeting, setMeeting] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [audioTime, setAudioTime] = useState(0);
  const [activeTab, setActiveTab] = useState('summary');
  const audioPlayerRef = useRef(null);

  useEffect(() => {
    fetch(`${API_BASE}/v1/knowledge/shared/${token}`)
      .then(res => {
        if (!res.ok) throw new Error('Meeting not found or sharing disabled');
        return res.json();
      })
      .then(data => { setMeeting(data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#fafaf8] flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-[#1a6b3c] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-[#6b6b65]">Loading meeting...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#fafaf8] flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-4xl mb-4">🔒</div>
          <h1 className="text-lg font-bold text-[#2c2c28] mb-2">Meeting Not Available</h1>
          <p className="text-sm text-[#6b6b65]">{error}</p>
        </div>
      </div>
    );
  }

  const hasTranscript = meeting.transcript_json || meeting.transcript;
  const hasSummary = !!meeting.summary;
  const hasAudio = !!meeting.audio_url;

  return (
    <div className="min-h-screen bg-[#fafaf8]">
      {/* Header */}
      <header className="bg-white border-b border-[#e0ddd8] px-6 py-5">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-bold text-[#1a6b3c] tracking-[1px] uppercase bg-[#edf7f0] px-2 py-0.5 rounded">Meeting</span>
            {meeting.duration_seconds && (
              <span className="text-[10px] font-bold text-[#6b6b65] tracking-[1px] uppercase bg-[#f5f4f0] px-2 py-0.5 rounded">{formatDuration(meeting.duration_seconds)}</span>
            )}
          </div>
          <h1 className="text-xl font-bold text-[#2c2c28] mb-1">{meeting.title}</h1>
          <p className="text-sm text-[#6b6b65]">{formatFullDate(meeting.recorded_at)}</p>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-6">
        {/* Audio Player */}
        {hasAudio && (
          <AudioPlayer
            ref={audioPlayerRef}
            audioUrl={meeting.audio_url}
            onTimeUpdate={setAudioTime}
          />
        )}

        {/* Tab switcher */}
        <div className="flex gap-1 mb-6 bg-[#f5f4f0] rounded-xl p-1 w-fit">
          {hasSummary && (
            <button
              onClick={() => setActiveTab('summary')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'summary' ? 'bg-white text-[#2c2c28] shadow-sm' : 'text-[#6b6b65] hover:text-[#2c2c28]'}`}
            >
              Summary
            </button>
          )}
          {hasTranscript && (
            <button
              onClick={() => setActiveTab('transcript')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'transcript' ? 'bg-white text-[#2c2c28] shadow-sm' : 'text-[#6b6b65] hover:text-[#2c2c28]'}`}
            >
              Transcript
            </button>
          )}
          {meeting.action_items?.length > 0 && (
            <button
              onClick={() => setActiveTab('actions')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === 'actions' ? 'bg-white text-[#2c2c28] shadow-sm' : 'text-[#6b6b65] hover:text-[#2c2c28]'}`}
            >
              Action Items ({meeting.action_items.length})
            </button>
          )}
        </div>

        {/* Tab content */}
        <div className="bg-white rounded-2xl border border-[#e0ddd8] p-6">
          {activeTab === 'summary' && hasSummary && (
            <SummaryRenderer summary={meeting.summary} />
          )}

          {activeTab === 'transcript' && hasTranscript && (
            meeting.transcript_json ? (
              <DiarizedTranscript
                transcriptJson={meeting.transcript_json}
                currentTime={audioTime}
                onSeek={(t) => audioPlayerRef.current?.seekTo(t)}
              />
            ) : (
              <div className="text-sm text-[#2c2c28] leading-relaxed whitespace-pre-wrap">{meeting.transcript}</div>
            )
          )}

          {activeTab === 'actions' && meeting.action_items?.length > 0 && (
            <div className="space-y-2">
              {meeting.action_items.map((ai) => (
                <div key={ai.id} className="flex items-start gap-3 py-3 border-b border-[#f0eeea] last:border-b-0">
                  <div className={`w-2 h-2 rounded-full mt-[7px] shrink-0 ${ai.status === 'completed' ? 'bg-[#1a6b3c]' : 'bg-[#b8860b]'}`} />
                  <div className="flex-1">
                    <div className={`text-sm leading-relaxed ${ai.status === 'completed' ? 'line-through text-[#9a9a92]' : 'text-[#2c2c28]'}`}>
                      {ai.description || ai.title}
                    </div>
                    {ai.assignee && <span className="text-xs text-[#6b6b65] mt-1 block">{ai.assignee}</span>}
                  </div>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${ai.status === 'completed' ? 'bg-[#edf7f0] text-[#1a6b3c]' : 'bg-[#fdf6e8] text-[#b8860b]'}`}>
                    {ai.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="text-center mt-8 pb-6">
          <p className="text-xs text-[#9a9a92]">Shared via Coppice AI</p>
        </div>
      </div>
    </div>
  );
}

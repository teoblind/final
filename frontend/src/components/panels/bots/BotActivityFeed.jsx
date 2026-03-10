import React, { useState } from 'react';
import Panel from '../../Panel';
import { useApi, postApi } from '../../../hooks/useApi';

const BOT_ICONS = {
  'lead-gen': '\u26A1',
  'email': '\u2709\uFE0F',
  'meeting': '\uD83C\uDFA4',
  'recorder': '\uD83D\uDCF9',
  'agent': '\uD83E\uDD16',
};

const BOT_COLORS = {
  'lead-gen': 'text-terminal-amber',
  'email': 'text-terminal-cyan',
  'meeting': 'text-terminal-green',
  'recorder': 'text-blue-400',
  'agent': 'text-terminal-muted',
};

const ACTION_BADGES = {
  lead_discovered: { label: 'Discovered', color: 'text-terminal-amber' },
  email_sent: { label: 'Sent', color: 'text-terminal-cyan' },
  email_replied: { label: 'Replied', color: 'text-terminal-green' },
  email_bounced: { label: 'Bounced', color: 'text-terminal-red' },
  meeting_recorded: { label: 'Recorded', color: 'text-terminal-green' },
  recording_started: { label: 'Recording', color: 'text-terminal-green' },
  recording_completed: { label: 'Completed', color: 'text-terminal-green' },
  recording_skipped: { label: 'Skipped', color: 'text-terminal-muted' },
  call_detected: { label: 'Detected', color: 'text-terminal-amber' },
  bot_started: { label: 'Started', color: 'text-terminal-green' },
  bot_stopped: { label: 'Stopped', color: 'text-terminal-red' },
  observation: { label: 'Observed', color: 'text-terminal-muted' },
  recommendation: { label: 'Recommends', color: 'text-terminal-amber' },
  action_executed: { label: 'Executed', color: 'text-terminal-green' },
  error: { label: 'Error', color: 'text-terminal-red' },
};

const BOT_LABELS = {
  'lead-gen': 'Lead Gen',
  'email': 'Email',
  'meeting': 'Meeting',
  'recorder': 'Recorder',
  'agent': 'Agent',
};

function formatTime(timestamp) {
  const d = new Date(timestamp);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDate(timestamp) {
  const d = new Date(timestamp);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function CommentThread({ eventId, onClose }) {
  const { data, loading, refetch } = useApi(`/bots/events/${encodeURIComponent(eventId)}/comments`, { refreshInterval: null });
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);

  const comments = data?.comments || [];

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!text.trim() || posting) return;
    setPosting(true);
    try {
      await postApi(`/bots/events/${encodeURIComponent(eventId)}/comments`, { text });
      setText('');
      refetch();
    } catch (err) {
      console.error('Failed to post comment:', err);
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="ml-14 mb-2 p-2 bg-terminal-bg/50 rounded border border-terminal-border/30">
      {loading && comments.length === 0 && (
        <p className="text-[10px] text-terminal-muted">Loading...</p>
      )}
      {comments.map(c => (
        <div key={c.id} className="flex gap-2 mb-1.5">
          <div className="w-5 h-5 rounded-full bg-terminal-border flex items-center justify-center shrink-0">
            <span className="text-[8px] text-terminal-text font-medium">{getInitials(c.user_name)}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-medium text-terminal-text">{c.user_name}</span>
              <span className="text-[9px] text-terminal-muted">{formatTime(c.created_at)}</span>
            </div>
            <p className="text-[11px] text-terminal-text">{c.text}</p>
          </div>
        </div>
      ))}
      <form onSubmit={handleSubmit} className="flex gap-1.5 mt-1.5">
        <input
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Add a comment..."
          className="flex-1 bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-[11px] text-terminal-text placeholder-terminal-muted focus:border-terminal-green/50 outline-none"
        />
        <button
          type="submit"
          disabled={!text.trim() || posting}
          className="px-2 py-1 text-[10px] bg-terminal-panel border border-terminal-border rounded text-terminal-text hover:border-terminal-green/50 disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}

export default function BotActivityFeed() {
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(50);
  const [expandedId, setExpandedId] = useState(null);
  const [commentingId, setCommentingId] = useState(null);

  const botParam = filter !== 'all' ? `&bot=${filter}` : '';
  const { data, loading, error, lastFetched, refetch } = useApi(
    `/bots/activity?limit=${limit}${botParam}`,
    { refreshInterval: 10000 }
  );

  const events = data?.events || [];

  // Group events by date
  const grouped = {};
  for (const event of events) {
    const dateKey = formatDate(event.timestamp);
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(event);
  }

  const filterOptions = [
    { value: 'all', label: 'All Bots' },
    { value: 'lead-gen', label: '\u26A1 Lead Gen' },
    { value: 'email', label: '\u2709\uFE0F Email' },
    { value: 'meeting', label: '\uD83C\uDFA4 Meetings' },
    { value: 'recorder', label: '\uD83D\uDCF9 Recorder' },
    { value: 'agent', label: '\uD83E\uDD16 Agents' },
  ];

  return (
    <Panel
      title="Bot Activity Feed"
      source="bots/activity"
      lastUpdated={lastFetched}
      loading={loading}
      error={error}
      onRefresh={refetch}
      headerRight={
        <select
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-[10px] text-terminal-text"
        >
          {filterOptions.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      }
    >
      <div className="space-y-4">
        {Object.entries(grouped).map(([date, dayEvents]) => (
          <div key={date}>
            <p className="text-[10px] text-terminal-muted uppercase tracking-wider mb-2">{date}</p>
            <div className="space-y-1">
              {dayEvents.map((event) => {
                const icon = BOT_ICONS[event.bot] || '\uD83E\uDD16';
                const botColor = BOT_COLORS[event.bot] || 'text-terminal-muted';
                const badge = ACTION_BADGES[event.action] || { label: event.action, color: 'text-terminal-muted' };
                const isExpanded = expandedId === event.id;
                const isCommenting = commentingId === event.id;

                return (
                  <div key={event.id}>
                    <div
                      className="flex items-start gap-2 py-1.5 border-b border-terminal-border/20 last:border-0 cursor-pointer hover:bg-terminal-bg/30"
                      onClick={() => setExpandedId(isExpanded ? null : event.id)}
                    >
                      <span className="text-[10px] text-terminal-muted w-10 shrink-0 pt-0.5 font-sans">
                        {formatTime(event.timestamp)}
                      </span>
                      <span className="text-xs shrink-0">{icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-medium ${botColor}`}>
                            {BOT_LABELS[event.bot] || event.bot}
                          </span>
                          <span className={`text-[10px] ${badge.color}`}>
                            {badge.label}
                          </span>
                          {event.ownerName && (
                            <span className="text-[9px] text-terminal-muted flex items-center gap-1">
                              <span className="inline-flex w-3.5 h-3.5 rounded-full bg-terminal-border items-center justify-center">
                                <span className="text-[7px] font-medium">{getInitials(event.ownerName)}</span>
                              </span>
                              {event.ownerName.split(' ')[0]}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-terminal-text mt-0.5 truncate">
                          {event.summary}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {event.commentCount > 0 && (
                          <span
                            className="text-[9px] text-terminal-muted px-1 py-0.5 bg-terminal-border/30 rounded cursor-pointer hover:text-terminal-text"
                            onClick={(e) => { e.stopPropagation(); setCommentingId(isCommenting ? null : event.id); }}
                          >
                            {event.commentCount}
                          </span>
                        )}
                        <button
                          className="text-[10px] text-terminal-muted hover:text-terminal-text px-1"
                          onClick={(e) => { e.stopPropagation(); setCommentingId(isCommenting ? null : event.id); }}
                          title="Comment"
                        >
                          {'\uD83D\uDCAC'}
                        </button>
                      </div>
                    </div>

                    {isExpanded && event.details && !isCommenting && (
                      <div className="ml-14 mb-2 p-2 bg-terminal-bg/50 rounded text-[11px] text-terminal-muted space-y-1">
                        {Object.entries(event.details).map(([key, val]) => (
                          val != null && val !== '' && (
                            <div key={key} className="flex gap-2">
                              <span className="text-terminal-muted/60 capitalize">{key}:</span>
                              <span className="text-terminal-text">{String(val)}</span>
                            </div>
                          )
                        ))}
                      </div>
                    )}

                    {isCommenting && (
                      <CommentThread eventId={event.id} onClose={() => setCommentingId(null)} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {events.length === 0 && !loading && (
          <div className="text-center py-8">
            <p className="text-sm text-terminal-muted">No bot activity yet</p>
            <p className="text-xs text-terminal-muted mt-1">Bot events will appear here as they run</p>
          </div>
        )}

        {events.length >= limit && (
          <button
            onClick={() => setLimit(prev => prev + 50)}
            className="w-full py-2 text-xs text-terminal-muted hover:text-terminal-text border-t border-terminal-border/30 transition-colors"
          >
            Load More
          </button>
        )}
      </div>
    </Panel>
  );
}

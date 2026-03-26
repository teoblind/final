import React, { Suspense, useState } from 'react';
import Panel, { Stat } from '../Panel';
import { useApi, postApi, deleteApi } from '../../hooks/useApi';
import { useAuth } from '../auth/AuthContext';
import BotActivityFeed from '../panels/bots/BotActivityFeed';
import BotStatusPanel from '../panels/bots/BotStatusPanel';

function PanelSkeleton() {
  return (
    <div className="bg-terminal-panel border border-terminal-border rounded-lg p-4 animate-pulse">
      <div className="h-4 bg-terminal-border rounded w-1/3 mb-3" />
      <div className="h-8 bg-terminal-border rounded w-1/2" />
    </div>
  );
}

function StatsRow() {
  const { data, loading } = useApi('/bots/stats', { refreshInterval: 30000 });

  if (loading && !data) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[1, 2, 3, 4].map(i => <PanelSkeleton key={i} />)}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div className="bg-terminal-panel border border-terminal-border rounded-lg p-4">
        <Stat label="Total Leads" value={data?.totalLeads ?? '-'} />
      </div>
      <div className="bg-terminal-panel border border-terminal-border rounded-lg p-4">
        <Stat
          label="Emails Sent"
          value={data?.totalEmailsSent ?? '-'}
          change={data?.emailsSentToday ? `+${data.emailsSentToday} today` : undefined}
        />
      </div>
      <div className="bg-terminal-panel border border-terminal-border rounded-lg p-4">
        <Stat label="Meetings This Week" value={data?.meetingsThisWeek ?? '-'} />
      </div>
      <div className="bg-terminal-panel border border-terminal-border rounded-lg p-4">
        <Stat label="Response Rate" value={data?.responseRate ?? '-'} />
      </div>
    </div>
  );
}

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

const BOT_TYPE_OPTIONS = [
  { value: 'lead-gen', label: 'Lead Gen' },
  { value: 'email', label: 'Email Outreach' },
  { value: 'meeting', label: 'Meeting Bot' },
  { value: 'recorder', label: 'Auto Recorder' },
  { value: 'agent', label: 'Agent' },
  { value: 'scraper', label: 'Scraper' },
  { value: 'other', label: 'Other' },
];

function TeamBotsPanel() {
  const { user } = useAuth();
  const { data, loading, error, lastFetched, refetch } = useApi('/bots/team', { refreshInterval: 30000 });
  const [showRegister, setShowRegister] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('lead-gen');
  const [submitting, setSubmitting] = useState(false);

  const bots = data?.bots || [];

  const handleRegister = async (e) => {
    e.preventDefault();
    if (!newName.trim() || submitting) return;
    setSubmitting(true);
    try {
      await postApi('/bots/register', { name: newName.trim(), botType: newType });
      setNewName('');
      setShowRegister(false);
      refetch();
    } catch (err) {
      console.error('Failed to register bot:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteApi(`/bots/register/${id}`);
      refetch();
    } catch (err) {
      console.error('Failed to delete bot:', err);
    }
  };

  return (
    <Panel
      title="Team Bots"
      source="bots/team"
      lastUpdated={lastFetched}
      loading={loading}
      error={error}
      onRefresh={refetch}
      headerRight={
        <button
          onClick={() => setShowRegister(!showRegister)}
          className="text-[10px] px-2 py-1 bg-terminal-bg border border-terminal-border rounded text-terminal-text hover:border-terminal-green/50 font-heading"
        >
          + Register Bot
        </button>
      }
    >
      {showRegister && (
        <form onSubmit={handleRegister} className="mb-3 p-2 bg-terminal-bg/50 rounded border border-terminal-border/30 flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[120px]">
            <label className="text-[9px] text-terminal-muted uppercase tracking-wider block mb-1">Name</label>
            <input
              type="text"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="My Lead Gen Bot"
              className="w-full bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-[11px] text-terminal-text placeholder-terminal-muted outline-none focus:border-terminal-green/50"
            />
          </div>
          <div>
            <label className="text-[9px] text-terminal-muted uppercase tracking-wider block mb-1">Type</label>
            <select
              value={newType}
              onChange={e => setNewType(e.target.value)}
              className="bg-terminal-bg border border-terminal-border rounded px-2 py-1 text-[11px] text-terminal-text"
            >
              {BOT_TYPE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={!newName.trim() || submitting}
            className="px-3 py-1 text-[11px] bg-terminal-panel border border-terminal-green/30 rounded text-terminal-green hover:bg-terminal-green/10 disabled:opacity-40 font-heading"
          >
            Register
          </button>
        </form>
      )}

      {bots.length === 0 && !loading && (
        <div className="text-center py-4">
          <p className="text-xs text-terminal-muted">No bots registered yet</p>
          <p className="text-[10px] text-terminal-muted mt-1">Register your bots so teammates can see their activity</p>
        </div>
      )}

      <div className="space-y-2">
        {bots.map(bot => {
          const config = bot.config_json ? JSON.parse(bot.config_json) : {};
          const isOwn = bot.user_id === user?.id;
          return (
            <div key={bot.id} className="flex items-center gap-3 py-2 border-b border-terminal-border/20 last:border-0">
              <div className="w-6 h-6 rounded-full bg-terminal-border flex items-center justify-center shrink-0">
                <span className="text-[9px] text-terminal-text font-medium">
                  {getInitials(bot.owner_name)}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-terminal-text">{bot.name}</span>
                  <span className="text-[9px] px-1.5 py-0.5 bg-terminal-border/40 rounded text-terminal-muted font-mono">
                    {bot.bot_type}
                  </span>
                  <span className={`text-[9px] font-mono ${bot.status === 'active' ? 'text-terminal-green' : 'text-terminal-muted'}`}>
                    {bot.status}
                  </span>
                </div>
                <p className="text-[10px] text-terminal-muted">
                  {bot.owner_name} {bot.owner_email ? `(${bot.owner_email})` : ''}
                </p>
              </div>
              {isOwn && (
                <button
                  onClick={() => handleDelete(bot.id)}
                  className="text-[10px] text-terminal-muted hover:text-terminal-red px-1"
                  title="Remove"
                >
                  x
                </button>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

export default function BotsDashboard() {
  const { user } = useAuth();

  return (
    <div className="p-4">
      <div className="mb-6">
        <h2 className="text-lg font-bold text-terminal-green font-heading">Bots</h2>
        <p className="text-xs text-terminal-muted">Activity feed from Charger-Bot, MeetingBot, and Auto-Recorder</p>
      </div>

      <StatsRow />

      <div className="mb-4">
        <Suspense fallback={<PanelSkeleton />}>
          <BotActivityFeed />
        </Suspense>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Suspense fallback={<PanelSkeleton />}>
          <BotStatusPanel />
        </Suspense>

        {user && (
          <Suspense fallback={<PanelSkeleton />}>
            <TeamBotsPanel />
          </Suspense>
        )}
      </div>
    </div>
  );
}

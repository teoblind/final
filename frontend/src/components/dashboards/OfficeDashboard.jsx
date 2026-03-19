/**
 * OfficeDashboard — 3D Isometric office visualization
 *
 * Shows AI agents as animated characters working in an isometric office grid.
 * Fetches live status from /api/v1/office/status.
 */

import React, { useState, useEffect, useCallback } from 'react';
import api from '../../lib/hooks/useApi';

// ─── Agent avatar configs ───────────────────────────────────────────────────

const ROLE_CONFIG = {
  email:    { emoji: '📧', color: '#2563eb', bgLight: '#eff6ff', label: 'Email' },
  chat:     { emoji: '💬', color: '#7c3aed', bgLight: '#f5f0ff', label: 'Chat' },
  meeting:  { emoji: '🎙️', color: '#1a6b3c', bgLight: '#edf7f0', label: 'Meeting' },
  research: { emoji: '🔬', color: '#b8860b', bgLight: '#fdf6e8', label: 'Research' },
  clawbot:  { emoji: '🤖', color: '#64748b', bgLight: '#f1f5f9', label: 'System' },
};

const STATUS_STYLES = {
  idle:         { dot: '#9ca3af', label: 'Idle', pulse: false },
  processing:   { dot: '#2563eb', label: 'Working', pulse: true },
  running:      { dot: '#1a6b3c', label: 'Active', pulse: true },
  observing:    { dot: '#f59e0b', label: 'Observing', pulse: true },
  analyzing:    { dot: '#8b5cf6', label: 'Analyzing', pulse: true },
  transcribing: { dot: '#7c3aed', label: 'Transcribing', pulse: true },
  error:        { dot: '#ef4444', label: 'Error', pulse: false },
};

// ─── 3D Isometric Tile ─────────────────────────────────────────────────────

function IsoTile({ x, y, children, onClick, highlighted, className = '' }) {
  // Isometric projection: x goes right-down, y goes left-down
  const px = (x - y) * 120;
  const py = (x + y) * 60;

  return (
    <div
      className={`absolute transition-all duration-300 cursor-pointer ${className}`}
      style={{
        left: `${px}px`,
        top: `${py}px`,
        width: '220px',
        zIndex: x + y,
      }}
      onClick={onClick}
    >
      {/* Floor tile — isometric diamond */}
      <svg viewBox="0 0 220 130" className="w-full" style={{ filter: highlighted ? 'brightness(1.05)' : undefined }}>
        <defs>
          <linearGradient id={`floor-${x}-${y}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={highlighted ? '#edf7f0' : '#fafaf8'} />
            <stop offset="100%" stopColor={highlighted ? '#d4edda' : '#f0eeea'} />
          </linearGradient>
        </defs>
        {/* Top face */}
        <polygon
          points="110,10 210,60 110,110 10,60"
          fill={`url(#floor-${x}-${y})`}
          stroke={highlighted ? '#1a6b3c' : '#e0ddd8'}
          strokeWidth="1.5"
        />
        {/* Left face */}
        <polygon
          points="10,60 110,110 110,125 10,75"
          fill={highlighted ? '#c3ddc8' : '#e8e6e1'}
          stroke={highlighted ? '#1a6b3c' : '#ddd9d3'}
          strokeWidth="0.5"
        />
        {/* Right face */}
        <polygon
          points="210,60 110,110 110,125 210,75"
          fill={highlighted ? '#b5d4bb' : '#dddbd5'}
          stroke={highlighted ? '#1a6b3c' : '#d0cec8'}
          strokeWidth="0.5"
        />
      </svg>
      {/* Content positioned on tile */}
      <div className="absolute inset-0 flex items-center justify-center" style={{ top: '-20px' }}>
        {children}
      </div>
    </div>
  );
}

// ─── Agent Character (3D-ish) ───────────────────────────────────────────────

function AgentCharacter({ agent, selected, onClick }) {
  const role = ROLE_CONFIG[agent.role] || ROLE_CONFIG.clawbot;
  const status = STATUS_STYLES[agent.status] || STATUS_STYLES.idle;
  const isActive = agent.status === 'processing' || agent.status === 'running' || agent.status === 'transcribing';

  return (
    <div
      className={`flex flex-col items-center transition-transform duration-300 ${isActive ? 'animate-bounce-slow' : ''} ${selected ? 'scale-110' : 'hover:scale-105'}`}
      onClick={onClick}
    >
      {/* Task bubble */}
      {agent.currentTask && (
        <div className="mb-1 px-2 py-0.5 bg-white rounded-full shadow-sm border border-[#e0ddd8] max-w-[160px]">
          <p className="text-[8px] text-[#6b6b65] truncate">{agent.currentTask.name}</p>
        </div>
      )}

      {/* Character body — 3D cube-ish */}
      <div className="relative">
        {/* Shadow */}
        <div className="absolute bottom-[-4px] left-1/2 -translate-x-1/2 w-10 h-2 rounded-full bg-black/10 blur-[2px]" />

        {/* Body */}
        <div
          className="w-12 h-14 rounded-xl flex items-center justify-center relative shadow-lg"
          style={{
            background: `linear-gradient(135deg, ${role.color}cc, ${role.color})`,
            transform: 'perspective(200px) rotateX(5deg)',
          }}
        >
          <span className="text-xl">{role.emoji}</span>

          {/* Status dot */}
          <div
            className={`absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${status.pulse ? 'animate-pulse' : ''}`}
            style={{ backgroundColor: status.dot }}
          />
        </div>
      </div>

      {/* Name plate */}
      <div className="mt-1.5 px-2 py-0.5 bg-white/90 rounded-md shadow-sm border border-[#e0ddd8]">
        <p className="text-[9px] font-bold text-[#333] text-center whitespace-nowrap">{agent.name.replace(/ (Email|Chat|Meeting|Research) Agent/, '')}</p>
        <p className="text-[8px] text-center" style={{ color: status.dot }}>{status.label}</p>
      </div>
    </div>
  );
}

// ─── Activity Feed ──────────────────────────────────────────────────────────

function ActivityFeed({ activities }) {
  return (
    <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#f0eeea]">
        <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Activity Feed</span>
      </div>
      <div className="max-h-[360px] overflow-y-auto">
        {activities.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-terminal-muted">No recent activity.</div>
        )}
        {activities.slice(0, 30).map((act, i) => (
          <div key={act.id || i} className="flex items-start gap-3 px-4 py-2.5 border-b border-[#f0eeea] last:border-b-0">
            <div className="w-6 h-6 rounded-lg bg-[#f5f4f0] flex items-center justify-center text-[11px] shrink-0 mt-0.5">
              {act.type === 'email' ? '📧' : act.type === 'doc' ? '📄' : act.type === 'meeting' ? '🎙️' : '⚡'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-medium text-terminal-text truncate">{act.title}</p>
              {act.subtitle && <p className="text-[10px] text-terminal-muted truncate mt-px">{act.subtitle}</p>}
            </div>
            <div className="text-[10px] text-terminal-muted whitespace-nowrap shrink-0">
              {act.tenant && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[#f5f4f0] text-[#6b6b65]">{act.tenant}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Meeting Status ─────────────────────────────────────────────────────────

function MeetingStatus({ meetings }) {
  if (!meetings || meetings.length === 0) return null;

  return (
    <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#f0eeea] flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-[#1a6b3c] animate-pulse" />
        <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Live Meetings</span>
      </div>
      <div className="divide-y divide-[#f0eeea]">
        {meetings.map((m, i) => (
          <div key={i} className="px-4 py-3 flex items-center gap-3">
            <div className="text-lg">🎙️</div>
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold text-terminal-text truncate">{m.meetingName || 'Meeting'}</p>
              <p className="text-[10px] text-terminal-muted">{m.status} — {m.tenantId}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function OfficeDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.get('/v1/office/status', {
        headers: { 'X-Office-Key': 'dev-office-key' },
        params: { key: 'dev-office-key' },
      });
      setData(res.data);
    } catch (err) {
      console.error('Office status fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, [fetchStatus]);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[500px]">
        <div className="text-center">
          <div className="text-4xl mb-3">🏢</div>
          <div className="text-sm text-terminal-muted">Loading office...</div>
        </div>
      </div>
    );
  }

  const agents = data?.agents || [];
  const activities = data?.activities || [];
  const meetings = data?.meetings || [];

  // Group agents by tenant for office layout
  const tenantGroups = {};
  agents.forEach(a => {
    const t = a.tenant || 'system';
    if (!tenantGroups[t]) tenantGroups[t] = [];
    tenantGroups[t].push(a);
  });

  const tenantKeys = Object.keys(tenantGroups).filter(t => t !== 'system');
  const systemAgents = tenantGroups.system || [];
  const activeCount = agents.filter(a => a.status !== 'idle').length;

  return (
    <div className="p-6 lg:px-7 lg:py-6 min-h-screen">
      {/* Stats bar */}
      <div className="flex items-center gap-6 mb-6">
        <div className="flex items-center gap-2">
          <div className="text-2xl">🏢</div>
          <div>
            <p className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px]">Coppice Office</p>
            <p className="text-xs text-terminal-text font-semibold">{agents.length} agents — {activeCount} active</p>
          </div>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-4">
          {Object.entries(STATUS_STYLES).slice(0, 3).map(([key, s]) => (
            <div key={key} className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${s.pulse ? 'animate-pulse' : ''}`} style={{ backgroundColor: s.dot }} />
              <span className="text-[10px] text-terminal-muted font-medium">{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6">
        {/* Isometric office view */}
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#f0eeea] flex items-center justify-between">
            <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Agent Office</span>
            <span className="text-[10px] text-terminal-muted">{data?.fetchedAt ? `Updated ${new Date(data.fetchedAt).toLocaleTimeString()}` : ''}</span>
          </div>

          <div className="p-6 overflow-auto" style={{ minHeight: '500px' }}>
            <div className="relative" style={{ width: '900px', height: '600px', margin: '0 auto' }}>
              {/* Origin offset to center the grid */}
              <div className="absolute" style={{ left: '350px', top: '20px' }}>
                {/* Tenant rooms */}
                {tenantKeys.map((tenantKey, tIdx) => {
                  const tenantAgents = tenantGroups[tenantKey];
                  const row = tIdx;

                  return (
                    <React.Fragment key={tenantKey}>
                      {/* Room label */}
                      <div
                        className="absolute text-[10px] font-bold uppercase tracking-[1.5px] text-terminal-muted"
                        style={{
                          left: `${(0 - row) * 120 - 80}px`,
                          top: `${(0 + row) * 60 + 25}px`,
                          transform: 'rotate(-26deg)',
                          transformOrigin: 'left center',
                        }}
                      >
                        {tenantKey}
                      </div>

                      {tenantAgents.map((agent, aIdx) => (
                        <IsoTile
                          key={agent.id}
                          x={aIdx}
                          y={row}
                          highlighted={selectedAgent?.id === agent.id}
                          onClick={() => setSelectedAgent(selectedAgent?.id === agent.id ? null : agent)}
                        >
                          <AgentCharacter
                            agent={agent}
                            selected={selectedAgent?.id === agent.id}
                            onClick={() => setSelectedAgent(selectedAgent?.id === agent.id ? null : agent)}
                          />
                        </IsoTile>
                      ))}
                    </React.Fragment>
                  );
                })}

                {/* System agents at the bottom */}
                {systemAgents.length > 0 && (
                  <>
                    <div
                      className="absolute text-[10px] font-bold uppercase tracking-[1.5px] text-terminal-muted"
                      style={{
                        left: `${(0 - tenantKeys.length) * 120 - 80}px`,
                        top: `${(0 + tenantKeys.length) * 60 + 25}px`,
                        transform: 'rotate(-26deg)',
                        transformOrigin: 'left center',
                      }}
                    >
                      system
                    </div>
                    {systemAgents.map((agent, aIdx) => (
                      <IsoTile
                        key={agent.id}
                        x={aIdx}
                        y={tenantKeys.length}
                        highlighted={selectedAgent?.id === agent.id}
                        onClick={() => setSelectedAgent(selectedAgent?.id === agent.id ? null : agent)}
                      >
                        <AgentCharacter
                          agent={agent}
                          selected={selectedAgent?.id === agent.id}
                          onClick={() => setSelectedAgent(selectedAgent?.id === agent.id ? null : agent)}
                        />
                      </IsoTile>
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          {/* Selected agent detail */}
          {selectedAgent && (
            <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#f0eeea]">
                <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Agent Detail</span>
              </div>
              <div className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shadow-md"
                    style={{ background: `linear-gradient(135deg, ${(ROLE_CONFIG[selectedAgent.role] || ROLE_CONFIG.clawbot).color}cc, ${(ROLE_CONFIG[selectedAgent.role] || ROLE_CONFIG.clawbot).color})` }}
                  >
                    {(ROLE_CONFIG[selectedAgent.role] || ROLE_CONFIG.clawbot).emoji}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-terminal-text">{selectedAgent.name}</p>
                    <p className="text-[10px] text-terminal-muted">{selectedAgent.tenant || 'System'} — {(ROLE_CONFIG[selectedAgent.role] || ROLE_CONFIG.clawbot).label}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-[12px]">
                    <span className="text-terminal-muted">Status</span>
                    <div className="flex items-center gap-1.5">
                      <div className={`w-2 h-2 rounded-full ${(STATUS_STYLES[selectedAgent.status] || STATUS_STYLES.idle).pulse ? 'animate-pulse' : ''}`} style={{ backgroundColor: (STATUS_STYLES[selectedAgent.status] || STATUS_STYLES.idle).dot }} />
                      <span className="font-medium text-terminal-text">{(STATUS_STYLES[selectedAgent.status] || STATUS_STYLES.idle).label}</span>
                    </div>
                  </div>
                  {selectedAgent.currentTask && (
                    <div className="flex justify-between text-[12px]">
                      <span className="text-terminal-muted">Task</span>
                      <span className="font-medium text-terminal-text truncate ml-3">{selectedAgent.currentTask.name}</span>
                    </div>
                  )}
                  {selectedAgent.lastActivityAt && (
                    <div className="flex justify-between text-[12px]">
                      <span className="text-terminal-muted">Last active</span>
                      <span className="font-medium text-terminal-text">{new Date(selectedAgent.lastActivityAt).toLocaleTimeString()}</span>
                    </div>
                  )}
                  {selectedAgent.senderEmail && (
                    <div className="flex justify-between text-[12px]">
                      <span className="text-terminal-muted">Email</span>
                      <span className="font-mono text-[11px] text-terminal-text">{selectedAgent.senderEmail}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Live meetings */}
          <MeetingStatus meetings={meetings} />

          {/* Activity feed */}
          <ActivityFeed activities={activities} />
        </div>
      </div>
    </div>
  );
}

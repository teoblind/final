/**
 * OfficeDashboard — 3D Isometric office simulation
 *
 * Agents walk around an isometric office grid, working at desks,
 * heading to meetings, and interacting with each other.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../lib/hooks/useApi';
import { useTenant } from '../../contexts/TenantContext';

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
  walking:      { dot: '#60a5fa', label: 'Walking', pulse: true },
  processing:   { dot: '#2563eb', label: 'Working', pulse: true },
  running:      { dot: '#1a6b3c', label: 'Active', pulse: true },
  observing:    { dot: '#f59e0b', label: 'Observing', pulse: true },
  analyzing:    { dot: '#8b5cf6', label: 'Analyzing', pulse: true },
  transcribing: { dot: '#7c3aed', label: 'Transcribing', pulse: true },
  error:        { dot: '#ef4444', label: 'Error', pulse: false },
};

// Office "rooms" / points of interest
const OFFICE_LOCATIONS = [
  { id: 'desk-1', label: 'Desk', x: 0, y: 0 },
  { id: 'desk-2', label: 'Desk', x: 1, y: 0 },
  { id: 'desk-3', label: 'Desk', x: 2, y: 0 },
  { id: 'desk-4', label: 'Desk', x: 3, y: 0 },
  { id: 'desk-5', label: 'Desk', x: 0, y: 1 },
  { id: 'desk-6', label: 'Desk', x: 1, y: 1 },
  { id: 'meeting', label: 'Meeting Room', x: 2, y: 1 },
  { id: 'kitchen', label: 'Break Room', x: 3, y: 1 },
  { id: 'server', label: 'Server Room', x: 0, y: 2 },
  { id: 'lounge', label: 'Lounge', x: 1, y: 2 },
  { id: 'printer', label: 'Printer', x: 2, y: 2 },
  { id: 'entrance', label: 'Entrance', x: 3, y: 2 },
];

// ─── Isometric helpers ──────────────────────────────────────────────────────

function isoProject(gridX, gridY) {
  // Isometric projection
  const px = (gridX - gridY) * 110;
  const py = (gridX + gridY) * 55;
  return { px, py };
}

// ─── Floor Tile ─────────────────────────────────────────────────────────────

function FloorTile({ x, y, label, highlighted }) {
  const { px, py } = isoProject(x, y);
  const isSpecial = label === 'Meeting Room' || label === 'Break Room' || label === 'Server Room';

  return (
    <div
      className="absolute"
      style={{ left: `${px}px`, top: `${py}px`, width: '200px', zIndex: x + y }}
    >
      <svg viewBox="0 0 200 120" className="w-full">
        <defs>
          <linearGradient id={`floor-${x}-${y}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor={highlighted ? '#edf7f0' : isSpecial ? '#f0f0f8' : '#fafaf8'} />
            <stop offset="100%" stopColor={highlighted ? '#d4edda' : isSpecial ? '#e4e4f0' : '#f0eeea'} />
          </linearGradient>
        </defs>
        <polygon points="100,8 192,56 100,104 8,56" fill={`url(#floor-${x}-${y})`} stroke={highlighted ? '#1e3a5f' : '#e0ddd8'} strokeWidth="1.5" />
        <polygon points="8,56 100,104 100,116 8,68" fill={isSpecial ? '#d8d8e8' : '#e8e6e1'} stroke="#ddd9d3" strokeWidth="0.5" />
        <polygon points="192,56 100,104 100,116 192,68" fill={isSpecial ? '#ccccdd' : '#dddbd5'} stroke="#d0cec8" strokeWidth="0.5" />
      </svg>
      {/* Room label */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none" style={{ top: '15px' }}>
        <span className="text-[8px] font-semibold uppercase tracking-[1px] text-[#b0b0a8]">{label}</span>
      </div>
    </div>
  );
}

// ─── Walking Agent Character ────────────────────────────────────────────────

function WalkingAgent({ agent, gridX, gridY, isWalking, onClick, selected }) {
  const role = ROLE_CONFIG[agent.role] || ROLE_CONFIG.clawbot;
  const status = STATUS_STYLES[agent.displayStatus || agent.status] || STATUS_STYLES.idle;
  const isActive = ['processing', 'running', 'transcribing', 'observing', 'analyzing'].includes(agent.status);
  const { px, py } = isoProject(gridX, gridY);

  return (
    <div
      className="absolute cursor-pointer"
      style={{
        left: `${px + 60}px`,
        top: `${py - 10}px`,
        zIndex: Math.round((gridX + gridY) * 10) + 5,
        transition: isWalking ? 'left 2s ease-in-out, top 2s ease-in-out' : 'left 0.5s ease-out, top 0.5s ease-out',
      }}
      onClick={onClick}
    >
      <div
        className="flex flex-col items-center"
        style={{
          animation: isWalking
            ? 'agent-walk 0.8s ease-in-out infinite'
            : isActive
              ? 'agent-work 2s ease-in-out infinite'
              : 'agent-idle-sway 3s ease-in-out infinite',
        }}
      >
        {/* Task bubble */}
        {agent.currentTask && (
          <div className="mb-1 px-2 py-0.5 bg-white rounded-lg shadow-md border border-[#e0ddd8] max-w-[140px]" style={{ animation: 'bubble-in 0.3s ease-out' }}>
            <p className="text-[7px] text-[#6b6b65] truncate font-medium">{agent.currentTask.name}</p>
          </div>
        )}

        {/* Character body */}
        <div className="relative">
          {/* Shadow */}
          <div
            className="absolute bottom-[-4px] left-1/2 -translate-x-1/2 rounded-full bg-black/10 blur-[2px]"
            style={{ width: isWalking ? '44px' : '36px', height: isWalking ? '12px' : '8px', transition: 'all 0.3s' }}
          />

          {/* Glow ring */}
          {isActive && (
            <div className="absolute inset-[-4px] rounded-2xl" style={{ animation: 'glow-ring 1.5s ease-in-out infinite', boxShadow: `0 0 12px ${role.color}40` }} />
          )}

          {/* Body */}
          <div
            className={`w-11 h-13 rounded-xl flex items-center justify-center shadow-lg ${selected ? 'ring-2 ring-[#1e3a5f]' : ''}`}
            style={{
              background: isActive
                ? `linear-gradient(135deg, ${role.color}, ${role.color}dd)`
                : `linear-gradient(135deg, ${role.color}99, ${role.color}77)`,
              width: '44px', height: '52px',
              transform: 'perspective(200px) rotateX(5deg)',
            }}
          >
            <span className="text-lg">{role.emoji}</span>
            <div
              className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${status.pulse ? 'animate-pulse' : ''}`}
              style={{ backgroundColor: status.dot }}
            />
          </div>
        </div>

        {/* Name plate */}
        <div className="mt-1 px-1.5 py-px bg-white/90 rounded-md shadow-sm border border-[#e0ddd8]">
          <p className="text-[8px] font-bold text-[#333] text-center whitespace-nowrap">{agent.name.replace(/ (Email|Chat|Meeting|Research) Agent/, '')}</p>
          <p className="text-[7px] text-center font-medium" style={{ color: status.dot }}>{isWalking ? 'Walking' : status.label}</p>
        </div>
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
      <div className="max-h-[400px] overflow-y-auto">
        {activities.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-terminal-muted">No recent activity</div>
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
            {act.tenant && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[#f5f4f0] text-[#6b6b65] shrink-0">{act.tenant}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function OfficeDashboard() {
  const { tenant } = useTenant();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [agentPositions, setAgentPositions] = useState({}); // agentId -> { x, y, walking }
  const moveTimers = useRef({});

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
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Filter agents by tenant
  const tenantSlug = tenant?.slug;
  const tenantId = tenant?.id;
  const isSuperAdmin = !tenantSlug || tenantSlug === 'default' || tenantSlug === 'sangha';

  const allAgents = data?.agents || [];
  const agents = isSuperAdmin
    ? allAgents
    : allAgents.filter(a => a.tenant === tenantSlug || a.tenant === tenantId || a.tenant === tenant?.name);

  const allActivities = data?.activities || [];
  const activities = isSuperAdmin
    ? allActivities
    : allActivities.filter(a => a.tenant === tenantSlug || a.tenant === tenantId || a.tenant === 'dacp');

  // Initialize agent positions and start movement
  useEffect(() => {
    if (agents.length === 0) return;

    // Assign initial positions
    setAgentPositions(prev => {
      const next = { ...prev };
      agents.forEach((agent, i) => {
        if (!next[agent.id]) {
          const loc = OFFICE_LOCATIONS[i % OFFICE_LOCATIONS.length];
          next[agent.id] = { x: loc.x, y: loc.y, walking: false, targetLoc: loc.label };
        }
      });
      return next;
    });

    // Set up random movement for each agent
    agents.forEach((agent) => {
      if (moveTimers.current[agent.id]) return; // already has a timer

      const scheduleMove = () => {
        // Random delay between 4-12 seconds
        const delay = 4000 + Math.random() * 8000;
        moveTimers.current[agent.id] = setTimeout(() => {
          // Pick a random destination
          const dest = OFFICE_LOCATIONS[Math.floor(Math.random() * OFFICE_LOCATIONS.length)];

          // Start walking
          setAgentPositions(prev => ({
            ...prev,
            [agent.id]: { ...prev[agent.id], walking: true },
          }));

          // After a brief moment, move to new position
          setTimeout(() => {
            setAgentPositions(prev => ({
              ...prev,
              [agent.id]: { x: dest.x, y: dest.y, walking: true, targetLoc: dest.label },
            }));
          }, 100);

          // Stop walking after arrival
          setTimeout(() => {
            setAgentPositions(prev => ({
              ...prev,
              [agent.id]: { ...prev[agent.id], walking: false },
            }));
          }, 2200);

          scheduleMove(); // schedule next move
        }, delay);
      };

      scheduleMove();
    });

    return () => {
      Object.values(moveTimers.current).forEach(clearTimeout);
      moveTimers.current = {};
    };
  }, [agents.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeCount = agents.filter(a => a.status !== 'idle').length;

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[500px]">
        <div className="text-center">
          <div className="spinner w-10 h-10 mx-auto mb-3" />
          <div className="text-sm text-terminal-muted">Loading office...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:px-7 lg:py-6 min-h-screen">
      {/* Stats bar */}
      <div className="flex items-center gap-6 mb-6">
        <div>
          <p className="text-[10px] font-bold text-terminal-muted uppercase tracking-[1px]">{tenant?.name || 'Coppice'} Office</p>
          <p className="text-xs text-terminal-text font-semibold">{agents.length} agents — {activeCount} active</p>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-4">
          {[['idle', STATUS_STYLES.idle], ['walking', STATUS_STYLES.walking], ['processing', STATUS_STYLES.processing]].map(([key, s]) => (
            <div key={key} className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${s.pulse ? 'animate-pulse' : ''}`} style={{ backgroundColor: s.dot }} />
              <span className="text-[10px] text-terminal-muted font-medium">{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6">
        {/* Isometric office */}
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#f0eeea] flex items-center justify-between">
            <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Office Floor</span>
            <span className="text-[10px] text-terminal-muted">{data?.fetchedAt ? `Updated ${new Date(data.fetchedAt).toLocaleTimeString()}` : ''}</span>
          </div>

          <div className="p-6 overflow-auto" style={{ minHeight: '460px' }}>
            <div className="relative" style={{ width: '900px', height: '500px', margin: '0 auto' }}>
              <div className="absolute" style={{ left: '380px', top: '20px' }}>
                {/* Floor tiles */}
                {OFFICE_LOCATIONS.map(loc => (
                  <FloorTile key={loc.id} x={loc.x} y={loc.y} label={loc.label} />
                ))}

                {/* Walking agents */}
                {agents.map(agent => {
                  const pos = agentPositions[agent.id];
                  if (!pos) return null;
                  return (
                    <WalkingAgent
                      key={agent.id}
                      agent={agent}
                      gridX={pos.x}
                      gridY={pos.y}
                      isWalking={pos.walking}
                      selected={selectedAgent?.id === agent.id}
                      onClick={() => setSelectedAgent(selectedAgent?.id === agent.id ? null : agent)}
                    />
                  );
                })}
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
                    <p className="text-[10px] text-terminal-muted">{(ROLE_CONFIG[selectedAgent.role] || ROLE_CONFIG.clawbot).label}</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-[12px]">
                    <span className="text-terminal-muted">Status</span>
                    <div className="flex items-center gap-1.5">
                      <div className={`w-2 h-2 rounded-full`} style={{ backgroundColor: (STATUS_STYLES[selectedAgent.status] || STATUS_STYLES.idle).dot }} />
                      <span className="font-medium text-terminal-text">{(STATUS_STYLES[selectedAgent.status] || STATUS_STYLES.idle).label}</span>
                    </div>
                  </div>
                  {agentPositions[selectedAgent.id] && (
                    <div className="flex justify-between text-[12px]">
                      <span className="text-terminal-muted">Location</span>
                      <span className="font-medium text-terminal-text">{agentPositions[selectedAgent.id].targetLoc}</span>
                    </div>
                  )}
                  {selectedAgent.currentTask && (
                    <div className="flex justify-between text-[12px]">
                      <span className="text-terminal-muted">Task</span>
                      <span className="font-medium text-terminal-text truncate ml-3">{selectedAgent.currentTask.name}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Activity feed */}
          <ActivityFeed activities={activities} />
        </div>
      </div>
    </div>
  );
}

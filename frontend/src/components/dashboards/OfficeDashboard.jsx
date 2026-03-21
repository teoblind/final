import React, { useState, useEffect, useCallback } from 'react';
import api from '../../lib/hooks/useApi';
import { useTenant } from '../../contexts/TenantContext';
import { FloorPlan } from './office-2d/FloorPlan';
import { STATUS_COLORS } from './office-2d/constants';

const ROLE_CONFIG = {
  email:    { emoji: '📧', color: '#2563eb', label: 'Email' },
  chat:     { emoji: '💬', color: '#7c3aed', label: 'Chat' },
  meeting:  { emoji: '🎙️', color: '#1a6b3c', label: 'Meeting' },
  research: { emoji: '🔬', color: '#b8860b', label: 'Research' },
  clawbot:  { emoji: '🤖', color: '#64748b', label: 'System' },
};

const STATUS_LABELS = {
  idle: 'Idle', thinking: 'Thinking', tool_calling: 'Using Tool',
  speaking: 'Speaking', processing: 'Processing', running: 'Running',
  transcribing: 'Transcribing', observing: 'Observing', analyzing: 'Analyzing',
  error: 'Error', offline: 'Offline',
};

// Map Coppice agent status to OpenClaw visual status
function mapStatus(status) {
  const mapping = {
    idle: 'idle',
    processing: 'thinking',
    running: 'tool_calling',
    observing: 'idle',
    analyzing: 'thinking',
    transcribing: 'speaking',
    error: 'error',
  };
  return mapping[status] || status;
}

// Assign zone based on role
function assignZone(role) {
  switch (role) {
    case 'meeting': return 'meeting';
    case 'research': return 'hotDesk';
    default: return 'desk';
  }
}

export default function OfficeDashboard() {
  const { tenant } = useTenant();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedAgentId, setSelectedAgentId] = useState(null);

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

  const tenantSlug = tenant?.slug;
  const tenantId = tenant?.id;
  const isSuperAdmin = !tenantSlug || tenantSlug === 'default' || tenantSlug === 'sangha';

  const allAgents = data?.agents || [];
  const filteredAgents = isSuperAdmin
    ? allAgents
    : allAgents.filter(a => a.tenant === tenantSlug || a.tenant === tenantId || a.tenant === tenant?.name);

  // Transform Coppice agents into OpenClaw VisualAgent format
  const visualAgents = filteredAgents.map((agent) => ({
    id: agent.id,
    name: agent.name.replace(/ (Email|Chat|Meeting|Research) Agent/, ''),
    status: mapStatus(agent.status),
    originalStatus: agent.status,
    zone: assignZone(agent.role),
    role: agent.role,
    position: { x: 0, y: 0 }, // positioned by FloorPlan
    currentTool: agent.currentTask ? { name: agent.currentTask.name } : null,
    speechBubble: null,
    isSubAgent: false,
    confirmed: true,
    movement: null,
  }));

  const allActivities = data?.activities || [];
  const activities = isSuperAdmin
    ? allActivities
    : allActivities.filter(a => a.tenant === tenantSlug || a.tenant === tenantId || a.tenant === 'dacp');

  const activeCount = filteredAgents.filter(a => a.status !== 'idle').length;
  const selectedAgent = filteredAgents.find(a => a.id === selectedAgentId);

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
          <p className="text-xs text-terminal-text font-semibold">{filteredAgents.length} agents — {activeCount} active</p>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-4">
          {[
            ['Idle', STATUS_COLORS.idle, false],
            ['Working', STATUS_COLORS.thinking, true],
            ['Active', STATUS_COLORS.tool_calling, true],
          ].map(([label, color, pulse]) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${pulse ? 'animate-pulse' : ''}`} style={{ backgroundColor: color }} />
              <span className="text-[10px] text-terminal-muted font-medium">{label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6">
        {/* Office floor plan */}
        <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
          <div className="px-4 py-3 border-b border-[#f0eeea] flex items-center justify-between">
            <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Office Floor</span>
            <span className="text-[10px] text-terminal-muted">{data?.fetchedAt ? `Updated ${new Date(data.fetchedAt).toLocaleTimeString()}` : ''}</span>
          </div>
          <div style={{ minHeight: '460px' }}>
            <FloorPlan
              agents={visualAgents}
              selectedAgentId={selectedAgentId}
              onSelectAgent={(id) => setSelectedAgentId(selectedAgentId === id ? null : id)}
              tenantName={tenant?.name || 'Coppice'}
            />
          </div>
        </div>

        {/* Right sidebar */}
        <div className="space-y-4">
          {/* Agent detail */}
          {selectedAgent && (
            <div className="bg-terminal-panel border border-terminal-border rounded-[14px] overflow-hidden">
              <div className="px-4 py-3 border-b border-[#f0eeea]">
                <span className="text-xs font-bold text-terminal-text tracking-[0.3px]">Agent Detail</span>
              </div>
              <div className="p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shadow-md"
                    style={{ background: `linear-gradient(135deg, ${(ROLE_CONFIG[selectedAgent.role] || ROLE_CONFIG.clawbot).color}cc, ${(ROLE_CONFIG[selectedAgent.role] || ROLE_CONFIG.clawbot).color})` }}>
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
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: STATUS_COLORS[mapStatus(selectedAgent.status)] || '#9ca3af' }} />
                      <span className="font-medium text-terminal-text">{STATUS_LABELS[selectedAgent.status] || selectedAgent.status}</span>
                    </div>
                  </div>
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
        </div>
      </div>
    </div>
  );
}

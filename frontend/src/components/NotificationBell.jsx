import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Bell, X, Check, CheckCheck } from 'lucide-react';
import { useApi, postApi } from '../hooks/useApi';

const TYPE_COLORS = {
  info: 'border-l-terminal-muted',
  warning: 'border-l-terminal-amber',
  action: 'border-l-terminal-amber',
  success: 'border-l-terminal-green',
  // Legacy types (Phase 6 fallback)
  action_required: 'border-l-terminal-amber',
  critical: 'border-l-terminal-red',
};

const AGENT_COLORS = {
  curtailment: 'bg-red-500',
  sangha: 'bg-blue-500',
  pools: 'bg-emerald-500',
  estimating: 'bg-amber-500',
  meetings: 'bg-purple-500',
  email: 'bg-cyan-500',
  documents: 'bg-indigo-500',
  hivemind: 'bg-violet-500',
};

const AGENT_LABELS = {
  curtailment: 'Curtailment',
  sangha: 'Sangha',
  pools: 'Pools',
  estimating: 'Estimating',
  meetings: 'Meetings',
  email: 'Email',
  documents: 'Docs',
  hivemind: 'Hivemind',
};

function getTimeAgo(timestamp) {
  const diff = Date.now() - new Date(timestamp).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export default function NotificationBell({ onNavigate }) {
  const [open, setOpen] = useState(false);
  const [usePlatform, setUsePlatform] = useState(true);
  const drawerRef = useRef(null);

  // Platform notifications (new multi-tenant system)
  const { data: platformCountData, error: platformCountErr } = useApi(
    usePlatform ? '/v1/platform-notifications/count' : null,
    { refreshInterval: 10000 }
  );
  const { data: platformNotifData, refetch: platformRefetch, error: platformNotifErr } = useApi(
    usePlatform && open ? '/v1/platform-notifications?limit=10' : null,
    { refreshInterval: open ? 10000 : 0 }
  );

  // Legacy fallback (Phase 6 notifications)
  const { data: legacyCountData } = useApi(
    !usePlatform ? '/notifications/count' : null,
    { refreshInterval: 10000 }
  );
  const { data: legacyNotifData, refetch: legacyRefetch } = useApi(
    !usePlatform && open ? '/notifications?limit=30' : null,
    { refreshInterval: open ? 10000 : 0 }
  );

  // If platform API fails, fall back to legacy
  useEffect(() => {
    if (platformCountErr || platformNotifErr) {
      setUsePlatform(false);
    }
  }, [platformCountErr, platformNotifErr]);

  const unreadCount = usePlatform
    ? (platformCountData?.unreadCount || 0)
    : (legacyCountData?.unreadCount || 0);

  const notifications = usePlatform
    ? (platformNotifData?.notifications || [])
    : (legacyNotifData?.notifications || []);

  const refetch = usePlatform ? platformRefetch : legacyRefetch;

  // Close drawer on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleMarkRead = useCallback(async (id) => {
    const endpoint = usePlatform
      ? `/v1/platform-notifications/${id}/read`
      : `/notifications/${id}/read`;
    await postApi(endpoint);
    refetch();
  }, [usePlatform, refetch]);

  const handleMarkAllRead = useCallback(async () => {
    const endpoint = usePlatform
      ? '/v1/platform-notifications/read-all'
      : '/notifications/read-all';
    await postApi(endpoint);
    refetch();
  }, [usePlatform, refetch]);

  const handleNotifClick = useCallback(async (notif) => {
    if (!notif.read) {
      const endpoint = usePlatform
        ? `/v1/platform-notifications/${notif.id}/read`
        : `/notifications/${notif.id}/read`;
      await postApi(endpoint);
      refetch();
    }
    if (notif.link_tab && onNavigate) {
      onNavigate(notif.link_tab);
      setOpen(false);
    }
  }, [usePlatform, refetch, onNavigate]);

  return (
    <div className="relative" ref={drawerRef}>
      {/* Bell Button */}
      <button
        onClick={() => { setOpen(!open); if (!open) refetch(); }}
        className="relative p-2 border border-terminal-border rounded-lg hover:bg-terminal-bg/50 transition-colors"
        title="Notifications"
      >
        <Bell size={18} className="text-terminal-muted" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Notification Drawer */}
      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 max-h-[70vh] bg-terminal-panel border border-terminal-border rounded-lg shadow-xl overflow-hidden z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-terminal-border bg-terminal-bg/50">
            <p className="text-sm font-semibold text-terminal-text">Notifications</p>
            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="text-[10px] text-terminal-cyan hover:underline flex items-center gap-1"
                  title="Mark all as read"
                >
                  <CheckCheck size={12} /> Read all
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-0.5 hover:bg-terminal-border rounded">
                <X size={14} className="text-terminal-muted" />
              </button>
            </div>
          </div>

          {/* Notification List */}
          <div className="overflow-y-auto max-h-[60vh]">
            {notifications.length === 0 && (
              <div className="py-8 text-center">
                <p className="text-xs text-terminal-muted">No notifications</p>
              </div>
            )}

            {notifications.map((notif) => {
              const agentId = notif.agent_id || notif.source;
              const agentColor = AGENT_COLORS[agentId] || 'bg-gray-500';
              const agentLabel = AGENT_LABELS[agentId] || agentId;
              const timeField = notif.created_at || notif.timestamp;

              return (
                <div
                  key={notif.id}
                  onClick={() => handleNotifClick(notif)}
                  className={`px-3 py-2.5 border-b border-terminal-border/30 border-l-2 ${TYPE_COLORS[notif.type] || 'border-l-terminal-muted'} ${
                    !notif.read ? 'bg-terminal-bg/30' : ''
                  } hover:bg-terminal-bg/50 transition-colors cursor-pointer`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      {/* Agent icon badge */}
                      {agentId && (
                        <span className={`mt-0.5 w-5 h-5 ${agentColor} rounded-full shrink-0 flex items-center justify-center text-[8px] font-bold text-white uppercase`}>
                          {(agentLabel || '?')[0]}
                        </span>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          {!notif.read && (
                            <span className="w-1.5 h-1.5 bg-terminal-cyan rounded-full shrink-0" />
                          )}
                          <p className={`text-xs font-medium truncate ${notif.read ? 'text-terminal-muted' : 'text-terminal-text'}`}>
                            {notif.title}
                          </p>
                        </div>
                        {notif.body && (
                          <p className="text-[10px] text-terminal-muted mt-0.5 line-clamp-2">{notif.body}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[9px] text-terminal-muted">{getTimeAgo(timeField)}</span>
                          {agentLabel && (
                            <span className="text-[9px] text-terminal-muted">{agentLabel}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {!notif.read && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleMarkRead(notif.id); }}
                          className="p-0.5 hover:bg-terminal-border rounded"
                          title="Mark read"
                        >
                          <Check size={10} className="text-terminal-muted" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

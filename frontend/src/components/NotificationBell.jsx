import React, { useState, useEffect, useRef } from 'react';
import { Bell, X, Check, CheckCheck } from 'lucide-react';
import { useApi, postApi } from '../hooks/useApi';

const TYPE_COLORS = {
  info: 'border-l-terminal-muted',
  action_required: 'border-l-terminal-amber',
  warning: 'border-l-terminal-amber',
  critical: 'border-l-terminal-red',
};

const TYPE_ICONS = {
  info: '\u2139\uFE0F',
  action_required: '\u26A0\uFE0F',
  warning: '\u26A0\uFE0F',
  critical: '\uD83D\uDEA8',
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

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const drawerRef = useRef(null);
  const { data: countData } = useApi('/notifications/count', { refreshInterval: 10000 });
  const { data: notifData, refetch } = useApi(
    open ? '/notifications?limit=30' : null,
    { refreshInterval: open ? 10000 : 0 }
  );

  const unreadCount = countData?.unreadCount || 0;
  const notifications = notifData?.notifications || [];

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

  // Browser notification for critical alerts
  useEffect(() => {
    if (!notifications.length) return;
    const critical = notifications.find(n => n.type === 'critical' && !n.read);
    if (critical && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('Sangha MineOS Alert', {
        body: critical.title,
        icon: '/favicon.ico',
        tag: `mineos-${critical.id}`,
      });
    }
  }, [notifications]);

  const handleMarkRead = async (id) => {
    await postApi(`/notifications/${id}/read`);
    refetch();
  };

  const handleMarkAllRead = async () => {
    await postApi('/notifications/read-all');
    refetch();
  };

  const handleDismiss = async (id) => {
    await postApi(`/notifications/${id}/dismiss`);
    refetch();
  };

  return (
    <div className="relative" ref={drawerRef}>
      {/* Bell Button */}
      <button
        onClick={() => { setOpen(!open); if (!open) refetch(); }}
        className="relative p-2 hover:bg-terminal-panel rounded transition-colors"
        title="Notifications"
      >
        <Bell size={18} className={unreadCount > 0 ? 'text-terminal-amber' : 'text-terminal-muted'} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-terminal-red text-white text-[9px] font-bold rounded-full flex items-center justify-center">
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

            {notifications.map((notif) => (
              <div
                key={notif.id}
                className={`px-3 py-2.5 border-b border-terminal-border/30 border-l-2 ${TYPE_COLORS[notif.type] || 'border-l-terminal-muted'} ${
                  !notif.read ? 'bg-terminal-bg/30' : ''
                } hover:bg-terminal-bg/50 transition-colors`}
              >
                <div className="flex items-start justify-between gap-2">
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
                      <span className="text-[9px] text-terminal-muted">{getTimeAgo(notif.timestamp)}</span>
                      <span className="text-[9px] text-terminal-muted">{notif.source}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!notif.read && (
                      <button
                        onClick={() => handleMarkRead(notif.id)}
                        className="p-0.5 hover:bg-terminal-border rounded"
                        title="Mark read"
                      >
                        <Check size={10} className="text-terminal-muted" />
                      </button>
                    )}
                    <button
                      onClick={() => handleDismiss(notif.id)}
                      className="p-0.5 hover:bg-terminal-border rounded"
                      title="Dismiss"
                    >
                      <X size={10} className="text-terminal-muted" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

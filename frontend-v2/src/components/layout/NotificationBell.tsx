import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../../api/client';
import { groupNotifications, type NotificationGroup } from './notificationGroups';

export interface AppNotification {
  id: number;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

interface NotificationListResponse {
  success: boolean;
  data: AppNotification[];
  total: number;
  unread_count: number;
}

const POLL_MS = 60_000;

/** Stored links carry the /app basename; router paths are relative to it. */
function toRoutePath(link: string | null): string | null {
  if (!link) return null;
  return link.startsWith('/app') ? link.slice(4) || '/' : link;
}

function relativeTime(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const refreshUnread = useCallback(async () => {
    try {
      const resp = await apiClient.get<NotificationListResponse>('/notifications/', { params: { size: 1 } });
      setUnread(resp.data.unread_count);
    } catch {
      // Badge stays at its last known value; the next poll retries.
    }
  }, []);

  useEffect(() => {
    void refreshUnread();
    const timer = window.setInterval(() => void refreshUnread(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refreshUnread]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const openPanel = async () => {
    const next = !open;
    setOpen(next);
    if (!next) return;
    try {
      const resp = await apiClient.get<NotificationListResponse>('/notifications/', { params: { size: 10 } });
      setItems(resp.data.data);
      setUnread(resp.data.unread_count);
    } catch {
      setItems([]);
    }
  };

  const markAllRead = async () => {
    await apiClient.post('/notifications/read-all');
    setUnread(0);
    setItems(current => current?.map(item => ({ ...item, read_at: item.read_at ?? new Date().toISOString() })) ?? current);
  };

  const deleteGroup = async (group: NotificationGroup) => {
    const ids = new Set(group.items.map(item => item.id));
    setItems(current => current?.filter(entry => !ids.has(entry.id)) ?? current);
    const unreadInGroup = group.items.filter(item => !item.read_at).length;
    if (unreadInGroup > 0) setUnread(count => Math.max(0, count - unreadInGroup));
    try {
      await Promise.all(group.items.map(item => apiClient.delete(`/notifications/${item.id}`)));
    } catch {
      void refreshUnread();
    }
  };

  const clearRead = async () => {
    const hadRead = items?.some(item => item.read_at) ?? false;
    setItems(current => current?.filter(entry => !entry.read_at) ?? current);
    try {
      await apiClient.delete('/notifications/read');
    } catch {
      if (hadRead) void openPanel();
    }
  };

  const openGroup = async (group: NotificationGroup) => {
    const latest = group.items[0];
    const unreadItems = group.items.filter(item => !item.read_at);
    if (unreadItems.length > 0) {
      const ids = new Set(unreadItems.map(item => item.id));
      const now = new Date().toISOString();
      unreadItems.forEach(item => void apiClient.post(`/notifications/${item.id}/read`).catch(() => undefined));
      setUnread(count => Math.max(0, count - unreadItems.length));
      setItems(current => current?.map(entry => (ids.has(entry.id) ? { ...entry, read_at: entry.read_at ?? now } : entry)) ?? current);
    }
    const path = toRoutePath(latest.link);
    if (path) {
      setOpen(false);
      navigate(path);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        onClick={() => void openPanel()}
        className="relative grid h-10 w-10 place-items-center rounded-md text-surface-300 hover:bg-surface-800"
      >
        <Bell className="h-5 w-5" aria-hidden="true" />
        {unread > 0 && (
          <span className="absolute right-0.5 top-0.5 grid min-h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-lg border border-surface-800 bg-surface-900 shadow-xl">
          <div className="flex items-center justify-between border-b border-surface-800 px-3 py-2">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-surface-400">Notifications</p>
            <div className="flex items-center gap-3">
              {items?.some(item => item.read_at) && (
                <button
                  type="button"
                  onClick={() => void clearRead()}
                  className="flex items-center gap-1 text-[11px] font-semibold text-surface-400 hover:text-surface-200"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Clear read
                </button>
              )}
              {unread > 0 && (
                <button
                  type="button"
                  onClick={() => void markAllRead()}
                  className="flex items-center gap-1 text-[11px] font-semibold text-accent-400 hover:text-accent-300"
                >
                  <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  Mark all read
                </button>
              )}
            </div>
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {items === null && <li className="px-3 py-4 text-center text-xs text-surface-500">Loading…</li>}
            {items !== null && items.length === 0 && (
              <li className="px-3 py-4 text-center text-xs text-surface-500">No notifications yet</li>
            )}
            {items && groupNotifications(items).map(group => {
              const item = group.items[0];
              const anyUnread = group.items.some(entry => !entry.read_at);
              return (
              <li key={group.items.map(entry => entry.id).join('-')} className="group relative">
                <button
                  type="button"
                  onClick={() => void openGroup(group)}
                  className={`flex w-full flex-col gap-0.5 px-3 py-2.5 pr-9 text-left hover:bg-surface-800 ${anyUnread ? '' : 'opacity-60'}`}
                >
                  <span className="flex items-center gap-2">
                    {anyUnread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400" aria-hidden="true" />}
                    <span className="truncate text-xs font-semibold text-surface-100">{item.title}</span>
                    {group.items.length > 1 && (
                      <span className="shrink-0 rounded-full bg-surface-700 px-1.5 text-[10px] font-bold leading-4 text-surface-200">
                        ×{group.items.length}
                      </span>
                    )}
                  </span>
                  {item.body && <span className="truncate pl-3.5 text-[11px] text-surface-400">{item.body}</span>}
                  <span className="pl-3.5 text-[10px] uppercase tracking-wide text-surface-500">{relativeTime(item.created_at)}</span>
                </button>
                <button
                  type="button"
                  aria-label={group.items.length > 1 ? `Delete ${group.items.length} notifications: ${item.title}` : `Delete notification ${item.title}`}
                  onClick={() => void deleteGroup(group)}
                  className="absolute right-2 top-2.5 grid h-6 w-6 place-items-center rounded text-surface-500 opacity-0 transition-opacity hover:bg-surface-700 hover:text-surface-200 focus:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

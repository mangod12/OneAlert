import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import apiClient from '../../api/client';

interface AppNotification {
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

  const openItem = async (item: AppNotification) => {
    if (!item.read_at) {
      void apiClient.post(`/notifications/${item.id}/read`).catch(() => undefined);
      setUnread(count => Math.max(0, count - 1));
      setItems(current => current?.map(entry => (entry.id === item.id ? { ...entry, read_at: new Date().toISOString() } : entry)) ?? current);
    }
    const path = toRoutePath(item.link);
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
          <ul className="max-h-80 overflow-y-auto">
            {items === null && <li className="px-3 py-4 text-center text-xs text-surface-500">Loading…</li>}
            {items !== null && items.length === 0 && (
              <li className="px-3 py-4 text-center text-xs text-surface-500">No notifications yet</li>
            )}
            {items?.map(item => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => void openItem(item)}
                  className={`flex w-full flex-col gap-0.5 px-3 py-2.5 text-left hover:bg-surface-800 ${item.read_at ? 'opacity-60' : ''}`}
                >
                  <span className="flex items-center gap-2">
                    {!item.read_at && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-400" aria-hidden="true" />}
                    <span className="truncate text-xs font-semibold text-surface-100">{item.title}</span>
                  </span>
                  {item.body && <span className="truncate pl-3.5 text-[11px] text-surface-400">{item.body}</span>}
                  <span className="pl-3.5 text-[10px] uppercase tracking-wide text-surface-500">{relativeTime(item.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

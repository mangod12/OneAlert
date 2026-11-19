import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellOff, CheckCheck, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import apiClient from '../api/client';
import { groupNotifications, type NotificationGroup } from '../components/layout/notificationGroups';
import type { AppNotification } from '../components/layout/NotificationBell';
import { relativeTime } from '../utils/relativeTime';

interface NotificationListResponse {
  success: boolean;
  data: AppNotification[];
  total: number;
  unread_count: number;
  page: number;
  size: number;
}

const KIND_LABELS: Array<[string, string]> = [
  ['alert_created', 'New alerts'],
  ['alert_assigned', 'Alert assignments'],
  ['alert_updated', 'Alert updates'],
  ['alert_watching', 'Alert watch additions'],
  ['alert_mention', 'Alert mentions'],
  ['case_assigned', 'Case assignments'], ['case_task_assigned', 'Task assignments'],
  ['case_updated', 'Case updates'],
  ['case_watching', 'Case watch additions'],
  ['case_mention', 'Case mentions'],
  ['incident_escalated', 'Incident escalations'],
  ['case_sla_breached', 'SLA breaches'],
  ['case_sla_due_soon', 'SLA due soon'],
  ['alert_sla_breached', 'Alert SLA breaches'],
  ['alert_sla_due_soon', 'Alert SLA due soon'],
];

function kindLabel(kind: string): string {
  return KIND_LABELS.find(([k]) => k === kind)?.[1] ?? kind.replace(/_/g, ' ');
}

function toRoutePath(link: string | null): string | null {
  if (!link) return null;
  return link.startsWith('/app') ? link.slice(4) || '/' : link;
}

const PAGE_SIZE = 20;

export function Notifications() {
  const navigate = useNavigate();
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    try {
      const resp = await apiClient.get<NotificationListResponse>('/notifications/', {
        params: { page, size: PAGE_SIZE, unread_only: unreadOnly, ...(kind ? { kind } : {}) },
      });
      setLoadError(false);
      setUnread(resp.data.unread_count);
      setTotal(resp.data.total);
      setItems(resp.data.data);
    } catch {
      setLoadError(true);
      setItems([]);
    }
  }, [page, unreadOnly, kind]);

  useEffect(() => { void load(); }, [load]);

  const markAllRead = async () => {
    await apiClient.post('/notifications/read-all');
    setUnread(0);
    setItems(current => current?.map(item => ({ ...item, read_at: item.read_at ?? new Date().toISOString() })) ?? current);
  };

  const clearRead = async () => {
    setItems(current => current?.filter(item => !item.read_at) ?? current);
    try {
      await apiClient.delete('/notifications/read');
      void load();
    } catch {
      void load();
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
    if (path) navigate(path);
  };

  const deleteGroup = async (group: NotificationGroup) => {
    const ids = new Set(group.items.map(item => item.id));
    setItems(current => current?.filter(entry => !ids.has(entry.id)) ?? current);
    const unreadInGroup = group.items.filter(item => !item.read_at).length;
    if (unreadInGroup > 0) setUnread(count => Math.max(0, count - unreadInGroup));
    try {
      await Promise.all(group.items.map(item => apiClient.delete(`/notifications/${item.id}`)));
    } catch {
      void load();
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-surface-50">Notifications</h1>
          <p className="text-sm text-surface-400">{unread > 0 ? `${unread} unread` : 'All caught up'}</p>
        </div>
        <div className="flex items-center gap-2">
          {items?.some(item => item.read_at) && (
            <button
              type="button"
              onClick={() => void clearRead()}
              className="flex items-center gap-1.5 rounded-md border border-surface-700 px-3 py-1.5 text-xs font-semibold text-surface-300 hover:bg-surface-800"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Clear read
            </button>
          )}
          {unread > 0 && (
            <button
              type="button"
              onClick={() => void markAllRead()}
              className="flex items-center gap-1.5 rounded-md bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-500"
            >
              <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Mark all read
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="sr-only" htmlFor="notif-kind">Filter by type</label>
        <select
          id="notif-kind"
          value={kind}
          onChange={e => { setKind(e.target.value); setPage(1); }}
          className="rounded-md border border-surface-700 bg-surface-900 px-2.5 py-1.5 text-sm text-surface-200"
        >
          <option value="">All types</option>
          {KIND_LABELS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-surface-300">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={e => { setUnreadOnly(e.target.checked); setPage(1); }}
            className="h-4 w-4 rounded border-surface-600"
          />
          Unread only
        </label>
      </div>

      {loadError && <p className="rounded-md border border-danger-500/40 bg-danger-500/10 px-3 py-2 text-sm text-danger-300">Notifications could not be loaded.</p>}

      <ul className="divide-y divide-surface-800 overflow-hidden rounded-lg border border-surface-800 bg-surface-900">
        {items === null && <li className="px-4 py-8 text-center text-sm text-surface-500">Loading…</li>}
        {items !== null && items.length === 0 && (
          <li className="flex flex-col items-center gap-2 px-4 py-10 text-sm text-surface-500">
            <BellOff className="h-6 w-6" aria-hidden="true" />
            No notifications match these filters
          </li>
        )}
        {items && groupNotifications(items).map(group => {
          const item = group.items[0];
          const anyUnread = group.items.some(entry => !entry.read_at);
          return (
            <li key={group.items.map(entry => entry.id).join('-')} className="group relative">
              <button
                type="button"
                onClick={() => void openGroup(group)}
                className={`flex w-full items-start gap-3 px-4 py-3 pr-12 text-left hover:bg-surface-800 ${anyUnread ? '' : 'opacity-60'}`}
              >
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${anyUnread ? 'bg-accent-400' : 'bg-transparent'}`} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-surface-100">{item.title}</span>
                    {group.items.length > 1 && (
                      <span className="shrink-0 rounded-full bg-surface-700 px-1.5 text-[10px] font-bold leading-4 text-surface-200">×{group.items.length}</span>
                    )}
                  </span>
                  {item.body && <span className="mt-0.5 block truncate text-xs text-surface-400">{item.body}</span>}
                  <span className="mt-1 block text-[10px] uppercase tracking-wide text-surface-500">
                    {kindLabel(item.kind)} · {relativeTime(item.created_at)}
                  </span>
                </span>
              </button>
              <button
                type="button"
                aria-label={group.items.length > 1 ? `Delete ${group.items.length} notifications: ${item.title}` : `Delete notification ${item.title}`}
                onClick={() => void deleteGroup(group)}
                className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded text-surface-500 opacity-0 transition-opacity hover:bg-surface-700 hover:text-surface-200 focus:opacity-100 group-hover:opacity-100"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-surface-400">
          <button
            type="button"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            className="flex items-center gap-1 rounded-md border border-surface-700 px-3 py-1.5 hover:bg-surface-800 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Newer
          </button>
          <span>Page {page} of {totalPages}</span>
          <button
            type="button"
            aria-label="Next page"
            disabled={page >= totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            className="flex items-center gap-1 rounded-md border border-surface-700 px-3 py-1.5 hover:bg-surface-800 disabled:opacity-40"
          >
            Older
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

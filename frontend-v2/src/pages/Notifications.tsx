import { NotificationBatchReview } from '../components/NotificationBatchReview';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellOff, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
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
  ['case_assigned', 'Case assignments'], ['case_task_assigned', 'Task assignments'], ['case_task_due_soon', 'Task due soon'], ['case_task_overdue', 'Task overdue'],
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
  if (!link || !link.startsWith('/') || link.startsWith('//') || link.includes('\\')) return null;
  const path = link === '/app' ? '/' : link.startsWith('/app/') ? link.slice(4) : link;
  return path.startsWith('//') ? null : path;
}

const PAGE_SIZE = 20;

export function Notifications() {
  const navigate = useNavigate();
  const requestId = useRef(0);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const [total, setTotal] = useState(0);
  const [unread, setUnread] = useState(0);
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState('');
  const [query, setQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<number | null>(null);
  const [actionError, setActionError] = useState('');

  const load = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true);
    setLoadError(false);
    try {
      const resp = await apiClient.get<NotificationListResponse>('/notifications/', {
        params: { page, size: PAGE_SIZE, unread_only: unreadOnly, ...(kind ? { kind } : {}), ...(query.trim() ? { query: query.trim() } : {}) },
      });
      if (request !== requestId.current) return;
      setLoadError(false);
      setUnread(resp.data.unread_count);
      setTotal(resp.data.total);
      setItems(resp.data.data);
    } catch {
      if (request !== requestId.current) return;
      setLoadError(true);
      setItems(null);
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [page, unreadOnly, kind, query]);

  useEffect(() => {
    void load();
    return () => { requestId.current += 1; };
  }, [load]);

  const markGroupRead = async (group: NotificationGroup): Promise<boolean> => {
    if (busy) return false;
    const unreadItems = group.items.filter(item => !item.read_at);
    if (!unreadItems.length) return true;
    setBusy(true);
    setActionError('');
    const results = await Promise.allSettled(unreadItems.map(item => apiClient.post(`/notifications/${item.id}/read`)));
    const saved = new Set(unreadItems.filter((_, index) => results[index].status === 'fulfilled').map(item => item.id));
    const now = new Date().toISOString();
    setUnread(count => Math.max(0, count - saved.size));
    setItems(current => unreadOnly
      ? current?.filter(entry => !saved.has(entry.id)) ?? current
      : current?.map(entry => saved.has(entry.id) ? { ...entry, read_at: entry.read_at ?? now } : entry) ?? current);
    if (unreadOnly) setTotal(count => Math.max(0, count - saved.size));
    const failed = unreadItems.length - saved.size;
    if (failed) setActionError(`${failed} notification${failed === 1 ? '' : 's'} could not be marked read. Failed items remain unread. Try again to retry only those items.`);
    setBusy(false);
    return failed === 0;
  };

  const openGroup = async (group: NotificationGroup) => {
    if (busy) return;
    const saved = await markGroupRead(group);
    if (!saved) return;
    const path = toRoutePath(group.items[0].link);
    if (path) navigate(path);
  };

  const deleteGroup = async (group: NotificationGroup) => {
    if (busy) return;
    setBusy(true);
    setActionError('');
    const results = await Promise.allSettled(group.items.map(item => apiClient.delete(`/notifications/${item.id}`)));
    const removed = new Set(group.items.filter((_, index) => results[index].status === 'fulfilled').map(item => item.id));
    setItems(current => current?.filter(item => !removed.has(item.id)) ?? current);
    setTotal(count => Math.max(0, count - removed.size));
    setUnread(count => Math.max(0, count - group.items.filter(item => removed.has(item.id) && !item.read_at).length));
    const failed = results.length - removed.size;
    if (failed) setActionError(`${failed} notification${failed === 1 ? '' : 's'} could not be deleted. Remaining items are still shown. Try again.`);
    setBusy(false);
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  useEffect(() => { if (!busy && !loading && !loadError && page > totalPages) setPage(totalPages); }, [busy, loading, loadError, page, totalPages]);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-surface-50">Notifications</h1>
          <p className="text-sm text-surface-400">{loading ? 'Loading notifications...' : loadError ? 'Unread count unavailable' : unread > 0 ? `${unread} unread` : 'All caught up'}</p>
        </div>

      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input type="search" aria-label="Search notification text" maxLength={200} value={query} disabled={busy} onChange={e => { setQuery(e.target.value); setPage(1); setExpandedGroup(null); }} placeholder="Search titles and saved messages..." className="min-w-0 w-full rounded-md border border-surface-700 bg-surface-900 px-3 py-2 text-sm text-surface-200" />
        {query && <button type="button" disabled={busy} onClick={() => { setQuery(''); setPage(1); }} className="text-xs text-accent-400">Clear notification search</button>}
        <label className="sr-only" htmlFor="notif-kind">Filter by type</label>
        <select
          id="notif-kind"
          disabled={busy}
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
            disabled={busy}
            checked={unreadOnly}
            onChange={e => { setUnreadOnly(e.target.checked); setPage(1); }}
            className="h-4 w-4 rounded border-surface-600"
          />
          Unread only
        </label>
      </div>

      {actionError && <p role="alert" className="rounded-md border border-danger/40 px-3 py-2 text-sm text-danger">{actionError}</p>}
      {busy && <p role="status" className="text-sm text-surface-400">Updating notifications...</p>}
      {loadError && <p className="rounded-md border border-danger-500/40 bg-danger-500/10 px-3 py-2 text-sm text-danger-300">Notifications could not be loaded. <button type="button" onClick={() => void load()} className="underline">Retry notifications</button></p>}

      <p className="text-xs text-surface-400">Search matches literal text in saved titles and message bodies across your visible inbox, combined with type and unread filters. Muted types stay hidden. The unread count covers all visible types, not only search matches.</p>
      <NotificationBatchReview query={query.trim()} kind={kind} unreadOnly={unreadOnly} disabled={busy || loading || loadError} onBusyChange={setBusy} onApplied={load} />

      <p className="text-xs text-surface-400">Related consecutive items are grouped on this loaded page only. Review a group to read its full saved messages. Related activity on other pages is not included.</p>
      <ul className="divide-y divide-surface-800 overflow-hidden rounded-lg border border-surface-800 bg-surface-900">
        {loading && <li className="px-4 py-8 text-center text-sm text-surface-500">Loading…</li>}
        {!loading && !loadError && items !== null && items.length === 0 && (
          <li className="flex flex-col items-center gap-2 px-4 py-10 text-sm text-surface-500">
            <BellOff className="h-6 w-6" aria-hidden="true" />
            No notifications match these filters
          </li>
        )}
        {!loading && !loadError && items && groupNotifications(items).map(group => {
          const item = group.items[0];
          const anyUnread = group.items.some(entry => !entry.read_at);
          return (
            <li key={group.items.map(entry => entry.id).join('-')} className="group relative">
              <button
                type="button"
                disabled={busy}
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
                disabled={busy}
                onClick={() => void deleteGroup(group)}
                className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded text-surface-500 opacity-100 transition-opacity hover:bg-surface-700 hover:text-surface-200 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
              <div className="flex flex-wrap gap-2 px-4 pb-3">
                <button type="button" aria-expanded={expandedGroup === item.id} aria-label={`Review loaded notifications: ${item.title}`}
                  onClick={() => setExpandedGroup(current => current === item.id ? null : item.id)}
                  className="rounded border border-surface-600 px-2.5 py-1.5 text-xs text-surface-300">{expandedGroup === item.id ? 'Hide messages' : `Review ${group.items.length} loaded message${group.items.length === 1 ? '' : 's'}`}</button>
                {anyUnread && <button type="button" disabled={busy} aria-label={`Mark loaded group read: ${item.title}`} onClick={() => void markGroupRead(group)}
                  className="rounded border border-surface-600 px-2.5 py-1.5 text-xs text-surface-300 disabled:opacity-40">Mark loaded group read</button>}
              </div>
              {expandedGroup === item.id && <section aria-label={`Saved messages: ${item.title}`} className="mx-4 mb-4 space-y-3 rounded border border-surface-700 bg-surface-950 p-3">
                <p className="text-xs text-surface-400">{group.items.length} loaded messages. Reading this panel does not mark them read.</p>
                {group.items.map(entry => <article key={entry.id} className="min-w-0 space-y-2 border-b border-surface-700 pb-3 last:border-0 last:pb-0">
                  <h2 className="break-words text-sm font-semibold text-surface-100">{entry.title}</h2>
                  <p className="text-xs text-surface-400">#{entry.id} · {entry.read_at ? 'Read' : 'Unread'} · {new Date(entry.created_at).toLocaleString()}</p>
                  <p className="whitespace-pre-wrap break-words text-sm text-surface-300">{entry.body || 'No saved message body.'}</p>
                  {toRoutePath(entry.link) && <button type="button" disabled={busy} onClick={() => void openGroup({ key: group.key, items: [entry] })}
                    aria-label={`Open notification #${entry.id}`} className="rounded border border-surface-600 px-2.5 py-1.5 text-xs text-surface-300 disabled:opacity-40">Open linked record</button>}
                </article>)}
              </section>}
            </li>
          );
        })}
      </ul>

      {!loading && !loadError && totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-surface-400">
          <button
            type="button"
            aria-label="Previous page"
            disabled={busy || page <= 1}
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
            disabled={busy || page >= totalPages}
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

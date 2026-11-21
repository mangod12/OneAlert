import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { ConfirmDialog } from './ui/ConfirmDialog';
type Operation = 'mark_read' | 'delete_read';
interface Record { id: number; kind: string; title: string; body: string | null; created_at: string; read_at: string | null; }
interface Preview { query?: string | null; operation: Operation; kind: string | null; total: number; records: Record[]; fingerprint: string; }
const button = 'rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
interface Props { query?: string; kind: string; unreadOnly: boolean; disabled: boolean; onBusyChange: (busy: boolean) => void; onApplied: () => Promise<void>; }
export function NotificationBatchReview(props: Props) { return <Review key={`${props.kind}:${props.unreadOnly}:${props.query || ""}`} {...props} />; }
function Review({ query = '', kind, unreadOnly, disabled, onBusyChange, onApplied }: Props) {
  const [preview, setPreview] = useState<Preview | null>(null), [confirm, setConfirm] = useState(false);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const request = useRef(0), lock = useRef(false);
  useEffect(() => () => { request.current += 1; }, []);
  const load = async (operation: Operation) => {
    if (lock.current || disabled) return;
    lock.current = true; const id = ++request.current; setLoading(true); onBusyChange(true); setPreview(null); setError(''); setNotice(''); setConfirm(false);
    try {
      const response = await apiClient.get('/notifications/review-batch', { params: { operation, ...(kind ? { kind } : {}), ...(query ? { query } : {}) } });
      if (request.current !== id) return;
      const value = response.data as Preview;
      if (!value || (value.query || '') !== query || value.operation !== operation || value.kind !== (kind || null) || !Number.isSafeInteger(value.total) || value.total < 0 || !/^[a-f0-9]{64}$/.test(value.fingerprint) || !Array.isArray(value.records) || value.records.length > 100 || value.records.length > value.total || new Set(value.records.map(record => record?.id)).size !== value.records.length || value.records.some(record => !record || !Number.isSafeInteger(record.id) || record.id < 1 || typeof record.kind !== 'string' || (kind && record.kind !== kind) || typeof record.title !== 'string' || (record.body !== null && typeof record.body !== 'string') || typeof record.created_at !== 'string' || (operation === 'mark_read' ? record.read_at !== null : typeof record.read_at !== 'string'))) throw new Error('The review did not match the requested notification scope. Reload it before making changes.');
      setPreview(value);
    } catch (err) { if (request.current === id) setError(getApiErrorMessage(err, 'Notification review unavailable. No changes applied.')); }
    finally { if (request.current === id) { setLoading(false); onBusyChange(false); } lock.current = false; }
  };
  const apply = async () => {
    if (!preview || lock.current || !preview.records.length || disabled) return;
    lock.current = true; const id = ++request.current; setBusy(true); onBusyChange(true); setError(''); setNotice('');
    const snapshot = preview, ids = snapshot.records.map(record => record.id);
    try {
      const response = await apiClient.post('/notifications/review-batch', { operation: snapshot.operation, kind: snapshot.kind, ids, fingerprint: snapshot.fingerprint, ...(query ? { query } : {}) });
      if (request.current !== id) return;
      const value = response.data;
      if (value?.success !== true || value.operation !== snapshot.operation || value.affected !== ids.length || !Array.isArray(value.ids) || value.ids.length !== ids.length || new Set(value.ids).size !== ids.length || value.ids.some((id: unknown) => !ids.includes(id as number))) throw new Error('The notification change could not be confirmed. Reload the inbox and review before retrying.');
      setPreview(null); setConfirm(false); setNotice(`${value.affected} reviewed notifications ${snapshot.operation === 'mark_read' ? 'marked read' : 'deleted'}. New arrivals and muted types were not included.`);
      await onApplied();
    } catch (err) { if (request.current === id) { setError(getApiErrorMessage(err, 'Notification change unconfirmed. Reload review before retrying.')); setPreview(null); setConfirm(false); } }
    finally { if (request.current === id) { setBusy(false); onBusyChange(false); } lock.current = false; }
  };
  return <section aria-label="Reviewed notification cleanup" className="space-y-3 rounded border border-surface-700 p-4">
    <h2 className="text-sm font-semibold text-surface-100">Review notification cleanup</h2>
    <p className="text-xs text-surface-400">Scope: {kind ? kind.replaceAll('_', ' ') : 'all visible notification types'}, across inbox pages. {query && <>Search text: &quot;{query}&quot;. </>}Muted types are excluded. Review at most 100 newest matching records. New arrivals are not added to a reviewed batch. This changes notifications, not linked investigations or alerts.</p>
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={disabled || loading || busy} onClick={() => void load('mark_read')}>Review matching unread notifications</button><button type="button" className={button} disabled={disabled || loading || busy || unreadOnly} onClick={() => void load('delete_read')}>Review matching read notifications for deletion</button></div>
    {unreadOnly && <p className="text-xs text-surface-400">Turn off Unread only before reviewing read-notification deletion.</p>}
    {loading && <p role="status" className="text-sm text-surface-300">Loading exact notification review...</p>}
    {error && <div className="space-y-2"><p role="alert" className="break-words text-sm text-danger">{error}</p><button type="button" className={button} disabled={disabled || loading || busy} onClick={() => void onApplied()}>Reload inbox to verify current records</button></div>}
    {notice && <p role="status" className="text-sm text-success">{notice}</p>}
    {preview && <>
      <p className="text-xs text-surface-300">{preview.records.length} exact records selected from {preview.total} matching records at review. Counts may change while you review. {preview.operation === 'delete_read' ? 'Deletion is permanent.' : 'These unread notifications will be marked read.'}</p>
      {!preview.records.length ? <p className="text-sm text-surface-400">{preview.total === 0 ? 'No notifications match this review scope. Inbox unread totals can include other notification types.' : 'No exact notification records were returned. Records may have changed during loading. Reload review before relying on it.'}</p> : <>
        <ul aria-label="Exact notification cleanup review" tabIndex={0} className="max-h-72 space-y-3 overflow-y-auto rounded border border-surface-800 p-3 text-xs text-surface-300">{preview.records.map(record => <li key={record.id} className="min-w-0 break-words border-b border-surface-800 pb-2"><p className="font-semibold">#{record.id}: {record.title}</p><p>{record.kind} · Created {record.created_at} · Read {record.read_at || 'not read'}</p><p className="whitespace-pre-wrap">{record.body || 'No recorded body.'}</p></li>)}</ul>
        <button type="button" className={button} disabled={disabled || loading || busy} onClick={() => setConfirm(true)}>Confirm reviewed notification changes</button>
      </>}
      <button type="button" className={button} disabled={busy} onClick={() => { setPreview(null); setConfirm(false); }}>Discard notification review</button>
    </>}
    {confirm && preview && <ConfirmDialog title="Apply exact notification review" description={`${preview.operation === 'delete_read' ? 'Permanently delete' : 'Mark read'} exactly ${preview.records.length} reviewed notifications. Scope: ${kind || 'all visible types'}, across pages, excluding muted types.${query ? ` Search text: ${query}.` : ''} New arrivals are excluded. Changed or missing reviewed records block the whole batch. No linked alerts or investigations are changed.`} confirmLabel={`Apply to ${preview.records.length} notifications`} tone={preview.operation === 'delete_read' ? 'danger' : 'primary'} busy={busy} onCancel={() => { if (!lock.current) setConfirm(false); }} onConfirm={() => void apply()} />}
  </section>;
}

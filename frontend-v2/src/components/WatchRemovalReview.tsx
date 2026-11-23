import { useRef } from 'react';
import type { WatchedRemovalRow } from '../utils/watchRemovalReview';
import { useDialogFocus } from './ui/useDialogFocus';
export interface WatchRemovalSelection { rows: WatchedRemovalRow[]; hidden: number; account: { id: number; email: string; role: string; org_id: number | null } }
export function WatchRemovalReview({ review, busy, onCancel, onConfirm }: { review: WatchRemovalSelection; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(dialog, () => { if (!busy) onCancel(); });
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 p-4"><div ref={dialog} role="dialog" aria-modal="true" aria-label="Review exact watchlist removal" className="max-h-[90dvh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-xl border border-surface-700 bg-surface-900 p-5 [overflow-wrap:anywhere]">
    <h2 className="text-lg font-semibold">Review exact watchlist removal</h2>
    <p className="text-sm">Stop following these {review.rows.length} exact loaded records, including {review.hidden} hidden by filters. No other record or search result is selected.</p>
    <p className="text-xs">Current account #{review.account.id} · {review.account.email} · {review.account.role} · Organization {review.account.org_id ?? 'None'}.</p>
    <ul aria-label="Exact records to unwatch" className="space-y-3">{review.rows.map(row => <li key={`${row.kind}-${row.id}`} className="space-y-1 rounded border border-surface-700 p-3 text-xs"><p className="font-semibold">{row.kind === 'alert' ? 'Alert' : 'Investigation'} #{row.id}: {row.name}</p><p>{row.severity} · {row.status.replaceAll('_', ' ')}{row.detail ? ` · Asset: ${row.detail}` : ''}</p><p>Your watch subscription: Following → Not following</p></li>)}</ul>
    <p className="text-sm text-warning">Only your own watch subscription is removed. Alerts and investigations are not deleted, closed, resolved or reassigned. Other watchers stay subscribed. You stop receiving updates tied to this watch and may lose access if following was your only access route. To follow again, you need access to the record.</p>
    <p className="text-xs text-surface-400">Confirmation rereads your account, each record identity/title/status/severity/creation time, investigation due dates and your watch membership before sending. Asset labels are display context and are not reverified. These reads are not a server lock or conditional delete; another session can still change the record or subscription. Each removal is a separate transaction, not an atomic batch. Processing stops at the first unknown result. Earlier verified removals stay applied; later records are not sent. Refresh before retrying. Nothing has been sent yet.</p>
    <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={onCancel} className="rounded border border-surface-600 px-3 py-2 text-sm disabled:opacity-40">Cancel watch review</button><button type="button" disabled={busy} onClick={onConfirm} className="rounded bg-warning px-3 py-2 text-sm font-semibold text-surface-950 disabled:opacity-40">{busy ? 'Checking reviewed removals...' : `Confirm ${review.rows.length} reviewed removals`}</button></div>
  </div></div>;
}

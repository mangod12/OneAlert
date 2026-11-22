import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../../api/client';
import { Panel } from '../ui/Panel';
import { OnCallCoverage } from './OnCallCoverage';
import { checkedRotationDraft, checkedRotationSave, checkedRotationSnapshot, rotationMemberName, sameRotationBaseline, sameRotationOrder, type RotationSnapshot } from '../../utils/onCallRotationReview';
const buttonClass = 'rounded border border-surface-600 px-3 py-2 text-xs text-primary-300 disabled:opacity-40';
const path = '/orgs/me/on-call';
async function readSnapshot() {
  const [identity, roster, rotation] = await Promise.all([apiClient.get('/auth/me'), apiClient.get('/orgs/me/members'), apiClient.get(path)]);
  return checkedRotationSnapshot(identity.data, roster.data, rotation.data);
}
function SavedOnCallRotationPanel() {
  const [snapshot, setSnapshot] = useState<RotationSnapshot | null>(null), [draft, setDraft] = useState<number[]>([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [readAt, setReadAt] = useState(''), [review, setReview] = useState<{ before: RotationSnapshot; proposed: number[] } | null>(null);
  const reads = useRef(0), ready = useRef(false), operation = useRef(false), reviewRef = useRef<HTMLElement | null>(null);
  const load = useCallback(async () => {
    if (operation.current) return;
    const request = ++reads.current; ready.current = false; setLoading(true); setSnapshot(null); setReview(null); setError(''); setNotice('');
    try { const current = await readSnapshot(); if (request !== reads.current) return; setSnapshot(current); setDraft([...current.rotation.member_ids]); setReadAt(new Date().toISOString()); ready.current = true; }
    catch { if (request === reads.current) setError('Organization access, saved rotation or roster could not be verified. No empty rotation or editable defaults are assumed. An organization and a complete supported read are required.'); }
    finally { if (request === reads.current) setLoading(false); }
  }, []);
  const invalidate = useCallback(() => { reads.current++; ready.current = false; }, []);
  useEffect(() => { void load(); return invalidate; }, [load, invalidate]);
  useEffect(() => { if (review) reviewRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [review]);
  const edit = (next: number[]) => { if (busy || !snapshot || snapshot.role !== 'admin') return; setReview(null); setNotice(''); setDraft(next); };
  const move = (index: number, direction: number) => { const next = [...draft], target = index + direction; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target], next[index]]; edit(next); };
  const reviewDraft = () => {
    if (!ready.current || !snapshot || snapshot.role !== 'admin' || loading || operation.current) return;
    try { const proposed = checkedRotationDraft(draft, snapshot); if (sameRotationOrder(proposed, snapshot.rotation.member_ids)) { setNotice('No rotation changes to review. Nothing was sent.'); setReview(null); return; } setReview({ before: snapshot, proposed }); setNotice(''); }
    catch { setReview(null); setNotice('Every proposed member must be active in the verified organization roster. Remove unavailable members or reread before reviewing. Nothing was sent.'); }
  };
  const confirm = async () => {
    if (!ready.current || !snapshot || snapshot.role !== 'admin' || !review || operation.current || loading) return;
    try { if (!sameRotationOrder(checkedRotationDraft(draft, snapshot), review.proposed) || !sameRotationBaseline(snapshot, review.before)) { setReview(null); return; } } catch { setReview(null); return; }
    operation.current = true; setBusy(true); setError(''); setNotice(''); const request = reads.current; let sent = false;
    try {
      const current = await readSnapshot(); if (request !== reads.current) return;
      if (!sameRotationBaseline(current, review.before)) { setSnapshot(current); setReview(null); setReadAt(new Date().toISOString()); setNotice('Organization access, roster or saved rotation changed. No save request was sent. Your draft is kept; review it again against the new saved state.'); return; }
      checkedRotationDraft(review.proposed, current); sent = true;
      const response = await apiClient.patch(path, { member_ids: review.proposed }); if (request !== reads.current) return;
      const saved = checkedRotationSave(response.data, review.proposed, current); setSnapshot({ ...current, rotation: saved }); setDraft([...saved.member_ids]); setReview(null); setReadAt(new Date().toISOString()); setNotice('The save response matches the reviewed rotation order. The server returned the anchor shown below. Other sessions and roster changes can still change coverage; no existing work was reassigned by this save.');
    } catch {
      if (request !== reads.current) return;
      ready.current = false; setSnapshot(null); setReview(null); setError(sent ? 'The rotation save outcome could not be verified. It may already have applied. Read the current rotation before any retry. No automatic retry was sent.' : 'Current organization access, rotation and roster could not be checked. No save request was sent. Read the current rotation again.');
    } finally { operation.current = false; if (request === reads.current) setBusy(false); }
  };
  return <Panel title="On-call rotation" description="Review ordered rotation changes separately from automation preferences.">
    <div className="min-w-0 space-y-4 p-5 [overflow-wrap:anywhere]">
      <p className="text-xs text-surface-400">Reads the saved rotation, current organization access and roster. Editing, adding, removing or reordering members does not save anything until a reviewed confirmation. This uses a fresh recheck, not an atomic lock.</p>
      <button type="button" disabled={loading || busy} onClick={() => void load()} className={buttonClass}>{snapshot ? 'Discard rotation draft and reread' : 'Read current on-call rotation'}</button>
      {loading && <p role="status" className="text-sm">Reading saved on-call rotation and organization access...</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {notice && <p role="status" className="text-sm text-primary-300">{notice}</p>}
      {snapshot && !loading && <>
        <section aria-label="Verified saved on-call rotation" className="space-y-2 rounded border border-surface-700 p-3 text-xs">
          <h3 className="font-semibold text-surface-100">Saved rotation, not the draft</h3>
          <p>Organization #{snapshot.orgId} · Current role: {snapshot.role} · Read or matching save response: {readAt}.</p>
          <p>Saved anchor, UTC date: {snapshot.rotation.anchor_date ?? 'Not set'}.</p>
          {snapshot.rotation.member_ids.length ? <ol className="list-inside list-decimal space-y-1">{snapshot.rotation.member_ids.map(id => <li key={id}>{rotationMemberName(snapshot, id)}</li>)}</ol> : <p>No saved rotation. There is no configured on-call override.</p>}
          <p>{snapshot.rotation.current_member_id === null ? 'Current on-call override unavailable. Existing whole-organization candidate rules apply.' : `Current on-call override: ${rotationMemberName(snapshot, snapshot.rotation.current_member_id)}.`}</p>
        </section>
        <p className="text-xs text-surface-400">A changed nonempty order resets the anchor to the server's current UTC date, starting the first member's seven-day period again. Clearing the list clears the anchor and removes the override. An unchanged save preserves a valid anchor. The exact saved anchor is read from the response, not predicted by your device clock.</p>
        <p className="text-xs text-surface-400">The saved rotation affects new-work assignment when auto-assignment is enabled and at least two organization members are active. It also restricts candidates for the explicit bulk alert auto-assignment action, even without that opt-in. This save does not enable automation, assign work, send notifications or change existing assignments. An unavailable scheduled member falls back to the existing whole-organization candidate rules, not the next person in the order.</p>
        {snapshot.members.filter(member => member.is_active).length < 2 && <p className="text-xs text-warning">Fewer than two active members. Automatic new-work assignment cannot run, but an admin can still inspect, repair or clear the saved rotation.</p>}
        {snapshot.role !== 'admin' ? <p className="text-sm text-warning">Only an organization admin can change the rotation. The saved order and coverage remain viewable.</p> : <fieldset disabled={busy} className="min-w-0 space-y-3">
          <legend className="text-sm font-semibold text-surface-100">Draft rotation order</legend>
          <ol className="space-y-2">{draft.map((id, index) => <li key={id} className="flex min-w-0 flex-wrap items-center gap-2 rounded border border-surface-700 p-3 text-xs"><span className="min-w-0 flex-1">{index + 1}. {rotationMemberName(snapshot, id)}</span><div className="flex flex-wrap gap-2"><button type="button" disabled={index === 0 || busy} onClick={() => move(index, -1)} aria-label={`Move member #${id} earlier`} className={buttonClass}>Earlier</button><button type="button" disabled={index === draft.length - 1 || busy} onClick={() => move(index, 1)} aria-label={`Move member #${id} later`} className={buttonClass}>Later</button><button type="button" onClick={() => edit(draft.filter(value => value !== id))} aria-label={`Remove member #${id} from draft rotation`} className={buttonClass}>Remove</button></div></li>)}</ol>
          {!draft.length && <p className="text-xs text-surface-400">Empty draft. Confirming a change to this list will clear the saved rotation.</p>}
          <div className="flex flex-wrap gap-2">{snapshot.members.filter(member => member.is_active && !draft.includes(member.id)).map(member => <button type="button" key={member.id} onClick={() => edit([...draft, member.id])} className={buttonClass}>Add {member.full_name || member.email} · #{member.id}</button>)}</div>
          <div className="flex flex-wrap gap-2"><button type="button" disabled={!draft.length || busy} onClick={() => edit([])} className={buttonClass}>Clear draft rotation</button><button type="button" onClick={reviewDraft} className={buttonClass}>Review rotation changes</button></div>
        </fieldset>}
        {review && <section ref={reviewRef} aria-label="On-call rotation change review" className="space-y-3 rounded border border-warning/40 bg-surface-950 p-4 text-xs">
          <h3 className="text-sm font-semibold text-surface-100">Review exact rotation change</h3>
          <div className="grid gap-4 sm:grid-cols-2">{[{ name: 'Saved order before', ids: review.before.rotation.member_ids }, { name: 'Proposed order after', ids: review.proposed }].map(group => <section key={group.name} aria-label={group.name}><h4 className="mb-2 font-semibold">{group.name}</h4>{group.ids.length ? <ol className="list-inside list-decimal space-y-2">{group.ids.map(id => <li key={id}>{rotationMemberName(review.before, id)}</li>)}</ol> : <p>No rotation</p>}</section>)}</div>
          <p className="text-warning">{review.proposed.length ? "Confirming this changed order resets the anchor to the server's current UTC date and starts a new seven-day period with the first proposed member." : 'Confirming this empty list clears the anchor and removes the on-call override.'}</p>
          <p className="text-surface-400">Confirm rechecks organization access, roster, order and anchor before sending only the exact proposed member IDs. This is not an atomic lock; another session or roster update can occur between check and save. No save request has been sent yet.</p>
          <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => setReview(null)} className={buttonClass}>Cancel rotation review</button><button type="button" disabled={busy} onClick={() => void confirm()} className="rounded bg-primary-500 px-3 py-2 text-xs font-semibold text-surface-950 disabled:opacity-40">{busy ? 'Checking and saving rotation...' : 'Confirm reviewed rotation'}</button></div>
        </section>}
      </>}
    </div>
    {snapshot && !loading && <OnCallCoverage revision={JSON.stringify([snapshot.orgId, snapshot.rotation, snapshot.members])} />}
  </Panel>;
}

export function OnCallRotationPanel() {
  const [open, setOpen] = useState(false);
  return open ? <SavedOnCallRotationPanel /> : <Panel title="On-call rotation" description="Inspect the saved order and review rotation changes separately from automation preferences."><div className="space-y-3 p-5"><p className="text-xs text-surface-400">Opening reads current organization access, roster and rotation. No rotation request or change is made before opening.</p><button type="button" onClick={() => setOpen(true)} className={buttonClass}>Open saved on-call rotation</button></div></Panel>;
}

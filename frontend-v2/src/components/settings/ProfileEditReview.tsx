import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import { checkedProfile, checkedProfileDraft, checkedProfileResult, sameProfile, unchangedProfileDraft, type ProfileDraft, type ReviewedProfile } from '../../utils/profileEditReview';
const button = 'rounded border border-surface-600 px-3 py-2 text-xs text-primary-300 disabled:opacity-40';
async function readProfile() { return checkedProfile((await apiClient.get('/auth/me')).data); }
function OpenProfileEditReview() {
  const [snapshot, setSnapshot] = useState<ReviewedProfile | null>(null), [draft, setDraft] = useState<ProfileDraft>({ full_name: '', company: '' });
  const [review, setReview] = useState<{ before: ReviewedProfile; draft: ProfileDraft } | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [readAt, setReadAt] = useState('');
  const generation = useRef(0), ready = useRef(false), operation = useRef(false), reviewRef = useRef<HTMLElement | null>(null);
  const load = useCallback(async () => {
    if (operation.current) return;
    const request = ++generation.current; ready.current = false; setLoading(true); setSnapshot(null); setReview(null); setError(''); setNotice('');
    try { const current = await readProfile(); if (request !== generation.current) return; setSnapshot(current); setDraft({ full_name: current.full_name ?? '', company: current.company ?? '' }); ready.current = true; setReadAt(new Date().toISOString()); }
    catch { if (request === generation.current) setError('The complete current account profile could not be verified. No editable profile defaults are assumed. Read again.'); }
    finally { if (request === generation.current) setLoading(false); }
  }, []);
  const invalidate = useCallback(() => { generation.current++; ready.current = false; }, []);
  useEffect(() => { void load(); return invalidate; }, [load, invalidate]);
  useEffect(() => { if (review) reviewRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [review]);
  const edit = (field: keyof ProfileDraft, value: string) => { if (operation.current) return; setDraft(current => ({ ...current, [field]: value })); setReview(null); setNotice(''); };
  const stage = () => {
    if (!snapshot || !ready.current || operation.current) return;
    try { const next = checkedProfileDraft(draft); if (unchangedProfileDraft(snapshot, next)) { setReview(null); setNotice('The trimmed profile values are unchanged. Nothing was sent.'); return; } setReview({ before: snapshot, draft: next }); setNotice(''); }
    catch { setReview(null); setNotice('Each profile value must be at most 1000 characters without control characters. Blank values explicitly clear the saved field. Nothing was sent.'); }
  };
  const confirm = async () => {
    if (!snapshot || !review || !ready.current || operation.current) return;
    try { if (JSON.stringify(checkedProfileDraft(draft)) !== JSON.stringify(review.draft)) { setReview(null); return; } } catch { setReview(null); return; }
    operation.current = true; setBusy(true); setError(''); setNotice(''); const request = generation.current; let sent = false;
    try {
      const current = await readProfile(); if (request !== generation.current) return;
      if (!sameProfile(current, review.before)) { setSnapshot(current); setReview(null); setReadAt(new Date().toISOString()); setNotice('Current account, access or saved profile changed. No profile update was sent. Your draft is kept; compare it with the current account and review again.'); return; }
      sent = true; const response = await apiClient.patch('/auth/me', review.draft); if (request !== generation.current) return;
      if (response.status !== 200) throw Error('Unverified response');
      const after = await readProfile(); if (request !== generation.current) return;
      const verified = checkedProfileResult(current, response.data, after, review.draft); setSnapshot(verified); setReview(null); setDraft({ full_name: verified.full_name ?? '', company: verified.company ?? '' }); setReadAt(new Date().toISOString()); setNotice(`Verified profile update for account #${verified.id}, ${verified.email}. Only display name and company were sent. Blank fields are saved as not set.`); void useAuthStore.getState().fetchUser();
    } catch {
      if (request !== generation.current) return;
      ready.current = false; setSnapshot(null); setReview(null); setError(sent ? 'The profile update outcome could not be verified. It may already have applied. Read the current profile before any retry. No automatic retry was sent and no success is assumed.' : 'The current profile could not be rechecked. No profile update was sent. Read again.');
    } finally { operation.current = false; if (request === generation.current) setBusy(false); }
  };
  return <section aria-label="Reviewed profile editing" className="min-w-0 space-y-4 border-t border-surface-800 p-5 text-xs [overflow-wrap:anywhere]">
    <p className="text-surface-400">This editor independently reads the current account and saved values. Review both fields before confirming. Other sessions can still race between reads; this is not an atomic lock.</p><button type="button" disabled={loading || busy} onClick={() => void load()} className={button}>Read current profile</button>
    {loading && <p role="status">Reading the current profile...</p>}{error && <p role="alert" className="text-danger">{error}</p>}{notice && <p role="status" className="text-primary-300">{notice}</p>}
    {snapshot && !loading && <><section aria-label="Verified profile account" className="space-y-2"><h3 className="font-semibold">Account #{snapshot.id} · {snapshot.email}</h3><p>Role: {snapshot.role}. Organization: {snapshot.org_id === null ? 'None' : `#${snapshot.org_id}`}. Read: {readAt}.</p><p>Saved display name: {snapshot.full_name === null ? 'Not set' : snapshot.full_name}</p><p>Saved company: {snapshot.company === null ? 'Not set' : snapshot.company}</p></section><fieldset disabled={busy} className="min-w-0 space-y-3"><legend className="font-semibold">Draft profile values</legend><label htmlFor="reviewed-profile-name" className="block">Display name</label><input id="reviewed-profile-name" autoComplete="off" maxLength={1000} value={draft.full_name} onChange={event => edit('full_name', event.target.value)} className="w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-sm"/><label htmlFor="reviewed-profile-company" className="block">Company</label><input id="reviewed-profile-company" autoComplete="off" maxLength={1000} value={draft.company} onChange={event => edit('company', event.target.value)} className="w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-sm"/><p>Leading and trailing whitespace is trimmed. A blank value clears that saved field to not set. Both fields are sent together after confirmation; this does not change your organization.</p><button type="button" disabled={busy} onClick={stage} className={button}>Review profile changes</button></fieldset></>}
    {review && <section ref={reviewRef} aria-label="Profile operation review" className="space-y-3 rounded border border-warning/40 bg-surface-950 p-4"><h3 className="text-sm font-semibold">Review exact account profile update</h3><p>Account #{review.before.id} · {review.before.email} · {review.before.role} · Organization {review.before.org_id === null ? 'None' : `#${review.before.org_id}`}.</p><p>Display name: {review.before.full_name ?? 'Not set'} → {review.draft.full_name || 'Clear to not set'}</p><p>Company: {review.before.company ?? 'Not set'} → {review.draft.company || 'Clear to not set'}</p><p className="text-warning">Only display name and company are sent. Blank values clear saved fields. Company is profile text, not organization membership. This does not change email, role, organization, password, MFA or other account settings.</p><p>Confirmation rereads the complete profile baseline before one update, then requires a matching response and a fresh current profile. Concurrent sessions can race. An unknown outcome requires rereading, never automatic retry. Nothing has been sent yet.</p><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => setReview(null)} className={button}>Cancel profile review</button><button type="button" disabled={busy} onClick={() => void confirm()} className="rounded bg-primary-500 px-3 py-2 font-semibold text-surface-950 disabled:opacity-40">{busy ? 'Checking profile update...' : 'Confirm reviewed profile update'}</button></div></section>}
  </section>;
}
export function ProfileEditReview() {
  const [open, setOpen] = useState(false);
  return open ? <OpenProfileEditReview/> : <div className="border-t border-surface-800 px-5 py-3"><button type="button" onClick={() => setOpen(true)} className={button}>Open reviewed profile editor</button></div>;
}

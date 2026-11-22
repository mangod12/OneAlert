import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../../api/client';
import { TeamMembershipReview } from './TeamMembershipReview';
import { useAuthStore } from '../../stores/authStore';
import { checkedOrganizationResult, checkedOrganizationSnapshot, organizationName, organizationSlug, sameOrganizationSnapshot, type OrganizationSnapshot } from '../../utils/organizationIdentityReview';
const button = 'rounded border border-surface-600 px-3 py-2 text-xs text-primary-300 disabled:opacity-40';
async function readOrganization() {
  const [identity, organization] = await Promise.all([apiClient.get('/auth/me'), apiClient.get('/orgs/me').catch((error: unknown) => { if ((error as { response?: { status?: number } })?.response?.status === 404) return { data: null }; throw error; })]);
  return checkedOrganizationSnapshot(identity.data, organization.data);
}
function OpenOrganizationIdentityReview() {
  const [snapshot, setSnapshot] = useState<OrganizationSnapshot | null>(null), [name, setName] = useState(''), [slug, setSlug] = useState('');
  const [review, setReview] = useState<{ before: OrganizationSnapshot; name: string; slug?: string } | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [readAt, setReadAt] = useState('');
  const generation = useRef(0), operation = useRef(false), ready = useRef(false), reviewRef = useRef<HTMLElement | null>(null);
  const load = useCallback(async () => {
    if (operation.current) return;
    const request = ++generation.current; ready.current = false; setLoading(true); setSnapshot(null); setReview(null); setError(''); setNotice('');
    try { const current = await readOrganization(); if (request !== generation.current) return; setSnapshot(current); setName(current.org?.name ?? ''); setSlug(''); ready.current = true; setReadAt(new Date().toISOString()); }
    catch { if (request === generation.current) setError('Current account and organization could not be verified. A missing organization is not assumed from a failed or incomplete read. Read again.'); }
    finally { if (request === generation.current) setLoading(false); }
  }, []);
  const invalidate = useCallback(() => { generation.current++; ready.current = false; }, []);
  useEffect(() => { void load(); return invalidate; }, [load, invalidate]);
  useEffect(() => { if (review) reviewRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [review]);
  const stage = () => {
    if (!snapshot || !ready.current || operation.current) return;
    try {
      const nextName = organizationName(name);
      if (snapshot.org && snapshot.role !== 'admin') throw Error('Not admin');
      if (snapshot.org?.name === nextName) { setReview(null); setNotice('The reviewed name is unchanged. Nothing was sent.'); return; }
      setReview({ before: snapshot, name: nextName, ...(snapshot.org ? {} : { slug: organizationSlug(slug) }) }); setNotice('');
    } catch { setReview(null); setNotice('Use a nonempty name of at most 1000 characters without control characters and, for creation, a slug of at most 100 lowercase letters, numbers or hyphens starting with a letter or number. Nothing was sent.'); }
  };
  const confirm = async () => {
    if (!snapshot || !review || !ready.current || operation.current) return;
    try { if (organizationName(name) !== review.name || !snapshot.org && organizationSlug(slug) !== review.slug) { setReview(null); return; } } catch { setReview(null); return; }
    operation.current = true; setBusy(true); setError(''); setNotice(''); const request = generation.current; let sent = false;
    try {
      const current = await readOrganization(); if (request !== generation.current) return;
      if (!sameOrganizationSnapshot(current, review.before)) { setSnapshot(current); setReview(null); setReadAt(new Date().toISOString()); setNotice('Account access or organization changed. No organization mutation was sent. Your draft is kept; review the current state again.'); return; }
      if (current.org && current.role !== 'admin') throw Error('Access changed');
      sent = true;
      const response = current.org ? await apiClient.patch('/orgs/me', { name: review.name }) : await apiClient.post('/orgs/', { name: review.name, slug: review.slug });
      if (request !== generation.current) return;
      if (response.status !== (current.org ? 200 : 201)) throw Error('Unverified response');
      const after = await readOrganization(); if (request !== generation.current) return;
      checkedOrganizationResult(current, after, response.data, review.name, review.slug);
      setSnapshot(after); setReview(null); setName(after.org!.name); setSlug(''); setReadAt(new Date().toISOString());
      setNotice(current.org ? `Verified organization #${after.org!.id} name is now ${after.org!.name}. Its slug, plan and limits are unchanged.` : `Verified organization #${after.org!.id}, ${after.org!.name}, slug ${after.org!.slug}, was created on the free plan. Your current account is its admin. No other account was added.`);
      void useAuthStore.getState().fetchUser();
    } catch {
      if (request !== generation.current) return;
      ready.current = false; setSnapshot(null); setReview(null); setError(sent ? 'The organization change outcome could not be verified. It may already have applied. Read the current organization before any retry. No automatic retry was sent and no success is assumed.' : 'Current account and organization could not be rechecked. No organization mutation was sent. Read again.');
    } finally { operation.current = false; if (request === generation.current) setBusy(false); }
  };
  return <section aria-label="Reviewed organization identity" className="min-w-0 space-y-4 text-xs [overflow-wrap:anywhere]">
    <p className="text-surface-400">Organization creation and name changes have their own current-account read, exact review and post-operation verification. Membership has a separate review. These reads are not an atomic lock against another session.</p>
    <button type="button" disabled={loading || busy} onClick={() => void load()} className={button}>Read current organization</button>
    {loading && <p role="status">Reading current account and organization...</p>}{error && <p role="alert" className="text-danger">{error}</p>}{notice && <p role="status" className="text-primary-300">{notice}</p>}
    {snapshot && !loading && <>
      <section aria-label="Verified organization identity" className="space-y-2"><h3 className="font-semibold">{snapshot.org ? `${snapshot.org.name} · Organization #${snapshot.org.id}` : 'No organization on this verified account'}</h3><p>Account #{snapshot.userId} · {snapshot.email} · {snapshot.role}. Read: {readAt}.</p>{snapshot.org ? <><p>Slug: {snapshot.org.slug}. Plan: {snapshot.org.plan}. Limits: {snapshot.org.max_users} members and {snapshot.org.max_assets} assets. Limits are not current usage.</p><p>Created: {snapshot.org.created_at}.</p></> : <p>This account has no organization. Creating one assigns this exact account to the new organization and promotes it to admin. This does not add teammates or join an existing organization.</p>}</section>
      {!snapshot.org || snapshot.role === 'admin' ? <fieldset disabled={busy} className="min-w-0 space-y-3"><legend className="font-semibold">{snapshot.org ? 'Draft organization name' : 'Draft new free organization'}</legend><label htmlFor="reviewed-org-name" className="block">Organization name</label><input id="reviewed-org-name" autoComplete="off" maxLength={1000} value={name} onChange={event => { if (operation.current) return; setName(event.target.value); setReview(null); setNotice(''); }} className="w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-sm"/>{!snapshot.org && <><label htmlFor="reviewed-org-slug" className="block">Organization slug</label><input id="reviewed-org-slug" autoComplete="off" maxLength={100} value={slug} onChange={event => { if (operation.current) return; setSlug(event.target.value); setReview(null); setNotice(''); }} className="w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-sm"/><p>The slug is trimmed and lowercased before review. Availability is checked only when confirmed. The existing name-only update API cannot change the slug afterward.</p></>}<button type="button" disabled={busy || !name.trim() || !snapshot.org && !slug.trim()} onClick={stage} className={button}>{snapshot.org ? 'Review organization name' : 'Review organization creation'}</button></fieldset> : <p className="text-warning">Only a current organization admin can rename this organization. Its verified identity remains viewable.</p>}
    </>}
    {review && <section ref={reviewRef} aria-label="Organization operation review" className="space-y-3 rounded border border-warning/40 bg-surface-950 p-4"><h3 className="text-sm font-semibold">{review.before.org ? 'Review exact organization rename' : 'Review new organization creation'}</h3><p>Account #{review.before.userId} · {review.before.email} · current role {review.before.role}.</p>{review.before.org ? <><p>Organization #{review.before.org.id}: {review.before.org.name} → {review.name}</p><p>Only the name field is sent. Slug {review.before.org.slug}, plan {review.before.org.plan} and existing limits are unchanged. This does not change membership, roles, assignments or the saved on-call order.</p></> : <><p>New name: {review.name}</p><p>Exact normalized slug: {review.slug}</p><p className="text-warning">Creates a new free organization, assigns this exact account to it and promotes it to admin. No other account is added and no invitation is sent. This is not a request to join an existing organization. Slug availability is not checked yet; the existing name-only update API cannot change it afterward. There is no delete-organization or undo-creation action in this workflow.</p><p>No plan or paid entitlement is requested. The returned organization and current admin membership must both verify before success is reported.</p></>}<p>Confirmation rechecks your exact account and the complete organization identity before one operation. A matching response and fresh current state are required. Concurrent sessions can race. An unknown result requires rereading, never automatic retry. Nothing has been sent yet.</p><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => setReview(null)} className={button}>Cancel organization review</button><button type="button" disabled={busy} onClick={() => void confirm()} className="rounded bg-primary-500 px-3 py-2 font-semibold text-surface-950 disabled:opacity-40">{busy ? 'Checking organization operation...' : review.before.org ? 'Confirm reviewed organization rename' : 'Confirm reviewed organization creation'}</button></div></section>}
    {snapshot?.org && !busy && <TeamMembershipReview key={snapshot.org.id}/>}
  </section>;
}
export function OrganizationIdentityReview() {
  const [open, setOpen] = useState(false);
  return open ? <OpenOrganizationIdentityReview/> : <div className="space-y-3 text-xs"><p className="text-surface-400">Read your current account and organization before creating an organization or renaming it. Membership changes have their own independent review. No editable defaults are assumed.</p><button type="button" onClick={() => setOpen(true)} className={button}>Open reviewed organization settings</button></div>;
}

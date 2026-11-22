import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../../api/client';
import { checkedMembershipProposal, checkedMembershipResult, checkedTeamSnapshot, membershipEmail, sameTeamBaseline, type MembershipProposal, type TeamSnapshot } from '../../utils/teamMembershipReview';
const button = 'rounded border border-surface-600 px-3 py-2 text-xs text-primary-300 disabled:opacity-40';
async function readTeam() {
  const [identity, org, roster] = await Promise.all([apiClient.get('/auth/me'), apiClient.get('/orgs/me'), apiClient.get('/orgs/me/members')]);
  return checkedTeamSnapshot(identity.data, org.data, roster.data);
}
function OpenMembershipReview({ onVerified }: { onVerified?: (snapshot: TeamSnapshot) => void }) {
  const [snapshot, setSnapshot] = useState<TeamSnapshot | null>(null), [email, setEmail] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{ before: TeamSnapshot; proposal: MembershipProposal } | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [readAt, setReadAt] = useState('');
  const generation = useRef(0), ready = useRef(false), operation = useRef(false), reviewRef = useRef<HTMLElement | null>(null);
  const load = useCallback(async () => {
    if (operation.current) return;
    const request = ++generation.current; ready.current = false; setLoading(true); setSnapshot(null); setReview(null); setError(''); setNotice('');
    try { const current = await readTeam(); if (request !== generation.current) return; setSnapshot(current); ready.current = true; setReadAt(new Date().toISOString()); }
    catch { if (request === generation.current) setError('Current account access, organization and complete roster could not be verified. No editable membership defaults are assumed. Read the team again.'); }
    finally { if (request === generation.current) setLoading(false); }
  }, []);
  useEffect(() => { if (snapshot && onVerified) onVerified(snapshot); }, [snapshot, onVerified]);
  const invalidate = useCallback(() => { generation.current++; ready.current = false; }, []);
  useEffect(() => { void load(); return invalidate; }, [load, invalidate]);
  useEffect(() => { if (review) reviewRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [review]);
  const stage = (proposal: MembershipProposal) => {
    if (!ready.current || !snapshot || operation.current) return;
    try { setReview({ before: snapshot, proposal: checkedMembershipProposal(proposal, snapshot) }); setNotice(''); }
    catch { setReview(null); setNotice('This membership change cannot be reviewed. Use a valid exact email not already in the roster with a free seat, or select a removable member other than yourself. Nothing was sent.'); }
  };
  const confirm = async () => {
    if (!ready.current || !snapshot || !review || operation.current || snapshot.role !== 'admin') return;
    try { if (review.proposal.kind === 'add' && membershipEmail(email) !== review.proposal.email) { setReview(null); return; } checkedMembershipProposal(review.proposal, snapshot); } catch { setReview(null); return; }
    operation.current = true; setBusy(true); setError(''); setNotice(''); const request = generation.current; let sent = false;
    try {
      const current = await readTeam(); if (request !== generation.current) return;
      if (!sameTeamBaseline(current, review.before)) { setSnapshot(current); setReview(null); setReadAt(new Date().toISOString()); setNotice('Account access, organization or roster changed. No membership mutation was sent. The email draft is kept; review the current team again.'); return; }
      const proposal = checkedMembershipProposal(review.proposal, current); sent = true;
      const response = proposal.kind === 'add' ? await apiClient.post('/orgs/me/invite', null, { params: { email: proposal.email } }) : await apiClient.delete(`/orgs/me/members/${proposal.target.id}`);
      if (request !== generation.current) return;
      if (response.status !== 200 || response.data?.success !== true) throw Error('Unverified operation response');
      const after = await readTeam(); if (request !== generation.current) return;
      const added = checkedMembershipResult(current, after, proposal);
      setSnapshot(after); setReview(null); setReadAt(new Date().toISOString());
      if (proposal.kind === 'add' && added) { setEmail(''); setNotice(`The current roster now includes ${added.email}, member #${added.id}, role ${added.role}, ${added.is_active ? 'active' : 'inactive'}. No email invitation or acceptance step was sent by this action.`); }
      else setNotice(`The current roster no longer includes member #${proposal.kind === 'remove' ? proposal.target.id : ''}. Their account was not deleted. Existing assignments and the saved on-call order were not rewritten by this action.`);
    } catch {
      if (request !== generation.current) return;
      ready.current = false; setSnapshot(null); setReview(null); setError(sent ? 'The membership change outcome could not be verified. It may already have applied. Read the current team before any retry. No automatic retry was sent and no access-change success is assumed.' : 'Current account access, organization and roster could not be rechecked. No membership mutation was sent. Read the team again.');
    } finally { operation.current = false; if (request === generation.current) setBusy(false); }
  };
  return <section aria-label="Reviewed team membership" className="min-w-0 space-y-4 border-t border-surface-700 pt-4 text-xs [overflow-wrap:anywhere]">
    <h3 className="text-sm font-semibold">Reviewed membership changes</h3><p className="text-surface-400">This section reads current account access, organization and the full roster independently. Review first, then confirm after a fresh recheck. This is not an atomic lock; another session can change membership between reads and the operation.</p>
    <button type="button" disabled={loading || busy} onClick={() => void load()} className={button}>Read current team membership</button>
    {loading && <p role="status">Reading current team membership...</p>}{error && <p role="alert" className="text-danger">{error}</p>}{notice && <p role="status" className="text-primary-300">{notice}</p>}
    {snapshot && !loading && <>
      <section aria-label="Verified membership roster" className="space-y-3"><h4 className="font-semibold">{snapshot.org.name} · Organization #{snapshot.org.id}</h4><p>Verified {snapshot.members.length} of {snapshot.org.max_users} seats used, including inactive members. Account #{snapshot.userId}, role {snapshot.role}. Read: {readAt}.</p>
        <ul className="space-y-2">{snapshot.members.map(member => <li key={member.id} className="min-w-0 space-y-2 rounded border border-surface-700 p-3"><p>{member.full_name || member.email} · Member #{member.id}</p><p>{member.email} · {member.role} · {member.is_active ? 'Active' : 'Inactive'}</p>{snapshot.role === 'admin' && member.id !== snapshot.userId && <button type="button" disabled={busy} onClick={() => stage({ kind: 'remove', target: member })} aria-label={`Review removal of member #${member.id}`} className={button}>Review removal</button>}{member.id === snapshot.userId && <p className="text-surface-400">Your own membership cannot be removed here.</p>}</li>)}</ul>
      </section>
      {snapshot.role === 'admin' ? <fieldset disabled={busy} className="min-w-0 space-y-3"><legend className="font-semibold">Add an existing account</legend><p className="text-surface-400">This directly adds the existing account found by the exact entered email, if it has no organization and a seat is available. It does not send an email invitation or request acceptance. The account lookup happens only when confirmed; this draft does not verify who owns that address or whether the account is active.</p><label htmlFor="membership-add-email" className="block">Exact account email</label><input id="membership-add-email" type="email" autoComplete="off" value={email} maxLength={254} onChange={event => { if (operation.current) return; setEmail(event.target.value); setReview(null); setNotice(''); }} className="w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-sm"/><button type="button" disabled={busy || !email.trim() || snapshot.members.length >= snapshot.org.max_users} onClick={() => stage({ kind: 'add', email })} className={button}>Review member addition</button>{snapshot.members.length >= snapshot.org.max_users && <p className="text-warning">All current seats are used. Inactive members also count. No addition is available from this read.</p>}</fieldset> : <p className="text-warning">Only a current organization admin can add or remove members. The verified roster remains viewable.</p>}
    </>}
    {review && <section ref={reviewRef} aria-label="Membership operation review" className="space-y-3 rounded border border-warning/40 bg-surface-950 p-4">
      <h4 className="text-sm font-semibold">{review.proposal.kind === 'add' ? 'Review direct member addition' : 'Review exact member removal'}</h4><p>{review.before.org.name} · Organization #{review.before.org.id} · Account #{review.before.userId} · {review.before.members.length} of {review.before.org.max_users} seats used.</p>
      {review.proposal.kind === 'add' ? <><p>Exact email: {review.proposal.email}</p><p className="text-warning">This adds an existing account directly to this organization. It is not an email invitation and does not wait for acceptance. The target account's identity, role and activity are not looked up until confirmation. The server requires that exact email to match an existing account with no organization.</p><p>The account keeps its existing role. Membership can grant access under that role and changes the organization's assignment candidate pool; this operation does not itself assign work or edit the saved on-call order.</p></> : <><p>{review.proposal.target.full_name || review.proposal.target.email} · Member #{review.proposal.target.id}</p><p>{review.proposal.target.email} · {review.proposal.target.role} · {review.proposal.target.is_active ? 'Active' : 'Inactive'}</p><p className="text-warning">This removes this exact account from this organization, not the account itself. It does not delete the account, revoke all sessions or tokens, rewrite existing assignments or remove IDs from the saved on-call order. Already authorized requests are not rolled back. No other member is selected.</p></>}
      <p>Confirmation rechecks the full roster, organization and your access before sending only this operation. A matching post-operation roster is required before reporting the change. Other sessions can race; unknown results require rereading, never an automatic retry. Nothing has been sent yet.</p>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => setReview(null)} className={button}>Cancel membership review</button><button type="button" disabled={busy} onClick={() => void confirm()} className="rounded bg-primary-500 px-3 py-2 font-semibold text-surface-950 disabled:opacity-40">{busy ? 'Checking membership operation...' : review.proposal.kind === 'add' ? 'Confirm reviewed member addition' : 'Confirm reviewed member removal'}</button></div>
    </section>}
  </section>;
}
export function TeamMembershipReview({ onVerified }: { onVerified?: (snapshot: TeamSnapshot) => void }) {
  const [open, setOpen] = useState(false);
  return open ? <OpenMembershipReview onVerified={onVerified}/> : <div className="mt-4 space-y-2 border-t border-surface-700 pt-4 text-xs"><p>Membership changes have a separate verified read and exact-operation review. Organization creation and rename are independent.</p><button type="button" onClick={() => setOpen(true)} className={button}>Open reviewed team membership</button></div>;
}

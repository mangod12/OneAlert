import { useCallback, useEffect, useRef, useState } from 'react';
import apiClient from '../../api/client';
import { Panel } from '../ui/Panel';
import { checkedCreatedToken, checkedTokenInventory, checkedTokenProposal, sameTokenInventory, sameTokenMetadata, sameTokenOwner, tokenCapability, tokenDate, tokenTime, type PersonalToken, type TokenInventory, type TokenProposal } from '../../utils/personalTokenReview';
const button = 'rounded border border-surface-600 px-3 py-2 text-xs text-primary-300 disabled:opacity-40';
const input = 'w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100';
async function readInventory() {
  const [identity, listing] = await Promise.all([apiClient.get('/auth/me'), apiClient.get('/api-tokens/')]);
  return checkedTokenInventory(identity.data, listing.data);
}
type Review = { kind: 'create'; before: TokenInventory; proposal: TokenProposal } | { kind: 'revoke'; before: TokenInventory; target: PersonalToken };
export function ApiTokensPanel() {
  const [inventory, setInventory] = useState<TokenInventory | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [readAt, setReadAt] = useState('');
  const [name, setName] = useState(''), [expiry, setExpiry] = useState(''), [readOnly, setReadOnly] = useState(false);
  const [review, setReview] = useState<Review | null>(null), [revealed, setRevealed] = useState<{ metadata: PersonalToken; raw: string } | null>(null);
  const generation = useRef(0), operation = useRef(false), ready = useRef(false), reviewRef = useRef<HTMLElement | null>(null);
  const load = useCallback(async () => {
    if (operation.current) return;
    const request = ++generation.current; ready.current = false; setLoading(true); setInventory(null); setReview(null); setRevealed(null); setError(''); setNotice('');
    try { const current = await readInventory(); if (request !== generation.current) return; setInventory(current); ready.current = true; setReadAt(new Date().toISOString()); }
    catch { if (request === generation.current) setError('Current account access and complete token metadata could not be verified. No empty inventory or editable defaults are assumed. Read the current tokens again.'); }
    finally { if (request === generation.current) setLoading(false); }
  }, []);
  const invalidate = useCallback(() => { generation.current++; ready.current = false; }, []);
  useEffect(() => { void load(); return invalidate; }, [load, invalidate]);
  useEffect(() => { if (review) reviewRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [review]);
  const change = (action: () => void) => { if (operation.current) return; setReview(null); setNotice(''); action(); };
  const reviewCreation = () => {
    if (!ready.current || !inventory || operation.current || revealed) return;
    try { const proposal = checkedTokenProposal(name, expiry, readOnly); setReview({ kind: 'create', before: inventory, proposal }); setNotice(''); }
    catch { setNotice('Use a token name from 1 to 80 characters and a listed expiry. No token was created.'); setReview(null); }
  };
  const confirm = async () => {
    if (!ready.current || !inventory || !review || operation.current || revealed) return;
    if (review.kind === 'create') { try { if (JSON.stringify(checkedTokenProposal(name, expiry, readOnly)) !== JSON.stringify(review.proposal)) { setReview(null); return; } } catch { setReview(null); return; } }
    operation.current = true; setBusy(true); setError(''); setNotice(''); const request = generation.current; let sent = false;
    try {
      const current = await readInventory(); if (request !== generation.current) return;
      if (!sameTokenOwner(current.owner, review.before.owner) || (review.kind === 'create' ? !sameTokenInventory(current, review.before) : !current.tokens.some(token => sameTokenMetadata(token, review.target)))) {
        setInventory(current); setReview(null); setReadAt(new Date().toISOString()); setNotice('Account access or reviewed token metadata changed. No mutation was sent. The creation draft is kept; review the current state again.'); return;
      }
      sent = true;
      if (review.kind === 'create') {
        const proposal = review.proposal, response = await apiClient.post('/api-tokens/', { name: proposal.name, ...(proposal.expires_in_days === null ? {} : { expires_in_days: proposal.expires_in_days }), ...(proposal.read_only ? { read_only: true } : {}) });
        if (request !== generation.current) return;
        if (response.status !== 201) throw Error('Unverified creation status');
        const created = checkedCreatedToken(response.data, proposal, current);
        setRevealed(created); setInventory({ ...current, tokens: [created.metadata, ...current.tokens] }); setName(''); setExpiry(''); setReadOnly(false); setReview(null); setReadAt(new Date().toISOString()); setNotice('The creation response matches the reviewed name, capability and expiry policy. Save the new token now; it cannot be recovered from the token list.');
      } else {
        const response = await apiClient.delete(`/api-tokens/${review.target.id}`); if (request !== generation.current) return;
        if (response.status !== 204) throw Error('Unverified revoke response');
        const after = await readInventory(); if (request !== generation.current) return;
        const target = after.tokens.find(token => token.id === review.target.id);
        if (!sameTokenOwner(after.owner, current.owner) || !target || target.revoked_at === null || !sameTokenMetadata({ ...target, revoked_at: review.target.revoked_at }, review.target)) throw Error('Unverified revoked metadata');
        setInventory(after); setReview(null); setReadAt(new Date().toISOString()); setNotice('The reviewed token is now listed as revoked. Other tokens were not selected for revocation. Requests that already passed authentication are not rolled back.');
      }
    } catch {
      if (request !== generation.current) return;
      ready.current = false; setInventory(null); setReview(null); setRevealed(null);
      setError(sent ? 'The token operation outcome could not be verified. It may already have applied. Read current tokens before doing anything else. No automatic retry was sent. A token created without a verified one-time response cannot be recovered from the list; inspect and revoke an unwanted new entry rather than creating duplicates.' : 'Current account access and token metadata could not be rechecked. No mutation was sent. Read the current tokens again.');
    } finally { operation.current = false; if (request === generation.current) setBusy(false); }
  };
  const copy = async () => { if (!revealed) return; try { await navigator.clipboard.writeText(revealed.raw); setNotice('Token copied. Your clipboard now contains a secret; replace it after saving the token securely.'); } catch { setNotice('Clipboard copy failed. Select the token and copy it manually before hiding it.'); } };
  return <Panel title="API tokens" description="Personal API access as your account. Review capabilities and expiry before creating or revoking tokens.">
    <div className="min-w-0 space-y-4 p-5 [overflow-wrap:anywhere]">
      <p className="text-xs text-surface-400">Tokens use your current account permissions, not a fixed project scope. Read-only blocks writes but still allows access to readable account data. A fresh metadata recheck is not an atomic lock. The server permits at most 20 unexpired, unrevoked tokens per user.</p>
      <button type="button" disabled={loading || busy || !!revealed} onClick={() => void load()} className={button}>{inventory ? 'Reread current API tokens' : 'Read current API tokens'}</button>
      {loading && <p role="status" className="text-sm">Reading current account access and API token metadata...</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {notice && <p role="status" className="text-sm text-primary-300">{notice}</p>}
      {revealed && <section aria-label="One-time created token" className="space-y-3 rounded border border-primary-500 p-3 text-xs">
        <h3 className="font-semibold">New token: {revealed.metadata.name}</h3><p>This raw token is shown only for this creation response. It is held in this page's memory only, not stored by this view. Hiding, navigating away or reloading loses this display. The server stores a hash and cannot show it again. Copying puts the secret on your system clipboard.</p>
        <code tabIndex={0} className="block select-all break-all rounded bg-surface-950 p-3">{revealed.raw}</code>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void copy()} className={button}>Copy the new token</button><button type="button" onClick={() => { setRevealed(null); setNotice('Raw token display cleared. Metadata remains available; the token cannot be recovered here.'); }} className={button}>Hide token permanently</button></div>
      </section>}
      {inventory && !loading && <>
        <section aria-label="Verified personal token inventory" className="space-y-3 text-xs"><h3 className="font-semibold">Saved tokens for account #{inventory.owner.id}</h3><p>Current role: {inventory.owner.role}. Organization: {inventory.owner.orgId ?? 'none'}. Read or verified response: {readAt}. Dates below are UTC; expiry status uses the device clock at this read, and the server decides authentication.</p>
          {!inventory.tokens.length && <p>No API tokens yet.</p>}
          <ul className="space-y-2">{inventory.tokens.map(token => <li key={token.id} className="min-w-0 space-y-2 rounded border border-surface-700 p-3">
            <p className="font-semibold">{token.name} · Token #{token.id}</p><p>{token.prefix}... · {token.revoked_at !== null ? 'Revoked' : token.expires_at !== null && tokenTime(token.expires_at) <= tokenTime(readAt) ? 'Expired by device clock at read' : 'Not revoked; check expiry'}</p>
            <p>{tokenCapability(token.read_only)}</p><p>Created: {tokenDate(token.created_at)}. Last used: {tokenDate(token.last_used_at)}.</p><p>Expires: {token.expires_at === null ? 'No expiry' : tokenDate(token.expires_at)}. Revoked: {tokenDate(token.revoked_at)}.</p>
            {token.revoked_at === null && <button type="button" disabled={busy || !!revealed} onClick={() => { setReview({ kind: 'revoke', before: inventory, target: token }); setNotice(''); }} aria-label={`Review revoke token ${token.name} #${token.id}`} className={button}>Review revocation</button>}
          </li>)}</ul>
        </section>
        <fieldset disabled={busy || !!revealed} className="min-w-0 space-y-3"><legend className="text-sm font-semibold">New token draft</legend>
          <div><label htmlFor="api-token-name" className="mb-1 block text-xs">Token name</label><input id="api-token-name" value={name} maxLength={80} onChange={event => change(() => setName(event.target.value))} className={input}/></div>
          <div><label htmlFor="api-token-expiry" className="mb-1 block text-xs">Expires</label><select id="api-token-expiry" value={expiry} onChange={event => change(() => setExpiry(event.target.value))} className={input}><option value="">No expiry</option>{[7,30,90,365].map(days => <option key={days} value={days}>{days} days</option>)}</select></div>
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={readOnly} onChange={event => change(() => setReadOnly(event.target.checked))}/>Read-only (GET, HEAD and OPTIONS only)</label>
          <button type="button" disabled={!name.trim() || busy || !!revealed} onClick={reviewCreation} className={button}>Review token creation</button>
        </fieldset>
      </>}
      {review && <section ref={reviewRef} aria-label="Personal API token operation review" className="space-y-3 rounded border border-warning/40 bg-surface-950 p-4 text-xs">
        <h3 className="text-sm font-semibold">{review.kind === 'create' ? 'Review new personal token' : 'Review token revocation'}</h3>
        <p>Account #{review.before.owner.id}, role {review.before.owner.role}, organization {review.before.owner.orgId ?? 'none'}.</p>
        {review.kind === 'create' ? <><p>Name: {review.proposal.name}</p><p>{tokenCapability(review.proposal.read_only)}</p><p className="text-warning">{review.proposal.expires_in_days === null ? 'No expiry: this token remains usable until revoked, subject to account access.' : `Expires ${review.proposal.expires_in_days} days after the server creates it. The exact UTC expiry comes from the response.`}</p><p>The raw token is returned only once. If the response is lost, inspect token metadata and revoke the unwanted entry; do not assume creation failed or retry automatically. No token has been created yet.</p></> : <><p>Revoke {review.target.name} · Token #{review.target.id} · {review.target.prefix}...</p><p>{tokenCapability(review.target.read_only)}</p><p>Created: {tokenDate(review.target.created_at)}. Expires: {review.target.expires_at === null ? 'No expiry' : tokenDate(review.target.expires_at)}.</p><p className="text-warning">This cannot be undone. Future authentication with this token will fail. Scripts and integrations using it can lose access; already authenticated requests are not rolled back. No other token is selected.</p></>}
        <p>Confirmation rereads account access and relevant metadata first, but it cannot lock other sessions. No automatic retry is sent after an unverifiable result.</p>
        <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => setReview(null)} className={button}>Cancel token review</button><button type="button" disabled={busy} onClick={() => void confirm()} className="rounded bg-primary-500 px-3 py-2 font-semibold text-surface-950 disabled:opacity-40">{busy ? 'Checking token operation...' : review.kind === 'create' ? 'Confirm reviewed token creation' : 'Confirm reviewed token revocation'}</button></div>
      </section>}
    </div>
  </Panel>;
}

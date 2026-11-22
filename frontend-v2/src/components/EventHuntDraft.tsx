import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { eventHuntDraft } from '../utils/eventHuntDraft';
const control = 'min-h-10 max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
export function EventHuntDraft({ eventId, hasDraft, busy, onApply }: { eventId: number; hasDraft: boolean; busy: boolean; onApply: (text: string) => void }) {
  const [text, setText] = useState<string | null>(null), [readAt, setReadAt] = useState(''), [clipped, setClipped] = useState(false), [error, setError] = useState(''), [loading, setLoading] = useState(false), [replace, setReplace] = useState(false), [applied, setApplied] = useState(false);
  const request = useRef(0), inFlight = useRef(false);
  useEffect(() => { const invalidate = () => { request.current++; }; return invalidate; }, []);
  const load = async () => {
    if (inFlight.current) return;
    const read = ++request.current; inFlight.current = true; setText(null); setError(''); setReplace(false); setApplied(false); setLoading(true);
    try { const { data } = await apiClient.get(`/events/${eventId}/evidence`); if (read !== request.current) return; const draft = eventHuntDraft(data, eventId); setText(draft.text); setClipped(draft.clipped); setReadAt(draft.readAt); }
    catch (err) { if (read === request.current) setError(getApiErrorMessage(err, 'Source event evidence unavailable. Your hypothesis is unchanged.')); }
    finally { if (read === request.current) { inFlight.current = false; setLoading(false); } }
  };
  const valid = text !== null && !!text.trim() && Array.from(text).length <= 4000;
  return <section aria-label="Review event-to-hunt draft" className="oa-panel space-y-3 p-4">
    <h2 className="font-semibold text-surface-100">Prepare a hunt from saved event #{eventId}</h2><p className="text-xs text-surface-400">This link carries only an event ID. Nothing is read, copied, sent to AI or run automatically. Read the current owned event, review and edit a local metadata-only hypothesis, then choose whether to use it. Starting Hunt remains a separate action and searches only this account's accessible telemetry.</p>
    <a className="inline-block text-xs text-primary-300 underline" href={`/app/events/${eventId}`}>Review exact source event #{eventId}</a><div><button type="button" disabled={loading} className={control} onClick={() => void load()}>{loading ? 'Reading source event...' : 'Read event metadata for a hypothesis draft'}</button></div>
    {error && <p role="alert" className="text-xs text-danger">{error} No hypothesis was changed and no hunt was started.</p>}
    {text !== null && <>
      <p className="break-words text-xs text-surface-400">Source evidence read {readAt}. Includes event ID/time/type, recorded severity/signature, network endpoint/protocol/action and host/user/domain/source-type text only. Signature is limited to 300 characters and each other text field to 100. {clipped ? 'Some source text was shortened.' : 'Source text fits these bounds.'} Raw payloads, byte counters, URLs, user agents and source configuration are not included in this draft. The evidence read can return a stored payload, but it is not copied into the hypothesis. No relationship is saved.</p>
      <label className="block space-y-1 text-xs text-surface-300">Review proposed event hypothesis<textarea aria-label="Event hypothesis review draft" rows={12} className={`${control} block w-full min-w-0`} value={text} onChange={event => { setText(event.target.value); setReplace(false); setApplied(false); }} /></label><p className="text-xs text-surface-400">{Array.from(text).length} of 4,000 characters. Using this draft changes only the local hypothesis. Starting Hunt separately sends the hypothesis to the configured AI and runs scoped read-only queries. Review any sensitive names or addresses first.</p>
      {hasDraft && <label className="flex items-start gap-2 text-xs text-warning"><input type="checkbox" checked={replace} onChange={event => setReplace(event.target.checked)} />Replace the current hypothesis with this reviewed event draft</label>}
      <button type="button" disabled={!valid || busy || (hasDraft && !replace)} className={control} onClick={() => { if (valid && !busy && (!hasDraft || replace)) { onApply(text); setApplied(true); setReplace(false); } }}>Use reviewed event hypothesis draft</button>{applied && <p role="status" className="text-xs text-primary-300">Reviewed event text copied to the hypothesis. No hunt was started and no event or source was changed.</p>}
    </>}
  </section>;
}

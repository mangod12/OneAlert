import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { caseHuntDraft } from '../utils/caseHuntDraft';
const control = 'max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
export function CaseHuntDraft({ caseId, hasDraft, busy, onApply }: { caseId: number; hasDraft: boolean; busy: boolean; onApply: (text: string) => void }) {
  const [text, setText] = useState<string | null>(null), [readAt, setReadAt] = useState(''), [clipped, setClipped] = useState(false);
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [replace, setReplace] = useState(false), [applied, setApplied] = useState(false);
  const revision = useRef(0), inFlight = useRef(false);
  useEffect(() => { const invalidate = () => { revision.current++; }; return invalidate; }, []);
  const load = async () => {
    if (inFlight.current) return;
    const request = ++revision.current; inFlight.current = true; setLoading(true); setText(null); setError(''); setReplace(false); setApplied(false);
    try {
      const { data } = await apiClient.get(`/cases/${caseId}`);
      if (request !== revision.current) return;
      const draft = caseHuntDraft(data, caseId); setText(draft.text); setClipped(draft.clipped); setReadAt(new Date().toISOString());
    } catch (err) { if (request === revision.current) setError(getApiErrorMessage(err, 'Source investigation could not be read. Your hunt draft is unchanged.')); }
    finally { if (request === revision.current) { inFlight.current = false; setLoading(false); } }
  };
  const valid = text !== null && !!text.trim() && Array.from(text).length <= 4000;
  return <section aria-label="Review case-to-hunt draft" className="oa-panel space-y-3 p-4 sm:p-6">
    <h2 className="text-base font-semibold text-surface-100">Prepare a hunt from investigation #{caseId}</h2>
    <p className="text-xs text-surface-400">This link contains only a case ID. Nothing is run or copied into your hypothesis automatically. Read current visible case metadata, review and edit a local draft, then choose whether to use it. A case may belong to a different account. Starting a hunt still searches only your own accessible security-event data, not another owner's linked evidence. Case visibility does not expand query access.</p>
    <a href={`/app/cases/${caseId}`} className="inline-block text-xs text-primary-300 underline">Review source investigation #{caseId}</a>
    <div><button type="button" disabled={loading} className={control} onClick={() => void load()}>{loading ? 'Reading source investigation...' : 'Read case metadata for a hypothesis draft'}</button></div>
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    {text !== null && <>
      <p className="break-words text-xs text-surface-400">Read {readAt}. Includes only case ID, title (up to 200 characters), recorded severity/status and summary (up to 1,600 characters). {clipped ? 'Source text was shortened.' : 'Source text fits these bounds.'} No linked alert/event rows, raw payloads, notes, tasks or response plans were read. Metadata can be outdated, incomplete or AI-generated. No source relationship is saved by using this draft.</p>
      <label className="block space-y-1 text-xs text-surface-300">Review proposed hypothesis<textarea aria-label="Case hypothesis review draft" rows={10} value={text} onChange={event => { setText(event.target.value); setApplied(false); setReplace(false); }} className={`${control} block w-full min-w-0`} /></label>
      <p className="text-xs text-surface-400">{Array.from(text).length} of 4,000 characters. Using this draft changes only the local hypothesis. Starting Hunt below separately sends it to the configured AI and runs scoped read-only queries.</p>
      {hasDraft && <label className="flex items-start gap-2 text-xs text-warning"><input type="checkbox" checked={replace} onChange={event => setReplace(event.target.checked)} />Replace the current hypothesis draft with this reviewed text</label>}
      <button type="button" disabled={!valid || busy || (hasDraft && !replace)} className={control} onClick={() => { if (valid && !busy && (!hasDraft || replace)) { onApply(text); setApplied(true); setReplace(false); } }}>Use reviewed case hypothesis draft</button>
      {applied && <p role="status" className="text-xs text-primary-300">Reviewed text copied to the hypothesis. No hunt was started and nothing was saved or changed in the investigation.</p>}
    </>}
  </section>;
}

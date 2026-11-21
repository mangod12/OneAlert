import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
interface Created { plan_id: number; case_id: number; status: string; autonomy_level: string; run_id: number; action_count: number; approved: boolean; execution_requested: boolean }
const button = 'rounded border border-surface-600 px-3 py-2 text-xs text-primary-300 disabled:opacity-40';
interface Props { caseId: number; onCreated: () => void }
export function ResponseDraftCreator(props: Props) { return <DraftCreator key={props.caseId} {...props} />; }
function DraftCreator({ caseId, onCreated }: Props) {
  const [review, setReview] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [created, setCreated] = useState<Created | null>(null);
  const inFlight = useRef(false), current = useRef(0);
  useEffect(() => () => { current.current += 1; }, []);
  const generate = async () => {
    if (inFlight.current) return;
    const request = ++current.current; inFlight.current = true; setBusy(true); setError(''); setCreated(null);
    try {
      const { data: value } = await apiClient.post<Created>(`/response-plans/draft-from-case/${caseId}`);
      if (request !== current.current) return;
      const positive = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
      if (!value || value.case_id !== caseId || !positive(value.plan_id) || !positive(value.run_id) || !positive(value.action_count) || value.action_count > 100 || value.status !== 'draft' || value.autonomy_level !== 'L1' || value.approved !== false || value.execution_requested !== false) throw new Error('The saved draft response did not match this investigation or unapproved L1 scope. Check existing plans before trying again.');
      setCreated(value); setReview(false); onCreated();
    } catch (err) { if (request === current.current) setError(getApiErrorMessage(err, 'Response draft could not be verified. Check existing plans and recorded runs before trying again.')); }
    finally { if (request === current.current) { inFlight.current = false; setBusy(false); } }
  };
  return <section aria-label="Draft a response plan" className="space-y-3 rounded border border-surface-700 p-3">
    <h3 className="text-sm font-semibold text-surface-100">Draft a response plan</h3>
    <p className="text-xs text-surface-400">Create an unapproved L1 proposal from this investigation using the configured AI, or a rule-based fallback if the AI is unavailable. No approval, simulation, notification or external action is requested.</p>
    {!review && <button type="button" className={button} onClick={() => { setReview(true); setError(''); }}>Review draft generation</button>}
    {review && <div className="space-y-3 text-xs text-surface-300"><p>Planning uses the current case title, severity, summary and MITRE tactics, plus the first 20 linked alert titles/severities in saved link-ID order and available asset name, type, zone, OT flag and protocol. Case summary/tactics are shortened at 2,000 characters each; other text fields at 500. Policy checks still assess all linked asset contexts. Linked event records, raw payloads, notes, tasks and full evidence chronology are not directly supplied. A case summary may itself be incomplete or AI-generated. Missing context is not evidence of safety.</p><p>The saved plan is only a proposal. Targets can be placeholders or unsupported by the evidence. Review the exact actions, target ownership and current policy before approving anything. Leaving this page does not cancel generation. Check the plan list before repeating a request after an error.</p><div className="flex flex-wrap gap-2"><button type="button" disabled={busy} className={button} onClick={() => void generate()}>{busy ? 'Generating response draft...' : 'Generate and save unapproved L1 draft'}</button><button type="button" disabled={busy} className={button} onClick={() => setReview(false)}>Cancel draft generation</button></div></div>}
    {error && <p role="alert" className="text-xs text-danger">{error} A failed or interrupted reply does not establish whether a draft was saved. Refresh the investigation plans before repeating.</p>}
    {created && <div role="status" className="space-y-2 text-xs text-surface-300"><p>Draft #{created.plan_id} saved with {created.action_count} proposed actions. Not approved or executed. Current plan and recorded run may change after this read.</p><div className="flex flex-wrap gap-3"><Link className="text-primary-300 underline" to={`/response-plans?plan=${created.plan_id}`}>Review saved draft #{created.plan_id}</Link><Link className="text-primary-300 underline" to={`/audit-log?run=${created.run_id}`}>Inspect generation run #{created.run_id}</Link></div></div>}
  </section>;
}

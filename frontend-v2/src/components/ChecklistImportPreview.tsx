import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
export interface ChecklistSelection { reviewed_fingerprint: string; action_indexes: number[]; }
interface Proposal { action_index: number; title: string; reason: string | null; priority: unknown; available: boolean; already_present: boolean; }
interface Preview { case_id: number; plan_id: number; plan_status: string; review_fingerprint: string; proposals: Proposal[]; }
const button = 'rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
export function ChecklistImportPreview({ caseId, planId, onImport, onClose, busy }: { caseId: number; planId: number; onImport: (payload: ChecklistSelection) => Promise<boolean> | void; onClose: () => void; busy: boolean }) {
  const [preview, setPreview] = useState<Preview | null>(null), [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0), [submitting, setSubmitting] = useState(false);
  const requestId = useRef(0);
  useEffect(() => {
    const request = ++requestId.current; setLoading(true); setPreview(null); setSelected([]); setError('');
    void apiClient.get(`/cases/${caseId}/tasks/from-plan/${planId}/preview`).then(response => {
      if (requestId.current !== request) return;
      const value = response.data as Preview;
      if (value.case_id !== caseId || value.plan_id !== planId || typeof value.plan_status !== 'string' || !/^[a-f0-9]{64}$/.test(value.review_fingerprint) || !Array.isArray(value.proposals) || value.proposals.length > 200 || new Set(value.proposals.map(row => row.action_index)).size !== value.proposals.length || value.proposals.some(row => !row || !Number.isSafeInteger(row.action_index) || row.action_index < 0 || typeof row.title !== 'string' || (row.reason !== null && typeof row.reason !== 'string') || typeof row.available !== 'boolean' || typeof row.already_present !== 'boolean' || (row.available && (!row.title || row.already_present)))) throw new Error('The checklist preview did not match this investigation and plan. Refresh before adding tasks.');
      setPreview(value);
    }).catch(err => { if (requestId.current === request) setError(getApiErrorMessage(err, 'Checklist preview unavailable.')); }).finally(() => { if (requestId.current === request) setLoading(false); });
    return () => { requestId.current += 1; };
  }, [caseId, planId, retry]);
  const locked = busy || submitting;
  const available = preview?.proposals.filter(row => row.available).map(row => row.action_index) ?? [];
  const submit = async () => {
    if (!preview || !selected.length || locked) return;
    setSubmitting(true); setError('');
    try { const done = await onImport({ reviewed_fingerprint: preview.review_fingerprint, action_indexes: selected }); if (done) onClose(); else { setPreview(null); setSelected([]); setError('No import was confirmed. Refresh the preview before trying again.'); } }
    catch (err) { setPreview(null); setSelected([]); setError(getApiErrorMessage(err, 'Tasks were not confirmed. Refresh the preview before trying again.')); }
    finally { setSubmitting(false); }
  };
  return <section aria-label={`Checklist import preview for plan ${planId}`} className="space-y-3 rounded border border-primary-500/40 bg-surface-950 p-4">
    <h3 className="text-sm font-semibold text-surface-100">Review checklist tasks from plan #{planId}</h3>
    <p className="text-xs text-surface-400">Choose actions to add as unchecked tasks. This does not approve or execute the response plan, run containment or notify anyone. Titles are limited to 300 characters. Existing titles and repeated titles are skipped; checklist state is checked again when adding.</p>
    {loading && <p role="status" className="text-sm text-surface-300">Loading checklist preview...</p>}
    {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    {!loading && preview && <>
      <p className="text-xs text-surface-300">Saved plan status: {preview.plan_status}. {available.length} new tasks available out of {preview.proposals.length} saved actions. Nothing is selected automatically.</p>
      <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={locked || !available.length} onClick={() => setSelected(available)}>Select all new tasks</button><button type="button" className={button} disabled={locked || !selected.length} onClick={() => setSelected([])}>Clear task selection</button></div>
      <ol aria-label="Proposed checklist tasks" tabIndex={0} className="max-h-96 space-y-2 overflow-y-auto">{preview.proposals.map(row => <li key={row.action_index} className="space-y-2 rounded border border-surface-700 p-3 text-xs"><label className="flex items-start gap-2 text-surface-200"><input type="checkbox" disabled={locked || !row.available} checked={selected.includes(row.action_index)} aria-label={`Select action ${row.action_index + 1} for checklist`} onChange={event => setSelected(values => event.target.checked ? [...values, row.action_index] : values.filter(index => index !== row.action_index))} /><span className="min-w-0 break-all">Action {row.action_index + 1}: {row.title || 'No usable task title recorded'}</span></label><p className="break-words text-surface-400">Recorded priority: {row.priority == null || row.priority === '' ? 'Not recorded' : JSON.stringify(row.priority)}</p>{row.reason && <p className="whitespace-pre-wrap break-words text-surface-400">{row.reason}</p>}{!row.available && <p className="text-warning">{row.already_present ? 'Same title is already present or proposed earlier.' : 'This saved action cannot be converted to a checklist task.'}</p>}</li>)}</ol>
    </>}
    <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={locked} onClick={() => setRetry(retry + 1)}>Refresh checklist preview</button><button type="button" className={button} disabled={locked} onClick={onClose}>Cancel checklist import</button><button type="button" className={`${button} bg-primary-600`} disabled={loading || locked || !preview || !selected.length} onClick={() => void submit()}>Add {selected.length} selected {selected.length === 1 ? 'task' : 'tasks'}</button></div>
  </section>;
}

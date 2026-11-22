import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { parseAuthoredHuntDraft, type HuntAuthoredQuery, type HuntQueryDraft } from '../utils/huntQueryDraft';
const control = 'min-h-10 max-w-full rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
const input = 'w-full min-w-0 rounded border border-surface-600 bg-surface-950 p-2 font-mono text-xs text-surface-200';
const blank = () => ({ description: '', sql: '', params: '{}' });
export function HuntAuthoredQueryEditor({ hypothesis, onCancel, onSaved, onRecorded }: { hypothesis: string; onCancel: () => void; onSaved: (value: HuntQueryDraft) => void; onRecorded: () => void }) {
  const [values, setValues] = useState([blank()]), [busy, setBusy] = useState(false), [stopped, setStopped] = useState(false), [error, setError] = useState('');
  const request = useRef(0), inFlight = useRef(false);
  useEffect(() => () => { request.current++; }, []);
  const change = (index: number, field: 'description' | 'sql' | 'params', value: string) => { setValues(items => items.map((item, position) => index === position ? { ...item, [field]: value } : item)); setError(''); };
  const save = async () => {
    if (inFlight.current || stopped) return;
    let queries: HuntAuthoredQuery[];
    try {
      if (!hypothesis.trim() || Array.from(hypothesis).length > 4000) throw Error('Use a nonempty hypothesis of at most 4000 characters.');
      queries = values.map((value, index) => {
        if (!value.sql.trim() || Array.from(value.sql).length > 12000 || Array.from(value.description).length > 1000) throw Error(`Query ${index + 1} needs 1 to 12000 SQL characters and a description of at most 1000 characters.`);
        const params: unknown = JSON.parse(value.params);
        if (!params || typeof params !== 'object' || Array.isArray(params) || Object.entries(params).some(([key, item]) => !['since', 'before', 'keyword'].includes(key) || typeof item !== 'string' || !item || Array.from(item).length > 2048)) throw Error(`Query ${index + 1} parameters must contain only nonempty since, before or keyword strings, each at most 2048 characters. Do not supply user_id.`);
        return { position: index + 1, description: value.description, sql: value.sql, params: params as Record<string, string> };
      });
    } catch (reason) { setError(reason instanceof SyntaxError ? 'Parameters must be valid JSON objects. No request was sent.' : (reason as Error).message); return; }
    const version = ++request.current, requestedHypothesis = hypothesis;
    inFlight.current = true; setBusy(true); setError('');
    let recorded = false;
    try {
      const response = await apiClient.post('/hunt/query-drafts/authored', { hypothesis: requestedHypothesis, queries });
      if (request.current !== version) return;
      onRecorded(); recorded = true;
      if (response.data.success !== true) throw Error('The analyst draft did not finish saving.');
      onSaved(parseAuthoredHuntDraft(response.data.data, requestedHypothesis, queries));
    } catch (reason) {
      if (request.current !== version) return;
      const status = (reason as { response?: { status?: number } })?.response?.status;
      const refused = status !== undefined && [400, 401, 404, 409, 422].includes(status);
      if (!refused && !recorded) onRecorded();
      setStopped(status !== 422);
      setError(refused ? 'The analyst draft was refused. Check the input and access before saving again. No event execution was requested.' : 'Saving could not be confirmed. A draft may already exist. Cancel and inspect Hunt History before saving again. No event execution was requested.');
    } finally { if (request.current === version) { inFlight.current = false; setBusy(false); } }
  };
  return <section aria-label="Author hunt query draft without AI" className="min-w-0 space-y-3 rounded border border-warning/50 p-3">
    <h4 className="text-sm font-semibold text-surface-100">Write your own query draft</h4>
    <p className="text-xs text-surface-300">Save one to three SQL queries as a compiler-only draft with a one-hour review window. No AI provider call or event SELECT. Review accepted/rejected contracts, then explicitly select queries separately. Saving is not execution approval.</p>
    <p className="break-words text-xs text-surface-400">Use one supported SELECT from security_events scoped by user_id = :user_id. The server supplies your owner ID. Optional parameters are since, before and keyword only. Use fixed timezone-aware timestamps; bounds do not advance automatically. Unsupported SQL is retained as a rejected query, not run.</p>
    {values.map((value, index) => <fieldset key={index} className="min-w-0 space-y-2 rounded border border-surface-700 p-2" disabled={busy || stopped}>
      <legend className="text-xs text-surface-300">Authored query {index + 1}</legend>
      <label className="block text-xs text-surface-300">Description for authored query {index + 1}<input aria-label={`Description for authored query ${index + 1}`} className={input} value={value.description} onChange={event => change(index, 'description', event.target.value)} /></label>
      <label className="block text-xs text-surface-300">SQL for authored query {index + 1}<textarea aria-label={`SQL for authored query ${index + 1}`} rows={5} className={input} value={value.sql} onChange={event => change(index, 'sql', event.target.value)} /></label>
      <label className="block text-xs text-surface-300">Parameters JSON for authored query {index + 1}<textarea aria-label={`Parameters JSON for authored query ${index + 1}`} rows={3} className={input} value={value.params} onChange={event => change(index, 'params', event.target.value)} /></label>
      <button type="button" className={control} disabled={values.length === 1} onClick={() => { setValues(items => items.filter((_, position) => position !== index)); setError(''); }}>Remove authored query {index + 1}</button>
    </fieldset>)}
    <button type="button" className={control} disabled={busy || stopped || values.length >= 3} onClick={() => { setValues(items => [...items, blank()]); setError(''); }}>Add authored query</button>
    {busy && <p role="status" className="text-xs text-surface-300">Saving and compiling analyst queries. No event execution requested...</p>}
    {error && <p role="alert" className="whitespace-pre-wrap break-words text-xs text-danger">{error}</p>}
    <div className="flex flex-wrap gap-2"><button type="button" className={control} disabled={busy || stopped} onClick={() => void save()}>Save analyst query draft</button><button type="button" className={control} disabled={busy} onClick={onCancel}>Cancel authored draft</button></div>
  </section>;
}

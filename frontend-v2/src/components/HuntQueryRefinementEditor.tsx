import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { parseRefinedHuntDraft, type HuntQueryDraft, type HuntQueryEdit } from '../utils/huntQueryDraft';

const control = 'min-h-10 max-w-full rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
const input = 'w-full min-w-0 rounded border border-surface-600 bg-surface-950 p-2 font-mono text-xs text-surface-200';

export function HuntQueryRefinementEditor({ source, onCancel, onSaved, onRecorded }: {
  source: HuntQueryDraft;
  onCancel: () => void;
  onSaved: (value: HuntQueryDraft) => void;
  onRecorded: () => void;
}) {
  const [values, setValues] = useState(() => source.draft.queries.map(query => ({
    position: query.position, sql: query.sql ?? '', params: JSON.stringify(query.params, null, 2),
  })));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [stopped, setStopped] = useState(false);
  const request = useRef(0), inFlight = useRef(false);
  useEffect(() => () => { request.current++; }, []);
  const change = (position: number, field: 'sql' | 'params', value: string) => {
    setValues(items => items.map(item => item.position === position ? { ...item, [field]: value } : item));
    setError('');
  };
  const save = async () => {
    if (inFlight.current || stopped) return;
    const edits: HuntQueryEdit[] = [];
    try {
      for (const [index, value] of values.entries()) {
        const original = source.draft.queries[index];
        // An untouched rejected query with no retained SQL remains rejected.
        if (value.sql === (original.sql ?? '') && value.params === JSON.stringify(original.params, null, 2)) continue;
        if (!value.sql.trim() || Array.from(value.sql).length > 12000) throw Error(`Query ${value.position} needs 1 to 12000 characters of SQL.`);
        const params: unknown = JSON.parse(value.params);
        if (!params || typeof params !== 'object' || Array.isArray(params) || Object.entries(params).some(([key, item]) => !['since', 'before', 'keyword'].includes(key) || typeof item !== 'string' || !item || Array.from(item).length > 2048)) throw Error(`Query ${value.position} parameters must be an object containing only nonempty since, before or keyword strings, each at most 2048 characters.`);
        const normalized = params as Record<string, string>;
        const sameParams = Object.keys(normalized).length === Object.keys(original.params).length && Object.entries(normalized).every(([key, item]) => item === original.params[key]);
        if (value.sql === original.sql && sameParams) continue;
        edits.push({ position: value.position, sql: value.sql, params: normalized });
      }
      if (!edits.length) throw Error('Change query SQL or parameters before saving a refined draft.');
    } catch (reason) {
      setError(reason instanceof SyntaxError ? 'Parameters must be valid JSON objects. No request was sent.' : (reason as Error).message);
      return;
    }
    const version = ++request.current;
    inFlight.current = true; setBusy(true); setError('');
    let recorded = false;
    try {
      const response = await apiClient.post(`/hunt/query-drafts/${source.session_id}/refinements`, { fingerprint: source.fingerprint, edits });
      if (version !== request.current) return;
      onRecorded(); recorded = true;
      if (response.data.success !== true) throw Error('The refined draft did not finish saving. Inspect Hunt History before saving again. No event execution was requested.');
      onSaved(parseRefinedHuntDraft(response.data.data, source, edits));
    } catch (reason) {
      if (version !== request.current) return;
      const status = (reason as { response?: { status?: number } })?.response?.status;
      const refused = status !== undefined && [400, 401, 404, 409, 422].includes(status);
      if (!refused && !recorded) onRecorded();
      setStopped(!refused || status === 409 || status === 404 || status === 401 || status === 400);
      setError(refused ? 'The refinement was refused. Check the edits. If the saved source changed, cancel and reload it before saving again. No event execution was requested.' : 'Saving could not be confirmed. A new draft may already exist. Cancel this editor and inspect Hunt History before saving again. No event execution was requested.');
    } finally {
      if (version === request.current) { inFlight.current = false; setBusy(false); }
    }
  };
  return <section aria-label="Edit saved hunt query draft" className="min-w-0 space-y-3 rounded border border-warning/50 p-3">
    <h4 className="text-sm font-semibold text-surface-100">Refine SQL and parameters</h4>
    <p className="text-xs text-surface-300">Saving makes a separate compiler-only draft with a new one-hour review window. The source stays unchanged. No AI call or event SELECT. Absolute time bounds do not advance automatically. Edited bounds or removed filters can change the scope; review the new compiler contract before selecting queries.</p>
    <p className="text-xs text-surface-400">Descriptions and the proposed explanation are copied from the source, not regenerated for your edits. Previously omitted queries are not recovered. Untouched retained queries are recompiled, not run.</p>
    {values.map(value => <fieldset key={value.position} className="min-w-0 space-y-2 rounded border border-surface-700 p-2" disabled={busy || stopped}>
      <legend className="text-xs text-surface-300">Original query {value.position}</legend>
      <label className="block text-xs text-surface-300">SQL for original query {value.position}<textarea aria-label={`SQL for original query ${value.position}`} rows={5} className={input} value={value.sql} onChange={event => change(value.position, 'sql', event.target.value)} /></label>
      <label className="block text-xs text-surface-300">Parameters JSON for original query {value.position}<textarea aria-label={`Parameters JSON for original query ${value.position}`} rows={3} className={input} value={value.params} onChange={event => change(value.position, 'params', event.target.value)} /></label>
    </fieldset>)}
    {busy && <p role="status" className="text-xs text-surface-300">Saving and compiling edited queries. No event execution requested...</p>}
    {error && <p role="alert" className="whitespace-pre-wrap break-words text-xs text-danger">{error}</p>}
    <div className="flex flex-wrap gap-2"><button type="button" className={control} disabled={busy || stopped} onClick={() => void save()}>Save edits as new query draft</button><button type="button" className={control} disabled={busy} onClick={onCancel}>Cancel edits</button></div>
  </section>;
}

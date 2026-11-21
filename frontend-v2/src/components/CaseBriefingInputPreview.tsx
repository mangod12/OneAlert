import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { verifyBriefingInputs, type BriefingInputs } from '../utils/briefingInputs';
export function CaseBriefingInputPreview({ caseId }: { caseId: number }) {
  const [data, setData] = useState<BriefingInputs | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const revision = useRef(0), busy = useRef(false);
  useEffect(() => { revision.current++; busy.current = false; setData(null); setError(''); setLoading(false); const invalidate = () => { revision.current += 1; }; return invalidate; }, [caseId]);
  const read = async () => {
    if (busy.current) return;
    busy.current = true; const request = ++revision.current; setLoading(true); setData(null); setError('');
    try {
      const { data: value } = await apiClient.get<BriefingInputs>(`/cases/${caseId}/briefing-inputs`);
      if (request !== revision.current) return;
      if (!verifyBriefingInputs(value, caseId)) throw new Error('The input preview did not match this case or its bounded source counts.');
      setData(value);
    } catch (err) { if (request === revision.current) setError(getApiErrorMessage(err, 'Input excerpts could not be loaded. No AI call or saved draft was made.')); }
    finally { if (request === revision.current) { busy.current = false; setLoading(false); } }
  };
  return <section aria-label="Read-only briefing input excerpts" className="space-y-3 rounded border border-surface-700 p-3">
    <h3 className="font-semibold text-surface-100">Inspect current briefing input excerpts</h3>
    <p>Read the bounded metadata used by the briefing collector before deciding whether to generate a draft. This button does not call AI, save a draft, grant access or change the case. Generating later collects fresh inputs, which may differ from this sequential read.</p>
    <button type="button" disabled={loading} onClick={() => void read()} className="rounded border border-surface-600 p-2 text-primary-300 disabled:opacity-40">{loading ? 'Reading input excerpts...' : 'Read current briefing input excerpts'}</button>
    {error && <p role="alert" className="text-danger">{error}</p>}
    {data && <>
      <p className="break-words">Read at {data.retrieved_at}. Excluded: {data.excluded}</p>
      {(['alert', 'event'] as const).map(kind => <p key={kind}>{kind}: {data.scope[kind].included} included / {data.scope[kind].available} available; {data.scope[kind].omitted} omitted by input limit; {data.scope[kind].unavailable} unavailable links.</p>)}
      <ul className="space-y-3">{data.source_records.map(source => <li key={source.key} className="min-w-0 space-y-1 rounded border border-surface-700 p-2">
        <p className="font-semibold">{source.kind} #{source.id}</p><p className="whitespace-pre-wrap break-words">{source.title || source.label || 'Label not recorded'}</p>{source.summary && <p className="whitespace-pre-wrap break-words">{source.summary}</p>}
        <p className="break-words text-surface-400">Recorded severity: {source.severity ?? 'Not recorded'}{source.status ? ` · status: ${source.status}` : ''}{source.recorded_at ? ` · time: ${source.recorded_at}` : ''}. These are saved labels, not verified incident facts.</p>
      </li>)}</ul>
    </>}
  </section>;
}

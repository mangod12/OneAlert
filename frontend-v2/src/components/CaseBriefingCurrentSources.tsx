import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { verifySavedBriefing, type SavedBriefing } from '../utils/caseBriefingEvidence';
import { verifyBriefingInputs, type BriefingInputs } from '../utils/briefingInputs';
import { compareBriefingSources } from '../utils/briefingComparison';

export function CaseBriefingCurrentSources({ row }: { row: SavedBriefing }) {
  const caseId = row.briefing.case_id;
  const [result, setCurrent] = useState<{ inputs: BriefingInputs; saved: SavedBriefing } | null>(null);
  const [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const revision = useRef(0), busy = useRef(false);
  useEffect(() => {
    revision.current++; busy.current = false; setCurrent(null); setError(''); setLoading(false);
    const invalidate = () => { revision.current++; }; return invalidate;
  }, [row]);
  const read = async () => {
    if (busy.current) return;
    const request = ++revision.current; busy.current = true; setCurrent(null); setError(''); setLoading(true);
    try {
      if (!verifySavedBriefing(row, caseId) || new Set(row.briefing.sources.map(s => s.key)).size !== row.briefing.sources.length) {
        throw new Error('Saved source identities could not be verified. No comparison was shown.');
      }
      const { data } = await apiClient.get<BriefingInputs>(`/cases/${caseId}/briefing-inputs`);
      if (request !== revision.current) return;
      if (!verifyBriefingInputs(data, caseId)) throw new Error('Current inputs could not be verified for this case. No comparison was shown.');
      setCurrent({ inputs: data, saved: row });
    } catch (err) {
      if (request === revision.current) setError(getApiErrorMessage(err, 'Current input read failed. No draft or case change was made.'));
    } finally {
      if (request === revision.current) { busy.current = false; setLoading(false); }
    }
  };
  const current = result?.saved === row ? result.inputs : null;
  const diff = current && current.case_id === caseId ? compareBriefingSources(row.briefing.sources, current.source_records) : null;
  const counts = (kind: 'alert' | 'event') => {
    const saved = row.briefing.scope[kind], now = current!.scope[kind];
    return `${kind}: saved ${saved.included} included, ${saved.omitted} omitted, ${saved.unavailable} unavailable; current read ${now.included} included, ${now.omitted} omitted, ${now.unavailable} unavailable.`;
  };
  return <section aria-label="Saved versus current briefing inputs" className="space-y-3 rounded border border-surface-700 p-3 text-xs text-surface-300">
    <h3 className="text-sm font-semibold text-surface-100">Review source changes since draft #{row.timeline_id}</h3>
    <p>Compare this displayed saved draft's shortened inputs with an on-demand read of current briefing inputs. No AI call, draft generation, case edit or action is made. This does not assess whether draft observations are still valid.</p>
    <button type="button" disabled={loading} onClick={() => void read()} className="rounded border border-surface-600 p-2 text-primary-300 disabled:opacity-40">{loading ? 'Reading current input differences...' : 'Compare saved inputs with current read'}</button>
    {error && <p role="alert" className="break-words text-warning">{error}</p>}
    {diff && current && <>
      <p className="break-words">Saved draft prepared {row.briefing.captured_at}. Current inputs read {current.retrieved_at}. This is a sequential read, not a frozen snapshot. A later generation reads inputs again.</p>
      <p>Only retained metadata fields are compared, not full source records or security posture. A missing key can reflect input limits, changed links or unavailable records, not deleted evidence. Identical excerpts do not prove unchanged evidence. Order alone is not treated as a source change.</p>
      <p role="status">{diff.filter(s => s.change === 'only_a').length} keys only in saved draft; {diff.filter(s => s.change === 'only_b').length} only in current read; {diff.filter(s => s.change === 'different').length} shared keys with different retained metadata; {diff.filter(s => s.change === 'same').length} with identical retained metadata.</p>
      {(['alert', 'event'] as const).map(kind => <p key={kind}>{counts(kind)}</p>)}
      {diff.every(s => s.change === 'same') && <p>No retained source differences found in these bounded reads. This is not a freshness guarantee or a reason to skip human review.</p>}
      <ul className="space-y-3">{diff.filter(s => s.change !== 'same').map(s => <li key={s.key} className="min-w-0 space-y-2 rounded border border-surface-700 p-3">
        <h4 className="break-words font-semibold">{s.key}: {s.change === 'different' ? 'Different retained metadata' : s.change === 'only_a' ? 'Only in saved draft' : 'Only in current read'}</h4>
        <div className="grid gap-3 md:grid-cols-2">{(['a', 'b'] as const).map(side => <div key={side} className="min-w-0 space-y-1"><p className="font-semibold">{side === 'a' ? 'Saved draft input' : 'Current read input'}</p>{s[side] ? <pre className="whitespace-pre-wrap break-all font-sans">{JSON.stringify(s[side], null, 2)}</pre> : <p>Not included in this bounded read.</p>}</div>)}</div>
      </li>)}</ul>
    </>}
  </section>;
}

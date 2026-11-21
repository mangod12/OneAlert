import { assessmentComparisonEvidence, assessmentComparisonFields as fields, type ComparedAssessment } from '../utils/assessmentComparisonEvidence';
import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
const button = 'rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
function recorded(value: string | null) { return value === null ? '(null: not recorded)' : value === '' ? '(empty text)' : value; }
export function AssessmentComparison({ controlId, ids }: { controlId: number; ids: number[] }) {
  const request = useRef(0);
  const [snapshot, setSnapshot] = useState<{ records: ComparedAssessment[]; loadedAt: string } | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(''), [changedOnly, setChangedOnly] = useState(true), [downloadError, setDownloadError] = useState('');
  const left = ids[0], right = ids[1];
  useEffect(() => { request.current += 1; setSnapshot(null); setError(''); setDownloadError(''); setLoading(false); return () => { request.current += 1; }; }, [controlId, left, right]);
  const load = async () => {
    const id = ++request.current; setSnapshot(null); setError(''); setDownloadError('');
    if (!Number.isSafeInteger(left) || left < 1 || !Number.isSafeInteger(right) || right < 1 || left === right) { setError('Select two distinct assessment records for this control.'); return; }
    setLoading(true);
    try {
      const responses = await Promise.all([left, right].map(id => apiClient.get(`/compliance/assessments/${id}`)));
      if (request.current !== id) return;
      const records = responses.map(response => response.data as ComparedAssessment);
      if (records.some((record, index) => !record || record.id !== [left, right][index] || record.control_id !== controlId || typeof record.status !== 'string' || typeof record.assessed_at !== 'string' || typeof record.assessed_by !== 'string' || (record.evidence_type !== null && typeof record.evidence_type !== 'string') || (record.evidence_detail !== null && typeof record.evidence_detail !== 'string'))) throw new Error('The saved assessment records did not match this control and selection. Reload before comparing.');
      setSnapshot({ records, loadedAt: new Date().toISOString() });
    } catch (err) { if (request.current === id) setError(getApiErrorMessage(err, 'Assessment comparison unavailable. No equality or compliance outcome is inferred.')); }
    finally { if (request.current === id) setLoading(false); }
  };
  const download = () => {
    if (!snapshot || loading || error) return; setDownloadError('');
    try { const content = assessmentComparisonEvidence(controlId, snapshot.records, snapshot.loadedAt, changedOnly, new Date().toISOString()); const url = URL.createObjectURL(new Blob([content], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `control-${controlId}-assessment-${left}-versus-${right}.json`; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch { setDownloadError('Assessment comparison evidence could not be downloaded. The loaded records are unchanged.'); }
  };
  const differences = snapshot ? fields.filter(([key]) => snapshot.records[0][key] !== snapshot.records[1][key]) : [];
  return <section aria-label="Compare saved assessment records" className="space-y-3 rounded border border-surface-700 p-3">
    <h3 className="text-sm font-semibold text-surface-100">Compare saved assessment records</h3>
    <p className="text-xs text-surface-400">Select a baseline, then a comparison record across history pages. Selection order defines the sides, not chronology. Loading fetches both current saved records separately. Edits to a record are not retained versions; differences are recorded values, not a new compliance assessment.</p>
    <p className="break-words text-xs text-surface-200">Selection: {ids.length ? ids.map(id => `#${id}`).join(' → ') : 'None'}</p>
    <button type="button" className={button} disabled={ids.length !== 2 || loading} onClick={() => void load()}>{loading ? 'Loading assessment comparison...' : 'Load selected assessment comparison'}</button>
    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    {snapshot && <>
      <p className="text-xs text-surface-400">Control #{controlId} · Baseline #{left} → Comparison #{right} · {differences.length} of {fields.length} recorded fields differ. Loaded {snapshot.loadedAt}. This is not an atomic snapshot or proof of compliance.</p>
      <button type="button" className={button} onClick={download}>Download loaded assessment comparison JSON</button>
      <p className="text-xs text-surface-400">Download includes both complete loaded records, full evidence detail and assessor names, read/export times and differing fields. The display filter limits the displayed-field list only, neither source record is redacted. Null and empty text remain distinct. Review before sharing. This export reads no new evidence and creates no compliance conclusion.</p>
      {downloadError && <p role="alert" className="text-xs text-danger">{downloadError}</p>}
      <label className="flex items-center gap-2 text-xs text-surface-300"><input type="checkbox" checked={changedOnly} onChange={event => setChangedOnly(event.target.checked)} />Show differing assessment fields only</label>
      {changedOnly && differences.length === 0 && <p className="text-xs text-surface-300">The compared recorded fields are identical. This does not establish compliance or unchanged evidence outside these records.</p>}
      <dl className="space-y-3">{(changedOnly ? differences : fields).map(([key, label]) => <div key={key} className="min-w-0 space-y-2 rounded border border-surface-800 p-3"><dt className="text-xs font-semibold text-surface-100">{label} · {snapshot.records[0][key] === snapshot.records[1][key] ? 'Same recorded value' : 'Different recorded values'}</dt><dd className="grid min-w-0 gap-3 text-xs text-surface-300 sm:grid-cols-2">{snapshot.records.map((record, index) => <div className="min-w-0" key={record.id}><p className="mb-1 text-surface-400">{index === 0 ? 'Baseline' : 'Comparison'} #{record.id}</p><p className="whitespace-pre-wrap break-words">{recorded(record[key])}</p></div>)}</dd></div>)}</dl>
    </>}
  </section>;
}

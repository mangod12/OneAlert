import { assessmentHistoryCsv } from '../utils/assessmentHistoryCsv';
import { useState, type ReactNode } from 'react';
export interface HistoryAssessment { id: number; control_id: number; status: string; evidence_type: string | null; evidence_detail: string | null; assessed_at: string; assessed_by: string; }
const control = 'min-h-9 max-w-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-xs text-surface-200 disabled:opacity-40';
export function AssessmentHistoryExplorer({ history, controlId, selectedIds, children }: { history: HistoryAssessment[]; controlId: number; selectedIds: number[]; children: (row: HistoryAssessment) => ReactNode }) {
  const [query, setQuery] = useState(''), [status, setStatus] = useState(''), [evidence, setEvidence] = useState(''), [from, setFrom] = useState(''), [through, setThrough] = useState(''), [page, setPage] = useState(1), [downloadError, setDownloadError] = useState('');
  const sorted = [...history].sort((a, b) => b.assessed_at.localeCompare(a.assessed_at) || b.id - a.id);
  const needle = query.trim().toLowerCase(), invalidDate = !!(from && through && from > through);
  const date = (value: string) => { const parsed = new Date(value.endsWith('Z') || /[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`); return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : null; };
  const matches = invalidDate ? [] : sorted.filter(row => {
    const day = date(row.assessed_at);
    return (!status || row.status === status) && (!evidence || (evidence === 'missing' ? !row.evidence_detail?.trim() : !!row.evidence_detail?.trim()))
      && (!from || !!day && day >= from) && (!through || !!day && day <= through)
      && (!needle || [String(row.id), row.status, row.evidence_type, row.evidence_detail, row.assessed_by].some(value => value?.toLowerCase().includes(needle)));
  });
  const lastPage = Math.max(1, Math.ceil(matches.length / 10)), currentPage = Math.min(page, lastPage);
  const selectedHidden = selectedIds.filter(id => !matches.some(row => row.id === id)).length;
  const download = () => {
    setDownloadError('');
    try { const url = URL.createObjectURL(new Blob([assessmentHistoryCsv(matches, controlId, { query, status, evidence, from, through }, history.length)], { type: 'text/csv;charset=utf-8' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `control-${controlId}-matching-assessments.csv`; document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch { setDownloadError('Matching assessment records could not be downloaded. The loaded history is unchanged.'); }
  };
  return <section aria-label="Search saved assessment history" className="space-y-3">
    <p className="text-xs text-surface-400">Search literal saved status, ID, assessor, evidence type or evidence detail across all loaded history pages. Filters do not change assessments or comparison selection. Date filters use inclusive UTC assessment dates, not edit dates. Invalid timestamps do not match a date filter.</p>
    <label className="block text-xs text-surface-300">Search assessment history<input type="search" aria-label="Search assessment history" maxLength={200} value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} className={`${control} mt-1 w-full min-w-0`} /></label>
    <div className="flex flex-wrap items-end gap-2"><select aria-label="History assessment status" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }} className={control}><option value="">All saved statuses</option>{[...new Set(sorted.map(row => row.status))].sort().map(value => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select>
      <select aria-label="History evidence detail scope" value={evidence} onChange={event => { setEvidence(event.target.value); setPage(1); }} className={control}><option value="">Any evidence detail</option><option value="present">Has nonempty evidence detail</option><option value="missing">Missing or blank evidence detail</option></select>
      <label className="flex flex-col gap-1 text-xs text-surface-400">From UTC date<input type="date" aria-label="History from UTC date" value={from} onChange={event => { setFrom(event.target.value); setPage(1); }} className={control} /></label>
      <label className="flex flex-col gap-1 text-xs text-surface-400">Through UTC date<input type="date" aria-label="History through UTC date" value={through} onChange={event => { setThrough(event.target.value); setPage(1); }} className={control} /></label>
      <button type="button" onClick={() => { setQuery(''); setStatus(''); setEvidence(''); setFrom(''); setThrough(''); setPage(1); }} className={control}>Clear history filters</button>
    </div>
    {invalidDate && <p role="alert" className="text-xs text-danger">From date must not be after through date. No history matches or CSV are inferred.</p>}
    <p role="status" className="text-xs text-surface-300">{invalidDate ? 'Matching count unavailable' : `${matches.length} of ${history.length} loaded assessment records match`}. {selectedHidden > 0 ? `${selectedHidden} selected comparison records are outside these filters and remain selected.` : 'Comparison selection is unchanged.'}</p>
    <button type="button" onClick={download} disabled={invalidDate || !matches.length} className={control}>Download matching assessment history CSV</button>
    <p className="text-xs text-surface-400">CSV includes full evidence text and assessor names for all matching loaded records, not just this page. Review before sharing. No refresh, automated assessment or recipient contact occurs. Null and empty evidence values have separate missing-value columns. Current record edits are not earlier versions.</p>
    {downloadError && <p role="alert" className="text-xs text-danger">{downloadError}</p>}
    <nav aria-label="Assessment history pages" className="flex flex-wrap items-center justify-between gap-2 text-xs text-surface-300"><span>Page {currentPage} of {lastPage}</span><div className="flex gap-2"><button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} className={control}>Previous records</button><button type="button" disabled={currentPage * 10 >= matches.length} onClick={() => setPage(currentPage + 1)} className={control}>More records</button></div></nav>
    {matches.length ? <ol className="space-y-3">{matches.slice((currentPage - 1) * 10, currentPage * 10).map(children)}</ol> : !invalidDate && <p className="text-sm text-surface-400">No loaded assessment records match. Clear filters to review other saved records. Missing evidence does not establish non-compliance.</p>}
  </section>;
}

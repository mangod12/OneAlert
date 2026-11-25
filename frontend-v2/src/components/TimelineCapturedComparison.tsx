import { useState } from 'react';
import type { TimelineRecord } from './TimelineExplorer';
const fields = [['timestamp', 'Raw timestamp'], ['entry_type', 'Type'], ['source', 'Source'], ['author_email', 'Recorded author'], ['content', 'Saved text']] as const;
export function TimelineCapturedComparison({ rows, baselineId, comparisonId, onClear }: { rows: TimelineRecord[]; baselineId: number; comparisonId: number; onClear: () => void }) {
  const [differencesOnly, setDifferencesOnly] = useState(false);
  const [reversed, setReversed] = useState(false);
  const baseline = rows.find(row => row.id === (reversed ? comparisonId : baselineId)), comparison = rows.find(row => row.id === (reversed ? baselineId : comparisonId));
  if (!baseline || !comparison || baseline.id === comparison.id) return null;
  return <section aria-label="Captured timeline entry comparison" className="mt-3 space-y-2 rounded-md border border-primary-700 p-2 [overflow-wrap:anywhere]">
    <h4 className="font-medium text-surface-100">Captured entry #{baseline.id} compared with #{comparison.id}</h4>
    <p>First selected starts as the baseline; sides can be swapped for inspection. Baseline is a viewing choice, not an earlier event or previous version. This compares only two captured entries, not edit history, chronology, source truth or response duration. No records, capture criteria or CSV rows change.</p>
    <div className="flex flex-wrap gap-2"><button type="button" aria-pressed={differencesOnly} onClick={() => setDifferencesOnly(value => !value)} className="min-h-9 rounded-md border border-surface-600 px-2">Show only different captured fields</button><button type="button" onClick={() => setReversed(value => !value)} className="min-h-9 rounded-md border border-surface-600 px-2">Swap captured comparison sides</button></div>
    <p role="status">{fields.filter(([key]) => baseline[key] !== comparison[key]).length} of {fields.length} captured fields differ. {differencesOnly ? 'Only different saved fields shown.' : 'All saved fields shown.'} Swapping sides changes this view only, not selected IDs, saved entries or export order.</p>
    {differencesOnly && fields.every(([key]) => baseline[key] === comparison[key]) && <p>No different saved fields. These are still two different captured entries, not duplicate evidence or equivalent events.</p>}
    {fields.filter(([key]) => !differencesOnly || baseline[key] !== comparison[key]).map(([key, label]) => <div key={key} className="rounded-md border border-surface-700 p-2">
      <h5 className="font-medium">{label}: {baseline[key] === comparison[key] ? 'Same saved value' : 'Different saved values'}</h5>
      <dl className="mt-1 space-y-1"><dt>Baseline #{baseline.id}</dt><dd className="whitespace-pre-wrap">{baseline[key] === null ? '(Not recorded)' : baseline[key] === '' ? '(Empty saved value)' : baseline[key]}</dd><dt>Comparison #{comparison.id}</dt><dd className="whitespace-pre-wrap">{comparison[key] === null ? '(Not recorded)' : comparison[key] === '' ? '(Empty saved value)' : comparison[key]}</dd></dl>
    </div>)}
    <button type="button" onClick={onClear} className="min-h-9 rounded-md border border-surface-600 px-2">Clear captured comparison</button>
  </section>;
}

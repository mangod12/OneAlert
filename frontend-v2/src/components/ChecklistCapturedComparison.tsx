import { checklistComparisonJson } from '../utils/checklistComparisonExport';
import { useState } from 'react';
import type { ChecklistExportSnapshot } from '../utils/checklistSnapshotExport';
const fields = [['title', 'Saved title'], ['done', 'Completed state'], ['due_date', 'Raw due date'], ['assignee_id', 'Assignee ID'], ['position', 'Checklist position']] as const;
export function ChecklistCapturedComparison({ tasks, baselineId, comparisonId, onClear }: { tasks: ChecklistExportSnapshot['tasks']; baselineId: number; comparisonId: number; onClear: () => void }) {
  const [differencesOnly, setDifferencesOnly] = useState(false);
  const [reversed, setReversed] = useState(false);
  const baseline = tasks.find(task => task.id === (reversed ? comparisonId : baselineId)), comparison = tasks.find(task => task.id === (reversed ? baselineId : comparisonId));
  if (!baseline || !comparison || baseline.id === comparison.id) return null;
  const display = (value: string | number | boolean | null) => value === null ? '(Not recorded)' : value === '' ? '(Empty saved value)' : String(value);
  const download = () => {
    const url = URL.createObjectURL(new Blob([checklistComparisonJson(baseline, comparison)], { type: 'application/json;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `captured-checklist-comparison-${baseline.id}-${comparison.id}.json`; link.click(); URL.revokeObjectURL(url);
  };
  return <section aria-label="Captured checklist task comparison" className="space-y-2 rounded border border-primary-700 p-2 [overflow-wrap:anywhere]">
    <h4 className="font-semibold">Captured task #{baseline.id} compared with #{comparison.id}</h4>
    <p>First selected starts as the baseline; sides can be swapped for inspection. Baseline is a viewing choice, not an older version. This compares two different tasks from the frozen review, not edit history, assignment changes, timeliness or remediation. Assignee IDs are captured IDs, not current member names. No captured filters, export rows or saved tasks change.</p>
    <div className="flex flex-wrap gap-2"><button type="button" aria-pressed={differencesOnly} onClick={() => setDifferencesOnly(value => !value)} className="min-h-9 rounded border border-surface-700 px-2">Show only different captured task fields</button><button type="button" onClick={() => setReversed(value => !value)} className="min-h-9 rounded border border-surface-700 px-2">Swap captured task comparison sides</button></div>
    <p role="status">{fields.filter(([key]) => baseline[key] !== comparison[key]).length} of {fields.length} captured task fields differ. {differencesOnly ? 'Only different saved fields shown.' : 'All saved fields shown.'} Swapping sides changes this view only, not selected IDs, saved tasks or export order.</p>
    {differencesOnly && fields.every(([key]) => baseline[key] === comparison[key]) && <p>No different saved task fields. These are still two different captured tasks, not duplicate work or equivalent remediation.</p>}
    {fields.filter(([key]) => !differencesOnly || baseline[key] !== comparison[key]).map(([key, label]) => <div key={key} className="rounded border border-surface-700 p-2"><h5 className="font-medium">{label}: {baseline[key] === comparison[key] ? 'Same saved value' : 'Different saved values'}</h5><dl className="mt-1 space-y-1"><dt>Baseline #{baseline.id}</dt><dd className="whitespace-pre-wrap">{display(baseline[key])}</dd><dt>Comparison #{comparison.id}</dt><dd className="whitespace-pre-wrap">{display(comparison[key])}</dd></dl></div>)}
    <p>Download only these two frozen tasks in the displayed side order, including all saved fields even when difference focus is on. No investigation context, full capture, upload or message is included. Review the local file before sharing it.</p>
    <button type="button" onClick={download} className="min-h-9 rounded border border-surface-700 px-2">Download captured task comparison JSON</button>
    <button type="button" className="min-h-9 rounded border border-surface-700 px-2" onClick={onClear}>Clear captured checklist comparison</button>
  </section>;
}

import type { ChecklistExportSnapshot } from '../utils/checklistSnapshotExport';
const fields = [['title', 'Saved title'], ['done', 'Completed state'], ['due_date', 'Raw due date'], ['assignee_id', 'Assignee ID'], ['position', 'Checklist position']] as const;
export function ChecklistCapturedComparison({ tasks, baselineId, comparisonId, onClear }: { tasks: ChecklistExportSnapshot['tasks']; baselineId: number; comparisonId: number; onClear: () => void }) {
  const baseline = tasks.find(task => task.id === baselineId), comparison = tasks.find(task => task.id === comparisonId);
  if (!baseline || !comparison || baseline.id === comparison.id) return null;
  const display = (value: string | number | boolean | null) => value === null ? '(Not recorded)' : value === '' ? '(Empty saved value)' : String(value);
  return <section aria-label="Captured checklist task comparison" className="space-y-2 rounded border border-primary-700 p-2 [overflow-wrap:anywhere]">
    <h4 className="font-semibold">Captured task #{baseline.id} compared with #{comparison.id}</h4>
    <p>First selected is the baseline, not an older version. This compares two different tasks from the frozen review, not edit history, assignment changes, timeliness or remediation. Assignee IDs are captured IDs, not current member names. No captured filters, export rows or saved tasks change.</p>
    {fields.map(([key, label]) => <div key={key} className="rounded border border-surface-700 p-2"><h5 className="font-medium">{label}: {baseline[key] === comparison[key] ? 'Same saved value' : 'Different saved values'}</h5><dl className="mt-1 space-y-1"><dt>Baseline #{baseline.id}</dt><dd className="whitespace-pre-wrap">{display(baseline[key])}</dd><dt>Comparison #{comparison.id}</dt><dd className="whitespace-pre-wrap">{display(comparison[key])}</dd></dl></div>)}
    <button type="button" className="min-h-9 rounded border border-surface-700 px-2" onClick={onClear}>Clear captured checklist comparison</button>
  </section>;
}

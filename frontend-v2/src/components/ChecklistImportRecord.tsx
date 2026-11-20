import { Link } from 'react-router-dom';
interface ImportRecord { kind: 'reviewed_checklist_import'; schema_version: 1; case_id: number; plan_id: number; reviewed_fingerprint: string; selected_action_indexes: number[]; skipped_existing_titles: number; created_tasks: { task_id: number; action_index: number; title_at_import: string }[]; }
function parseRecord(value: unknown, caseId: number): ImportRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as ImportRecord;
  if (record.kind !== 'reviewed_checklist_import' || record.schema_version !== 1 || record.case_id !== caseId || !Number.isSafeInteger(record.plan_id) || record.plan_id < 1 || !/^[a-f0-9]{64}$/.test(record.reviewed_fingerprint) || !Array.isArray(record.selected_action_indexes) || record.selected_action_indexes.some(index => !Number.isSafeInteger(index) || index < 0) || !Array.isArray(record.created_tasks) || !record.created_tasks.length || record.created_tasks.length > 200 || record.created_tasks.some(task => !task || !Number.isSafeInteger(task.task_id) || task.task_id < 1 || !Number.isSafeInteger(task.action_index) || task.action_index < 0 || !record.selected_action_indexes.includes(task.action_index) || typeof task.title_at_import !== 'string') || !Number.isSafeInteger(record.skipped_existing_titles) || record.skipped_existing_titles < 0) return null;
  return record;
}
export function ChecklistImportRecord({ metadata, caseId }: { metadata: unknown; caseId: number }) {
  const record = parseRecord(metadata, caseId);
  if (!record) return null;
  return <details className="mt-2 rounded border border-surface-700 p-3"><summary className="cursor-pointer text-xs text-primary-300">Inspect recorded checklist import from plan #{record.plan_id}</summary><div className="mt-3 space-y-3 text-xs text-surface-400">
    <p>Saved at import. Tasks created: {record.created_tasks.length}. Selected titles skipped: {record.skipped_existing_titles}. This record does not establish the tasks' current state or approve or execute the response plan.</p>
    <Link className="inline-block text-primary-300" to={`/response-plans?plan=${record.plan_id}`}>Open current decision evidence for plan #{record.plan_id}</Link>
    <p>The linked plan may have changed or been deleted. Evidence access is checked separately. Historical imports without this record cannot be reconstructed from task titles.</p>
    <ol className="max-h-64 space-y-2 overflow-y-auto" aria-label="Tasks recorded at checklist import" tabIndex={0}>{record.created_tasks.map(task => <li key={`${task.task_id}:${task.action_index}`} className="break-all rounded bg-surface-950 p-2">Task #{task.task_id} from saved action position {task.action_index + 1}: {task.title_at_import}</li>)}</ol>
    <p className="break-all font-mono">Reviewed plan fingerprint: {record.reviewed_fingerprint}</p>
    <p>This is a saved application record, not a signed receipt or immutable audit log. Titles are snapshots at import and may differ from current checklist titles.</p>
  </div></details>;
}

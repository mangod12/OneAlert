import type { ImportPreviewComparison } from '../utils/eventImportComparison';
const messages = {
  unverifiable: 'Preview-to-import comparison could not be verified.',
  incomplete: 'Some comparison metadata was not recorded. No complete match is established.',
  different: 'Import response differs from the attached parser preview.',
  matching: 'All recorded counters and skip-reason counts match the attached preview.',
};
export function EventImportPreviewComparison({ comparison }: { comparison: ImportPreviewComparison }) {
  if (comparison.status === 'not_attached') return <p className="text-xs text-surface-400">No parser preview was attached to this upload. Only its recorded import response is shown.</p>;
  const rows = (values: ImportPreviewComparison['counters']) => <ul className="space-y-3">{values.map(row => <li key={row.key} className="min-w-0 rounded border border-surface-700 p-3">
    <p className="mb-2 text-xs font-medium text-surface-100">{row.label}</p>
    <dl className="grid min-w-0 grid-cols-3 gap-2 text-xs">{([['Preview', row.preview], ['Response', row.actual], ['Difference', row.delta]] as const).map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-surface-400">{label}</dt><dd className="mt-1 break-all text-surface-100">{value === undefined ? 'Not recorded' : `${label === 'Difference' && value > 0 ? '+' : ''}${value.toLocaleString()}`}</dd></div>)}</dl>
  </li>)}</ul>;
  return <section aria-label="Attached preview and import response comparison" className="min-w-0 space-y-3 rounded border border-surface-600 p-3">
    <h3 className="text-sm font-semibold text-surface-100">Preview versus import response</h3>
    <p className={comparison.status === 'matching' ? 'text-xs text-surface-200' : 'text-xs text-warning'}>{messages[comparison.status]}</p>
    {comparison.preview && <p className="break-all text-xs text-surface-400">Attached request preview: {comparison.preview.source_type}, {comparison.preview.byte_size.toLocaleString()} file bytes. Preview read at {comparison.preview.previewed_at}. File/parser fingerprint: {comparison.preview.fingerprint}.</p>}
    {comparison.counters.length > 0 && rows(comparison.counters)}
    {comparison.reasons.length > 0 && <div className="space-y-2"><h4 className="text-xs font-medium text-surface-100">Recorded skip-reason counts</h4>{rows(comparison.reasons)}</div>}
    <p className="text-xs text-surface-400">This compares the loaded preview attached to the submitted request with its recorded response, not an independently authenticated receipt, live event check, unchanged-parser guarantee or threat conclusion. Missing counters are not zero. Redactions count only accepted or imported records.</p>
    <p className="text-xs text-warning">Differences do not undo imported rows. Do not re-upload just to make counts match. Inspect existing events before considering any retry.</p>
    <p className="text-xs text-surface-400">The receipt download includes this allowlisted comparison and any valid attached preview metadata, not file bytes or event values. Filename, source ID and fingerprint can identify sensitive input. Keep private. No extra read, import or sharing.</p>
  </section>;
}

import type { HistoryAssessment } from '../components/AssessmentHistoryExplorer';
export function assessmentHistoryCsv(records: HistoryAssessment[], controlId: number, scope: { query: string; status: string; evidence: string; from: string; through: string }, loadedCount: number): string {
  const cell = (value: unknown) => {
    const text = value == null ? '' : String(value);
    let start = 0;
    while (start < text.length && (text.charCodeAt(start) <= 32 || /\s/u.test(text[start]))) start++;
    const safe = '=+@-'.includes(text[start] ?? '\uffff') ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const rows: unknown[][] = [['scope', 'control_id', 'assessment_id', 'status', 'evidence_type', 'evidence_type_missing', 'evidence_detail', 'evidence_detail_missing', 'assessed_at', 'assessed_by', 'search', 'status_filter', 'evidence_filter', 'from_utc_date', 'through_utc_date', 'loaded_records', 'matching_records']];
  for (const row of records) rows.push(['Matching loaded current assessment records, not immutable versions or proof of compliance', controlId, row.id, row.status, row.evidence_type, row.evidence_type === null, row.evidence_detail, row.evidence_detail === null, row.assessed_at, row.assessed_by, scope.query.trim(), scope.status, scope.evidence, scope.from, scope.through, loadedCount, records.length]);
  return '\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}

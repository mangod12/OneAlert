export interface ComparedAssessment { id: number; control_id: number; status: string; evidence_type: string | null; evidence_detail: string | null; assessed_at: string; assessed_by: string; }
export const assessmentComparisonFields = [['status', 'Saved status'], ['evidence_type', 'Evidence type'], ['evidence_detail', 'Recorded evidence detail'], ['assessed_at', 'Recorded assessment time'], ['assessed_by', 'Recorded assessor']] as const;
export function assessmentComparisonEvidence(controlId: number, records: ComparedAssessment[], loadedAt: string, changedOnly: boolean, exportedAt: string) {
  const differences = assessmentComparisonFields.filter(([key]) => records[0][key] !== records[1][key]);
  return JSON.stringify({ evidence_type: 'saved_assessment_comparison', control_id: controlId, loaded_at: loadedAt, exported_at: exportedAt,
    scope: 'Two separately read current saved assessment records. Selection order defines baseline and comparison, not chronology. Edits are not retained versions. Recorded field differences do not prove compliance or evidence validity. Not an atomic snapshot, immutable audit history or a new assessment. No assessment was changed.',
    display_filter: { differing_fields_only: changedOnly }, total_compared_fields: assessmentComparisonFields.length,
    differing_field_count: differences.length, differing_fields: differences.map(([key]) => key),
    baseline: records[0], comparison: records[1],
    displayed_fields: (changedOnly ? differences : assessmentComparisonFields).map(([key, label]) => ({ field: key, label, differs: records[0][key] !== records[1][key], baseline_value: records[0][key], comparison_value: records[1][key] })),
  }, null, 2) + '\n';
}

import { compareActionPositions } from './responsePlanComparison';
export interface ComparisonPlan { id: number; case_id: number; status: string; autonomy_level: string; actions: unknown[]; }
export function matchingComparisonPositions(before: ComparisonPlan, after: ComparisonPlan, changedOnly: boolean, query: string) {
  const needle = query.trim().toLowerCase();
  return compareActionPositions(before.actions, after.actions).filter(row => (!changedOnly || row.change !== 'unchanged') && (!needle || [String(row.position), row.change, row.before, row.after].some(value => value?.toLowerCase().includes(needle))));
}
export function planComparisonEvidence(snapshot: { before: ComparisonPlan; after: ComparisonPlan; loadedAt: string }, filters: { changedOnly: boolean; query: string }, exportedAt: string) {
  const { before, after } = snapshot, rows = compareActionPositions(before.actions, after.actions);
  const metadata = (plan: ComparisonPlan) => ({ id: plan.id, case_id: plan.case_id, status: plan.status, autonomy_level: plan.autonomy_level, saved_action_count: plan.actions.length });
  return JSON.stringify({ evidence_type: 'matching_saved_response_plan_comparison', exported_at: exportedAt, loaded_at: snapshot.loadedAt,
    scope: 'Only matching stored action positions from two separately loaded current saved plans. Alignment is by position, not identity or chronology. Reordering may appear as changes. No approval requests were compared. Recorded fields do not prove execution. Not an atomic snapshot or immutable history. No plan was changed.',
    filters: { changed_only: filters.changedOnly, search: filters.query.trim() },
    baseline: metadata(before), comparison: metadata(after),
    metadata_differences: { status: before.status !== after.status, autonomy_level: before.autonomy_level !== after.autonomy_level },
    total_positions: rows.length,
    position_counts_before_filters: Object.fromEntries(['changed','added','removed','unchanged'].map(change => [change, rows.filter(row => row.change === change).length])),
    matching_positions: matchingComparisonPositions(before, after, filters.changedOnly, filters.query).map(row => ({ position: row.position, change: row.change,
      baseline_present: row.position <= before.actions.length, comparison_present: row.position <= after.actions.length,
      ...(row.position <= before.actions.length ? { baseline_action: before.actions[row.position - 1] } : {}),
      ...(row.position <= after.actions.length ? { comparison_action: after.actions[row.position - 1] } : {}),
    })),
  }, null, 2) + '\n';
}

import { describe, expect, it } from 'vitest';
import { compareValidationRuns, validationComparisonCsv, type ComparableStep, type ComparableRun } from './validationComparison';
const step = (extra: Partial<ComparableStep> = {}): ComparableStep => ({ id: 1, technique_id: 'T1110', test_name: 'Password guessing', test_type: 'atomic', actual_result: 'detected', status: 'completed', simulated: true, ...extra });
const run = (id: number): ComparableRun => ({ id, name: 'Recorded run', mode: 'dry_run', status: 'completed', scope: { asset_ids: [7] }, created_at: '2026-11-20T08:00:00Z', steps: [] });
describe('recorded validation outcome comparison', () => {
  it('ignores database IDs, ordering and un-compared metadata', () => {
    const before = [{ ...step(), duration_ms: 5 }, step({ id: 2, technique_id: 'T1071' })];
    const after = [step({ id: 8, technique_id: 'T1071' }), { ...step({ id: 9 }), duration_ms: 900 }];
    expect(compareValidationRuns(before, after).map(row => row.kind)).toEqual(['unchanged', 'unchanged']);
  });
  it('compares recorded result, status and simulation flag without dropping false', () => {
    const row = compareValidationRuns([step()], [step({ actual_result: 'missed', status: 'failed', simulated: false })])[0];
    expect(row.kind).toBe('changed');
    expect(row.fields).toEqual(['actual_result', 'status', 'simulated']);
    expect(row.current[0].simulated).toBe(false);
  });
  it('does not invent a pass or miss when recorded evidence is absent', () => {
    expect(compareValidationRuns([step()], [step({ actual_result: null, simulated: undefined, status: undefined })])[0].fields).toEqual(['actual_result', 'status', 'simulated']);
    expect(compareValidationRuns([step({ simulated: undefined })], [step({ simulated: undefined })])[0].kind).toBe('unchanged');
  });
  it('does not pair renamed tests or changed test types', () => {
    for (const current of [step({ test_name: 'Other test' }), step({ test_type: 'manual' }), step({ technique_id: 'T1059' })]) {
      expect(compareValidationRuns([step()], [current]).map(row => row.kind).sort()).toEqual(['added', 'removed']);
    }
  });
  it('leaves duplicate identities ambiguous on either side, even if outcomes look identical', () => {
    for (const [before, after] of [[[step(), step()], [step()]], [[step()], [step(), step()]], [[], [step(), step()]]]) {
      const row = compareValidationRuns(before, after)[0];
      expect(row.kind).toBe('ambiguous'); expect(row.fields).toEqual([]);
    }
  });
  it('keeps additions/removals directional and never changes source evidence', () => {
    const before = [step()]; const original = JSON.stringify(before);
    expect(compareValidationRuns(before, [])[0].kind).toBe('removed');
    expect(compareValidationRuns([], before)[0].kind).toBe('added');
    expect(compareValidationRuns([], [])).toEqual([]);
    expect(JSON.stringify(before)).toBe(original);
  });
  it('exports only supplied groups with source IDs, scope/mode context and duplicate JSON evidence', () => {
    const rows = compareValidationRuns([step(), step()], [step({ simulated: false })]);
    const csv = validationComparisonCsv(run(1), { ...run(2), mode: 'lab' }, rows);
    expect(csv).toContain('"1","2","dry_run","lab"');
    expect(csv).toContain('"baseline_scope_json"');
    expect(csv).toContain('""asset_ids"":[7]');
    expect(csv).toContain('"ambiguous"');
    expect(csv).toContain('""simulated"":false');
    expect(csv.match(/""id"":1/g)).toHaveLength(3);
    expect(validationComparisonCsv(run(1), run(2), []).split('\r\n')).toHaveLength(1);
  });
  it('protects spreadsheet text while preserving original multiline step evidence', () => {
    const record = step({ test_name: '=Recorded, "test"\nnext line', technique_id: '\t@technique' });
    const csv = validationComparisonCsv(run(1), run(2), compareValidationRuns([record], []));
    expect(csv).toContain('"\'=Recorded, ""test""\nnext line"');
    expect(csv).toContain('"\'\t@technique"');
    expect(csv).toContain('""test_name"":""=Recorded');
  });
});

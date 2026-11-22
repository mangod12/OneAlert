import { describe, expect, it } from 'vitest';
import { compareHuntDraftSource, huntDraftSourceComparisonPackage } from './huntDraftSourceComparison';
import { draftSourceFixture } from './huntDraftSourceComparison.fixture';

describe('exact recorded hunt draft source comparison', () => {
  it('compares explicit query fields and explains removed/later bounds without claiming whole-query equivalence', () => {
    const { source, refined } = draftSourceFixture(), result = compareHuntDraftSource(refined, source);
    expect(result.queries[0].edited).toBe(true);
    expect(result.queries[0].changes).toEqual(['SQL text', 'parameters', 'row limits', 'applied absolute time bounds']);
    expect(result.queries[0].timeBoundChanges[0]).toContain('since removed');
    expect(result.queries[0].timeBoundChanges[1]).toContain('before moved later');
    expect(result.queries[0].timeBoundChanges[1]).toContain('not necessarily the whole query');
    expect(result.source).toEqual(source); expect(result.refined).toEqual(refined);
  });
  it('keeps unedited positions visible and does not treat parameter object key order as an edit', () => {
    const { source, refined } = draftSourceFixture();
    source.draft.queries.push({ ...structuredClone(source.draft.queries[0]), position: 2 }); source.draft.generated_query_count = 2;
    refined.draft.queries.push({ ...structuredClone(source.draft.queries[1]), params: { before: source.draft.queries[1].params.before, since: source.draft.queries[1].params.since } }); refined.draft.generated_query_count = 2;
    const result = compareHuntDraftSource(refined, source);
    expect(result.queries[1].position).toBe(2); expect(result.queries[1].edited).toBe(false);
    expect(result.queries[1].changes).toEqual([]); expect(result.queries[1].timeBoundChanges).toEqual([]);
  });
  it.each(['id', 'fingerprint', 'hypothesis', 'description', 'explanation', 'positions', 'missing_query'])('refuses a mismatched or changed source instead of substituting another one: %s', mode => {
    const { source, refined } = draftSourceFixture();
    if (mode === 'id') source.session_id = 11;
    if (mode === 'fingerprint') source.fingerprint = 'c'.repeat(64);
    if (mode === 'hypothesis') source.hypothesis = 'Different hypothesis';
    if (mode === 'description') source.draft.queries[0].description = 'Changed source description';
    if (mode === 'explanation') source.draft.explanation = 'Changed source explanation';
    if (mode === 'positions') refined.draft.refinement!.edited_query_numbers = [];
    if (mode === 'missing_query') source.draft.queries = [];
    expect(() => compareHuntDraftSource(refined, source)).toThrow();
  });
  it('requires the saved edited positions to match actual SQL/parameter differences', () => {
    const { source, refined } = draftSourceFixture();
    refined.draft.queries = structuredClone(source.draft.queries);
    expect(() => compareHuntDraftSource(refined, source)).toThrow();
  });
  it('does not infer removed bounds from a rejected source with no applied compiler contract', () => {
    const { source, refined } = draftSourceFixture();
    Object.assign(source.draft.queries[0], { sql: 'DELETE FROM security_events WHERE user_id = :user_id', params: {}, accepted: false, execution: null, time_window: {}, error: 'Unsupported write' });
    source.can_execute = false;
    const result = compareHuntDraftSource(refined, source);
    expect(result.queries[0].changes).toContain('compiler acceptance');
    expect(result.queries[0].timeBoundChanges).toEqual(['Applied time bounds cannot be compared because at least one query is compiler-rejected.']);
  });
  it('can compare an expired source without renewing its bounds or execution eligibility', () => {
    const { source, refined } = draftSourceFixture();
    source.can_execute = false; source.read_at = '2026-11-22T05:00:00Z';
    const before = structuredClone(source), result = compareHuntDraftSource(refined, source);
    expect(result.source).toEqual(before); expect(result.source.can_execute).toBe(false);
  });
  it('distinguishes a changed timestamp notation from a moved instant', () => {
    const { source, refined } = draftSourceFixture();
    refined.draft.queries[0].sql = source.draft.queries[0].sql!.replace('LIMIT 100', 'LIMIT 20');
    refined.draft.queries[0].params = { ...source.draft.queries[0].params, since: '2026-11-20T05:30:00+05:30' };
    refined.draft.queries[0].time_window = { ...source.draft.queries[0].time_window, since: '2026-11-20T05:30:00+05:30' };
    expect(compareHuntDraftSource(refined, source).queries[0].timeBoundChanges[0]).toContain('same instant');
  });
  it('labels narrowed individual bounds without claiming a narrower whole query', () => {
    const { source, refined } = draftSourceFixture();
    refined.draft.queries[0].sql = source.draft.queries[0].sql!.replace('LIMIT 100', 'LIMIT 20');
    refined.draft.queries[0].params = { since: '2026-11-21T00:00:00Z', before: '2026-11-21T23:00:00Z' };
    refined.draft.queries[0].time_window = { since: '2026-11-21T00:00:00Z', before: '2026-11-21T23:00:00Z' };
    const notes = compareHuntDraftSource(refined, source).queries[0].timeBoundChanges;
    expect(notes).toHaveLength(2); expect(notes.every(note => note.includes('narrows') && note.includes('not necessarily the whole query'))).toBe(true);
  });
  it('does not collapse distinct microsecond bounds into the same millisecond', () => {
    const { source, refined } = draftSourceFixture();
    source.draft.queries[0].params.before = '2026-11-22T00:00:00.000001Z';
    source.draft.queries[0].time_window.before = '2026-11-22T00:00:00.000001+00:00';
    refined.draft.queries[0].sql = source.draft.queries[0].sql!.replace('LIMIT 100', 'LIMIT 20');
    refined.draft.queries[0].params = { ...source.draft.queries[0].params, before: '2026-11-22T00:00:00.000002Z' };
    refined.draft.queries[0].time_window = { ...source.draft.queries[0].time_window, before: '2026-11-22T00:00:00.000002+00:00' };
    const notes = compareHuntDraftSource(refined, source).queries[0].timeBoundChanges;
    expect(notes).toHaveLength(1); expect(notes[0]).toContain('before moved later'); expect(notes[0]).toContain('widens');
  });
  it('exports both loaded drafts and all comparisons, never event results or a fabricated atomic snapshot', () => {
    const { source, refined } = draftSourceFixture(), comparison = compareHuntDraftSource(refined, source);
    const value = JSON.parse(huntDraftSourceComparisonPackage(comparison, '2026-11-22T03:20:00Z'));
    expect(value.format).toBe('onealert_hunt_draft_source_comparison_v1');
    expect(value.source).toEqual(source); expect(value.refined).toEqual(refined); expect(value.queries).toEqual(comparison.queries);
    expect(value.query_results).toBeUndefined(); expect(value.scope).toContain('Keep private'); expect(value.scope).toContain('not a semantic-equivalence');
    expect(() => huntDraftSourceComparisonPackage(comparison, 'not-a-date')).toThrow();
  });
});

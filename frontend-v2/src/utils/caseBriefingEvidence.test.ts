import { expect, it } from 'vitest';
import { verifySavedBriefing, type SavedBriefing } from './caseBriefingEvidence';
const zero = { linked: 0, available: 0, included: 0, omitted: 0, unavailable: 0, limit: 20 };
const row: SavedBriefing = { timeline_id: 11, briefing: { format: 'onealert-case-briefing', version: 1, case_id: 7, run_id: 83, mode: 'ai_draft', captured_at: '2026-11-21T18:00:00Z', scope: { alert: zero, event: { ...zero, limit: 50 } }, sources: [{ key: 'case:7', kind: 'case', id: 7, title: 'Case label' }], observations: [{ text: 'Recorded metadata only.', sources: ['case:7'] }], gaps: [], review_questions: [] } };
it.each(['a', 'अ', '😀', '𐐷'])('uses the same 400-codepoint bound as the server for %s', char => {
  const valid = { ...row, briefing: { ...row.briefing, observations: [{ text: char.repeat(400), sources: ['case:7'] }], gaps: [char.repeat(400)], review_questions: [char.repeat(400)] } };
  expect(verifySavedBriefing(valid, 7)).toBe(true);
  for (const field of ['observations', 'gaps', 'review_questions']) {
    const value = field === 'observations' ? [{ text: char.repeat(401), sources: ['case:7'] }] : [char.repeat(401)];
    expect(verifySavedBriefing({ ...valid, briefing: { ...valid.briefing, [field]: value } }, 7)).toBe(false);
  }
});
it('does not weaken type or source-reference checks while accepting supplementary Unicode', () => {
  expect(verifySavedBriefing({ ...row, briefing: { ...row.briefing, observations: [{ text: '😀', sources: ['case:8'] }] } }, 7)).toBe(false);
  expect(verifySavedBriefing({ ...row, briefing: { ...row.briefing, case_id: 8 } }, 7)).toBe(false);
});

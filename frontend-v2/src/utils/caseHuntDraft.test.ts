import { expect, it } from 'vitest';
import { caseHuntDraft } from './caseHuntDraft';
const source = { id: 7, title: 'Gateway authentication inquiry', summary: 'Repeated failure observations', severity: 'high', status: 'open', timeline: [{ private: 'Do not include' }], attack_narrative: 'Do not include', user_id: 900 };
it('bounds and separates recorded metadata from draft instructions without importing unrelated fields', () => {
  const draft = caseHuntDraft(source, 7);
  expect(draft.text).toContain('"case_id": 7'); expect(draft.text).toContain(source.title); expect(draft.text).toContain('only security telemetry accessible to this account'); expect(draft.text).not.toContain('Do not include'); expect(draft.text).not.toContain('900'); expect(draft.clipped).toBe(false);
});
it('clips source fields by Unicode code points, preserving literal markup and missing summaries', () => {
  const result = caseHuntDraft({ ...source, title: '<b>Literal</b>', summary: '😀'.repeat(1601) }, 7);
  expect(result.clipped).toBe(true); expect(result.text).toContain('<b>Literal</b>'); expect(result.text.split('😀').length - 1).toBe(1600); expect(Array.from(result.text).length).toBeLessThanOrEqual(4000);
  expect(caseHuntDraft({ ...source, summary: null }, 7).text).toContain('"summary": null');
});
it.each([null, [], { ...source, id: 8 }, { ...source, summary: {} }, { ...source, severity: null }, { ...source, status: 'a'.repeat(51) }, { ...source, summary: '\u0001'.repeat(1600) }])('rejects mismatched, malformed or oversized encoded metadata', value => {
  expect(() => caseHuntDraft(value, 7)).toThrow();
});

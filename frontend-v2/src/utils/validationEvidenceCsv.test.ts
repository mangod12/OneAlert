import { expect, it } from 'vitest';
import { validationEvidenceCsv } from './validationEvidenceCsv';
const run = { id: 8, name: 'Review', mode: 'dry_run' };
const step = { id: 0, technique_id: 'T1', test_name: 'Test', actual_result: null, duration_ms: 0 };
it('preserves steps without controls and distinguishes missing evidence from false/zero', () => {
  const csv = validationEvidenceCsv(run, [step, { ...step, simulated: false, controls: [{ id: 0, control_name: 'Guard', control_type: 'sigma', expected: false, detected: false, detection_time_ms: 0, details: 'Saved, "detail"\nline2' }] }], 'attention', 'query');
  expect(csv).toContain('"unknown"'); expect(csv).toContain('"false","false","0"');
  expect(csv).toContain('"Saved, ""detail""\nline2"'); expect(csv).toContain('"attention","query"');
  expect(csv).toContain('simulated results do not prove live detection');
});
it.each(['=1', '+cmd', '-cmd', '@cmd', '\t =1'])('neutralizes text %j in step/control/filter fields', value => {
  const csv = validationEvidenceCsv(run, [{ ...step, test_name: value, controls: [{ id: 1, control_name: value, control_type: 'test', expected: true, detected: false, detection_time_ms: null, details: value }] }], 'all', value);
  expect(csv.split(`"'${value}"`)).toHaveLength(5);
});

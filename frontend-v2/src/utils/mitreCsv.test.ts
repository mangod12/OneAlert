import { describe, expect, it } from 'vitest';
import { mitreCsv } from './mitreCsv';
const technique = { id: 'T1', name: 'A, "quoted" technique', tactics: ['TA1', 'TA2'], description: 'Line1\nLine2' };
describe('MITRE CSV snapshots', () => {
  it('preserves full text and filter scope and distinguishes recorded mappings, absent mappings and unknown', () => {
    expect(mitreCsv([technique], ['T1'], 'query', false)).toContain('"recorded_mapping","query","false"');
    expect(mitreCsv([technique], [], '', true)).toContain('"no_recorded_mapping","","true"');
    const csv = mitreCsv([technique], undefined, '', false);
    expect(csv).toContain('"unknown"');
    expect(csv).toContain('not proof of tested detection, deployment or live protection');
    expect(csv).not.toContain('"detected"');
    expect(csv).not.toContain('"gap"');
    expect(csv).toContain('"A, ""quoted"" technique"');
    expect(csv).toContain('"TA1; TA2"');
    expect(csv).toContain('"Line1\nLine2"');
  });
  it.each(['=SUM(1)', '+cmd', '-cmd', '@cmd', '\t =1', '\r@cmd'])('neutralizes spreadsheet text %j', value => {
    expect(mitreCsv([{ ...technique, name: value }], [], value, false)).toContain(`"'${value}"`);
  });
});

import { describe, expect, it } from 'vitest';
import { mitreCsv } from './mitreCsv';
const technique = { id: 'T1', name: 'A, "quoted" technique', tactics: ['TA1', 'TA2'], description: 'Line1\nLine2' };
describe('MITRE CSV snapshots', () => {
  it('preserves full text and filter scope and distinguishes detected, gap and unknown', () => {
    expect(mitreCsv([technique], ['T1'], 'query', false)).toContain('"detected","query","false"');
    expect(mitreCsv([technique], [], '', true)).toContain('"gap","","true"');
    const csv = mitreCsv([technique], undefined, '', false);
    expect(csv).toContain('"unknown"');
    expect(csv).toContain('"A, ""quoted"" technique"');
    expect(csv).toContain('"TA1; TA2"');
    expect(csv).toContain('"Line1\nLine2"');
  });
  it.each(['=SUM(1)', '+cmd', '-cmd', '@cmd', '\t =1', '\r@cmd'])('neutralizes spreadsheet text %j', value => {
    expect(mitreCsv([{ ...technique, name: value }], [], value, false)).toContain(`"'${value}"`);
  });
});

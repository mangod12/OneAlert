import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RecordedRunSteps, type RecordedStep } from './RecordedRunSteps';
vi.mock('./DetectionRunReceipt', () => ({ DetectionRunReceipt: ({ text }: { text: string }) => <p>Detection receipt: {text}</p> }));
vi.mock('./TriageGroupReceipt', () => ({ TriageGroupReceipt: ({ text }: { text: string }) => <p>Triage receipt: {text}</p> }));
const steps: RecordedStep[] = Array.from({ length: 45 }, (_, index) => ({ id: index + 1, step_number: index < 2 ? 1 : index + 1, action: index === 44 ? 'rare_action' : 'analyze', tool_used: index % 2 ? null : 'Local detector', duration_ms: index === 0 ? 0 : null, input_summary: `Input ${index + 1}`, output_summary: index === 44 ? '<b>Literal 100%_needle [x]</b>' : `Recorded output ${index + 1}` })).reverse();
const show = (rows = steps, agentType = 'hunt') => render(<RecordedRunSteps runId={7} agentType={agentType} steps={rows} />);
beforeEach(() => { vi.resetAllMocks(); URL.createObjectURL = vi.fn(() => 'blob:step-selection'); URL.revokeObjectURL = vi.fn(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('sorts tied sequence numbers by exact record ID and pages loaded evidence', () => {
  show(); const list = screen.getByRole('list', { name: 'Matching recorded steps' }); expect(list.children).toHaveLength(20); expect(list.children[0].textContent).toContain('Step record #1'); expect(list.children[1].textContent).toContain('Step record #2');
  expect(screen.getByText(/Duration: 0 ms/)).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'More matching steps' })); expect(screen.getByText('45 of 45 loaded steps match. Page 2 of 3.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'More matching steps' })); expect(list.children).toHaveLength(5); expect(screen.getByText('45. rare_action')).toBeTruthy();
});
it('searches all pages literally before paging and preserves markup as text', () => {
  show(); fireEvent.change(screen.getByLabelText('Search loaded recorded steps'), { target: { value: '100%_NEEDLE [x]' } });
  expect(screen.getByText('1 of 45 loaded steps match. Page 1 of 1.')).toBeTruthy(); expect(screen.getByText('<b>Literal 100%_needle [x]</b>').querySelector('b')).toBeNull();
  fireEvent.change(screen.getByLabelText('Recorded step search field'), { target: { value: 'input_summary' } }); expect(screen.getByText(/No loaded step summaries match/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear step filters' })); expect(screen.getByText('45 of 45 loaded steps match. Page 1 of 3.')).toBeTruthy();
});
it('combines exact action and missing/literal tool selection without inferred execution status', () => {
  show(); fireEvent.change(screen.getByLabelText('Recorded step action filter'), { target: { value: 'value:rare_action' } }); expect(screen.getByText('1 of 45 loaded steps match. Page 1 of 1.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Recorded step tool filter'), { target: { value: 'missing' } }); expect(screen.getByText(/No loaded step summaries match/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Recorded step tool filter'), { target: { value: 'value:Local detector' } }); expect(screen.getByText('45. rare_action')).toBeTruthy();
});
it('supports exact empty action labels and tool values equal to reserved control terms', () => {
  show([{ ...steps[0], action: '', tool_used: 'missing' }]); fireEvent.change(screen.getByLabelText('Recorded step action filter'), { target: { value: 'value:' } }); fireEvent.change(screen.getByLabelText('Recorded step tool filter'), { target: { value: 'value:missing' } }); expect(screen.getByText('1 of 1 loaded steps match. Page 1 of 1.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Recorded step tool filter'), { target: { value: 'missing' } }); expect(screen.getByText(/No loaded step summaries match/)).toBeTruthy();
});
it('keeps zero recorded steps separate from no filter matches and malformed data', () => {
  show([]); expect(screen.getByText(/No steps recorded in this snapshot/)).toBeTruthy(); expect(screen.queryByRole('button', { name: 'Download matching loaded steps JSON' })).toBeNull();
});
it.each([{ rows: [{ ...steps[0], id: 0 }] }, { rows: [{ ...steps[0], duration_ms: -1 }] }, { rows: [{ ...steps[0], output_summary: {} }] }, { rows: [steps[0], steps[0]] }])('fails closed for malformed or duplicate step rows', ({ rows }) => {
  show(rows as unknown as RecordedStep[]); expect(screen.getByRole('alert').textContent).toContain('malformed'); expect(screen.queryByRole('button', { name: 'Download matching loaded steps JSON' })).toBeNull();
});
it('keeps detection and triage receipt renderers inside filtered rows', () => {
  const view = show([{ ...steps[0], action: 'detection_review_receipt', output_summary: 'Saved receipt' }], 'detect'); expect(screen.getByText('Detection receipt: Saved receipt')).toBeTruthy();
  view.unmount(); show([{ ...steps[0], action: 'triage_group_outcome', output_summary: 'Saved triage' }], 'triage'); expect(screen.getByText('Triage receipt: Saved triage')).toBeTruthy();
});
it('prepares a matching selection download across pages, reports local failure and clears obsolete errors', () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {}); show(); fireEvent.change(screen.getByLabelText('Recorded step action filter'), { target: { value: 'value:analyze' } });
  fireEvent.click(screen.getByRole('button', { name: 'Download matching loaded steps JSON' })); expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob)); expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe('agent-run-7-matching-loaded-steps.json');
  vi.mocked(URL.createObjectURL).mockImplementationOnce(() => { throw Error('Local file unavailable'); }); fireEvent.click(screen.getByRole('button', { name: 'Download matching loaded steps JSON' })); expect(screen.getByRole('alert').textContent).toContain('could not be downloaded');
  fireEvent.change(screen.getByLabelText('Search loaded recorded steps'), { target: { value: 'absent' } }); expect(screen.queryByRole('alert')).toBeNull(); expect((screen.getByRole('button', { name: 'Download matching loaded steps JSON' }) as HTMLButtonElement).disabled).toBe(true);
});
it('refuses a partial download above 5000 matches but permits narrowing the same loaded records', () => {
  show(Array.from({ length: 5001 }, (_, index) => ({ ...steps[0], id: index + 1, step_number: index + 1, action: index === 5000 ? 'single' : 'many' })));
  expect((screen.getByRole('button', { name: 'Download matching loaded steps JSON' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Recorded step action filter'), { target: { value: 'value:single' } }); expect((screen.getByRole('button', { name: 'Download matching loaded steps JSON' }) as HTMLButtonElement).disabled).toBe(false); expect(screen.getByText('1 of 5001 loaded steps match. Page 1 of 1.')).toBeTruthy();
});

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChecklistCapturedComparison } from './ChecklistCapturedComparison';
import { ChecklistCapturedRows } from './ChecklistCapturedRows';
const tasks = Array.from({ length: 23 }, (_, i) => ({ id: i + 1, title: i === 22 ? '<script>literal</script>' : '', done: i === 22, position: i, due_date: i === 22 ? '2026-11-25' : null, assignee_id: i === 22 ? 99 : null }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('compares exact typed saved fields with null and empty distinctions, literal text and non-history caveat', () => {
 const clear = vi.fn(); render(<ChecklistCapturedComparison tasks={tasks} baselineId={1} comparisonId={23} onClear={clear} />);
 expect(screen.getByText('Saved title: Different saved values')).toBeTruthy(); expect(screen.getByText('Completed state: Different saved values')).toBeTruthy(); expect(screen.getByText('(Empty saved value)')).toBeTruthy(); expect(screen.getAllByText('(Not recorded)')).toHaveLength(2); expect(screen.getByText('<script>literal</script>')).toBeTruthy(); expect(document.querySelector('script')).toBeNull(); expect(screen.getByText(/not an older version/)).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Clear captured checklist comparison' })); expect(clear).toHaveBeenCalledOnce();
});
it('keeps ordered selection across inspection pages and search, blocks a third task and supports remove/clear', () => {
 render(<ChecklistCapturedRows tasks={tasks} />); fireEvent.click(screen.getByRole('button', { name: 'Compare captured checklist task 1' })); fireEvent.click(screen.getByRole('button', { name: 'Next captured checklist tasks' })); fireEvent.click(screen.getByRole('button', { name: 'Next captured checklist tasks' })); fireEvent.click(screen.getByRole('button', { name: 'Compare captured checklist task 23' }));
 expect(screen.getByRole('region', { name: 'Captured checklist task comparison' }).textContent).toContain('Captured task #1 compared with #23'); expect(screen.getByRole('button', { name: 'Compare captured checklist task 21' })).toHaveProperty('disabled', true);
 fireEvent.change(screen.getByLabelText('Find within captured checklist tasks'), { target: { value: 'no match' } }); expect(screen.getByRole('region', { name: 'Captured checklist task comparison' })).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Find within captured checklist tasks'), { target: { value: 'literal' } }); fireEvent.click(screen.getByRole('button', { name: 'Compare captured checklist task 23' })); expect(screen.queryByRole('region', { name: 'Captured checklist task comparison' })).toBeNull(); expect(screen.getByText('Task comparison selection: baseline #1.')).toBeTruthy();
 fireEvent.click(screen.getByRole('button', { name: 'Clear checklist comparison selection' })); expect(screen.getByText('Task comparison selection: none.')).toBeTruthy(); expect(tasks).toHaveLength(23);
});
it('does not compare a task to itself or substitute an unavailable captured task', () => {
 const view = render(<ChecklistCapturedComparison tasks={tasks} baselineId={1} comparisonId={1} onClear={() => {}} />); expect(view.container.innerHTML).toBe(''); view.rerender(<ChecklistCapturedComparison tasks={tasks} baselineId={1} comparisonId={99} onClear={() => {}} />); expect(view.container.innerHTML).toBe('');
});
it('uses exact saved values rather than inferring distinct tasks have different fields', () => {
 render(<ChecklistCapturedComparison tasks={[tasks[0], { ...tasks[0], id: 24 }]} baselineId={1} comparisonId={24} onClear={() => {}} />); expect(screen.getAllByText(/Same saved value/)).toHaveLength(5);
});

it('focuses exact typed differences, keeps false and null values and restores equal fields', () => {
 const data = [tasks[0], { ...tasks[0], id: 24, done: true, assignee_id: 0 }], before = JSON.stringify(data);
 render(<ChecklistCapturedComparison tasks={data} baselineId={1} comparisonId={24} onClear={() => {}} />);
 expect(screen.getByRole('status').textContent).toContain('2 of 5 captured task fields differ.');
 fireEvent.click(screen.getByRole('button', { name: 'Show only different captured task fields' }));
 expect(screen.getByRole('button', { name: 'Show only different captured task fields' }).getAttribute('aria-pressed')).toBe('true');
 expect(screen.queryByText('Saved title: Same saved value')).toBeNull(); expect(screen.getByText('Completed state: Different saved values')).toBeTruthy(); expect(screen.getByText('false')).toBeTruthy(); expect(screen.getByText('0')).toBeTruthy(); expect(screen.getByText('(Not recorded)')).toBeTruthy();
 fireEvent.click(screen.getByRole('button', { name: 'Show only different captured task fields' })); expect(screen.getByText('Saved title: Same saved value')).toBeTruthy(); expect(JSON.stringify(data)).toBe(before);
});
it('swaps viewing sides while preserving field focus and original selection', () => {
 render(<ChecklistCapturedComparison tasks={tasks} baselineId={1} comparisonId={23} onClear={() => {}} />);
 fireEvent.click(screen.getByRole('button', { name: 'Show only different captured task fields' })); fireEvent.click(screen.getByRole('button', { name: 'Swap captured task comparison sides' }));
 expect(screen.getByText('Captured task #23 compared with #1')).toBeTruthy(); expect(screen.getAllByText('Baseline #23')).toHaveLength(5); expect(screen.getAllByText('Comparison #1')).toHaveLength(5);
 fireEvent.click(screen.getByRole('button', { name: 'Swap captured task comparison sides' })); expect(screen.getByText('Captured task #1 compared with #23')).toBeTruthy();
});
it('explains equal fields without claiming two distinct tasks are equivalent', () => {
 render(<ChecklistCapturedComparison tasks={[tasks[0], { ...tasks[0], id: 24 }]} baselineId={1} comparisonId={24} onClear={() => {}} />);
 fireEvent.click(screen.getByRole('button', { name: 'Show only different captured task fields' }));
 expect(screen.getByRole('status').textContent).toContain('0 of 5 captured task fields differ.'); expect(screen.getByText(/No different saved task fields/).textContent).toContain('not duplicate work or equivalent remediation'); expect(screen.queryByText('Saved title: Same saved value')).toBeNull();
});
it('retains focused swapped comparison through zero inspection matches and clears explicitly', () => {
 render(<ChecklistCapturedRows tasks={tasks} />); fireEvent.click(screen.getByRole('button', { name: 'Compare captured checklist task 1' })); fireEvent.click(screen.getByRole('button', { name: 'Compare captured checklist task 2' }));
 fireEvent.click(screen.getByRole('button', { name: 'Show only different captured task fields' })); fireEvent.click(screen.getByRole('button', { name: 'Swap captured task comparison sides' })); fireEvent.change(screen.getByLabelText('Find within captured checklist tasks'), { target: { value: 'no-match' } });
 expect(screen.getByText('Captured task #2 compared with #1')).toBeTruthy(); expect(screen.getByText('Task comparison selection: baseline #1; comparison #2.')).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Clear captured checklist comparison' })); expect(screen.queryByRole('region', { name: 'Captured checklist task comparison' })).toBeNull();
});

it('downloads displayed frozen tasks including equal fields despite difference focus and keeps review open', async () => {
 const blobs: Blob[] = []; vi.stubGlobal('URL', { createObjectURL: vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:tasks'; }), revokeObjectURL: vi.fn() }); const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(this: HTMLAnchorElement) { expect(this.download).toBe('captured-checklist-comparison-23-1.json'); }); const before = JSON.stringify(tasks);
 render(<ChecklistCapturedComparison tasks={tasks} baselineId={1} comparisonId={23} onClear={() => {}} />); expect(blobs).toHaveLength(0); fireEvent.click(screen.getByRole('button', { name: 'Swap captured task comparison sides' })); fireEvent.click(screen.getByRole('button', { name: 'Show only different captured task fields' })); fireEvent.click(screen.getByRole('button', { name: 'Download captured task comparison JSON' })); expect(click).toHaveBeenCalledOnce(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:tasks'); expect(blobs[0].type).toBe('application/json;charset=utf-8');
 const text = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blobs[0]); }); const value = JSON.parse(text); expect(value.baseline.task_id).toBe(23); expect(value.comparison.task_id).toBe(1); expect(value.baseline.completed).toBe(true); expect(value.comparison.completed).toBe(false); expect(value.comparison.due_date).toBeNull(); expect(value.baseline.assignee_id).toBe(99); expect(value.baseline.title).toBe('<script>literal</script>'); expect(screen.getByRole('region', { name: 'Captured checklist task comparison' }).textContent).toContain('#23 compared with #1'); expect(JSON.stringify(tasks)).toBe(before);
});

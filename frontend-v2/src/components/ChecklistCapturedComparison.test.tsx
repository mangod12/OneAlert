import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChecklistCapturedComparison } from './ChecklistCapturedComparison';
import { ChecklistCapturedRows } from './ChecklistCapturedRows';
const tasks = Array.from({ length: 23 }, (_, i) => ({ id: i + 1, title: i === 22 ? '<script>literal</script>' : '', done: i === 22, position: i, due_date: i === 22 ? '2026-11-25' : null, assignee_id: i === 22 ? 99 : null }));
afterEach(cleanup);
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

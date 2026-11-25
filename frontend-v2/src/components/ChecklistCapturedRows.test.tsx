import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ChecklistCapturedRows } from './ChecklistCapturedRows';
afterEach(cleanup);
const tasks = Array.from({ length: 23 }, (_, i) => ({ id: i + 1, title: i === 22 ? '<script>Unique literal</script>' : `Task ${i + 1}`, done: i === 22, position: i, due_date: i === 22 ? '2026-11-25' : null, assignee_id: i === 22 ? 99 : null }));
it('pages frozen tasks in captured order and keeps the export count explicit', () => {
 render(<ChecklistCapturedRows tasks={tasks} />); expect(screen.getByRole('list').children).toHaveLength(10);
 expect(screen.getByText(/Captured tasks 1-10 of 23/)).toBeTruthy();
 expect(screen.getByRole('button', { name: 'Previous captured checklist tasks' })).toHaveProperty('disabled', true);
 fireEvent.click(screen.getByRole('button', { name: 'Next captured checklist tasks' })); fireEvent.click(screen.getByRole('button', { name: 'Next captured checklist tasks' }));
 expect(screen.getByText(/Captured tasks 21-23 of 23/)).toBeTruthy(); expect(screen.getByRole('list').children).toHaveLength(3);
 expect(screen.getByRole('button', { name: 'Next captured checklist tasks' })).toHaveProperty('disabled', true);
});
it.each(['UNIQUE LITERAL', 'completed', '2026-11-25', '99'])('searches all captured pages for literal metadata %s and resets inspection to page1', query => {
 render(<ChecklistCapturedRows tasks={tasks} />); fireEvent.click(screen.getByRole('button', { name: 'Next captured checklist tasks' }));
 fireEvent.change(screen.getByLabelText('Find within captured checklist tasks'), { target: { value: query } });
 expect(screen.getByText(/Captured tasks 1-1 of 1 inspection matches; 23 tasks remain/)).toBeTruthy(); expect(screen.getByRole('list').textContent).toContain('#23: <script>Unique literal</script>'); expect(document.querySelector('script')).toBeNull();
 expect(tasks).toHaveLength(23); expect(tasks[22].title).toBe('<script>Unique literal</script>');
});
it('handles zero matches without claiming an empty export, then clears to the full frozen list', () => {
 render(<ChecklistCapturedRows tasks={tasks} />); fireEvent.change(screen.getByLabelText('Find within captured checklist tasks'), { target: { value: 'not present' } });
 expect(screen.getByText(/Captured tasks 0-0 of 0 inspection matches; 23 tasks remain/)).toBeTruthy(); expect(screen.getByText(/reviewed export is unchanged/)).toBeTruthy(); expect(screen.getByRole('list').children).toHaveLength(0);
 fireEvent.click(screen.getByRole('button', { name: 'Clear captured checklist search' })); expect(screen.getByText(/Captured tasks 1-10 of 23/)).toBeTruthy();
});
it('matches explicit unassigned and empty due markers without account-name inference', () => {
 render(<ChecklistCapturedRows tasks={tasks} />); fireEvent.change(screen.getByLabelText('Find within captured checklist tasks'), { target: { value: 'unassigned' } }); expect(screen.getByText(/of 22 inspection matches; 23 tasks remain/)).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Find within captured checklist tasks'), { target: { value: 'not set' } }); expect(screen.getByText(/of 22 inspection matches; 23 tasks remain/)).toBeTruthy();
});

it('counts all captured tasks independently of pages/search and drills exact categories without changing export', () => {
 render(<ChecklistCapturedRows tasks={tasks} />); fireEvent.click(screen.getByRole('button', { name: 'Next captured checklist tasks' })); fireEvent.click(screen.getByRole('button', { name: 'Explore captured checklist composition' })); const region = screen.getByRole('region', { name: 'Captured checklist composition' }); expect(within(region).getByRole('button', { name: 'Completion: Open · 22 tasks' })).toBeTruthy(); fireEvent.click(within(region).getByRole('button', { name: 'Recorded assignee: #99 · 1 task' })); expect(screen.getByRole('list').children).toHaveLength(1); expect(screen.getByRole('list').textContent).toContain('#23:');
 fireEvent.change(screen.getByLabelText('Find within captured checklist tasks'), { target: { value: 'Task 1' } }); expect(screen.getByRole('list').children).toHaveLength(0); expect(within(region).getByRole('button', { name: 'Raw due date: (Not set) · 22 tasks' })).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'Clear captured checklist category' })); expect(screen.getByRole('list').children).toHaveLength(10); expect(screen.getByText(/23 tasks remain in the reviewed export/)).toBeTruthy();
});
it('distinguishes missing empty and invalid raw due strings without assigning deadlines', () => {
 render(<ChecklistCapturedRows tasks={[tasks[0], { ...tasks[1], due_date: '' }, { ...tasks[2], due_date: 'not-a-date' }]} />); fireEvent.click(screen.getByRole('button', { name: 'Explore captured checklist composition' })); const region = screen.getByRole('region', { name: 'Captured checklist composition' }); fireEvent.click(within(region).getByRole('button', { name: 'Raw due date: (Empty saved value) · 1 task' })); expect(screen.getByRole('list').textContent).toContain('#2:'); expect(screen.getByRole('list').children).toHaveLength(1); fireEvent.click(within(region).getByRole('button', { name: 'Raw due date: not-a-date · 1 task' })); expect(screen.getByRole('list').textContent).toContain('#3:'); fireEvent.click(within(region).getByRole('button', { name: 'Raw due date: (Not set) · 1 task' })); expect(screen.getByRole('list').textContent).toContain('#1:');
});
it('keeps cross-category comparison selection unchanged when drilling composition', () => {
 render(<ChecklistCapturedRows tasks={tasks} />); fireEvent.click(screen.getByRole('button', { name: 'Compare captured checklist task 1' })); fireEvent.click(screen.getByRole('button', { name: 'Next captured checklist tasks' })); fireEvent.click(screen.getByRole('button', { name: 'Next captured checklist tasks' })); fireEvent.click(screen.getByRole('button', { name: 'Compare captured checklist task 23' })); fireEvent.click(screen.getByRole('button', { name: 'Explore captured checklist composition' })); fireEvent.click(screen.getByRole('button', { name: 'Completion: Open · 22 tasks' })); expect(screen.getByRole('region', { name: 'Captured checklist task comparison' }).textContent).toContain('#23'); expect(screen.getByText(/Task comparison selection: baseline #1; comparison #23/)).toBeTruthy();
});

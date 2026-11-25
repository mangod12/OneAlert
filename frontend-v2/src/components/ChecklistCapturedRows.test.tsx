import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

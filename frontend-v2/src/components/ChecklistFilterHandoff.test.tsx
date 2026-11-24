import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChecklistFilterHandoff } from './ChecklistFilterHandoff';
import { defaultChecklistFilters } from '../utils/checklistTriage';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('copies only explicit filter scope and translates mine to the exact current account', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  window.history.replaceState({}, '', '/app/cases/7?note=1&token=private#secret');
  render(<ChecklistFilterHandoff caseId={7} filters={{ ...defaultChecklistFilters, assignee: 'mine', query: 'host & endpoint' }} currentUserId={99} disabled={false} />);
  expect(writeText).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button')); await screen.findByText(/link copied/);
  const url = new URL(writeText.mock.calls[0][0]); expect(url.pathname).toBe('/app/cases/7'); expect(url.searchParams.get('checklist_assignee')).toBe('99'); expect(url.searchParams.get('checklist_query')).toBe('host & endpoint'); expect(url.searchParams.has('note')).toBe(false); expect(url.searchParams.has('token')).toBe(false); expect(url.hash).toBe('');
});
it('labels copy failure and refuses unresolved mine', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(Error('denied')) } });
  const view = render(<ChecklistFilterHandoff caseId={7} filters={defaultChecklistFilters} currentUserId={null} disabled={false} />);
  fireEvent.click(screen.getByRole('button')); await screen.findByText(/could not be copied/);
  view.rerender(<ChecklistFilterHandoff caseId={7} filters={{ ...defaultChecklistFilters, assignee: 'mine' }} currentUserId={null} disabled={false} />);
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
});
it('disables copying incomplete or reversed fixed date windows', () => {
  const { rerender } = render(<ChecklistFilterHandoff caseId={7} filters={{ ...defaultChecklistFilters, due: 'range' }} currentUserId={5} disabled={false} />);
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  rerender(<ChecklistFilterHandoff caseId={7} filters={{ ...defaultChecklistFilters, due: 'range', dueFrom: '2026-11-24', dueTo: '2026-11-20' }} currentUserId={5} disabled={false} />);
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
});

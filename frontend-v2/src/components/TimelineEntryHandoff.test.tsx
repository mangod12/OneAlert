import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TimelineEntryHandoff } from './TimelineEntryHandoff';
const writeText = vi.fn();
beforeEach(() => { writeText.mockReset().mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } }); window.history.replaceState(null, '', '/app/cases/7?task=22&note=99&secret=sensitive#fragment'); });
afterEach(cleanup);
it('copies only the exact saved investigation and entry with no ambient query or fragment', async () => {
  render(<TimelineEntryHandoff caseId={7} entryId={4} />);
  expect(screen.getByText('Entry #4 link')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Entry #4 link'));
  fireEvent.click(screen.getByRole('button', { name: 'Copy exact timeline entry link' }));
  await screen.findByText(/Exact timeline entry link copied/);
  expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/app/cases/7?note=4`);
  expect(screen.getByRole('link', { name: 'Open exact entry #4' })).toHaveAttribute('href', '/app/cases/7?note=4');
  expect(screen.getByText(/not note text, search criteria or unsaved edits/)).toBeInTheDocument();
  expect(screen.getByText(/not a frozen copy or edit history/)).toBeInTheDocument();
});
it('shows an honest fallback link without claiming a copy when clipboard rejects', async () => {
  writeText.mockRejectedValue(new Error('denied'));
  render(<TimelineEntryHandoff caseId={7} entryId={45} />);
  fireEvent.click(screen.getByText('Entry #45 link'));
  fireEvent.click(screen.getByRole('button', { name: 'Copy exact timeline entry link' }));
  await screen.findByText('Copy unavailable. Use the exact entry link below.');
  expect(screen.queryByText(/Exact timeline entry link copied/)).toBeNull();
  expect(screen.getByRole('link')).toHaveAttribute('href', '/app/cases/7?note=45');
});
it('supports a browser without clipboard through its visible exact link', async () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  render(<TimelineEntryHandoff caseId={7} entryId={4} />);
  fireEvent.click(screen.getByText('Entry #4 link'));
  fireEvent.click(screen.getByRole('button'));
  await screen.findByText('Copy unavailable. Use the exact entry link below.');
});
it.each([[0, 4], [7, -1], [1.5, 4], [7, Number.MAX_SAFE_INTEGER + 1], [NaN, 4]])('does not create misleading or invalid entry links %s/%s', (caseId, entryId) => {
  const { container } = render(<TimelineEntryHandoff caseId={caseId} entryId={entryId} />);
  expect(container).toBeEmptyDOMElement();
});

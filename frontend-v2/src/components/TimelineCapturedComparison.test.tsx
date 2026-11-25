import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TimelineCapturedComparison } from './TimelineCapturedComparison';
import { TimelineCapturedRows } from './TimelineCapturedRows';
const rows = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, timestamp: i === 11 ? '2026-11-25T00:00:00+00:00' : '2026-11-25T00:00:00Z', entry_type: 'note', source: 'human', author_email: i === 11 ? '' : null, content: i === 11 ? '<script>alert(1)</script>' : 'Original literal text' }));
afterEach(cleanup);
it('compares exact raw exported values, distinguishes null/empty, renders saved text as text and labels selection not chronology', () => {
  const clear = vi.fn(); render(<TimelineCapturedComparison rows={rows} baselineId={1} comparisonId={12} onClear={clear} />);
  expect(screen.getByText('Raw timestamp: Different saved values')).toBeInTheDocument();
  expect(screen.getByText('Type: Same saved value')).toBeInTheDocument();
  expect(screen.getByText('(Not recorded)')).toBeInTheDocument(); expect(screen.getByText('(Empty saved value)')).toBeInTheDocument();
  expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument(); expect(document.querySelector('script')).toBeNull();
  expect(screen.getByText(/not an earlier event or previous version/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear captured comparison' })); expect(clear).toHaveBeenCalledOnce();
});
it('retains cross-page selection through search changes, blocks a third selection and supports removal and clear', () => {
  render(<TimelineCapturedRows rows={rows} />); fireEvent.click(screen.getByText('Inspect captured matching rows (12)'));
  fireEvent.click(screen.getByRole('button', { name: 'Compare captured entry 1' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next captured rows' }));
  fireEvent.click(screen.getByRole('button', { name: 'Compare captured entry 12' }));
  expect(screen.getByRole('region', { name: 'Captured timeline entry comparison' })).toHaveTextContent('Captured entry #1 compared with #12');
  expect(screen.getByRole('button', { name: 'Compare captured entry 11' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Find within captured rows'), { target: { value: 'No matches' } });
  expect(screen.getByRole('region')).toHaveTextContent('Captured entry #1 compared with #12');
  fireEvent.change(screen.getByLabelText('Find within captured rows'), { target: { value: '12' } });
  fireEvent.click(screen.getByRole('button', { name: 'Compare captured entry 12' }));
  expect(screen.queryByRole('region')).toBeNull();
  expect(screen.getByText('Comparison selection: baseline #1.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear comparison selection' }));
  expect(screen.getByText('Comparison selection: none.')).toBeInTheDocument();
});
it('cannot compare the same or unavailable captured entry and never substitutes a current row', () => {
  const view = render(<TimelineCapturedComparison rows={rows} baselineId={1} comparisonId={1} onClear={() => {}} />); expect(view.container).toBeEmptyDOMElement();
  view.rerender(<TimelineCapturedComparison rows={rows} baselineId={1} comparisonId={99} onClear={() => {}} />); expect(view.container).toBeEmptyDOMElement();
});

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TimelineCapturedComparison } from './TimelineCapturedComparison';
import { TimelineCapturedRows } from './TimelineCapturedRows';
const rows = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, timestamp: i === 11 ? '2026-11-25T00:00:00+00:00' : '2026-11-25T00:00:00Z', entry_type: 'note', source: 'human', author_email: i === 11 ? '' : null, content: i === 11 ? '<script>alert(1)</script>' : 'Original literal text' }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
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

it('focuses exact raw differences and restores same fields without changing input values', () => {
  const before = JSON.stringify(rows); render(<TimelineCapturedComparison rows={rows} baselineId={1} comparisonId={12} onClear={() => {}} />);
  expect(screen.getByRole('status')).toHaveTextContent('3 of 5 captured fields differ.');
  fireEvent.click(screen.getByRole('button', { name: 'Show only different captured fields' }));
  expect(screen.getByRole('button', { name: 'Show only different captured fields' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByText('Type: Same saved value')).toBeNull(); expect(screen.queryByText('Source: Same saved value')).toBeNull();
  expect(screen.getByText('Raw timestamp: Different saved values')).toBeInTheDocument();
  expect(screen.getByText('Recorded author: Different saved values')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show only different captured fields' })); expect(screen.getByText('Type: Same saved value')).toBeInTheDocument();
  expect(JSON.stringify(rows)).toBe(before);
});
it('swaps baseline and comparison labels without changing selected entries or hiding differences', () => {
  render(<TimelineCapturedComparison rows={rows} baselineId={1} comparisonId={12} onClear={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show only different captured fields' }));
  fireEvent.click(screen.getByRole('button', { name: 'Swap captured comparison sides' }));
  expect(screen.getByText('Captured entry #12 compared with #1')).toBeInTheDocument();
  expect(screen.getAllByText('Baseline #12')).toHaveLength(3); expect(screen.getAllByText('Comparison #1')).toHaveLength(3);
  expect(screen.getByRole('status')).toHaveTextContent('3 of 5 captured fields differ. Only different saved fields shown.');
  fireEvent.click(screen.getByRole('button', { name: 'Swap captured comparison sides' })); expect(screen.getByText('Captured entry #1 compared with #12')).toBeInTheDocument();
});
it('explains an equal-field comparison without treating distinct entry identities as duplicates', () => {
  render(<TimelineCapturedComparison rows={rows} baselineId={1} comparisonId={2} onClear={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show only different captured fields' }));
  expect(screen.getByRole('status')).toHaveTextContent('0 of 5 captured fields differ.');
  expect(screen.getByText(/No different saved fields/)).toHaveTextContent('not duplicate evidence or equivalent events');
  expect(screen.queryByText('Type: Same saved value')).toBeNull();
});
it('keeps selection through focused reversed comparison when inspection text has no matches', () => {
  render(<TimelineCapturedRows rows={rows} />); fireEvent.click(screen.getByText('Inspect captured matching rows (12)'));
  fireEvent.click(screen.getByRole('button', { name: 'Compare captured entry 1' })); fireEvent.click(screen.getByRole('button', { name: 'Compare captured entry 2' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show only different captured fields' })); fireEvent.click(screen.getByRole('button', { name: 'Swap captured comparison sides' }));
  fireEvent.change(screen.getByLabelText('Find within captured rows'), { target: { value: 'unmatched' } });
  expect(screen.getByText('Captured entry #2 compared with #1')).toBeInTheDocument(); expect(screen.getByText('Comparison selection: baseline #1; comparison #2.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear captured comparison' })); expect(screen.queryByRole('region', { name: 'Captured timeline entry comparison' })).toBeNull();
});

it('downloads displayed frozen sides with all raw fields despite difference focus and keeps review open', async () => {
 const blobs: Blob[] = []; vi.stubGlobal('URL', { createObjectURL: vi.fn((blob: Blob) => { blobs.push(blob); return 'blob:comparison'; }), revokeObjectURL: vi.fn() }); const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(this: HTMLAnchorElement) { expect(this.download).toBe('captured-timeline-comparison-12-1.json'); }); const before = JSON.stringify(rows);
 render(<TimelineCapturedComparison rows={rows} baselineId={1} comparisonId={12} onClear={() => {}} />); expect(blobs).toHaveLength(0); fireEvent.click(screen.getByRole('button', { name: 'Swap captured comparison sides' })); fireEvent.click(screen.getByRole('button', { name: 'Show only different captured fields' })); fireEvent.click(screen.getByRole('button', { name: 'Download captured comparison JSON' })); expect(click).toHaveBeenCalledOnce(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:comparison'); expect(blobs[0].type).toBe('application/json;charset=utf-8');
 const text = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blobs[0]); }); const value = JSON.parse(text); expect(value.baseline.entry_id).toBe(12); expect(value.comparison.entry_id).toBe(1); expect(value.baseline.recorded_author).toBe(''); expect(value.comparison.recorded_author).toBeNull(); expect(value.baseline.entry_type).toBe('note'); expect(value.baseline.content).toBe('<script>alert(1)</script>'); expect(value.different_fields).toEqual(['timestamp', 'author_email', 'content']); expect(screen.getByRole('region')).toHaveTextContent('#12 compared with #1'); expect(JSON.stringify(rows)).toBe(before);
});

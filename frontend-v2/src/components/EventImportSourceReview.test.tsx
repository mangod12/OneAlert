import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { EventImportSourceReview } from './EventImportSourceReview';
import type { ImportReceipt } from '../utils/eventImportReceipt';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const receipt = (): ImportReceipt => ({ filename: 'journal.ndjson', parser: 'linux_journal', received_at: '2026-11-22T06:00:00Z', result: { received: 1, ingested: 1, skipped: 0, source_id: 7 } });
const profile = () => ({ source: { id: 7, name: 'Retained source, not a batch', source_type: 'linux_journal', status: 'active', event_count: 20, last_event_at: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' }, retained_event_count: 2, first_observed_at: '2026-01-01T00:00:00Z', last_observed_at: '2026-01-01T00:00:00Z', first_created_at: '2026-01-01T00:00:00Z', last_created_at: '2026-01-01T00:00:00Z', nonempty_field_counts: { source_ip: 0, dest_ip: 0, hostname: 2, username: 0, domain: 0 }, groups: { severity: [{ value: 'info', count: 2 }], event_type: [{ value: 'linux_journal', count: 2 }], source_type: [{ value: 'linux_journal', count: 2 }], processed: [{ value: 'pending', count: 2 }] }, retrieved_at: '2026-11-22T06:01:00Z', scope: 'Current retained source evidence, not this import batch' });
const show = () => fireEvent.click(screen.getByRole('button', { name: 'Show source investigation tools' }));
async function read() { fireEvent.click(screen.getByRole('button', { name: 'Read recorded source profile' })); await screen.findByText('Retained owned events: 2'); }
beforeEach(() => { get.mockReset(); get.mockResolvedValue({ data: profile() }); });
afterEach(cleanup);
it('offers a positive exact-source new-tab link and keeps reads behind explicit tools and read actions', async () => {
  render(<EventImportSourceReview receipt={receipt()} />);
  const link = screen.getByRole('link', { name: 'Open source #7 events in a new tab' });
  expect(link).toHaveAttribute('href', '/app/events?source_id=7'); expect(link).toHaveAttribute('target', '_blank'); expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.getByText(/not an exact upload batch/)).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Read recorded source profile' })).not.toBeInTheDocument(); expect(get).not.toHaveBeenCalled();
  const button = screen.getByRole('button', { name: 'Show source investigation tools' }); show(); expect(button).toHaveAttribute('aria-expanded', 'true'); expect(document.getElementById(button.getAttribute('aria-controls')!)).toBeVisible(); expect(get).not.toHaveBeenCalled();
  await read(); expect(get).toHaveBeenCalledExactlyOnceWith('/events/sources/7/recorded-evidence'); expect(screen.getByText("Source's recorded counter: 20")).toBeInTheDocument(); expect(screen.getByText(/not proof of data loss/)).toBeInTheDocument();
});
it.each([undefined, null, 0, -1, NaN, Infinity, 1.5, '7', {}, 2147483648, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1])('does not create a guessed or malformed source action from %s', source => {
  const value = receipt(); value.result = { ...value.result, source_id: source as number }; render(<EventImportSourceReview receipt={value} />);
  expect(screen.queryByRole('link')).not.toBeInTheDocument(); expect(screen.queryByRole('button')).not.toBeInTheDocument(); expect(screen.getByText(/No usable positive source ID/)).toBeInTheDocument(); expect(get).not.toHaveBeenCalled();
});
it('does not hide an all-skipped or missing-counter response behind an assumed successful import', () => {
  const value = receipt(); value.result = { source_id: 7, ingested: 0, skipped: 1 }; const view = render(<EventImportSourceReview receipt={value} />);
  expect(screen.getByRole('link')).toBeInTheDocument(); expect(screen.getByText(/do not independently prove this import committed/)).toBeInTheDocument();
  view.rerender(<EventImportSourceReview receipt={{ ...value, result: { source_id: 7 } }} />); expect(screen.getByRole('link')).toBeInTheDocument(); expect(get).not.toHaveBeenCalled();
});
it('hiding tools drops the loaded profile and reopening does not reread or restore it', async () => {
  render(<EventImportSourceReview receipt={receipt()} />); show(); await read(); fireEvent.click(screen.getByRole('button', { name: 'Hide source investigation tools' })); expect(screen.queryByText('Retained owned events: 2')).not.toBeInTheDocument(); show(); expect(screen.queryByText('Retained owned events: 2')).not.toBeInTheDocument(); expect(get).toHaveBeenCalledTimes(1);
});
it('ties open tools to the response object even when replacement metadata has the same filename, source, parser and time', async () => {
  const value = receipt(), view = render(<EventImportSourceReview receipt={value} />); show(); await read(); view.rerender(<EventImportSourceReview receipt={{ ...value, result: { ...value.result } }} />);
  expect(screen.queryByText('Retained owned events: 2')).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Show source investigation tools' })).toHaveAttribute('aria-expanded', 'false'); expect(get).toHaveBeenCalledTimes(1);
});
it('clears prior source context when a new response reports another source or no source', async () => {
  const value = receipt(), view = render(<EventImportSourceReview receipt={value} />); show(); await read(); view.rerender(<EventImportSourceReview receipt={{ ...value, result: { source_id: 8 } }} />); expect(screen.queryByText('Retained owned events: 2')).not.toBeInTheDocument(); expect(screen.getByRole('link')).toHaveAttribute('href', '/app/events?source_id=8');
  view.rerender(<EventImportSourceReview receipt={{ ...value, result: {} }} />); expect(screen.queryByRole('link')).not.toBeInTheDocument(); expect(get).toHaveBeenCalledTimes(1);
});
it('ignores a profile reply after hiding or replacing the response rather than attaching it to new context', async () => {
  let resolve!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(done => { resolve = done; })); const value = receipt(), view = render(<EventImportSourceReview receipt={value} />); show(); fireEvent.click(screen.getByRole('button', { name: 'Read recorded source profile' }));
  view.rerender(<EventImportSourceReview receipt={{ ...value, result: { source_id: 8 } }} />); await act(async () => resolve({ data: profile() })); show(); expect(screen.queryByText('Retained owned events: 2')).not.toBeInTheDocument(); expect(get).toHaveBeenCalledTimes(1);
});
it('refuses a wrong-source profile and keeps failure distinct from an empty upload result', async () => {
  get.mockResolvedValue({ data: { ...profile(), source: { ...profile().source, id: 8 } } }); render(<EventImportSourceReview receipt={receipt()} />); show(); fireEvent.click(screen.getByRole('button', { name: 'Read recorded source profile' })); expect(await screen.findByRole('alert')).toHaveTextContent('did not match this source'); expect(screen.queryByText('Retained owned events: 2')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Download loaded source profile JSON' })).not.toBeInTheDocument();
});
it('reuses exact-label investigation only after a separate explicit action and preserves prior source totals', async () => {
  render(<EventImportSourceReview receipt={receipt()} />); show(); await read(); get.mockRejectedValueOnce(Error('unavailable')); fireEvent.click(screen.getByRole('button', { name: "Read this exact label's events" })); expect(await screen.findByRole('alert')).toHaveTextContent('No absence'); expect(get).toHaveBeenLastCalledWith('/events/sources/7/group-events', { params: { group: 'severity', value: 'info', page: 1, size: 10 } }); expect(screen.getByText('Retained owned events: 2')).toBeInTheDocument();
});
it('does not read the timeline merely by showing tools or reading the source profile', async () => {
  render(<EventImportSourceReview receipt={receipt()} />); show(); await read(); expect(screen.getByRole('button', { name: 'Read saved observation distribution' })).toBeInTheDocument(); expect(get).toHaveBeenCalledTimes(1);
});

it('keeps the largest supported source-only route ID exact rather than rounding or broadening it', () => {
  const value = receipt(); value.result.source_id = 2147483647; render(<EventImportSourceReview receipt={value} />); expect(screen.getByRole('link')).toHaveAttribute('href', '/app/events?source_id=2147483647'); expect(get).not.toHaveBeenCalled();
});

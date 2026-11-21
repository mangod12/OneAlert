import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { CaseEvidenceChronology } from './CaseEvidenceChronology';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const row = { kind: 'alert', id: 100, label: 'Saved gateway finding', severity: 'high', recorded_at: '2026-11-21T10:00:00Z', can_open_original: true };
const fixture = { case_id: 7, kind: 'all', severity: 'all', order: 'oldest', page: 1, size: 10, total: 2, counts: { alert: { available: 1, unavailable: 2 }, event: { available: 1, unavailable: 0 } }, records: [row, { ...row, kind: 'event', recorded_at: '2026-11-21T10:01:00Z' }], retrieved_at: '2026-11-21T11:00:00Z' };
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Load evidence chronology' }));
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: fixture }); });
afterEach(cleanup);
it('loads only on request, combines distinct kind/ID records, explains clocks and has no mutations', async () => {
  render(<CaseEvidenceChronology caseId={7} />); expect(get).not.toHaveBeenCalled(); open();
  await screen.findByText('2 matching linked records');
  expect(screen.getByText(/do not establish attack sequence/)).toBeTruthy();
  expect(screen.getByText(/2 unavailable linked references excluded/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Open original alert #100' }).getAttribute('href')).toBe('/app/alerts?alert=100');
  expect(screen.getByRole('link', { name: 'Open original event #100' }).getAttribute('href')).toBe('/app/events/100');
  expect(get).toHaveBeenCalledWith('/cases/7/evidence-chronology', { params: { kind: 'all', severity: 'all', order: 'oldest', page: 1, size: 10 } });
  expect(apiClient.post).not.toHaveBeenCalled(); expect(apiClient.patch).not.toHaveBeenCalled();
});
it('applies kind, severity and order filters without retaining stale rows', async () => {
  render(<CaseEvidenceChronology caseId={7} />); open(); await screen.findByText('2 matching linked records');
  const filtered = { ...fixture, kind: 'event', total: 1, records: [fixture.records[1]] };
  get.mockResolvedValueOnce({ data: filtered }); fireEvent.change(screen.getByLabelText('Chronology evidence'), { target: { value: 'event' } });
  await screen.findByText('1 matching linked records'); expect(screen.queryByRole('link', { name: 'Open original alert #100' })).toBeNull();
  get.mockResolvedValueOnce({ data: { ...filtered, severity: 'high' } }); fireEvent.change(screen.getByLabelText('Chronology severity'), { target: { value: 'high' } });
  await screen.findByText('1 matching linked records');
  get.mockResolvedValueOnce({ data: { ...filtered, severity: 'high', order: 'newest' } }); fireEvent.change(screen.getByLabelText('Time order'), { target: { value: 'newest' } });
  await screen.findByText('1 matching linked records'); expect(get).toHaveBeenLastCalledWith('/cases/7/evidence-chronology', { params: { kind: 'event', severity: 'high', order: 'newest', page: 1, size: 10 } });
});
it('withholds original links for collaborators and labels missing timestamps honestly', async () => {
  get.mockResolvedValueOnce({ data: { ...fixture, records: fixture.records.map(r => ({ ...r, can_open_original: false, recorded_at: null })) } });
  render(<CaseEvidenceChronology caseId={7} />); open(); await screen.findByText('2 matching linked records');
  expect(screen.queryByRole('link')).toBeNull(); expect(screen.getByText(/Event timestamp: Not recorded/)).toBeTruthy();
});
it.each([{ case_id: 8 }, { kind: 'event' }, { page: 2 }, { order: 'newest' }, { severity: 'high' }, { total: -1 }, { total: 3 }, { counts: null }, { retrieved_at: 'bad' }, { records: [] }, { records: [row, row] }, { records: [{ ...row, recorded_at: 'bad' }, fixture.records[1]] }, { records: [{ ...row, label: {} }, fixture.records[1]] }])('rejects malformed scope, totals or records %j', async changes => {
  get.mockResolvedValueOnce({ data: { ...fixture, ...changes } }); render(<CaseEvidenceChronology caseId={7} />); open(); await screen.findByRole('alert'); expect(screen.queryByRole('link')).toBeNull();
});
it('pages globally and clamps after current evidence shrinks', async () => {
  const large = { ...fixture, total: 11, counts: { alert: { available: 11, unavailable: 0 }, event: { available: 0, unavailable: 0 } }, records: Array.from({ length: 10 }, (_, i) => ({ ...row, id: i + 1 })) };
  get.mockResolvedValueOnce({ data: large }); render(<CaseEvidenceChronology caseId={7} />); open(); await screen.findByText('Page 1 of 2');
  get.mockResolvedValueOnce({ data: { ...large, page: 2, records: [{ ...row, id: 11 }] } }); fireEvent.click(screen.getByRole('button', { name: 'Next chronology page' })); await screen.findByText('Page 2 of 2');
  get.mockResolvedValueOnce({ data: { ...fixture, page: 2, records: [] } }).mockResolvedValueOnce({ data: fixture }); fireEvent.click(screen.getByRole('button', { name: 'Refresh chronology' })); await screen.findByText('Page 1 of 1');
});
it('discards late responses after a scope change and supports retry after failure', async () => {
  let finish!: (v: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<CaseEvidenceChronology caseId={7} />); open(); get.mockRejectedValueOnce(new Error('Unavailable'));
  fireEvent.change(screen.getByLabelText('Time order'), { target: { value: 'newest' } }); await screen.findByRole('alert');
  await act(async () => finish({ data: fixture })); expect(screen.queryByRole('link')).toBeNull();
  get.mockResolvedValueOnce({ data: { ...fixture, order: 'newest' } }); fireEvent.click(screen.getByRole('button', { name: 'Refresh chronology' })); await screen.findByText('2 matching linked records');
});
it('does not equate an empty evidence result with no incident', async () => {
  get.mockResolvedValueOnce({ data: { ...fixture, total: 0, counts: { alert: { available: 0, unavailable: 1 }, event: { available: 0, unavailable: 0 } }, records: [] } });
  render(<CaseEvidenceChronology caseId={7} />); open(); await screen.findByText(/not proof that no activity occurred/);
});

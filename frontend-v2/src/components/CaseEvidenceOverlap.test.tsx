import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { CaseEvidenceOverlap } from './CaseEvidenceOverlap';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const row = { id: 100, label: 'Recorded shared alert', severity: 'high', recorded_at: null, can_open_original: true };
const fixture = { relation: 'shared', total: 1, case_id: 7, case_title: 'Source inquiry', other_case_id: 8, other_case_title: 'Comparison inquiry', kind: 'alert', source_count: 4, other_count: 2, shared_count: 1, source_only_count: 3, other_only_count: 1, page: 1, size: 10, records: [row], retrieved_at: '2026-11-21T11:00:00Z', scope: 'Exact saved record IDs' };
const compare = (id = '8') => { fireEvent.change(screen.getByLabelText('Other investigation ID'), { target: { value: id } }); fireEvent.click(screen.getByRole('button', { name: 'Compare linked record IDs' })); };
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: fixture }); });
afterEach(cleanup);
it('uses exact selected IDs and distinguishes overlap from similarity without mutations', async () => {
  render(<CaseEvidenceOverlap caseId={7} />); expect(get).not.toHaveBeenCalled(); compare();
  await screen.findByText('alert #100: Recorded shared alert');
  expect(get).toHaveBeenCalledWith('/cases/7/evidence-overlap', { params: { other_case_id: 8, kind: 'alert', relation: 'shared', page: 1, size: 10 } });
  expect(screen.getByText(/does not prove a common incident/)).toBeTruthy();
  expect(screen.getByText(/4 in #7, 2 in #8/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Open original alert #100' }).getAttribute('href')).toBe('/app/alerts?alert=100');
  expect(screen.getByRole('link', { name: '#8: Comparison inquiry' }).getAttribute('href')).toBe('/app/cases/8');
  expect(apiClient.post).not.toHaveBeenCalled(); expect(apiClient.patch).not.toHaveBeenCalled();
});
it.each(['0', '7', '-1', '7.5', '8e0', '2147483648', 'bad'])('does not fetch invalid or same ID %s', value => {
  render(<CaseEvidenceOverlap caseId={7} />); compare(value); expect(screen.getByRole('alert').textContent).toContain('different positive'); expect(get).not.toHaveBeenCalled();
});
it('switches evidence kinds with exact event links and retains no old alert detail', async () => {
  render(<CaseEvidenceOverlap caseId={7} />); compare(); await screen.findByText(/alert #100:/);
  get.mockResolvedValueOnce({ data: { ...fixture, kind: 'event' } }); fireEvent.change(screen.getByLabelText('Evidence kind'), { target: { value: 'event' } });
  await screen.findByText(/event #100:/); expect(screen.queryByText(/alert #100:/)).toBeNull();
  expect(screen.getByRole('link', { name: 'Open original event #100' }).getAttribute('href')).toBe('/app/events/100');
});
it('withholds original links for collaborators and avoids claiming no common incident on zero overlap', async () => {
  get.mockResolvedValueOnce({ data: { ...fixture, records: [{ ...row, can_open_original: false }] } });
  render(<CaseEvidenceOverlap caseId={7} />); compare(); await screen.findByText(/Original record belongs to/);
  expect(screen.queryByRole('link', { name: /Open original/ })).toBeNull();
  get.mockResolvedValueOnce({ data: { ...fixture, shared_count: 0, total: 0, source_only_count: 4, other_only_count: 2, records: [] } });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh evidence comparison' })); await screen.findByText(/does not establish that the investigations are unrelated/);
});
it.each([{ case_id: 9 }, { other_case_id: 9 }, { page: 2 }, { kind: 'event' }, { source_only_count: 0 }, { records: [] }, { records: [{ ...row, label: {} }] }, { records: [{ ...row, severity: {} }] }])('rejects unbound or inconsistent comparison %j', async changes => {
  get.mockResolvedValueOnce({ data: { ...fixture, ...changes } }); render(<CaseEvidenceOverlap caseId={7} />); compare();
  await screen.findByRole('alert'); expect(screen.queryByText(/alert #100:/)).toBeNull();
});
it('paginates shared IDs and clamps a page after concurrent link removal', async () => {
  const page1 = { ...fixture, source_count: 11, other_count: 11, shared_count: 11, total: 11, source_only_count: 0, other_only_count: 0, records: Array.from({ length: 10 }, (_, index) => ({ ...row, id: index + 1 })) };
  get.mockResolvedValueOnce({ data: page1 }); render(<CaseEvidenceOverlap caseId={7} />); compare(); await screen.findByText(/alert #1:/);
  get.mockResolvedValueOnce({ data: { ...page1, page: 2, records: [row] } }); fireEvent.click(screen.getByRole('button', { name: 'More shared evidence' })); await screen.findByText(/alert #100:/);
  get.mockResolvedValueOnce({ data: { ...fixture, page: 2, records: [] } }).mockResolvedValueOnce({ data: fixture });
  fireEvent.click(screen.getByRole('button', { name: 'Refresh evidence comparison' })); await screen.findByText('Page 1 of 1');
});
it('discards late replies after typing a new ID and retries source errors', async () => {
  let finish!: (v: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<CaseEvidenceOverlap caseId={7} />); compare(); fireEvent.change(screen.getByLabelText('Other investigation ID'), { target: { value: '9' } });
  await act(async () => finish({ data: fixture })); expect(screen.queryByText(/alert #100:/)).toBeNull();
  get.mockRejectedValueOnce(new Error('Unavailable')); compare(); await screen.findByRole('alert');
  get.mockResolvedValueOnce({ data: fixture }); fireEvent.click(screen.getByRole('button', { name: 'Retry evidence comparison' })); await screen.findByText(/alert #100:/);
});
it.each([['source_only', 3], ['other_only', 1]])('reads and binds the selected exclusive set %s', async (relation, total) => {
  render(<CaseEvidenceOverlap caseId={7} />); compare(); await screen.findByText(/alert #100:/);
  const records = Array.from({ length: Number(total) }, (_, i) => ({ ...row, id: 111 + i, label: 'Exclusive metadata', can_open_original: false }));
  get.mockResolvedValueOnce({ data: { ...fixture, relation, total, records } });
  fireEvent.change(screen.getByLabelText('Record set'), { target: { value: relation } });
  await screen.findByText('alert #111: Exclusive metadata');
  expect(get).toHaveBeenLastCalledWith('/cases/7/evidence-overlap', { params: { other_case_id: 8, kind: 'alert', relation, page: 1, size: 10 } });
  expect(screen.queryByText(/alert #100:/)).toBeNull(); expect(screen.queryByRole('link', { name: /Open original/ })).toBeNull();
});
it('rejects a response for another set or a total inconsistent with the selected count', async () => {
  get.mockResolvedValueOnce({ data: { ...fixture, relation: 'source_only', total: 3 } });
  render(<CaseEvidenceOverlap caseId={7} />); compare(); await screen.findByRole('alert'); expect(screen.queryByText(/alert #100:/)).toBeNull();
  get.mockResolvedValueOnce({ data: { ...fixture, total: 3 } }); fireEvent.click(screen.getByRole('button', { name: 'Retry evidence comparison' }));
  await screen.findByRole('alert'); expect(screen.queryByText(/alert #100:/)).toBeNull();
});
it('discards a late shared response when switching to an exclusive set', async () => {
  let finish!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<CaseEvidenceOverlap caseId={7} />); compare();
  get.mockResolvedValueOnce({ data: { ...fixture, relation: 'other_only', records: [{ ...row, id: 112, label: 'Other investigation evidence' }] } });
  fireEvent.change(screen.getByLabelText('Record set'), { target: { value: 'other_only' } });
  await screen.findByText(/alert #112:/); await act(async () => finish({ data: fixture }));
  expect(screen.queryByText(/alert #100:/)).toBeNull(); expect(screen.getByText(/alert #112:/)).toBeTruthy();
});
it('paginates the exclusive set total rather than the shared count and resets on set change', async () => {
  const sourceOnly = { ...fixture, relation: 'source_only', total: 11, source_count: 12, source_only_count: 11, records: Array.from({ length: 10 }, (_, i) => ({ ...row, id: 200 + i })) };
  get.mockResolvedValueOnce({ data: sourceOnly }); render(<CaseEvidenceOverlap caseId={7} />);
  fireEvent.change(screen.getByLabelText('Record set'), { target: { value: 'source_only' } }); compare();
  await screen.findByText(/alert #200:/); expect(screen.getByText('Page 1 of 2')).toBeTruthy();
  get.mockResolvedValueOnce({ data: { ...sourceOnly, page: 2, records: [{ ...row, id: 210 }] } });
  fireEvent.click(screen.getByRole('button', { name: 'More selected evidence' })); await screen.findByText(/alert #210:/);
  get.mockResolvedValueOnce({ data: { ...fixture, relation: 'other_only' } });
  fireEvent.change(screen.getByLabelText('Record set'), { target: { value: 'other_only' } }); await screen.findByText(/alert #100:/);
  expect(get).toHaveBeenLastCalledWith('/cases/7/evidence-overlap', { params: { other_case_id: 8, kind: 'alert', relation: 'other_only', page: 1, size: 10 } });
});

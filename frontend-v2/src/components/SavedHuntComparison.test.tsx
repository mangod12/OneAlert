import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { SavedHuntComparison } from './SavedHuntComparison';
import { savedHuntEvidence } from '../utils/huntSessionEvidence';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const source = { id: 7, hypothesis: 'Saved authentication inquiry', status: 'partial', queries_run: 1, findings_count: 3, created_at: '2026-11-21T00:00:00Z', sigma_rule: null,
  result_data: { query_results: [{ outcome: 'completed', query: { sql: 'SELECT id', description: 'Selected metadata' }, rows: [{ id: 1 }, { id: 2 }, { id: 2 }], row_count: 100 }] } };
const other = { ...source, id: 8, hypothesis: '<b>Other saved inquiry</b>', result_data: { query_results: [{ outcome: 'failed', query: { sql: 'SELECT id, hostname', description: 'Different context' }, rows: [{ id: 1 }, { id: 3 }], row_count: 200 }] } };
const show = () => { const value = savedHuntEvidence(source, 7); return render(<SavedHuntComparison session={value.session} evidence={value.evidence} />); };
const open = (id = '8') => { fireEvent.change(screen.getByLabelText('Comparison hunt session ID'), { target: { value: id } }); fireEvent.click(screen.getByRole('button', { name: 'Read other saved hunt for comparison' })); };
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data: other }); }); afterEach(cleanup);
it('only reads another exact saved record after request and compares retained rows without rerunning anything', async () => {
  show(); expect(get).not.toHaveBeenCalled(); open(); await screen.findByText(/1 exact rows shared; 2 only in A; 1 only in B/);
  expect(get).toHaveBeenCalledExactlyOnceWith('/hunt/8'); expect(apiClient.post).not.toHaveBeenCalled(); expect(apiClient.patch).not.toHaveBeenCalled();
  expect(screen.getByText(/Recorded query or execution context differs/)).toBeTruthy();
  expect(screen.getByText(/A: 3 retained rows, 100 reported/)).toBeTruthy();
  expect(screen.getByText(/<b>Other saved inquiry/).querySelector('b')).toBeNull();
  expect(screen.getByRole('link', { name: 'Open exact comparison hunt #8' }).getAttribute('href')).toBe('/app/hunt?session=8');
  expect(screen.getByRole('list', { name: 'Compared retained hunt rows' }).children).toHaveLength(2);
  fireEvent.change(screen.getByLabelText('Compared retained row set'), { target: { value: 'onlyB' } });
  expect(screen.getByRole('list', { name: 'Compared retained hunt rows' }).textContent).toContain('3');
});
it.each(['0', '-1', '7', '1.5', '8e0', '9007199254740992'])('refuses invalid or same session ID %s', id => {
  show(); open(id); expect(screen.getByRole('alert').textContent).toContain('different positive'); expect(get).not.toHaveBeenCalled();
});
it('fails closed for a mismatched record ID and supports retry with no fallback to another record', async () => {
  get.mockResolvedValueOnce({ data: { ...other, id: 9 } }); show(); open(); await screen.findByRole('alert');
  expect(screen.queryByText(/exact rows shared/)).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Read other saved hunt for comparison' }));
  await screen.findByText(/exact rows shared/); expect(get).toHaveBeenLastCalledWith('/hunt/8');
});
it('does not equate missing query evidence with zero findings, including historical list receipts', async () => {
  get.mockResolvedValueOnce({ data: { ...other, result_data: null } }); show(); open(); await screen.findByText(/Both sessions need a retained query result/);
  get.mockResolvedValueOnce({ data: { ...other, result_data: [{ rows: [] }] } }); fireEvent.click(screen.getByRole('button', { name: 'Read other saved hunt for comparison' }));
  await screen.findByText(/0 exact rows shared; 3 only in A; 0 only in B/);
  expect(screen.getByText(/outcome not recorded/)).toBeTruthy();
});
it('ignores a stale comparison reply after changing the selected ID', async () => {
  let finish!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); show(); open();
  fireEvent.change(screen.getByLabelText('Comparison hunt session ID'), { target: { value: '9' } }); await act(async () => finish({ data: other }));
  expect(screen.queryByText(/exact rows shared/)).toBeNull();
});
it('pages only the selected retained row multiset and lets the reviewer switch saved queries', async () => {
  get.mockResolvedValue({ data: { ...other, result_data: { query_results: [{ rows: Array.from({ length: 23 }, (_, i) => ({ value: `Retained row ${i}` })) }, { rows: [{ id: 1 }] }] } } });
  show(); open(); await screen.findByText(/23 only in B/);
  fireEvent.change(screen.getByLabelText('Compared retained row set'), { target: { value: 'onlyB' } });
  expect(screen.getByText('Page 1 of 3')).toBeTruthy(); fireEvent.click(screen.getByRole('button', { name: 'More compared rows' }));
  expect(screen.getByText('Page 2 of 3')).toBeTruthy(); expect(screen.getByRole('list', { name: 'Compared retained hunt rows' }).children).toHaveLength(10);
  fireEvent.change(screen.getByLabelText('B saved query for comparison'), { target: { value: '1' } });
  await screen.findByText(/1 exact rows shared; 2 only in A; 0 only in B/); expect(screen.getByText('Page 1 of 1')).toBeTruthy();
});

it('leaves a permission failure as unavailable, without assuming empty evidence', async () => {
  get.mockRejectedValueOnce({ response: { status: 404, data: { detail: 'Saved hunt not found' } } }); show(); open(); await screen.findByRole('alert');
  expect(screen.queryByText(/exact rows shared/)).toBeNull(); expect(get).toHaveBeenCalledTimes(1); expect(apiClient.post).not.toHaveBeenCalled();
});
it('invalidates pending reads on unmount', async () => {
  let finish!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); const view = show(); open(); view.unmount(); await act(async () => finish({ data: other }));
  expect(screen.queryByText(/exact rows shared/)).toBeNull();
});
it('rejects malformed retained rows instead of inferring empty results', async () => {
  get.mockResolvedValueOnce({ data: { ...other, result_data: { query_results: [{ rows: null }] } } }); show(); open(); await screen.findByRole('alert');
  expect(screen.queryByText(/exact rows shared/)).toBeNull();
});

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import apiClient from '../api/client';
import { ResponsePlanComparison } from './ResponsePlanComparison';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const before = { id: 7, case_id: 4, status: 'approved', autonomy_level: 'L1', actions: [{ action_type: 'inspect', target: 'gateway' }] };
const after = { ...before, id: 8, status: 'partial', actions: [{ action_type: 'inspect', target: 'gateway', execution_result: { status: 'completed', execution_mode: 'simulated' } }, { action_type: 'notify', target: 'soc' }] };
beforeEach(() => { vi.resetAllMocks(); get.mockImplementation(async url => ({ data: url.endsWith('/7') ? before : after })); });
afterEach(cleanup);
function show() { render(<MemoryRouter><ResponsePlanComparison /></MemoryRouter>); fireEvent.click(screen.getByRole('button', { name: 'Compare two saved response plans' })); }
function load() { fireEvent.change(screen.getByLabelText('Baseline plan ID'), { target: { value: '7' } }); fireEvent.change(screen.getByLabelText('Comparison plan ID'), { target: { value: '8' } }); fireEvent.click(screen.getByRole('button', { name: 'Load saved plan comparison' })); }
it('fetches only on demand and displays complete action fields with exact evidence links', async () => {
  show(); expect(get).not.toHaveBeenCalled(); load();
  await screen.findByText('Stored action position 1: changed');
  expect(screen.getByText('Stored action position 2: added')).toBeTruthy();
  expect(screen.getByText(/"execution_mode": "simulated"/)).toBeTruthy();
  expect(screen.getByRole('link', { name: /Baseline plan #7/ }).getAttribute('href')).toBe('/response-plans?plan=7');
  expect(get).toHaveBeenCalledTimes(2);
});
it.each(['0', '07', '-7', '1e3', '9007199254740992'])('rejects invalid exact IDs %s without a request', async value => {
  show(); fireEvent.change(screen.getByLabelText('Baseline plan ID'), { target: { value } }); fireEvent.change(screen.getByLabelText('Comparison plan ID'), { target: { value: '8' } });
  fireEvent.click(screen.getByRole('button', { name: 'Load saved plan comparison' })); await screen.findByRole('alert'); expect(get).not.toHaveBeenCalled();
});
it('rejects cross-investigation plans and mismatched returned identities', async () => {
  get.mockResolvedValueOnce({ data: before }).mockResolvedValueOnce({ data: { ...after, case_id: 5 } }); show(); load();
  await screen.findByText(/belong to different investigations/); expect(screen.queryByRole('link')).toBeNull();
  get.mockResolvedValueOnce({ data: before }).mockResolvedValueOnce({ data: { ...after, id: 9 } });
  fireEvent.click(screen.getByRole('button', { name: 'Load saved plan comparison' })); await screen.findByText(/did not match the requested records/); expect(screen.queryByRole('link')).toBeNull();
});
it('does not present a one-sided comparison if either request fails', async () => {
  get.mockResolvedValueOnce({ data: before }).mockRejectedValueOnce(new Error('Plan unavailable'));
  show(); load(); await screen.findByText('Plan unavailable'); expect(screen.queryByRole('link')).toBeNull();
});
it('hides unchanged positions by default and pages at ten stored positions', async () => {
  get.mockImplementation(async url => ({ data: { ...(url.endsWith('/7') ? before : after), actions: Array.from({ length: 12 }, (_, i) => ({ target: `host-${i}` })) } }));
  show(); load(); await screen.findByText(/No changed action positions/);
  fireEvent.click(screen.getByLabelText('Show changed positions only'));
  expect(screen.getByText('Stored action position 10: unchanged')).toBeTruthy(); expect(screen.queryByText('Stored action position 11: unchanged')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Next comparison positions' })); expect(screen.getByText('Stored action position 11: unchanged')).toBeTruthy();
});
it('clears loaded comparison on input edits and ignores late results after closing', async () => {
  let finish!: (v: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce({ data: after });
  show(); load(); fireEvent.click(screen.getByRole('button', { name: 'Compare two saved response plans' }));
  await act(async () => finish({ data: before })); expect(screen.queryByRole('link')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Compare two saved response plans' })); fireEvent.click(screen.getByRole('button', { name: 'Load saved plan comparison' }));
  await screen.findByText('Stored action position 1: changed'); fireEvent.change(screen.getByLabelText('Comparison plan ID'), { target: { value: '9' } }); expect(screen.queryByRole('link')).toBeNull();
});

it('prefills linked IDs without fetching, then reloads both exact records on request', async () => {
  const view = render(<MemoryRouter><ResponsePlanComparison baseline="7" comparison="8" /></MemoryRouter>);
  expect((screen.getByLabelText('Baseline plan ID') as HTMLInputElement).value).toBe('7');
  expect(get).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Load saved plan comparison' }));
  await screen.findByText('Stored action position 1: changed');
  view.rerender(<MemoryRouter><ResponsePlanComparison baseline="8" comparison="7" /></MemoryRouter>);
  expect(screen.queryByRole('link')).toBeNull();
  expect((screen.getByLabelText('Baseline plan ID') as HTMLInputElement).value).toBe('8');
  expect(get).toHaveBeenCalledTimes(2);
});

it('searches complete loaded comparison positions beyond the current page and resets paging', async () => {
  get.mockImplementation(async url => ({ data: { ...(url.endsWith('/7') ? before : after), actions: Array.from({ length: 22 }, (_, i) => ({ target: url.endsWith('/7') ? 'old' : i === 21 ? 'Rare last host' : 'new' })) } })); show(); load(); await screen.findByText('Stored action position 10: changed'); fireEvent.click(screen.getByText('Next comparison positions')); expect(screen.getByText(/Page 2 of 3/)).toBeTruthy(); fireEvent.change(screen.getByLabelText('Search saved action position evidence'), { target: { value: 'RARE last' } }); expect(screen.getByText('Stored action position 22: changed')).toBeTruthy(); expect(screen.getByText(/1 of 22 loaded positions match/)).toBeTruthy(); expect(screen.getByText(/Page 1 of 1/)).toBeTruthy(); expect(get).toHaveBeenCalledTimes(2);
});
it('keeps metadata differences visible under empty literal action searches and downloads matching scope', async () => {
  const create = vi.fn((blob: Blob) => { expect(blob.type).toBe('application/json'); return 'blob:comparison'; }); vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() }); const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try { show(); load(); await screen.findByText('Stored action position 1: changed'); fireEvent.change(screen.getByLabelText('Search saved action position evidence'), { target: { value: '.*' } }); expect(screen.getByText('Status: approved → partial (different recorded values)')).toBeTruthy(); expect(screen.getByText(/0 of 2 loaded positions match/)).toBeTruthy(); fireEvent.click(screen.getByText('Download matching plan comparison JSON')); expect(create).toHaveBeenCalledTimes(1); expect(click).toHaveBeenCalledTimes(1); fireEvent.click(screen.getByText('Clear position evidence search')); expect(screen.getByText('Stored action position 1: changed')).toBeTruthy(); }
  finally { vi.unstubAllGlobals(); vi.restoreAllMocks(); }
});
it('keeps download failure separate from loaded comparison and clears export state on record changes', async () => {
  vi.stubGlobal('URL', { createObjectURL: () => { throw Error('No download'); } });
  try { show(); load(); await screen.findByText('Stored action position 1: changed'); fireEvent.click(screen.getByText('Download matching plan comparison JSON')); expect(screen.getByRole('alert').textContent).toContain('could not be downloaded'); expect(screen.getByText('Stored action position 1: changed')).toBeTruthy(); fireEvent.change(screen.getByLabelText('Comparison plan ID'), { target: { value: '9' } }); expect(screen.queryByRole('alert')).toBeNull(); expect(screen.queryByText('Download matching plan comparison JSON')).toBeNull(); } finally { vi.unstubAllGlobals(); }
});

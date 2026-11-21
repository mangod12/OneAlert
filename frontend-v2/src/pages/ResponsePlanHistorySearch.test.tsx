import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { ResponsePlans } from './ResponsePlans';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const plan = { id: 12, case_id: 4, status: 'completed', autonomy_level: 'L2', created_by: 'Analyst', created_at: '2026-11-21T04:00:00Z', actions: [] };
beforeEach(() => { vi.resetAllMocks(); get.mockImplementation(async url => ({ data: { data: url.endsWith('pending-approvals') ? [] : [plan], total: url.endsWith('pending-approvals') ? 0 : 41 } })); URL.createObjectURL = vi.fn(() => 'blob:plan'); URL.revokeObjectURL = vi.fn(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
describe('Response plan history search', () => {
  it('applies a trimmed literal search and exact case without changing approval filters', async () => {
    render(<ResponsePlans />); await screen.findByText('Case #4');
    fireEvent.change(screen.getByLabelText('Search plan history'), { target: { value: '  100%_safe  ' } });
    fireEvent.change(screen.getByLabelText('Plan history investigation ID'), { target: { value: '4' } });
    expect(screen.getByText(/Plan history search draft not applied/)).toBeTruthy();
    expect(get.mock.calls.filter(([url]) => url === '/response-plans/')).toHaveLength(1);
    fireEvent.submit(screen.getByRole('form', { name: 'Search response plan history' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/response-plans/', { params: { page: 1, size: 20, query: '100%_safe', case_id: 4 } }));
    expect(get).toHaveBeenCalledWith('/response-plans/pending-approvals', { params: { page: 1, size: 10 } });
    fireEvent.change(screen.getByLabelText('Filter plan history autonomy'), { target: { value: 'L2' } });
    fireEvent.change(screen.getByLabelText('Order plan history'), { target: { value: 'oldest' } });
    await waitFor(() => expect(get).toHaveBeenCalledWith('/response-plans/', { params: { page: 1, size: 20, query: '100%_safe', case_id: 4, autonomy_level: 'L2', sort: 'oldest' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear plan history filters' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/response-plans/', { params: { page: 1, size: 20 } }));
    expect((screen.getByLabelText('Search plan history') as HTMLInputElement).value).toBe('');
  });
  it.each(['0', '-1', '1.2', '9007199254740992', '4x'])('rejects invalid exact investigation %s without sending the draft', async value => {
    render(<ResponsePlans />); await screen.findByText('Case #4');
    fireEvent.change(screen.getByLabelText('Plan history investigation ID'), { target: { value } });
    fireEvent.submit(screen.getByRole('form', { name: 'Search response plan history' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Use one positive whole-number investigation ID. The draft has not been applied.');
    expect(get.mock.calls.filter(([url]) => url === '/response-plans/')).toHaveLength(1);
  });
  it('exports the applied scope, not an unapplied draft, and ignores a stale download', async () => {
    let finish!: (value: unknown) => void;
    const original = get.getMockImplementation()!;
    get.mockImplementation((url, config) => url === '/response-plans/export' ? new Promise(resolve => { finish = resolve; }) : original(url, config));
    render(<ResponsePlans />); await screen.findByText('Case #4');
    fireEvent.change(screen.getByLabelText('Search plan history'), { target: { value: 'Analyst' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Search response plan history' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/response-plans/', { params: { page: 1, size: 20, query: 'Analyst' } }));
    fireEvent.change(screen.getByLabelText('Search plan history'), { target: { value: 'Not applied' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(get).toHaveBeenCalledWith('/response-plans/export', { params: { query: 'Analyst' }, responseType: 'blob' });
    fireEvent.change(screen.getByLabelText('Order plan history'), { target: { value: 'oldest' } });
    await screen.findByRole('button', { name: 'Export CSV' });
    await act(async () => finish({ data: new Blob(['id'], { type: 'text/csv' }) }));
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it('rejects an invalid export response and keeps retry available', async () => {
    const original = get.getMockImplementation()!;
    get.mockImplementation(async (url, config) => url === '/response-plans/export' ? { data: new Blob(['{}'], { type: 'application/json' }) } : original(url, config));
    render(<ResponsePlans />); await screen.findByText('Case #4');
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'The server did not return response plan CSV. No file was downloaded.');
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: 'Export CSV' }) as HTMLButtonElement).disabled).toBe(false);
  });
});

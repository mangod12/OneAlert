import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SavedViewsMenu } from './SavedViewsMenu';

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('./Toast', () => ({ toast: vi.fn() }));

import apiClient from '../api/client';
import { toast } from './Toast';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);
const mockPatch = vi.mocked(apiClient.patch);
const mockDelete = vi.mocked(apiClient.delete);
const mockToast = vi.mocked(toast);
afterEach(cleanup);
beforeEach(() => vi.resetAllMocks());

const views = [
  { id: 1, name: 'Critical pending', filters: { severity: 'critical', status: 'pending', sort: 'cvss_desc' }, created_at: '2026-11-18T00:00:00Z' },
  { id: 2, name: 'Mine unassigned', filters: { assigned: 'unassigned' }, created_at: '2026-11-18T01:00:00Z' },
];

describe('SavedViewsMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it('lists saved views when opened', async () => {
    mockGet.mockResolvedValue({ data: views } as never);
    render(<SavedViewsMenu currentFilters={{}} onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /saved views/i }));
    expect(await screen.findByText('Critical pending')).toBeTruthy();
    expect(screen.getByText('Mine unassigned')).toBeTruthy();
    expect(mockGet).toHaveBeenCalledWith('/alerts/views/');
  });

  it('applies a view on click', async () => {
    mockGet.mockResolvedValue({ data: views } as never);
    const onApply = vi.fn();
    render(<SavedViewsMenu currentFilters={{}} onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: /saved views/i }));
    fireEvent.click(await screen.findByText('Critical pending'));
    expect(onApply).toHaveBeenCalledWith({ severity: 'critical', status: 'pending', sort: 'cvss_desc' });
  });

  it('saves the current filters under a new name', async () => {
    mockGet.mockResolvedValue({ data: [] } as never);
    const created = { id: 3, name: 'High on plc', filters: { severity: 'high', search: 'plc' }, created_at: '2026-11-18T02:00:00Z' };
    mockPost.mockResolvedValue({ data: created } as never);

    render(<SavedViewsMenu currentFilters={{ severity: 'high', search: 'plc' }} onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /saved views/i }));
    fireEvent.change(await screen.findByLabelText('Name for the saved view'), { target: { value: 'High on plc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/alerts/views/', {
      name: 'High on plc',
      filters: { severity: 'high', search: 'plc' },
    }));
    expect(await screen.findByText('High on plc')).toBeTruthy();
    expect(mockToast).toHaveBeenCalledWith('Saved view "High on plc"', 'success');
  });

  it('deletes a view', async () => {
    mockGet.mockResolvedValue({ data: views } as never);
    mockDelete.mockResolvedValue({} as never);
    render(<SavedViewsMenu currentFilters={{}} onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /saved views/i }));
    fireEvent.click(await screen.findByLabelText('Delete view Critical pending'));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('/alerts/views/1'));
    expect(screen.queryByText('Critical pending')).toBeNull();
    expect(screen.getByText('Mine unassigned')).toBeTruthy();
  });

  it('renames a view inline', async () => {
    mockGet.mockResolvedValue({ data: views } as never);
    const renamed = { ...views[0], name: 'Critical triage' };
    mockPatch.mockResolvedValue({ data: renamed } as never);
    render(<SavedViewsMenu currentFilters={{}} onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /saved views/i }));
    fireEvent.click(await screen.findByLabelText('Rename view Critical pending'));
    const input = await screen.findByLabelText('New name for view Critical pending');
    fireEvent.change(input, { target: { value: 'Critical triage' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/alerts/views/1', { name: 'Critical triage' }));
    expect(await screen.findByText('Critical triage')).toBeTruthy();
    expect(screen.queryByText('Critical pending')).toBeNull();
    expect(mockToast).toHaveBeenCalledWith('Renamed view to "Critical triage"', 'success');
  });

  it('escape cancels a rename without calling the API', async () => {
    mockGet.mockResolvedValue({ data: views } as never);
    render(<SavedViewsMenu currentFilters={{}} onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /saved views/i }));
    fireEvent.click(await screen.findByLabelText('Rename view Critical pending'));
    const input = await screen.findByLabelText('New name for view Critical pending');
    fireEvent.change(input, { target: { value: 'Changed mind' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByLabelText('New name for view Critical pending')).toBeNull();
    expect(await screen.findByText('Critical pending')).toBeTruthy();
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('shows an error toast when the rename fails', async () => {
    mockGet.mockResolvedValue({ data: views } as never);
    mockPatch.mockRejectedValue(new Error('conflict'));
    render(<SavedViewsMenu currentFilters={{}} onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /saved views/i }));
    fireEvent.click(await screen.findByLabelText('Rename view Critical pending'));
    const input = await screen.findByLabelText('New name for view Critical pending');
    fireEvent.change(input, { target: { value: 'Mine unassigned' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.any(String), 'error'));
    // The row stays in edit mode so the analyst can fix the name.
    expect(screen.getByLabelText('New name for view Critical pending')).toBeTruthy();
  });

  it('shows the empty state', async () => {
    mockGet.mockResolvedValue({ data: [] } as never);
    render(<SavedViewsMenu currentFilters={{}} onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /saved views/i }));
    expect(await screen.findByText('No saved views yet')).toBeTruthy();
  });
});

it('shows failed reads as unavailable, not an empty saved view list, then retries', async () => {
  mockGet.mockRejectedValueOnce(new Error('Unavailable')).mockResolvedValueOnce({ data: views });
  render(<SavedViewsMenu currentFilters={{}} onApply={vi.fn()} />); fireEvent.click(screen.getByRole('button', { name: /saved views/i }));
  await screen.findByRole('alert'); expect(screen.queryByText('No saved views yet')).toBeNull();
  expect((screen.getByLabelText('Name for the saved view') as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Retry saved views' })); await screen.findByText('Critical pending');
});
it('never applies an older scope read after switching the menu endpoint', async () => {
  let resolve!: (value: unknown) => void; mockGet.mockReturnValueOnce(new Promise(r => { resolve = r; })).mockResolvedValueOnce({ data: [{ ...views[0], name: 'Inventory only' }] });
  const { rerender } = render(<SavedViewsMenu currentFilters={{}} onApply={vi.fn()} />); fireEvent.click(screen.getByRole('button', { name: /saved views/i }));
  rerender(<SavedViewsMenu basePath="/inventory/views/" currentFilters={{}} onApply={vi.fn()} />); await screen.findByText('Inventory only');
  resolve({ data: views }); await waitFor(() => expect(screen.queryByText('Critical pending')).toBeNull());
});
it('serializes rapid mutations and does not append an old-scope save into inventory views', async () => {
  mockGet.mockResolvedValue({ data: [] }); let resolve!: (value: unknown) => void; mockPost.mockReturnValueOnce(new Promise(r => { resolve = r; }));
  const { rerender } = render(<SavedViewsMenu currentFilters={{}} onApply={vi.fn()} />); fireEvent.click(screen.getByRole('button', { name: /saved views/i })); await screen.findByText('No saved views yet');
  fireEvent.change(screen.getByLabelText('Name for the saved view'), { target: { value: 'Old scope pending' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' })); fireEvent.click(screen.getByRole('button', { name: 'Save' })); expect(mockPost).toHaveBeenCalledTimes(1);
  rerender(<SavedViewsMenu basePath="/inventory/views/" currentFilters={{}} onApply={vi.fn()} />); await screen.findByText('No saved views yet');
  resolve({ data: { ...views[0], name: 'Old scope pending' } }); await waitFor(() => expect(screen.queryByText('Old scope pending')).toBeNull());
});
it('blocks applying a view during a pending rename and preserves the row on deletion failure', async () => {
  mockGet.mockResolvedValue({ data: views }); let resolve!: (value: unknown) => void; mockPatch.mockReturnValueOnce(new Promise(r => { resolve = r; })); const onApply = vi.fn();
  render(<SavedViewsMenu currentFilters={{}} onApply={onApply} />); fireEvent.click(screen.getByRole('button', { name: /saved views/i })); await screen.findByText('Critical pending');
  fireEvent.click(screen.getByLabelText('Rename view Critical pending')); const input = screen.getByLabelText('New name for view Critical pending'); fireEvent.change(input, { target: { value: 'Renamed' } }); fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.click(screen.getByRole('button', { name: 'Mine unassigned' })); expect(onApply).not.toHaveBeenCalled();
  resolve({ data: { ...views[0], name: 'Renamed' } }); await screen.findByText('Renamed');
  mockDelete.mockRejectedValueOnce(new Error('Denied')); fireEvent.click(screen.getByLabelText('Delete view Renamed')); await waitFor(() => expect(mockToast).toHaveBeenCalledWith('Denied', 'error')); expect(screen.getByText('Renamed')).toBeTruthy();
});

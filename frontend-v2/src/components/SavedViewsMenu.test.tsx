import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SavedViewsMenu } from './SavedViewsMenu';

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('./Toast', () => ({ toast: vi.fn() }));

import apiClient from '../api/client';
import { toast } from './Toast';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);
const mockDelete = vi.mocked(apiClient.delete);
const mockToast = vi.mocked(toast);

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

  it('shows the empty state', async () => {
    mockGet.mockResolvedValue({ data: [] } as never);
    render(<SavedViewsMenu currentFilters={{}} onApply={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /saved views/i }));
    expect(await screen.findByText('No saved views yet')).toBeTruthy();
  });
});

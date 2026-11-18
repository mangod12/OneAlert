import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../../api/client';
import { ApiTokensPanel } from './ApiTokensPanel';

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../Toast', () => ({ toast: vi.fn() }));

const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);
const del = vi.mocked(apiClient.delete);

const tokens = [
  { id: 1, name: 'CI pipeline', prefix: 'oa_ab12cd34ef', created_at: '2026-11-10T00:00:00Z', last_used_at: '2026-11-17T00:00:00Z', expires_at: null, revoked_at: null },
  { id: 2, name: 'Old laptop', prefix: 'oa_ff00ee11dd', created_at: '2026-10-01T00:00:00Z', last_used_at: null, expires_at: '2026-11-01T00:00:00Z', revoked_at: '2026-11-05T00:00:00Z' },
];

beforeEach(() => {
  vi.resetAllMocks();
  get.mockResolvedValue({ data: tokens });
});

afterEach(cleanup);

describe('ApiTokensPanel', () => {
  it('lists tokens with status details', async () => {
    render(<ApiTokensPanel />);
    expect(await screen.findByText('CI pipeline')).toBeTruthy();
    expect(screen.getByText('Old laptop')).toBeTruthy();
    expect(screen.getByText('revoked')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revoke token CI pipeline' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Revoke token Old laptop' })).toBeNull();
  });

  it('creates a token and reveals it once', async () => {
    const created = { ...tokens[0], id: 3, name: 'Deploy bot', token: 'oa_secretvalue123' };
    post.mockResolvedValue({ data: created });
    render(<ApiTokensPanel />);
    await screen.findByText('CI pipeline');

    fireEvent.change(screen.getByLabelText('Token name'), { target: { value: 'Deploy bot' } });
    fireEvent.change(screen.getByLabelText('Expires'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: /create token/i }));

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api-tokens/', { name: 'Deploy bot', expires_in_days: 30 }));
    expect(await screen.findByText('oa_secretvalue123')).toBeTruthy();
    expect(screen.getByText(/will not be shown again/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('oa_secretvalue123')).toBeNull();
  });

  it('revokes a token after confirmation', async () => {
    del.mockResolvedValue({});
    render(<ApiTokensPanel />);
    await screen.findByText('CI pipeline');

    fireEvent.click(screen.getByRole('button', { name: 'Revoke token CI pipeline' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke token' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/api-tokens/1'));
  });

  it('shows an empty state', async () => {
    get.mockResolvedValue({ data: [] });
    render(<ApiTokensPanel />);
    expect(await screen.findByText('No API tokens yet.')).toBeTruthy();
  });
});

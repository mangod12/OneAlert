import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../../api/client';
import { SuppressionRulesPanel } from './SuppressionRulesPanel';

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const post = vi.mocked(apiClient.post);
const patch = vi.mocked(apiClient.patch);
const del = vi.mocked(apiClient.delete);

beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const rule = {
  id: 1, name: 'Historian ransomware noise', cve_id: null, asset_id: 11,
  severity: null, title_contains: 'ransomware', duration_hours: 48,
  enabled: true, created_at: '2026-11-18T10:00:00Z', matching_active_alerts: 2,
};

function mockGets(rules: unknown[] = [rule]) {
  get.mockImplementation(async (url: string) => {
    if (url === '/suppression-rules/') return { data: rules };
    if (url === '/assets/') return { data: { assets: [{ id: 11, name: 'plant-historian' }], total: 1 } };
    throw new Error(`unexpected ${url}`);
  });
}

describe('SuppressionRulesPanel', () => {
  it('lists rules with criteria, snooze window and match count', async () => {
    mockGets();
    render(<SuppressionRulesPanel />);
    expect(await screen.findByText('Historian ransomware noise')).toBeTruthy();
    expect(screen.getByText(/plant-historian · title contains/)).toBeTruthy();
    expect(screen.getByText(/title contains "ransomware"/)).toBeTruthy();
    expect(screen.getByText(/snoozes for 48h/)).toBeTruthy();
    expect(screen.getByText(/matches 2 active alerts now/)).toBeTruthy();
  });

  it('creates a rule with the selected criteria', async () => {
    mockGets([]);
    post.mockResolvedValue({ data: { ...rule, id: 2 } });
    render(<SuppressionRulesPanel />);
    fireEvent.change(await screen.findByLabelText('Rule name'), { target: { value: 'Old Acrobat CVE' } });
    fireEvent.change(screen.getByLabelText('CVE (optional)'), { target: { value: 'CVE-2026-9999' } });
    fireEvent.change(screen.getByLabelText('Snooze hours'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/suppression-rules/', {
      name: 'Old Acrobat CVE', cve_id: 'CVE-2026-9999', duration_hours: 12,
    }));
  });

  it('blocks creation without any criterion', async () => {
    mockGets([]);
    render(<SuppressionRulesPanel />);
    fireEvent.change(await screen.findByLabelText('Rule name'), { target: { value: 'match everything' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create rule' }));
    expect(post).not.toHaveBeenCalled();
    expect(await screen.findByText(/Set at least one criterion/)).toBeTruthy();
  });

  it('pauses and re-enables a rule', async () => {
    mockGets();
    patch.mockResolvedValue({ data: { ...rule, enabled: false } });
    render(<SuppressionRulesPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/suppression-rules/1', { enabled: false }));
  });

  it('deletes a rule after confirmation', async () => {
    mockGets();
    del.mockResolvedValue({});
    render(<SuppressionRulesPanel />);
    fireEvent.click(await screen.findByLabelText('Delete rule Historian ransomware noise'));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete rule' }));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/suppression-rules/1'));
  });
});
it('previews the same validated draft body without creating a rule', async () => {
  mockGets([]); post.mockRejectedValueOnce(new Error('Preview offline')); render(<SuppressionRulesPanel />);
  fireEvent.change(await screen.findByLabelText('Rule name'), { target: { value: '  Draft gateway  ' } }); fireEvent.change(screen.getByLabelText('Title contains (optional)'), { target: { value: ' scanner ' } }); fireEvent.change(screen.getByLabelText('Snooze hours'), { target: { value: '12' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview draft scope' })); await screen.findByRole('dialog'); await screen.findByRole('alert');
  expect(post).toHaveBeenCalledExactlyOnceWith('/suppression-rules/preview', { name: 'Draft gateway', title_contains: 'scanner', duration_hours: 12 });
  fireEvent.click(screen.getByRole('button', { name: 'Close draft preview' })); post.mockResolvedValueOnce({ data: rule }); fireEvent.click(screen.getByRole('button', { name: 'Create rule' }));
  await waitFor(() => expect(post).toHaveBeenLastCalledWith('/suppression-rules/', { name: 'Draft gateway', title_contains: 'scanner', duration_hours: 12 }));
});
it('rejects fractional snooze windows in preview and creation', async () => {
  mockGets([]); render(<SuppressionRulesPanel />); fireEvent.change(await screen.findByLabelText('Rule name'), { target: { value: 'Draft' } }); fireEvent.change(screen.getByLabelText('Title contains (optional)'), { target: { value: 'scanner' } }); fireEvent.change(screen.getByLabelText('Snooze hours'), { target: { value: '1.5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview draft scope' })); await screen.findByText(/Snooze duration must be a whole number/); expect(post).not.toHaveBeenCalled();
});

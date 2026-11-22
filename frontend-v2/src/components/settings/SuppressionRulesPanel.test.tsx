import { webcrypto } from 'node:crypto';
import { suppressionEditFixture } from '../../utils/suppressionEditReview.fixture';
import { within } from '@testing-library/react';
import { suppressionRuleFingerprint } from '../../utils/suppressionStatusReview';
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
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

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

  it('opens a status review and only pauses after the exact conditional change is confirmed', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const snapshot = { ...rule }; delete (snapshot as Partial<typeof rule>).matching_active_alerts;
    const fingerprint = await suppressionRuleFingerprint(snapshot);
    const paused = { ...snapshot, enabled: false };
    let saved = false;
    get.mockImplementation(async (url: string) => {
      if (url === '/suppression-rules/') return { data: [{ ...rule, enabled: !saved }] };
      if (url === '/assets/') return { data: { assets: [], total: 0 } };
      return { data: { rule: snapshot, rule_fingerprint: fingerprint, page: 1, size: 10, scope: 'active', search: '', total: 0, matching_total: 0, criteria_present: true, retrieved_at: '2026-01-01T00:00:00Z', alerts: [] } };
    });
    post.mockImplementation(async () => { saved = true; return { data: { conditional_update_applied: true, reviewed_fingerprint: fingerprint, rule: paused, rule_fingerprint: await suppressionRuleFingerprint(paused) } }; });
    render(<SuppressionRulesPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    const confirm = await screen.findByRole('button', { name: 'Confirm reviewed pause' });
    expect(patch).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
    fireEvent.click(confirm);
    await waitFor(() => expect(post).toHaveBeenCalledExactlyOnceWith('/suppression-rules/1/reviewed-status', { enabled: false, expected_fingerprint: fingerprint }));
    await screen.findByText(/conditional status change was confirmed/);
    expect((await screen.findByRole('button', { name: 'Enable' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close status review' }));
    expect((screen.getByRole('button', { name: 'Enable' }) as HTMLButtonElement).disabled).toBe(false);
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

it('opens a canonical saved-rule edit instead of trusting stale list values and refreshes only after verified confirmation', async () => {
  vi.stubGlobal('crypto', webcrypto);
  const fixture = await suppressionEditFixture({ id: 1, name: 'Fresh saved name', enabled: true }); let edited = false;
  get.mockImplementation(async (url: string) => {
    if (url === '/suppression-rules/') return { data: edited ? [{ ...fixture.result.rule, matching_active_alerts: 2 }] : [rule] };
    if (url === '/assets/') return { data: { assets: [], total: 0 } };
    if (url === '/suppression-rules/1/edit-review') return { data: fixture.base };
    throw Error('Unexpected lookup');
  });
  post.mockImplementation(async (url: string) => {
    if (url === '/suppression-rules/1/edit-preview') return { data: fixture.preview };
    if (url === '/suppression-rules/1/reviewed-edit') { edited = true; return { data: fixture.result }; }
    throw Error('Unexpected mutation');
  });
  render(<SuppressionRulesPanel />);
  fireEvent.click(await screen.findByRole('button', { name: 'Edit saved rule Historian ransomware noise' }));
  const dialog = within(await screen.findByRole('dialog'));
  await waitFor(() => expect((dialog.getByRole('textbox', { name: 'Rule name' }) as HTMLInputElement).value).toBe('Fresh saved name'));
  expect((dialog.getByRole('textbox', { name: 'Asset record ID, exact' }) as HTMLInputElement).value).toBe('11');
  fireEvent.change(dialog.getByRole('textbox', { name: 'Title contains, literal and case-insensitive' }), { target: { value: fixture.proposal.title_contains } });
  fireEvent.click(dialog.getByRole('button', { name: 'Preview exact saved-rule edit' }));
  fireEvent.click(await dialog.findByRole('button', { name: 'Confirm reviewed rule edit' })); await dialog.findByText(/conditional edit was confirmed/);
  expect(post).toHaveBeenCalledTimes(2); expect(post).toHaveBeenNthCalledWith(1, '/suppression-rules/1/edit-preview', { expected_fingerprint: fixture.base.rule_fingerprint, proposal: fixture.proposal }); expect(post).toHaveBeenLastCalledWith('/suppression-rules/1/reviewed-edit', { expected_fingerprint: fixture.base.rule_fingerprint, proposal: fixture.proposal }); expect(patch).not.toHaveBeenCalled(); expect(del).not.toHaveBeenCalled();
  fireEvent.click(dialog.getByRole('button', { name: 'Close edit review' })); expect(await screen.findByRole('button', { name: 'Edit saved rule Fresh saved name' })).toBeTruthy();
});

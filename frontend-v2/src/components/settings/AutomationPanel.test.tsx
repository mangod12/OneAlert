import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../../api/client';
import { AutomationPanel } from './AutomationPanel';

vi.mock('../../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn(), patch: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const patch = vi.mocked(apiClient.patch);

beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function mockPrefs(prefs: unknown = { auto_escalate_incidents: true, auto_escalate_min_alerts: 4, auto_escalate_min_severity: 'critical' }) {
  get.mockImplementation(async (url: string) => {
    if (url === '/auth/me/automation-preferences') return { data: prefs };
    throw new Error(`unexpected ${url}`);
  });
}

describe('AutomationPanel', () => {
  it('loads and shows current preferences', async () => {
    mockPrefs();
    render(<AutomationPanel />);
    const toggle = await screen.findByRole('checkbox');
    expect((toggle as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Active alerts on one asset') as HTMLInputElement).value).toBe('4');
    expect((screen.getByLabelText('Highest severity at least') as HTMLSelectElement).value).toBe('critical');
  });

  it('saves updated preferences', async () => {
    mockPrefs({ auto_escalate_incidents: false, auto_escalate_min_alerts: 3, auto_escalate_min_severity: 'high' });
    patch.mockResolvedValue({ data: {} });
    render(<AutomationPanel />);
    fireEvent.click(await screen.findByRole('checkbox'));
    fireEvent.change(screen.getByLabelText('Active alerts on one asset'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Highest severity at least'), { target: { value: 'critical' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save automation' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/auth/me/automation-preferences', {
      auto_escalate_incidents: true,
      auto_escalate_min_alerts: 5,
      auto_escalate_min_severity: 'critical',
    }));
  });

  it('rejects an out-of-range alert threshold', async () => {
    mockPrefs();
    render(<AutomationPanel />);
    fireEvent.change(await screen.findByLabelText('Active alerts on one asset'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save automation' }));
    expect(patch).not.toHaveBeenCalled();
  });

  it('disables the inputs while auto-escalation is off', async () => {
    mockPrefs({ auto_escalate_incidents: false, auto_escalate_min_alerts: 3, auto_escalate_min_severity: 'high' });
    render(<AutomationPanel />);
    await screen.findByRole('checkbox');
    expect((screen.getByLabelText('Active alerts on one asset') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Highest severity at least') as HTMLSelectElement).disabled).toBe(true);
  });
});

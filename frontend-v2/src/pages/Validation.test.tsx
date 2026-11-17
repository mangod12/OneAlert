import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { Validation } from './Validation';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const run = {
  id: 8, name: 'Perimeter check', status: 'completed', mode: 'dry_run',
  description: 'Weekly review', mitre_techniques: ['T1110'],
  created_at: '2026-11-17T08:00:00Z', results_summary: null,
  steps: [
    { id: 1, technique_id: 'T1110', test_name: 'Missed password guessing', actual_result: 'missed', duration_ms: 120 },
    { id: 2, technique_id: 'T1071', test_name: 'Detected command channel', actual_result: 'detected', duration_ms: 80 },
    { id: 3, technique_id: 'T1046', test_name: 'Untested discovery', actual_result: null, duration_ms: null },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(apiClient.get).mockImplementation(url => Promise.resolve({ data: { data: url.endsWith('/8') ? run : [run] } }));
});
afterEach(cleanup);

async function openResults() {
  render(<Validation />);
  fireEvent.click(await screen.findByRole('button', { name: 'View results for Perimeter check' }));
  await screen.findByText('Missed password guessing');
}

describe('Validation result triage', () => {
  it('isolates results needing attention and switches back to all results', async () => {
    await openResults();
    expect(screen.getByRole('note').textContent).toContain('do not prove');
    fireEvent.click(screen.getByRole('button', { name: 'Needs attention (2)' }));
    expect(screen.getByText('Missed password guessing')).toBeTruthy();
    expect(screen.queryByText('Detected command channel')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Detected (1)' }));
    expect(screen.getByText('Detected command channel')).toBeTruthy();
    expect(screen.queryByText('Missed password guessing')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'All results (3)' }));
    expect(screen.getByText('Missed password guessing')).toBeTruthy();
    expect(screen.getByText('Detected command channel')).toBeTruthy();
  });

  it('distinguishes unrun steps from missed detections', async () => {
    await openResults();
    expect(screen.getByText('Not run')).toBeTruthy();
    expect(screen.getByText('Not timed')).toBeTruthy();
  });

  it('exposes technique selection state to assistive technology', async () => {
    render(<Validation />);
    fireEvent.click(screen.getByRole('button', { name: 'New Validation' }));
    const technique = screen.getByRole('button', { name: /T1110 Brute Force/ });
    expect(technique.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(technique);
    expect(technique.getAttribute('aria-pressed')).toBe('true');
  });

  it('uses separate native buttons for results and execution', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { data: [{ ...run, status: 'pending' }] } });
    render(<Validation />);
    const viewButton = await screen.findByRole('button', { name: 'View results for Perimeter check' });
    expect(viewButton.tagName).toBe('BUTTON');
    const runButton = screen.getByRole('button', { name: 'Run' });
    expect(within(viewButton).queryByRole('button', { name: 'Run' })).toBeNull();
    expect(runButton.parentElement?.getAttribute('role')).not.toBe('button');
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { Compliance } from './Compliance';

vi.mock('../api/client', () => ({ default: { get: vi.fn(), patch: vi.fn() } }));

const get = vi.mocked(apiClient.get);
const patch = vi.mocked(apiClient.patch);

const frameworks = [
  { id: 1, name: 'NIST CSF', version: '2.0', description: null },
  { id: 2, name: 'IEC 62443', version: '4.2', description: null },
];
const summaries = [
  { framework_id: 1, framework_name: 'NIST CSF', total_controls: 10, compliant: 6, non_compliant: 1, partial: 2, not_assessed: 1, compliance_percentage: 60 },
  { framework_id: 2, framework_name: 'IEC 62443', total_controls: 5, compliant: 0, non_compliant: 0, partial: 0, not_assessed: 5, compliance_percentage: 0 },
];
const controls = [
  { id: 11, framework_id: 1, control_id: 'PR.AC-1', title: 'Identities are managed', description: null, category: 'Protect' },
  { id: 12, framework_id: 1, control_id: 'DE.CM-1', title: 'Networks are monitored', description: null, category: 'Detect' },
];
const assessments = [
  { id: 5, control_id: 11, status: 'compliant', evidence_type: null, evidence_detail: null, assessed_at: '2026-11-10T08:00:00Z', assessed_by: 'analyst' },
];

function mockOverview() {
  get.mockImplementation(async (url: string) => {
    if (url === '/compliance/frameworks') return { data: frameworks };
    if (url === '/compliance/summary') return { data: summaries };
    if (url === '/compliance/frameworks/1/controls') return { data: controls };
    if (url === '/compliance/assessments') return { data: assessments };
    throw new Error(`unexpected ${url}`);
  });
}

beforeEach(() => { vi.resetAllMocks(); mockOverview(); patch.mockResolvedValue({ data: {} }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Compliance page', () => {
  it('renders framework cards with progress and assessment counts', async () => {
    render(<Compliance />);
    await screen.findByText('NIST CSF');
    expect(screen.getByText('IEC 62443')).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: 'NIST CSF compliance' });
    expect(bar.getAttribute('aria-valuenow')).toBe('60');
    expect(screen.getByText('6 compliant · 2 partial · 1 non-compliant · 1 not assessed')).toBeTruthy();
  });

  it('expands a framework to show controls with their assessment status', async () => {
    render(<Compliance />);
    fireEvent.click(await screen.findByText('NIST CSF'));
    await screen.findByText('PR.AC-1');
    expect(screen.getByText('Identities are managed')).toBeTruthy();
    expect((screen.getByRole('combobox', { name: 'Set status for PR.AC-1' }) as HTMLSelectElement).value).toBe('compliant');
    expect(screen.getAllByText('Not assessed').length).toBeGreaterThan(0);
    expect(screen.getByText('Networks are monitored')).toBeTruthy();
  });

  it('collapses the controls table when the same framework is clicked again', async () => {
    render(<Compliance />);
    fireEvent.click(await screen.findByText('NIST CSF'));
    await screen.findByText('PR.AC-1');
    fireEvent.click(screen.getByText('NIST CSF'));
    await waitFor(() => expect(screen.queryByText('PR.AC-1')).toBeNull());
  });

  it('shows the error state when the overview fails', async () => {
    get.mockRejectedValue(new Error('offline'));
    render(<Compliance />);
    await screen.findByText('Compliance unavailable');
  });
});
describe('Control search and status filter', () => {
  it('filters controls by ID or title substring', async () => {
    render(<Compliance />);
    fireEvent.click(await screen.findByText('NIST CSF'));
    await screen.findByText('PR.AC-1');
    fireEvent.change(screen.getByLabelText('Search controls'), { target: { value: 'networks' } });
    expect(screen.queryByText('PR.AC-1')).toBeNull();
    expect(screen.getByText('DE.CM-1')).toBeTruthy();
    expect(screen.getByText('1 of 2 controls')).toBeTruthy();
  });

  it('filters controls by effective assessment status', async () => {
    render(<Compliance />);
    fireEvent.click(await screen.findByText('NIST CSF'));
    await screen.findByText('PR.AC-1');
    fireEvent.change(screen.getByLabelText('Filter controls by status'), { target: { value: 'not_assessed' } });
    expect(screen.queryByText('PR.AC-1')).toBeNull();
    expect(screen.getByText('DE.CM-1')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Filter controls by status'), { target: { value: 'compliant' } });
    expect(screen.getByText('PR.AC-1')).toBeTruthy();
    expect(screen.queryByText('DE.CM-1')).toBeNull();
  });
});

describe('Assessment status updates', () => {
  it('updates an assessment status and saves it to the API', async () => {
    render(<Compliance />);
    fireEvent.click(await screen.findByText('NIST CSF'));
    const select = await screen.findByRole('combobox', { name: 'Set status for PR.AC-1' });
    fireEvent.change(select, { target: { value: 'partial' } });
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/compliance/assessments/5', { status: 'partial' }));
    expect((select as HTMLSelectElement).value).toBe('partial');
  });

  it('reverts the status and shows an error when the update fails', async () => {
    patch.mockRejectedValue(new Error('offline'));
    render(<Compliance />);
    fireEvent.click(await screen.findByText('NIST CSF'));
    const select = await screen.findByRole('combobox', { name: 'Set status for PR.AC-1' });
    fireEvent.change(select, { target: { value: 'non_compliant' } });
    await waitFor(() => expect(patch).toHaveBeenCalled());
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe('compliant'));
  });

  it('offers no editor for controls that have never been assessed', async () => {
    render(<Compliance />);
    fireEvent.click(await screen.findByText('NIST CSF'));
    await screen.findByText('DE.CM-1');
    expect(screen.queryByRole('combobox', { name: 'Set status for DE.CM-1' })).toBeNull();
  });
});

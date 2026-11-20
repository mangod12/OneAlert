import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { Compliance } from './Compliance';

vi.mock('../api/client', () => ({ default: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));

const get = vi.mocked(apiClient.get);
const patch = vi.mocked(apiClient.patch);
const post = vi.mocked(apiClient.post);

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
    if (url === '/compliance/assessments/5/review') return { data: { assessment: assessments[0], reviewed_fingerprint: 'a'.repeat(64) } };
    throw new Error(`unexpected ${url}`);
  });
}

beforeEach(() => { vi.resetAllMocks(); mockOverview(); patch.mockResolvedValue({ data: {} }); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Automated assessment', () => {
  it('runs the automated assessment and refreshes the overview', async () => {
    post.mockResolvedValue({ data: { data: { total: 11 } } });
    render(<Compliance />);
    await screen.findByText('NIST CSF');
    get.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Run automated assessment' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/compliance/assess'));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/compliance/summary'));
  });

  it('reloads the open framework controls after an assessment', async () => {
    post.mockResolvedValue({ data: { data: { total: 11 } } });
    render(<Compliance />);
    fireEvent.click(await screen.findByText('NIST CSF'));
    await screen.findByText('PR.AC-1');
    get.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Run automated assessment' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/compliance/frameworks/1/controls'));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/compliance/assessments'));
  });
});

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

describe('Reviewed assessment changes', () => {
  it('opens a current saved assessment review instead of immediately changing status', async () => {
    patch.mockResolvedValue({ data: { ...assessments[0], status: 'partial' } });
    render(<Compliance />);
    fireEvent.click(await screen.findByText('NIST CSF'));
    const select = await screen.findByRole('combobox', { name: 'Set status for PR.AC-1' });
    fireEvent.change(select, { target: { value: 'partial' } });
    await screen.findByText('Saved status: compliant');
    expect(patch).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Review status')).toHaveProperty('value', 'partial');
    fireEvent.click(screen.getByRole('button', { name: 'Save reviewed assessment' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(patch).toHaveBeenCalledWith('/compliance/assessments/5', { status: 'partial', evidence_type: null, evidence_detail: null }, { params: { reviewed_fingerprint: 'a'.repeat(64) } });
    expect(select).toHaveProperty('value', 'partial');
  });
  it('cancels a proposed status change without changing the table or sending a write', async () => {
    render(<Compliance />); fireEvent.click(await screen.findByText('NIST CSF'));
    const select = await screen.findByRole('combobox', { name: 'Set status for PR.AC-1' });
    fireEvent.change(select, { target: { value: 'non_compliant' } });
    await screen.findByText('Saved status: compliant');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(select).toHaveProperty('value', 'compliant'); expect(patch).not.toHaveBeenCalled();
  });
  it('opens exact current evidence from the control row', async () => {
    render(<Compliance />); fireEvent.click(await screen.findByText('NIST CSF'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit evidence for PR.AC-1' }));
    await screen.findByText('Saved status: compliant');
    expect(get).toHaveBeenCalledWith('/compliance/assessments/5/review');
    expect(screen.getByLabelText('Details')).toHaveProperty('value', '');
    expect(patch).not.toHaveBeenCalled();
  });
  it('offers a new manual assessment, not a saved-record edit, for unassessed controls', async () => {
    render(<Compliance />); fireEvent.click(await screen.findByText('NIST CSF')); await screen.findByText('DE.CM-1');
    expect(screen.queryByRole('combobox', { name: 'Set status for DE.CM-1' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit evidence for DE.CM-1' })).toBeNull();
  });
});

describe('Compliance CSV export', () => {
  it('downloads the CSV for the expanded framework', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:compliance');
    URL.revokeObjectURL = vi.fn();
    const clicks: string[] = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
      const el = origCreate(tag, options);
      if (tag === 'a') {
        Object.defineProperty(el, 'download', { set: (v: string) => clicks.push(v), configurable: true });
        el.click = () => clicks.push('clicked');
      }
      return el;
    });
    get.mockImplementation(async (url: string, config?: unknown) => {
      if (url === '/compliance/export') return { data: new Blob(['csv']) , config };
      if (url === '/compliance/frameworks') return { data: frameworks };
      if (url === '/compliance/summary') return { data: summaries };
      if (url === '/compliance/frameworks/1/controls') return { data: controls };
      if (url === '/compliance/assessments') return { data: assessments };
      throw new Error(`unexpected ${url}`);
    });
    render(<Compliance />);
    fireEvent.click(await screen.findByText('NIST CSF'));
    fireEvent.click(await screen.findByRole('button', { name: /export csv/i }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/compliance/export', { params: { framework_id: '1' }, responseType: 'blob' }));
    await waitFor(() => expect(clicks).toContain('compliance-1.csv'));
  });
});


describe('Compliance framework request identity', () => {
  it.each(['success', 'failure'])('ignores obsolete controls %s from another framework', async outcome => {
    let resolveOld!: (value: unknown) => void;
    let rejectOld!: (error: Error) => void;
    get.mockImplementation((url: string) => {
      if (url === '/compliance/frameworks') return Promise.resolve({ data: frameworks });
      if (url === '/compliance/summary') return Promise.resolve({ data: summaries });
      if (url === '/compliance/assessments') return Promise.resolve({ data: assessments });
      if (url.endsWith('/1/controls')) return new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; });
      return Promise.resolve({ data: [{ ...controls[0], id: 21, framework_id: 2, control_id: 'IEC-CURRENT', title: 'Current framework control' }] });
    });
    render(<Compliance />);
    fireEvent.click(await screen.findByText('NIST CSF'));
    fireEvent.click(screen.getByText('IEC 62443'));
    await screen.findByText('IEC-CURRENT');
    await act(async () => { if (outcome === 'success') resolveOld({ data: controls }); else rejectOld(new Error('Old framework failure')); });
    expect(screen.getByText('IEC-CURRENT')).toBeTruthy();
    expect(screen.queryByText('PR.AC-1')).toBeNull();
    expect(screen.queryByText('Old framework failure')).toBeNull();
  });
  it('does not reuse a collapsed framework result when another framework opens', async () => {
    let resolveOld!: (value: unknown) => void;
    get.mockImplementation((url: string) => {
      if (url === '/compliance/frameworks') return Promise.resolve({ data: frameworks });
      if (url === '/compliance/summary') return Promise.resolve({ data: summaries });
      if (url === '/compliance/assessments') return Promise.resolve({ data: [] });
      if (url.endsWith('/1/controls')) return new Promise(resolve => { resolveOld = resolve; });
      return Promise.resolve({ data: [] });
    });
    render(<Compliance />);
    fireEvent.click(await screen.findByText('NIST CSF'));
    fireEvent.click(screen.getByText('NIST CSF'));
    await act(async () => { resolveOld({ data: controls }); });
    fireEvent.click(screen.getByText('IEC 62443'));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/compliance/frameworks/2/controls'));
    expect(screen.queryByText('PR.AC-1')).toBeNull();
  });
});


it('retries controls without collapsing the selected framework', async () => {
  let fail = true;
  get.mockImplementation(async (url: string) => {
    if (url === '/compliance/frameworks') return { data: frameworks };
    if (url === '/compliance/summary') return { data: summaries };
    if (url === '/compliance/assessments') return { data: assessments };
    if (fail) throw new Error('Controls temporarily unavailable');
    return { data: controls };
  });
  render(<Compliance />);
  fireEvent.click(await screen.findByText('NIST CSF'));
  expect(await screen.findByText('Controls unavailable')).toBeTruthy();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('PR.AC-1')).toBeTruthy();
  expect(screen.getByRole('button', { name: /NIST CSF 2.0/ }).getAttribute('aria-expanded')).toBe('true');
  expect(get.mock.calls.filter(([url]) => url === '/compliance/frameworks/1/controls').length).toBe(2);
});

it('shows not-applicable controls separately and refreshes posture after a saved status', async () => {
  let changed = false;
  get.mockImplementation(async url => {
    if (url === '/compliance/frameworks') return { data: frameworks };
    if (url === '/compliance/summary') return { data: [{ ...summaries[0], not_assessed: 0, not_applicable: 1, compliance_percentage: changed ? 50 : 60 }] };
    if (url === '/compliance/assessments') return { data: [...assessments, { ...assessments[0], id: 6, status: 'partial' }] };
    if (url === '/compliance/assessments/6/review') return { data: { assessment: { ...assessments[0], id: 6, status: 'partial' }, reviewed_fingerprint: 'a'.repeat(64) } };
    return { data: controls };
  });
  patch.mockImplementation(async () => { changed = true; return { data: { ...assessments[0], id: 6, status: 'non_compliant' } }; });
  render(<Compliance />);
  fireEvent.click(await screen.findByText('NIST CSF'));
  const select = await screen.findByLabelText('Set status for PR.AC-1');
  expect(select).toHaveProperty('value', 'partial');
  expect(screen.getByText(/0 not assessed · 1 not applicable/)).toBeTruthy();
  fireEvent.change(select, { target: { value: 'non_compliant' } });
  await screen.findByText('Saved status: partial');
  fireEvent.click(screen.getByRole('button', { name: 'Save reviewed assessment' }));
  await waitFor(() => expect(screen.getByRole('progressbar', { name: 'NIST CSF compliance' }).getAttribute('aria-valuenow')).toBe('50'));
});

it('keeps a saved status and offers independent posture retry if the refresh fails', async () => {
  render(<Compliance />);
  fireEvent.click(await screen.findByText('NIST CSF'));
  const select = await screen.findByLabelText('Set status for PR.AC-1');
  patch.mockResolvedValue({ data: { ...assessments[0], status: 'partial' } });
  fireEvent.change(select, { target: { value: 'partial' } });
  await screen.findByText('Saved status: compliant');
  get.mockRejectedValueOnce(new Error('posture offline'));
  fireEvent.click(screen.getByRole('button', { name: 'Save reviewed assessment' }));
  await screen.findByText(/cards may be out of date/);
  expect(select).toHaveProperty('value', 'partial');
  const reads = get.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Retry posture' }));
  await waitFor(() => expect(screen.queryByText(/cards may be out of date/)).toBeNull());
  expect(get.mock.calls.slice(reads)).toEqual([['/compliance/summary']]);
  expect(patch).toHaveBeenCalledTimes(1);
  expect(post).not.toHaveBeenCalled();
});

it('records the first manual control assessment without automated execution', async () => {
  post.mockResolvedValue({ data: { ...assessments[0], id: 20, control_id: 12, status: 'partial', evidence_type: 'manual', evidence_detail: 'Reviewed policy' } });
  render(<Compliance />);
  fireEvent.click(await screen.findByText('NIST CSF'));
  fireEvent.click(await screen.findByLabelText('Assess control DE.CM-1'));
  expect(screen.getByText(/Saving does not run an automated assessment/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Review status'), { target: { value: 'partial' } });
  fireEvent.change(screen.getByLabelText('Details'), { target: { value: 'Reviewed policy' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save manual assessment' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(post).toHaveBeenCalledExactlyOnceWith('/compliance/controls/12/assessments', { status: 'partial', evidence_type: 'manual', evidence_detail: 'Reviewed policy' });
  expect(screen.getByLabelText('Set status for DE.CM-1')).toHaveProperty('value', 'partial');
  expect(get.mock.calls.filter(([url]) => url === '/compliance/summary')).toHaveLength(2);
});

it('keeps a failed manual review draft and supports retry without automation', async () => {
  post.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ data: { ...assessments[0], id: 20, control_id: 12, status: 'partial' } });
  render(<Compliance />);
  fireEvent.click(await screen.findByText('NIST CSF'));
  fireEvent.click(await screen.findByLabelText('Assess control DE.CM-1'));
  fireEvent.change(screen.getByLabelText('Details'), { target: { value: 'Retained manual evidence' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save manual assessment' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save manual assessment' })).toHaveProperty('disabled', false));
  expect(screen.getByLabelText('Details')).toHaveProperty('value', 'Retained manual evidence');
  fireEvent.click(screen.getByRole('button', { name: 'Save manual assessment' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(post.mock.calls.every(([url]) => url === '/compliance/controls/12/assessments')).toBe(true);
});

it('records a new review without removing the earlier evidence and browses it newest first', async () => {
  const reviewed = { ...assessments[0], id: 9, status: 'partial', evidence_detail: 'New retained evidence', assessed_at: '2026-11-20T08:00:00Z' };
  post.mockResolvedValue({ data: reviewed });
  render(<Compliance />);
  fireEvent.click(await screen.findByText('NIST CSF'));
  fireEvent.click(await screen.findByLabelText('New review for PR.AC-1'));
  fireEvent.change(screen.getByLabelText('Review status'), { target: { value: 'partial' } });
  fireEvent.change(screen.getByLabelText('Details'), { target: { value: reviewed.evidence_detail } });
  fireEvent.click(screen.getByRole('button', { name: 'Save manual assessment' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByLabelText('Assessment history for PR.AC-1'));
  expect(screen.getByRole('dialog', { name: 'Assessment history for PR.AC-1' })).toBeTruthy();
  expect(screen.getByText('Latest saved record · #9')).toBeTruthy();
  expect(screen.getByText('Earlier saved record · #5')).toBeTruthy();
  expect(screen.getByText('New retained evidence')).toBeTruthy();
  expect(screen.getByText(/not a separate audit history/)).toBeTruthy();
  expect(post).toHaveBeenCalledExactlyOnceWith('/compliance/controls/11/assessments', expect.objectContaining({ status: 'partial' }));
});

it('pages saved assessment history locally and keeps higher IDs first on timestamp ties', async () => {
  const records = Array.from({ length: 23 }, (_, index) => ({ ...assessments[0], id: index + 1, evidence_detail: `Retained record ${index + 1}` }));
  get.mockImplementation(async url => {
    if (url === '/compliance/frameworks') return { data: frameworks };
    if (url === '/compliance/summary') return { data: summaries };
    if (url === '/compliance/assessments') return { data: records };
    return { data: controls };
  });
  render(<Compliance />);
  fireEvent.click(await screen.findByText('NIST CSF'));
  fireEvent.click(await screen.findByLabelText('Assessment history for PR.AC-1'));
  expect(screen.getByText('Latest saved record · #23')).toBeTruthy();
  expect(screen.queryByText('Retained record 13')).toBeNull();
  const reads = get.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'More records' }));
  expect(screen.getByText('Retained record 13')).toBeTruthy();
  expect(screen.getByText('Page 2 of 3')).toBeTruthy();
  expect(get).toHaveBeenCalledTimes(reads);
  expect(post).not.toHaveBeenCalled();
  expect(patch).not.toHaveBeenCalled();
});

it('selects exact assessment records across history pages and reloads them for comparison without writes', async () => {
  const records = Array.from({ length: 23 }, (_, index) => ({ ...assessments[0], id: index + 1, evidence_detail: `Saved evidence ${index + 1}` }));
  get.mockImplementation(async url => {
    if (url === '/compliance/frameworks') return { data: frameworks };
    if (url === '/compliance/summary') return { data: summaries };
    if (url === '/compliance/assessments') return { data: records };
    if (/\/compliance\/assessments\/\d+$/.test(url)) return { data: records.find(record => record.id === Number(url.split('/').at(-1))) };
    return { data: controls };
  });
  render(<Compliance />);
  fireEvent.click(await screen.findByText('NIST CSF'));
  fireEvent.click(await screen.findByLabelText('Assessment history for PR.AC-1'));
  fireEvent.click(screen.getByLabelText('Select assessment 23 for comparison'));
  fireEvent.click(screen.getByRole('button', { name: 'More records' }));
  fireEvent.click(screen.getByLabelText('Select assessment 13 for comparison'));
  expect(screen.getByText('Selection: #23 → #13')).toBeTruthy();
  const reads = get.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Load selected assessment comparison' }));
  await screen.findByText(/1 of 5 recorded fields differ/);
  expect(get.mock.calls.slice(reads).map(call => call[0])).toEqual(['/compliance/assessments/23', '/compliance/assessments/13']);
  expect(post).not.toHaveBeenCalled(); expect(patch).not.toHaveBeenCalled();
});

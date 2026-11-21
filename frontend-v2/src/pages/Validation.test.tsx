import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { toast } from '../components/Toast';
vi.mock('../components/Toast', () => ({ toast: vi.fn() }));
import { Validation } from './Validation';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
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

describe('Validation run confirmation', () => {
  it('runs only after confirming in the dialog', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { data: [{ ...run, status: 'pending' }] } });
    vi.mocked(apiClient.post).mockResolvedValue({ data: {} });
    render(<Validation />);
    fireEvent.click(await screen.findByRole('button', { name: 'Run' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(vi.mocked(apiClient.post)).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    await waitFor(() => expect(vi.mocked(apiClient.post)).toHaveBeenCalledWith('/validation/runs/8/execute'));
  });

  it('cancelling the dialog leaves the run untouched', async () => {
    vi.mocked(apiClient.get).mockResolvedValue({ data: { data: [{ ...run, status: 'pending' }] } });
    vi.mocked(apiClient.post).mockResolvedValue({ data: {} });
    render(<Validation />);
    fireEvent.click(await screen.findByRole('button', { name: 'Run' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await screen.findByRole('button', { name: 'Run' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(vi.mocked(apiClient.post)).not.toHaveBeenCalled();
  });
});

describe('Run status filter', () => {
  it('sends the chosen status to the API', async () => {
    const get = vi.mocked(apiClient.get);
    render(<Validation />);
    const select = await screen.findByLabelText('Filter runs by status');
    await waitFor(() => expect(get).toHaveBeenCalledWith('/validation/runs', { params: { page: 1, size: 20 } }));
    fireEvent.change(select, { target: { value: 'failed' } });
    await waitFor(() => {
      expect(get).toHaveBeenCalledWith('/validation/runs', { params: { page: 1, size: 20, status: 'failed' } });
    });
  });
});

describe('Validation coverage panel', () => {
  const coverage = [
    { technique_id: 'T1110', technique_name: 'Brute Force', total_tests: 4, detections: 3, detection_rate: 75 },
    { technique_id: 'T1046', technique_name: 'Network Service Discovery', total_tests: 3, detections: 1, detection_rate: 33.3 },
  ];

  const mockWithCoverage = (coverageResult: 'ok' | 'fail') => {
    vi.mocked(apiClient.get).mockImplementation(url => {
      if (url.endsWith('/coverage')) {
        return coverageResult === 'ok'
          ? Promise.resolve({ data: { data: coverage } })
          : Promise.reject(new Error('Coverage unavailable'));
      }
      return Promise.resolve({ data: { data: [run] } });
    });
  };

  it('renders per-technique detection rates', async () => {
    mockWithCoverage('ok');
    render(<Validation />);
    expect(await screen.findByText('Detection Coverage by Technique')).toBeTruthy();
    expect(screen.getByText('Brute Force')).toBeTruthy();
    expect(screen.getByText('3/4 detected')).toBeTruthy();
    expect(screen.getByText('75%')).toBeTruthy();
    expect(screen.getByText('33.3%')).toBeTruthy();
  });

  it('keeps the runs list and flags the coverage failure when coverage fails', async () => {
    mockWithCoverage('fail');
    render(<Validation />);
    expect(await screen.findByText('Perimeter check')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Coverage unavailable');
    expect(screen.queryByText('Validation unavailable')).toBeNull();
  });
});

describe('Delete validation run', () => {
  it('deletes a run after confirmation and refreshes the list', async () => {
    const del = vi.mocked(apiClient.delete);
    del.mockResolvedValue({ data: null });
    render(<Validation />);
    await screen.findByText('Perimeter check');
    const get = vi.mocked(apiClient.get);
    get.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Delete validation run Perimeter check' }));
    expect((await screen.findByText(/Its steps and recorded results are removed permanently/)).textContent).toContain('removed permanently');
    fireEvent.click(screen.getByRole('button', { name: 'Delete run' }));

    await waitFor(() => expect(del).toHaveBeenCalledWith('/validation/runs/8'));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/validation/runs', expect.anything()));
  });

  it('keeps the run when the dialog is cancelled', async () => {
    const del = vi.mocked(apiClient.delete);
    render(<Validation />);
    await screen.findByText('Perimeter check');

    fireEvent.click(screen.getByRole('button', { name: 'Delete validation run Perimeter check' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(del).not.toHaveBeenCalled();
    expect(screen.getByText('Perimeter check')).toBeTruthy();
  });
});

describe('Export validation run', () => {
  it('downloads the run results as CSV from the detail panel', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:validation');
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
    const get = vi.mocked(apiClient.get);
    get.mockImplementation(async (url: string) => {
      if (url === '/validation/runs/8/export') return { data: new Blob(['csv']) };
      return { data: { data: url.endsWith('/8') ? run : [run] } };
    });
    render(<Validation />);
    fireEvent.click(await screen.findByRole('button', { name: 'View results for Perimeter check' }));
    fireEvent.click(await screen.findByRole('button', { name: /export csv/i }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/validation/runs/8/export', { responseType: 'blob' }));
    await waitFor(() => expect(clicks).toContain('validation-run-8.csv'));
  });
});


describe('Validation detail request identity', () => {
  it.each(['success', 'failure'])('ignores an obsolete detail %s after another run is selected', async result => {
    let resolveOld!: (value: unknown) => void;
    let rejectOld!: (error: Error) => void;
    vi.mocked(apiClient.get).mockImplementation(url => {
      if (url === '/validation/runs/8') return new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; });
      if (url === '/validation/runs/9') return Promise.resolve({ data: { data: { ...run, id: 9, name: 'Current check', steps: [{ ...run.steps[0], test_name: 'Current evidence' }] } } });
      return Promise.resolve({ data: { data: [{ ...run }, { ...run, id: 9, name: 'Current check' }] } });
    });
    render(<Validation />);
    fireEvent.click(await screen.findByRole('button', { name: 'View results for Perimeter check' }));
    fireEvent.click(screen.getByRole('button', { name: 'View results for Current check' }));
    await screen.findByText('Current evidence');
    await act(async () => { if (result === 'success') resolveOld({ data: { data: run } }); else rejectOld(new Error('Old detail failure')); });
    expect(screen.getByText('Current evidence')).toBeTruthy();
    expect(screen.queryByText('Missed password guessing')).toBeNull();
    expect(screen.queryByText('Old detail failure')).toBeNull();
  });
  it('clears old evidence on failure and retries the selected run', async () => {
    let fail = false;
    vi.mocked(apiClient.get).mockImplementation(async url => {
      if (url.endsWith('/8')) { if (fail) throw new Error('Detail unavailable'); return { data: { data: run } }; }
      return { data: { data: [run] } };
    });
    await openResults();
    fail = true;
    fireEvent.click(screen.getByRole('button', { name: 'View results for Perimeter check' }));
    expect(await screen.findByText('Detail unavailable')).toBeTruthy();
    expect(screen.queryByText('Missed password guessing')).toBeNull();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry run details' }));
    expect(await screen.findByText('Missed password guessing')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close results' }));
    expect(screen.queryByText('Missed password guessing')).toBeNull();
  });
  it('rejects a detail payload for the wrong run', async () => {
    vi.mocked(apiClient.get).mockImplementation(async url => ({ data: { data: url.endsWith('/8') ? { ...run, id: 99 } : [run] } }));
    render(<Validation />);
    fireEvent.click(await screen.findByRole('button', { name: 'View results for Perimeter check' }));
    expect(await screen.findByText('The response did not match this validation run. Try again.')).toBeTruthy();
    expect(screen.queryByText('Missed password guessing')).toBeNull();
  });
});


describe('Validation run history navigation', () => {
  it('reaches later runs, preserves the status and resets to page one on filter changes', async () => {
    vi.mocked(apiClient.get).mockImplementation(async (url, config) => {
      if (url.endsWith('/coverage')) return { data: { data: [] } };
      const page = (config?.params as { page: number }).page;
      return { data: { data: [{ ...run, id: page, name: `Run page ${page}` }], total: 21 } };
    });
    render(<Validation />);
    await screen.findByText('Run page 1');
    fireEvent.click(screen.getByRole('button', { name: 'Next runs' }));
    expect(await screen.findByText('Run page 2')).toBeTruthy();
    expect(screen.getByText('Showing 21–21 of 21 matching runs · Page 2 of 2')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Next runs' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Filter runs by status'), { target: { value: 'completed' } });
    expect(await screen.findByText('Run page 1')).toBeTruthy();
    expect(vi.mocked(apiClient.get)).toHaveBeenCalledWith('/validation/runs', { params: { page: 1, size: 20, status: 'completed' } });
  });
  it.each(['success', 'failure'])('ignores an obsolete list %s after a newer filter result', async outcome => {
    let resolveOld!: (value: unknown) => void;
    let rejectOld!: (error: Error) => void;
    vi.mocked(apiClient.get).mockImplementation((url, config) => {
      if (url.endsWith('/coverage')) return Promise.resolve({ data: { data: [] } });
      if ((config?.params as { status?: string })?.status === 'failed') return new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; });
      return Promise.resolve({ data: { data: [{ ...run, name: 'Current filtered run' }], total: 1 } });
    });
    render(<Validation />);
    await screen.findByText('Current filtered run');
    const select = screen.getByLabelText('Filter runs by status');
    fireEvent.change(select, { target: { value: 'failed' } });
    fireEvent.change(select, { target: { value: 'completed' } });
    await screen.findByText('Current filtered run');
    await act(async () => { if (outcome === 'success') resolveOld({ data: { data: [run], total: 1 } }); else rejectOld(new Error('Obsolete list failure')); });
    expect(screen.getByText('Current filtered run')).toBeTruthy();
    expect(screen.queryByText('Perimeter check')).toBeNull();
    expect(screen.queryByText('Obsolete list failure')).toBeNull();
  });
});


describe('Recorded validation control evidence', () => {
  it('shows per-control expectations, detections, timings and details without execution', async () => {
    const detail = { ...run, steps: [{ ...run.steps[0], simulated: true, status: 'completed', test_type: 'atomic', executed_at: '2026-11-20T03:00:00Z', controls: [
      { id: 1, control_name: 'Simulated password guard', control_type: 'sigma', expected: true, detected: false, detection_time_ms: null, details: 'Synthetic missed result.\nReview the configured control.' },
      { id: 2, control_name: 'Synthetic telemetry check', control_type: 'manual', expected: false, detected: true, detection_time_ms: 0, details: null },
    ] }] };
    vi.mocked(apiClient.get).mockImplementation(async url => ({ data: { data: url.endsWith('/8') ? detail : [run] } }));
    render(<Validation />);
    fireEvent.click(await screen.findByRole('button', { name: 'View results for Perimeter check' }));
    const summary = await screen.findByLabelText('Inspect recorded evidence for T1110: Missed password guessing');
    fireEvent.click(summary);
    expect(screen.getByText('Simulated password guard')).toBeTruthy();
    expect(screen.getByText('Expected to detect: Yes · Recorded detection: No')).toBeTruthy();
    expect(screen.getByText('Expected to detect: No · Recorded detection: Yes')).toBeTruthy();
    expect(screen.getByText('Recorded detection time: 0 ms')).toBeTruthy();
    expect(screen.getByText('Recorded detection time: Not recorded')).toBeTruthy();
    expect(screen.getByText('No control detail recorded.')).toBeTruthy();
    expect(screen.getByText(/Synthetic missed result/).textContent).toContain('Review the configured control.');
    expect(screen.getByText('Simulated')).toBeTruthy();
    expect(vi.mocked(apiClient.post)).not.toHaveBeenCalled();
  });
  it('labels absent control and execution records without making a live-detection claim', async () => {
    await openResults();
    expect(screen.getAllByText('No control results recorded for this step.').length).toBe(3);
    expect(screen.getAllByText(/Missing records do not establish that no detection occurred/).length).toBe(3);
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThan(3);
  });
  it('distinguishes recorded non-simulated steps and retains unparseable times', async () => {
    const detail = { ...run, steps: [{ ...run.steps[0], simulated: false, executed_at: 'unverified-clock' }] };
    vi.mocked(apiClient.get).mockImplementation(async url => ({ data: { data: url.endsWith('/8') ? detail : [run] } }));
    render(<Validation />);
    fireEvent.click(await screen.findByRole('button', { name: 'View results for Perimeter check' }));
    expect(await screen.findByText('Recorded as non-simulated')).toBeTruthy();
    expect(screen.getByText('unverified-clock')).toBeTruthy();
  });
});

it('retries optional validation coverage without reloading or executing runs', async () => {
  let fail = true;
  vi.mocked(apiClient.get).mockImplementation(url => url === '/validation/coverage' ? fail ? Promise.reject(new Error('Coverage offline')) : Promise.resolve({ data: { data: [{ technique_id: 'T1110', technique_name: 'Brute Force', total_tests: 2, detections: 1, detection_rate: 50 }] } }) : Promise.resolve({ data: { data: [run], total: 1 } }));
  render(<Validation />);
  await screen.findByRole('button', { name: 'Retry validation coverage' });
  expect(screen.getByRole('button', { name: 'View results for Perimeter check' })).toBeTruthy();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry validation coverage' }));
  expect(await screen.findByText('1/2 detected')).toBeTruthy();
  expect(vi.mocked(apiClient.get).mock.calls.filter(([url]) => url === '/validation/runs')).toHaveLength(1);
  expect(vi.mocked(apiClient.post)).not.toHaveBeenCalled();
});

it('pages and searches saved control evidence and exports all matches without execution', async () => {
  const steps = Array.from({ length: 23 }, (_, index) => ({ ...run.steps[0], id: index, test_name: `Retained test ${index}`, controls: [{ id: index, control_name: 'Retained guard', control_type: 'sigma', expected: true, detected: false, detection_time_ms: 0, details: index === 22 ? 'Distinct stored control evidence' : null }] }));
  vi.mocked(apiClient.get).mockImplementation(url => Promise.resolve({ data: { data: url.endsWith('/8') ? { ...run, steps } : url.endsWith('/coverage') ? [] : [run] } }));
  Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(() => 'blob:evidence'), configurable: true });
  Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), configurable: true });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<Validation />);
  fireEvent.click(await screen.findByRole('button', { name: 'View results for Perimeter check' }));
  await screen.findByText('Retained test 0');
  expect(screen.queryByText('Retained test 10')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'More evidence' }));
  expect(screen.getByText('Retained test 10')).toBeTruthy();
  const reads = vi.mocked(apiClient.get).mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Export filtered evidence' }));
  expect(click).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByLabelText('Search recorded validation evidence'), { target: { value: 'distinct stored' } });
  expect(screen.getByText('Retained test 22')).toBeTruthy();
  expect(screen.getByText('Evidence page 1 of 1')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Detected (0)' }));
  expect(screen.getByRole('button', { name: 'Export filtered evidence' })).toHaveProperty('disabled', true);
  expect(vi.mocked(apiClient.get).mock.calls.length).toBe(reads);
  expect(vi.mocked(apiClient.post)).not.toHaveBeenCalled();
});

it('opens read-only outcome comparison from recorded results without executing a test', async () => {
  const get = vi.mocked(apiClient.get);
  const fallback = get.getMockImplementation()!;
  get.mockImplementation((url, config) => url === '/validation/runs/7' ? Promise.resolve({ data: { data: { ...run, id: 7 } } }) : fallback(url, config));
  await openResults();
  fireEvent.click(screen.getByRole('button', { name: 'Compare recorded outcomes' }));
  fireEvent.change(screen.getByLabelText('Baseline validation run ID'), { target: { value: '7' } });
  fireEvent.click(screen.getByRole('button', { name: 'Compare outcomes' }));
  await screen.findByText('unchanged: 3');
  expect(vi.mocked(apiClient.post)).not.toHaveBeenCalled();
  expect(vi.mocked(apiClient.delete)).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Close comparison' }));
  expect(screen.queryByLabelText('Validation outcome comparison')).toBeNull();
});

it('renders new lab simulation plans as unmeasured, never a 0% or successful detection result', async () => {
  const plan = { ...run, mode: 'lab', results_summary: { measurement_mode: 'simulation_only', simulated_tests: 1,
    tested: 0, detected: 0, missed: 0, detection_rate: null, agent_run_id: 83 },
    steps: [{ id: 4, technique_id: 'T1110', test_name: 'Authentication simulation plan', actual_result: 'simulated_unmeasured',
      duration_ms: 0, simulated: true, executed_at: null, expected_detection: 'Sigma auth rule', controls: [] }] };
  vi.mocked(apiClient.get).mockImplementation(url => Promise.resolve({ data: { data: url.endsWith('/8') ? plan : [plan] } }));
  render(<Validation />); fireEvent.click(await screen.findByRole('button', { name: 'View results for Perimeter check' }));
  await screen.findByRole('region', { name: 'Unmeasured simulation outcome' });
  expect(screen.getByText('Simulated, not measured')).toBeTruthy(); expect(screen.getByRole('note').textContent).toContain('No commands executed');
  expect(screen.queryByText('0%')).toBeNull(); expect(screen.queryByText('Detection Rate')).toBeNull();
  expect(screen.getByRole('link', { name: 'Inspect exact simulation agent run #83' }).getAttribute('href')).toBe('/app/audit-log?run=83');
  fireEvent.click(screen.getByText('Inspect recorded evidence', { exact: true }));
  expect(screen.getByText('Planned expected detection, not an observation: Sigma auth rule')).toBeTruthy();
  expect(screen.getByText('No control results recorded for this step.')).toBeTruthy();
  expect(screen.getAllByText('Not recorded')[0]).toBeTruthy(); expect(apiClient.post).not.toHaveBeenCalled();
});
it('explains simulation-only execution and unavailable production before confirmation', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({ data: { data: [{ ...run, status: 'pending', mode: 'lab' }] } });
  render(<Validation />); fireEvent.click(await screen.findByRole('button', { name: 'Run' }));
  expect((await screen.findByRole('dialog')).textContent).toContain('No commands, network probes or live control checks');
  expect(screen.getByRole('dialog').textContent).toContain('Production execution is unavailable');
  expect(apiClient.post).not.toHaveBeenCalled();
});

it('does not claim unmeasured simulation success for a mismatched receipt', async () => {
  vi.mocked(apiClient.get).mockResolvedValue({ data: { data: [{ ...run, status: 'pending' }] } });
  vi.mocked(apiClient.post).mockResolvedValue({ data: { success: true, data: { run_id: 99, status: 'completed' } } });
  render(<Validation />); fireEvent.click(await screen.findByRole('button', { name: 'Run' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Run now' }));
  await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining('could not be verified'), 'error'));
  expect(toast).not.toHaveBeenCalledWith('Simulation plan prepared, detection not measured', 'success');
});
it('blocks repeated confirmation before the pending simulation receipt returns', async () => {
  let reject!: (error: unknown) => void;
  vi.mocked(apiClient.get).mockResolvedValue({ data: { data: [{ ...run, status: 'pending' }] } });
  vi.mocked(apiClient.post).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  render(<Validation />); fireEvent.click(await screen.findByRole('button', { name: 'Run' }));
  const confirm = await screen.findByRole('button', { name: 'Run now' }); fireEvent.click(confirm); fireEvent.click(confirm);
  expect(apiClient.post).toHaveBeenCalledTimes(1); await act(async () => reject({}));
  expect(toast).toHaveBeenCalledWith(expect.stringContaining('Read saved results before retrying'), 'error');
});

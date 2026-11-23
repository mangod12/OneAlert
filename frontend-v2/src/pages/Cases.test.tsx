import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cases } from './Cases';

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../components/Toast', () => ({ toast: vi.fn() }));

import apiClient from '../api/client';
import { toast } from '../components/Toast';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);
const mockPatch = vi.mocked(apiClient.patch);
const mockDelete = vi.mocked(apiClient.delete);
const mockToast = vi.mocked(toast);

interface CaseItem {
  id: number;
  title: string;
  summary: string | null;
  severity: string;
  status: string;
  confidence_score: number | null;
  mitre_tactics: string[] | null;
  created_by: string;
  created_at: string;
  alert_count: number;
  event_count: number;
}

function makeCase(overrides: Partial<CaseItem> = {}): CaseItem {
  return {
    id: 1,
    title: 'Credential dumping on edge router',
    summary: 'Multiple brute force alerts correlated.',
    severity: 'high',
    status: 'open',
    confidence_score: 0.87,
    mitre_tactics: ['Credential Access'],
    created_by: 'agent',
    created_at: '2026-11-16T10:00:00Z',
    alert_count: 4,
    event_count: 12,
    ...overrides,
  };
}

function renderCases() {
  return render(
    <MemoryRouter>
      <Cases />
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockGet.mockResolvedValue({ data: { cases: [makeCase()], total: 1 } });
  mockPost.mockResolvedValue({ data: {} });
});

describe('Cases page', () => {
  it('renders investigation cards linking to case details', async () => {
    renderCases();
    expect(await screen.findByText('Credential dumping on edge router')).toBeTruthy();
    expect(screen.getByText('high')).toBeTruthy();
    const link = screen.getByRole('link', { name: /credential dumping/i });
    expect(link.getAttribute('href')).toBe('/cases/1');
  });

  it('shows an error state and retries', async () => {
    mockGet.mockReset();
    mockGet.mockImplementation((url: string) => (
      url === '/orgs/me/members'
        ? Promise.resolve({ data: [] })
        : Promise.reject({ isAxiosError: true, response: { status: 500, data: {} } })
    ));
    renderCases();
    expect(await screen.findByText('Investigations could not be loaded.')).toBeTruthy();
    mockGet.mockImplementation((url: string) => Promise.resolve(
      url === '/orgs/me/members' ? { data: [] } : { data: { cases: [makeCase()], total: 1 } }
    ));
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(await screen.findByText('Credential dumping on edge router')).toBeTruthy();
  });

  it('shows the empty state and starts triage from it', async () => {
    mockGet.mockResolvedValue({ data: { cases: [], total: 0 } });
    renderCases();
    expect(await screen.findByText('No investigations yet')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: /run ai triage/i })[0]);
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/cases/auto-triage', null, { params: { hours_back: 72 } });
    });
  });

  it('runs AI triage from the header and refetches', async () => {
    renderCases();
    await screen.findByText('Credential dumping on edge router');
    fireEvent.click(screen.getByRole('button', { name: /run ai triage/i }));
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/cases/auto-triage', null, { params: { hours_back: 72 } });
      expect(mockGet.mock.calls.filter(([url]) => url === '/cases/')).toHaveLength(2);
    });
  });
});

describe('Agent pipeline', () => {
  it('runs the pipeline for the selected lookback and shows stage summaries', async () => {
    mockPost.mockImplementation(async (url: string) => {
      if (url === '/cases/pipeline') {
        return {
          data: {
            data: {
              detect: { summary: 'Analyzed 12 events, found 3 findings' },
              triage: { summary: 'Created 1 cases from 4 alerts and 12 events' },
              total_duration_ms: 1830,
              pipeline_status: 'completed',
            },
          },
        };
      }
      return { data: {} };
    });
    renderCases();
    await screen.findByText('Credential dumping on edge router');
    fireEvent.change(screen.getByLabelText('Pipeline lookback'), { target: { value: '72' } });
    fireEvent.click(screen.getByRole('button', { name: /run pipeline/i }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/cases/pipeline', null, { params: { hours_back: 72 } }));
    expect(await screen.findByText('Pipeline outcome: completed · 1.8s')).toBeTruthy();
    expect(screen.getByText('Detect: Analyzed 12 events, found 3 findings')).toBeTruthy();
    expect(screen.getByText('Triage: Created 1 cases from 4 alerts and 12 events')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /dismiss pipeline result/i }));
    expect(screen.queryByText(/Pipeline outcome:/)).toBeNull();
  });

  it('shows an error toast when the pipeline fails', async () => {
    mockPost.mockRejectedValue({ isAxiosError: true, response: { status: 500, data: {} } });
    renderCases();
    await screen.findByText('Credential dumping on edge router');
    fireEvent.click(screen.getByRole('button', { name: /run pipeline/i }));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('could not be run'), 'error'));
    expect(screen.queryByText(/Pipeline outcome:/)).toBeNull();
  });
});

describe('Manual investigation creation', () => {
  it('opens a case from the dialog and refreshes the list', async () => {
    renderCases();
    await screen.findByText('Credential dumping on edge router');
    fireEvent.click(screen.getByRole('button', { name: /new investigation/i }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Suspicious USB activity' } });
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'New removable media on floor 3.' } });
    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'high' } });
    fireEvent.click(screen.getByRole('button', { name: /open investigation/i }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/cases/', { title: 'Suspicious USB activity', summary: 'New removable media on floor 3.', severity: 'high' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mockToast).toHaveBeenCalledWith('Investigation opened.', 'success');
    await waitFor(() => expect(mockGet.mock.calls.filter(([url]) => url === '/cases/')).toHaveLength(2));
  });

  it('keeps the submit disabled until a title is entered', async () => {
    renderCases();
    await screen.findByText('Credential dumping on edge router');
    fireEvent.click(screen.getByRole('button', { name: /new investigation/i }));
    const submit = screen.getByRole('button', { name: /open investigation/i }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Odd VPN logins' } });
    expect(submit.disabled).toBe(false);
  });
});

describe('Case search', () => {
  function mockList() {
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/cases/') return { data: { cases: [makeCase()], total: 1 } };
      if (url === '/cases/search') return { data: { success: true, data: [
        { case_id: 1, title: 'Credential dumping on edge router', score: 0.82, snippet: 'Multiple brute force alerts correlated.' },
      ], query: 'brute force' } };
      throw new Error(`unexpected ${url}`);
    });
  }

  it('searches in plain language and links results to their case', async () => {
    mockList();
    render(<MemoryRouter><Cases /></MemoryRouter>);
    await screen.findByText('Credential dumping on edge router');
    fireEvent.change(screen.getByLabelText('Search investigations'), { target: { value: 'brute force' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/cases/search', { params: { q: 'brute force' } }));
    expect(await screen.findByText('1 result for this search')).toBeTruthy();
    expect(screen.getByText('82% match')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(screen.queryByText('1 result for this search')).toBeNull();
  });

  it('shows an empty result state without touching the case list', async () => {
    mockList();
    mockGet.mockImplementation(async (url: string) => {
      if (url === '/cases/') return { data: { cases: [makeCase()], total: 1 } };
      if (url === '/cases/search') return { data: { success: true, data: [], query: 'ransomware' } };
      throw new Error(`unexpected ${url}`);
    });
    render(<MemoryRouter><Cases /></MemoryRouter>);
    await screen.findByText('Credential dumping on edge router');
    fireEvent.change(screen.getByLabelText('Search investigations'), { target: { value: 'ransomware' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('No investigations match that search.')).toBeTruthy();
    expect(screen.getByText('Credential dumping on edge router')).toBeTruthy();
  });
});

describe('Case quick status change', () => {
  it('updates the status from the list and toasts', async () => {
    mockPatch.mockResolvedValue({ data: {} });
    renderCases();
    const select = await screen.findByLabelText('Set status for case 1');
    expect(select).toHaveProperty('value', 'open');
    fireEvent.change(select, { target: { value: 'investigating' } });
    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/cases/1', null, { params: { status_update: 'investigating' } });
    });
    await waitFor(() => {
      expect(screen.getByLabelText('Set status for case 1')).toHaveProperty('value', 'investigating');
    });
    expect(mockToast).toHaveBeenCalledWith('Case #1 marked investigating.', 'success');
  });
});

describe('Case filters', () => {
  it('refetches with the selected status and severity', async () => {
    renderCases();
    await screen.findByText('Credential dumping on edge router');
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'open' } });
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/cases/', { params: { page: 1, size: 20, status: 'open', sort: 'created_at_desc' } }));
    fireEvent.change(screen.getByLabelText('Filter by severity'), { target: { value: 'high' } });
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/cases/', { params: { page: 1, size: 20, status: 'open', severity: 'high', sort: 'created_at_desc' } }));
  });

  it('refetches with assigned=me when the assignee filter changes', async () => {
    renderCases();
    await screen.findByText('Credential dumping on edge router');
    fireEvent.change(screen.getByLabelText('Filter by assignee'), { target: { value: 'me' } });
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/cases/', { params: { page: 1, size: 20, assigned: 'me', sort: 'created_at_desc' } }));
  });

  it('refetches with watching=me when the watched-by-me filter is chosen', async () => {
    mockGet.mockResolvedValue({ data: { cases: [makeCase()], total: 1 } });
    renderCases();
    await screen.findByText('Credential dumping on edge router');
    fireEvent.change(screen.getByLabelText('Filter by assignee'), { target: { value: 'watching' } });
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/cases/', { params: { page: 1, size: 20, watching: 'me', sort: 'created_at_desc' } }));
  });

  it('sends the chosen sort order to the API', async () => {
    mockGet.mockResolvedValue({ data: { cases: [makeCase()], total: 1 } });
    renderCases();
    await screen.findByText('Credential dumping on edge router');
    fireEvent.change(screen.getByLabelText('Sort investigations'), { target: { value: 'severity_desc' } });
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/cases/', { params: { page: 1, size: 20, sort: 'severity_desc' } });
    });
  });
});

describe('Cases pagination', () => {
  it('requests the next page and shows the page position', async () => {
    mockGet.mockResolvedValue({ data: { cases: [makeCase()], total: 45 } });
    renderCases();
    expect(await screen.findByText('Page 1 of 3')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/cases/', expect.objectContaining({
        params: expect.objectContaining({ page: 2, size: 20 }),
      }));
    });
  });

  it('resets to page 1 when a filter changes', async () => {
    mockGet.mockResolvedValue({ data: { cases: [makeCase()], total: 45 } });
    renderCases();
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/cases/', expect.objectContaining({
        params: expect.objectContaining({ page: 2 }),
      }));
    });
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'open' } });
    await waitFor(() => {
      expect(mockGet).toHaveBeenCalledWith('/cases/', expect.objectContaining({
        params: expect.objectContaining({ page: 1, status: 'open' }),
      }));
    });
  });
});

describe('Case bulk actions', () => {
  const twoCases = () => [
    makeCase({ id: 1 }),
    makeCase({ id: 2, title: 'Suspicious OAuth grant', severity: 'critical' }),
  ];

  const selectAll = async () => {
    expect(await screen.findByText('Credential dumping on edge router')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Select all investigations on this page'));
    expect(screen.getByText('2 selected')).toBeTruthy();
  };

  it('reviews selected close-out instead of sending immediate status writes', async () => {
    mockGet.mockImplementation(async url => {
      if (url === '/auth/me') return { data: { id: 5, email: 'a@example.test', role: 'analyst', org_id: 7, is_active: true } };
      if (url.endsWith('/closeout-review')) { const id = Number(url.split('/')[2]); return { data: { case_id: id, title: `Fresh case ${id}`, status: 'open', target_status: 'resolved', resolution: null, can_edit_resolution: true, task_total: 0, alert_total: 0, unavailable_alert_links: 0, reviewed_fingerprint: 'f'.repeat(64), open_tasks: [], remaining_alerts: [] } }; }
      if (url === '/cases/') return { data: { cases: [makeCase({ id: 1 }), makeCase({ id: 2 })], total: 2 } };
      return { data: { data: [] } };
    });
    renderCases();
    fireEvent.click(await screen.findByLabelText('Select investigation 1')); fireEvent.click(screen.getByLabelText('Select investigation 2'));
    fireEvent.change(screen.getByLabelText('Set status for selected investigations'), { target: { value: 'resolved' } });
    expect(await screen.findByText('Investigation #1: Fresh case 1')).toBeTruthy(); expect(screen.getByText('Investigation #2: Fresh case 2')).toBeTruthy();
    expect(mockPatch).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Apply reviewed close-out statuses' })).toHaveProperty('disabled', true);
  });

  it('assigns selected investigations to an organization member', async () => {
    mockGet.mockImplementation((url: string) => Promise.resolve(
      url === '/orgs/me/members'
        ? { data: [{ id: 5, email: 'priya@example.com', is_active: true }] }
        : { data: { cases: twoCases(), total: 2 } }
    ));
    renderCases();
    await selectAll();
    fireEvent.change(screen.getByLabelText('Assign selected investigations'), { target: { value: '5' } });
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/cases/1/assign', { user_id: 5 });
      expect(mockPost).toHaveBeenCalledWith('/cases/2/assign', { user_id: 5 });
    });
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('2 investigations assigned to priya@example.com.', 'success'));
  });

  it('watches selected investigations with one POST per case', async () => {
    mockGet.mockResolvedValue({ data: { cases: twoCases(), total: 2 } });
    mockPost.mockResolvedValue({ data: {} });
    renderCases();
    await selectAll();
    fireEvent.click(screen.getByRole('button', { name: 'Watch selected investigations' }));
    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith('/cases/1/watch');
      expect(mockPost).toHaveBeenCalledWith('/cases/2/watch');
    });
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('2 investigations watched.', 'success'));
  });

  it('unwatches selected investigations with one DELETE per case', async () => {
    mockGet.mockResolvedValue({ data: { cases: twoCases(), total: 2 } });
    mockDelete.mockResolvedValue({ data: {} });
    renderCases();
    await selectAll();
    fireEvent.click(screen.getByRole('button', { name: 'Unwatch selected investigations' }));
    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('/cases/1/watch');
      expect(mockDelete).toHaveBeenCalledWith('/cases/2/watch');
    });
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('2 investigations unwatched.', 'success'));
  });

  it('deletes selected investigations after confirmation', async () => {
    mockGet.mockResolvedValue({ data: { cases: twoCases(), total: 2 } });
    mockDelete.mockResolvedValue({ data: {} });
    renderCases();
    await selectAll();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Delete 2 investigations?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2' }));
    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith('/cases/1');
      expect(mockDelete).toHaveBeenCalledWith('/cases/2');
    });
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('2 investigations deleted.', 'success'));
  });
});

it('clears previous rows while filters load and ignores a late previous-filter response', async () => {
  let resolveOld!: (value: unknown) => void;
  mockGet.mockImplementation((url: string, config?: unknown) => {
    if (url !== '/cases/') return Promise.resolve({ data: [] });
    const status = (config as { params: { status?: string } }).params.status;
    if (status === 'open') return new Promise(resolve => { resolveOld = resolve; });
    if (status === 'closed') return Promise.resolve({ data: { cases: [makeCase({ id: 2, title: 'Current closed case', status: 'closed' })], total: 1 } });
    return Promise.resolve({ data: { cases: [makeCase()], total: 1 } });
  });
  renderCases();
  await screen.findByText('Credential dumping on edge router');
  fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'open' } });
  expect(screen.queryByText('Credential dumping on edge router')).toBeNull();
  expect(screen.getByText('Loading the current investigation view.')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'closed' } });
  await screen.findByText('Current closed case');
  await act(async () => resolveOld({ data: { cases: [makeCase({ title: 'Stale open case' })], total: 99 } }));
  expect(screen.queryByText('Stale open case')).toBeNull();
  expect(screen.getByText('Current closed case')).toBeTruthy();
});

it('does not restore search results after a pending search is cleared', async () => {
  let resolveSearch!: (value: unknown) => void;
  mockGet.mockImplementation((url: string) => url === '/cases/search'
    ? new Promise(resolve => { resolveSearch = resolve; })
    : Promise.resolve({ data: { cases: [makeCase()], total: 1 } }));
  renderCases();
  await screen.findByText('Credential dumping on edge router');
  fireEvent.change(screen.getByLabelText('Search investigations'), { target: { value: 'old search' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  await act(async () => resolveSearch({ data: { data: [{ case_id: 8, title: 'Stale search result', score: 1, snippet: '' }] } }));
  expect(screen.queryByText('Stale search result')).toBeNull();
});

it('replaces failed search results with a retry instead of leaving stale matches', async () => {
  let attempts = 0;
  mockGet.mockImplementation(async (url: string) => {
    if (url === '/cases/search') {
      attempts += 1;
      if (attempts === 2) throw new Error('Search service unavailable');
      return { data: { data: [{ case_id: 9, title: 'Search-only case', score: 1, snippet: '' }] } };
    }
    return { data: { cases: [makeCase()], total: 1 } };
  });
  renderCases();
  await screen.findByText('Credential dumping on edge router');
  fireEvent.change(screen.getByLabelText('Search investigations'), { target: { value: 'search query' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await screen.findByText('Search-only case');
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await screen.findByRole('alert');
  expect(screen.queryByText('Search-only case')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry investigation search' }));
  await screen.findByText('Search-only case');
});

it('applies keyword filtering to server-side rows and CSV only after submission', async () => {
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:keyword');
  globalThis.URL.revokeObjectURL = vi.fn();
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  renderCases();
  await screen.findByText('Credential dumping on edge router');
  fireEvent.change(screen.getByLabelText('Filter all accessible investigations by keyword'), { target: { value: 'gateway' } });
  expect(mockGet.mock.calls.some(([, config]) => (config as { params?: { search?: string } })?.params?.search === 'gateway')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Apply keyword filter' }));
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/cases/', { params: expect.objectContaining({ search: 'gateway', page: 1 }) }));
  await screen.findByRole('button', { name: 'Export CSV' });
  fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
  await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/cases/export', { params: { search: 'gateway', sort: 'created_at_desc' }, responseType: 'blob' }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear keyword filter' }));
  await waitFor(() => expect(mockGet).toHaveBeenLastCalledWith('/cases/', { params: { page: 1, size: 20, sort: 'created_at_desc' } }));
  click.mockRestore();
});


it('shows partial automatic triage as an incomplete outcome rather than an all-clear', async () => {
  mockPost.mockResolvedValueOnce({ data: { data: { status: 'partial', summary: 'Created 1 case; 1 of 2 correlation groups failed and need review or retry' } } });
  renderCases(); await screen.findByText('Credential dumping on edge router');
  fireEvent.click(screen.getByRole('button', { name: /run ai triage/i }));
  await screen.findByText('Automatic triage outcome: partial');
  expect(screen.getByText(/do not assume zero created cases means no incident/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss triage result' }));
  expect(screen.queryByRole('region', { name: 'Automatic triage result' })).toBeNull();
});
it('does not label partial pipeline results completed', async () => {
  mockPost.mockResolvedValueOnce({ data: { data: { pipeline_status: 'partial', total_duration_ms: 300,
    detect: { summary: 'Detection completed' }, triage: { status: 'failed', summary: 'Two groups failed' } } } });
  renderCases(); await screen.findByText('Credential dumping on edge router');
  fireEvent.click(screen.getByRole('button', { name: /run pipeline/i }));
  await screen.findByText('Pipeline outcome: partial · 0.3s');
  expect(screen.getByText(/this is not an all-clear/)).toBeTruthy();
});

it('preserves exact pipeline stage run links including failed stage evidence', async () => {
  mockPost.mockResolvedValueOnce({ data: { data: { pipeline_status: 'partial', total_duration_ms: 300,
    run_ids: { detect: 81, triage: 82 }, detect: { summary: 'Detection completed' }, triage: { status: 'failed', summary: 'Two groups failed' } } } });
  render(<MemoryRouter><Cases /></MemoryRouter>); await screen.findByText('Credential dumping on edge router'); fireEvent.click(screen.getByRole('button', { name: /run pipeline/i }));
  expect((await screen.findByRole('link', { name: 'Inspect detect run #81' })).getAttribute('href')).toBe('/app/audit-log?run=81');
  expect(screen.getByRole('link', { name: 'Inspect triage run #82' }).getAttribute('href')).toBe('/app/audit-log?run=82');
  expect(screen.getByText(/not automatically saved as alerts or passed to triage/)).toBeTruthy();
});
it('keeps the automatic triage receipt linked to its invocation run', async () => {
  mockPost.mockResolvedValueOnce({ data: { data: { status: 'partial', summary: 'One group failed', run_id: 83 } } });
  render(<MemoryRouter><Cases /></MemoryRouter>); await screen.findByText('Credential dumping on edge router'); fireEvent.click(screen.getByRole('button', { name: /run ai triage/i }));
  expect((await screen.findByRole('link', { name: 'Inspect triage run #83' })).getAttribute('href')).toBe('/app/audit-log?run=83');
});

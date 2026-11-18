import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    expect(await screen.findByText('Pipeline finished in 1.8s')).toBeTruthy();
    expect(screen.getByText('Detect: Analyzed 12 events, found 3 findings')).toBeTruthy();
    expect(screen.getByText('Triage: Created 1 cases from 4 alerts and 12 events')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /dismiss pipeline result/i }));
    expect(screen.queryByText(/Pipeline finished/)).toBeNull();
  });

  it('shows an error toast when the pipeline fails', async () => {
    mockPost.mockRejectedValue({ isAxiosError: true, response: { status: 500, data: {} } });
    renderCases();
    await screen.findByText('Credential dumping on edge router');
    fireEvent.click(screen.getByRole('button', { name: /run pipeline/i }));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.stringContaining('could not be run'), 'error'));
    expect(screen.queryByText(/Pipeline finished/)).toBeNull();
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

  it('marks selected investigations resolved with one PATCH per case', async () => {
    mockGet.mockResolvedValue({ data: { cases: twoCases(), total: 2 } });
    mockPatch.mockResolvedValue({ data: {} });
    renderCases();
    await selectAll();
    fireEvent.change(screen.getByLabelText('Set status for selected investigations'), { target: { value: 'resolved' } });
    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith('/cases/1', null, { params: { status_update: 'resolved' } });
      expect(mockPatch).toHaveBeenCalledWith('/cases/2', null, { params: { status_update: 'resolved' } });
    });
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('2 investigations marked resolved.', 'success'));
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

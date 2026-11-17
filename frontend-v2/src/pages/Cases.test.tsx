import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Cases } from './Cases';

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../components/Toast', () => ({ toast: vi.fn() }));

import apiClient from '../api/client';
import { toast } from '../components/Toast';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);
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
    mockGet.mockRejectedValueOnce({ isAxiosError: true, response: { status: 500, data: {} } });
    mockGet.mockResolvedValueOnce({ data: { cases: [makeCase()], total: 1 } });
    renderCases();
    expect(await screen.findByText('Investigations could not be loaded.')).toBeTruthy();
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
      expect(mockGet).toHaveBeenCalledTimes(2);
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

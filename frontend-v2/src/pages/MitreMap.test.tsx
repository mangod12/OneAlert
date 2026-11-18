import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { MitreMap } from './MitreMap';

vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));

const get = vi.mocked(apiClient.get);

const coverage = {
  total_techniques: 50,
  covered_techniques: 21,
  coverage_percentage: 42,
  by_tactic: {
    TA0001: { name: 'Initial Access', total: 10, covered: 5, percentage: 50 },
    TA0002: { name: 'Execution', total: 10, covered: 0, percentage: 0 },
  },
  covered_ids: ['T1190'],
};

const techniques = [
  { id: 'T1059', name: 'Command and Scripting Interpreter', tactics: ['TA0002'], description: 'Adversaries may abuse command and script interpreters.' },
  { id: 'T1190', name: 'Exploit Public-Facing Application', tactics: ['TA0001'], description: 'Adversaries may exploit internet-facing applications.' },
];

beforeEach(() => {
  vi.resetAllMocks();
  get.mockImplementation(async (url: string) => {
    if (url === '/mitre/coverage') return { data: { data: coverage } };
    if (url === '/mitre/techniques') return { data: techniques };
    throw new Error(`unexpected ${url}`);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('MitreMap technique coverage markers', () => {
  it('marks detected techniques and gaps from covered_ids', async () => {
    render(<MitreMap />);
    await screen.findByText('T1059');
    expect(screen.getByText('Detected')).toBeTruthy();
    expect(screen.getByText('Gap')).toBeTruthy();
  });

  it('gaps-only toggle hides detected techniques', async () => {
    render(<MitreMap />);
    await screen.findByText('T1059');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Gaps only' }));
    expect(screen.queryByText('T1190')).toBeNull();
    expect(screen.getByText('T1059')).toBeTruthy();
    expect(screen.queryByText('Detected')).toBeNull();
  });

  it('shows no markers or toggle when coverage lacks covered_ids', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/mitre/coverage') return { data: { data: { ...coverage, covered_ids: undefined } } };
      if (url === '/mitre/techniques') return { data: techniques };
      throw new Error(`unexpected ${url}`);
    });
    render(<MitreMap />);
    await screen.findByText('T1059');
    expect(screen.queryByRole('checkbox', { name: 'Gaps only' })).toBeNull();
    expect(screen.queryByText('Detected')).toBeNull();
    expect(screen.queryByText('Gap')).toBeNull();
  });
});

describe('MitreMap', () => {
  it('renders overall coverage with progressbar semantics', async () => {
    render(<MitreMap />);
    const bar = await screen.findByRole('progressbar', { name: 'Overall ATT&CK coverage' });
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(screen.getByText('42%')).toBeTruthy();
    expect(screen.getByText('21 of 50 techniques detected')).toBeTruthy();
  });

  it('labels each tactic bar so the percentage is announced with its tactic', async () => {
    render(<MitreMap />);
    const bar = await screen.findByRole('progressbar', { name: 'Initial Access coverage' });
    expect(bar.getAttribute('aria-valuenow')).toBe('50');
    expect(screen.getByRole('progressbar', { name: 'Execution coverage' }).getAttribute('aria-valuenow')).toBe('0');
    expect(screen.getByText('5/10')).toBeTruthy();
  });

  it('filters the technique list as you type in the labeled search box', async () => {
    render(<MitreMap />);
    await screen.findByText('T1190');
    fireEvent.change(screen.getByLabelText('Search techniques'), { target: { value: 'scripting' } });
    expect(screen.getByText('T1059')).toBeTruthy();
    expect(screen.queryByText('T1190')).toBeNull();
  });

  it('shows the error state with retry when both endpoints fail', async () => {
    get.mockRejectedValue(new Error('down'));
    render(<MitreMap />);
    await screen.findByText('ATT&CK coverage unavailable');
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });
});

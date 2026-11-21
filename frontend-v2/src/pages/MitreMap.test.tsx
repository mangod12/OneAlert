import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
    expect(screen.getByText('Mapped')).toBeTruthy();
    expect(screen.getByText('No mapping')).toBeTruthy();
  });

  it('gaps-only toggle hides detected techniques', async () => {
    render(<MitreMap />);
    await screen.findByText('T1059');
    fireEvent.click(screen.getByRole('checkbox', { name: 'No recorded mapping only' }));
    expect(screen.queryByText('T1190')).toBeNull();
    expect(screen.getByText('T1059')).toBeTruthy();
    expect(screen.queryByText('Mapped')).toBeNull();
  });

  it('shows no markers or toggle when coverage lacks covered_ids', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/mitre/coverage') return { data: { data: { ...coverage, covered_ids: undefined } } };
      if (url === '/mitre/techniques') return { data: techniques };
      throw new Error(`unexpected ${url}`);
    });
    render(<MitreMap />);
    await screen.findByText('T1059');
    expect(screen.queryByRole('checkbox', { name: 'No recorded mapping only' })).toBeNull();
    expect(screen.queryByText('Mapped')).toBeNull();
    expect(screen.queryByText('No mapping')).toBeNull();
  });
});

describe('MitreMap technique references', () => {
  const references = {
    technique_id: 'T1190',
    technique_name: 'Exploit Public-Facing Application',
    cases: [{ id: 7, title: 'Web shell on dmz-proxy', status: 'open' }],
    detection_rules: [{ id: 3, name: 'Exploit attempt pattern', enabled: false }],
  };

  function mockWithReferences() {
    get.mockImplementation(async (url: string) => {
      if (url === '/mitre/coverage') return { data: { data: coverage } };
      if (url === '/mitre/techniques') return { data: techniques };
      if (url === '/mitre/techniques/T1190/references') return { data: references };
      throw new Error(`unexpected ${url}`);
    });
  }

  it('expands a detected technique to show the cases and rules behind it', async () => {
    mockWithReferences();
    render(<MemoryRouter><MitreMap /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Show recorded mappings for T1190 Exploit Public-Facing Application' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/mitre/techniques/T1190/references'));
    const caseLink = await screen.findByRole('link', { name: '#7 Web shell on dmz-proxy' });
    expect(caseLink.getAttribute('href')).toBe('/cases/7');
    expect(screen.getByText('open')).toBeTruthy();
    const ruleLink = screen.getByRole('link', { name: 'Exploit attempt pattern' });
    expect(ruleLink.getAttribute('href')).toBe('/hunt');
    expect(screen.getByText('disabled')).toBeTruthy();
  });

  it('collapses the references when the technique is clicked again', async () => {
    mockWithReferences();
    render(<MemoryRouter><MitreMap /></MemoryRouter>);
    const toggle = await screen.findByRole('button', { name: 'Show recorded mappings for T1190 Exploit Public-Facing Application' });
    fireEvent.click(toggle);
    await screen.findByRole('link', { name: '#7 Web shell on dmz-proxy' });
    fireEvent.click(toggle);
    expect(screen.queryByRole('link', { name: '#7 Web shell on dmz-proxy' })).toBeNull();
  });

  it('notes when nothing references the technique yet', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/mitre/coverage') return { data: { data: coverage } };
      if (url === '/mitre/techniques') return { data: techniques };
      if (url === '/mitre/techniques/T1190/references') return { data: { ...references, cases: [], detection_rules: [] } };
      throw new Error(`unexpected ${url}`);
    });
    render(<MemoryRouter><MitreMap /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Show recorded mappings for T1190 Exploit Public-Facing Application' }));
    expect(await screen.findByText('No cases reference this technique.')).toBeTruthy();
    expect(screen.getByText('No detection rules cover this technique.')).toBeTruthy();
  });

  it('does not make gap techniques expandable', async () => {
    mockWithReferences();
    render(<MemoryRouter><MitreMap /></MemoryRouter>);
    await screen.findByText('T1059');
    expect(screen.queryByRole('button', { name: /Show recorded mappings for T1059/ })).toBeNull();
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
    expect(screen.getByText('21 of 50 techniques with case or enabled-rule mappings')).toBeTruthy();
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

it.each(['success', 'failure'])('ignores stale technique reference %s after selection changes', async outcome => {
  let resolveOld!: (value: unknown) => void;
  let rejectOld!: (reason: unknown) => void;
  get.mockImplementation(url => {
    if (url === '/mitre/coverage') return Promise.resolve({ data: { data: { ...coverage, covered_ids: ['T1059', 'T1190'] } } });
    if (url === '/mitre/techniques') return Promise.resolve({ data: techniques });
    if (url === '/mitre/techniques/T1059/references') return new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; });
    return Promise.resolve({ data: { technique_id: 'T1190', technique_name: 'Current', cases: [{ id: 8, title: 'Current technique evidence', status: 'open' }], detection_rules: [] } });
  });
  render(<MemoryRouter><MitreMap /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: /Show recorded mappings for T1059/ }));
  fireEvent.click(screen.getByRole('button', { name: /Show recorded mappings for T1190/ }));
  await screen.findByText('#8 Current technique evidence');
  await act(async () => {
    if (outcome === 'success') resolveOld({ data: { technique_id: 'T1059', technique_name: 'Old', cases: [{ id: 9, title: 'Wrong technique evidence', status: 'open' }], detection_rules: [] } });
    else rejectOld(new Error('Old technique failed'));
  });
  expect(screen.getByText('#8 Current technique evidence')).toBeTruthy();
  expect(screen.queryByText('#9 Wrong technique evidence')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('does not restore reference evidence from a collapsed request after reopening', async () => {
  const resolvers: Array<(value: unknown) => void> = [];
  const fallback = get.getMockImplementation()!;
  get.mockImplementation((url, config) => url === '/mitre/techniques/T1190/references' ? new Promise(resolve => { resolvers.push(resolve); }) : fallback(url, config));
  render(<MemoryRouter><MitreMap /></MemoryRouter>);
  const trigger = await screen.findByRole('button', { name: /Show recorded mappings for T1190/ });
  fireEvent.click(trigger);fireEvent.click(trigger);fireEvent.click(trigger);
  await act(async () => resolvers[0]({ data: { cases: [{ id: 9, title: 'Collapsed stale evidence', status: 'open' }], detection_rules: [] } }));
  expect(screen.queryByText('#9 Collapsed stale evidence')).toBeNull();
  expect(screen.getByText('Loading references…')).toBeTruthy();
  await act(async () => resolvers[1]({ data: { cases: [], detection_rules: [] } }));
  expect(screen.getByText('No cases reference this technique.')).toBeTruthy();
});

it('retries failed references in the expanded technique without reloading coverage', async () => {
  let fail = true;
  const fallback = get.getMockImplementation()!;
  get.mockImplementation((url, config) => url === '/mitre/techniques/T1190/references' ? fail ? Promise.reject(new Error('References offline')) : Promise.resolve({ data: { cases: [], detection_rules: [] } }) : fallback(url, config));
  render(<MemoryRouter><MitreMap /></MemoryRouter>);
  const trigger = await screen.findByRole('button', { name: /Show recorded mappings for T1190/ });
  fireEvent.click(trigger);
  expect(await screen.findByRole('button', { name: 'Retry technique references' })).toBeTruthy();
  expect(screen.queryByText('No cases reference this technique.')).toBeNull();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry technique references' }));
  expect(await screen.findByText('No cases reference this technique.')).toBeTruthy();
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(get.mock.calls.filter(([url]) => url === '/mitre/coverage')).toHaveLength(1);
  expect(get.mock.calls.filter(([url]) => url === '/mitre/techniques')).toHaveLength(1);
});

it('does not retain stale detected markers when coverage fails on a partial-data retry', async () => {
  let attempt = 0;
  get.mockImplementation(url => {
    if (url === '/mitre/coverage') {
      attempt += 1;
      return attempt === 1 ? Promise.resolve({ data: { data: coverage } }) : Promise.reject(new Error('Coverage unavailable'));
    }
    return attempt === 1 ? Promise.reject(new Error('Catalog unavailable')) : Promise.resolve({ data: techniques });
  });
  render(<MitreMap />);
  await screen.findByText('42%');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText('T1190');
  expect(screen.queryByText('42%')).toBeNull();
  expect(screen.queryByText('Mapped')).toBeNull();
  expect(screen.queryByText('No mapping')).toBeNull();
  expect(screen.queryByRole('checkbox', { name: 'No recorded mapping only' })).toBeNull();
  expect(screen.getByText('Some live data is unavailable')).toBeTruthy();
});

it('does not retain a stale technique catalog when the next retry cannot load it', async () => {
  let attempt = 0;
  get.mockImplementation(url => {
    if (url === '/mitre/coverage') {
      attempt += 1;
      return attempt === 1 ? Promise.reject(new Error('Coverage unavailable')) : Promise.resolve({ data: { data: coverage } });
    }
    return attempt === 1 ? Promise.resolve({ data: techniques }) : Promise.reject(new Error('Catalog unavailable'));
  });
  render(<MitreMap />);
  await screen.findByText('T1059');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText('42%');
  expect(screen.queryByText('T1059')).toBeNull();
  expect(screen.getByText('Some live data is unavailable')).toBeTruthy();
});

it('exports exactly the loaded gap-filtered techniques without another request', async () => {
  URL.createObjectURL = vi.fn(() => 'blob:mitre');
  URL.revokeObjectURL = vi.fn();
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<MitreMap />);
  await screen.findByText('T1059');
  fireEvent.click(screen.getByRole('checkbox', { name: 'No recorded mapping only' }));
  const reads = get.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Export filtered techniques' }));
  expect(click).toHaveBeenCalledOnce();
  expect(get.mock.calls.length).toBe(reads);
  expect(screen.getByText(/1 of 2 loaded techniques shown/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Search techniques'), { target: { value: 'no match' } });
  expect(screen.getByRole('button', { name: 'Export filtered techniques' })).toHaveProperty('disabled', true);
});

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HuntLab } from './HuntLab';

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import apiClient from '../api/client';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);
const mockPatch = vi.mocked(apiClient.patch);
const mockDelete = vi.mocked(apiClient.delete);

const session = {
  id: 5,
  hypothesis: 'DNS tunneling to external domains',
  status: 'completed',
  queries_run: 2,
  findings_count: 3,
  sigma_rule: null,
  created_at: '2026-11-16T08:00:00Z',
};

const sessionDetail = {
  ...session,
  result_data: {
    explanation: 'Found periodic TXT lookups consistent with tunneling.',
    query_results: [{
      query: { description: 'TXT lookups by host', sql: 'SELECT host, count(*) FROM dns' },
      row_count: 1,
      rows: [{ host: 'plc-02', lookups: 412 }],
    }],
  },
  sigma_rule: 'title: DNS tunneling\nlogsource:\n  category: dns',
};

beforeEach(() => { vi.resetAllMocks(); });
afterEach(cleanup);

describe('Hunt session reopening', () => {
  it('reloads a past session\'s results when its history row is activated', async () => {
    mockGet.mockImplementation(url => Promise.resolve({
      data: url.endsWith('/5') ? sessionDetail : url.endsWith('/detections') ? [] : { sessions: [session], total: 1 },
    }));
    render(<HuntLab />);
    fireEvent.click(await screen.findByRole('button', { name: /reopen hunt: dns tunneling/i }));
    expect(await screen.findByText('Found periodic TXT lookups consistent with tunneling.')).toBeTruthy();
    expect(screen.getByText(/title: DNS tunneling/)).toBeTruthy();
    expect(screen.getByText('plc-02')).toBeTruthy();
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/hunt/5'));
  });

  it('restores the hypothesis text into the hunt input', async () => {
    mockGet.mockImplementation(url => Promise.resolve({
      data: url.endsWith('/5') ? sessionDetail : url.endsWith('/detections') ? [] : { sessions: [session], total: 1 },
    }));
    render(<HuntLab />);
    fireEvent.click(await screen.findByRole('button', { name: /reopen hunt: dns tunneling/i }));
    await screen.findByText('Found periodic TXT lookups consistent with tunneling.');
    expect((screen.getByLabelText('Hunting Hypothesis') as HTMLInputElement).value)
      .toBe('DNS tunneling to external domains');
  });

  it('reports a failed load without clearing existing results', async () => {
    mockGet.mockImplementation(url => {
      if (url.endsWith('/5')) return Promise.reject(new Error('Not found'));
      return Promise.resolve({ data: url.endsWith('/detections') ? [] : { sessions: [session], total: 1 } });
    });
    mockPost.mockResolvedValue({ data: { data: { explanation: 'Fresh hunt result' } } });
    render(<HuntLab />);
    fireEvent.change(await screen.findByLabelText('Hunting Hypothesis'), { target: { value: 'new hypothesis' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hunt' }));
    expect(await screen.findByText('Fresh hunt result')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /reopen hunt: dns tunneling/i }));
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/hunt/5'));
    // The previous result stays visible after the failed reopen.
    expect(screen.getByText('Fresh hunt result')).toBeTruthy();
  });
});

describe('Hunt session deletion', () => {
  function mockWithSession() {
    mockGet.mockImplementation(url => Promise.resolve({
      data: url.endsWith('/detections') ? [] : { sessions: mockDelete.mock.calls.length ? [] : [session], total: mockDelete.mock.calls.length ? 0 : 1 },
    }));
  }

  it('deletes a session through the confirm dialog', async () => {
    mockWithSession();
    mockDelete.mockResolvedValue({ data: {} });
    render(<HuntLab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete hunt: DNS tunneling to external domains' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete hunt' }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('/hunt/5'));
    await waitFor(() => expect(screen.queryByRole('button', { name: /reopen hunt: dns tunneling/i })).toBeNull());
  });

  it('keeps the session when the delete dialog is cancelled', async () => {
    mockWithSession();
    render(<HuntLab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete hunt: DNS tunneling to external domains' }));
    fireEvent.click(await screen.findByRole('button', { name: /cancel/i }));
    expect(mockDelete).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /reopen hunt: dns tunneling/i })).toBeTruthy();
  });
});

describe('Detection rules', () => {
  const rules = [
    { id: 1, name: 'Modbus write to PLC', description: 'Flags write function codes', rule_type: 'sigma', rule_content: 'title: x', mitre_techniques: ['T0855'], confidence: 'high', tested: true, enabled: true, created_by: 'human', created_at: '2026-11-10T08:00:00Z' },
    { id: 2, name: 'DNS tunneling heuristic', description: null, rule_type: 'sql', rule_content: 'select 1', mitre_techniques: null, confidence: 'low', tested: false, enabled: false, created_by: 'agent', created_at: '2026-11-12T08:00:00Z' },
  ];

  function mockWithRules() {
    mockGet.mockImplementation(url => Promise.resolve({
      data: url.endsWith('/5') ? sessionDetail : url.endsWith('/detections') ? rules : { sessions: [session], total: 1 },
    }));
  }

  it('lists saved rules with type, confidence and mitre badges', async () => {
    mockWithRules();
    render(<HuntLab />);
    await screen.findByText('Modbus write to PLC');
    expect(screen.getByText('DNS tunneling heuristic')).toBeTruthy();
    expect(screen.getByText('T0855')).toBeTruthy();
    expect(screen.getByText('tested')).toBeTruthy();
    expect(screen.getByText('disabled')).toBeTruthy();
  });

  it('saves a generated sigma rule with the content prefilled', async () => {
    mockWithRules();
    mockPost.mockResolvedValue({ data: {} });
    render(<HuntLab />);
    fireEvent.click(await screen.findByRole('button', { name: /reopen hunt: dns tunneling/i }));
    await screen.findByText(/title: DNS tunneling/);
    fireEvent.click(screen.getByRole('button', { name: /save as detection rule/i }));
    expect((screen.getByLabelText('Rule content *') as HTMLTextAreaElement).value).toContain('title: DNS tunneling');
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'DNS tunneling' } });
    fireEvent.change(screen.getByLabelText('Confidence'), { target: { value: 'high' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/hunt/detections', {
      name: 'DNS tunneling',
      rule_type: 'sigma',
      rule_content: 'title: DNS tunneling\nlogsource:\n  category: dns',
      description: null,
      confidence: 'high',
      enabled: false, mitre_techniques: [],
    }));
  });

  it('edits a rule name, description and confidence with type and content fixed', async () => {
    mockWithRules();
    mockPatch.mockImplementation(async (_url: string, data?: unknown) => {
      const body = data as { name: string; description: string; confidence: string };
      return { data: { ...rules[0], ...body } };
    });
    render(<HuntLab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit rule Modbus write to PLC' }));
    expect((screen.getByLabelText('Name *') as HTMLInputElement).value).toBe('Modbus write to PLC');
    expect((screen.getByLabelText('Type') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Rule content *') as HTMLTextAreaElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Modbus write v2' } });
    fireEvent.change(screen.getByLabelText('Confidence'), { target: { value: 'medium' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update rule' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/hunt/detections/1', {
      name: 'Modbus write v2', description: 'Flags write function codes', confidence: 'medium',
    }));
    expect(await screen.findByText('Modbus write v2')).toBeTruthy();
  });

  it('disables and re-enables a rule via the API', async () => {
    mockWithRules();
    mockPatch.mockImplementation(async (url: string, data?: unknown) => {
      const body = data as { enabled: boolean };
      const rule = rules.find(r => url.endsWith(`/detections/${r.id}`))!;
      return { data: { ...rule, enabled: body.enabled } };
    });
    render(<HuntLab />);
    const disableBtn = await screen.findByRole('button', { name: 'Disable rule Modbus write to PLC' });
    fireEvent.click(disableBtn);
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/hunt/detections/1', { enabled: false }));
    expect(await screen.findByRole('button', { name: 'Enable rule Modbus write to PLC' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Enable rule Modbus write to PLC' }));
    await waitFor(() => expect(mockPatch).toHaveBeenCalledWith('/hunt/detections/1', { enabled: true }));
  });

  it('deletes a rule through the confirm dialog', async () => {
    mockWithRules();
    mockDelete.mockResolvedValue({ data: {} });
    render(<HuntLab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete rule Modbus write to PLC' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete rule' }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('/hunt/detections/1'));
    await waitFor(() => expect(screen.queryByText('Modbus write to PLC')).toBeNull());
    expect(screen.getByText('DNS tunneling heuristic')).toBeTruthy();
  });

  it('keeps the rule when the delete dialog is cancelled', async () => {
    mockWithRules();
    render(<HuntLab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete rule Modbus write to PLC' }));
    fireEvent.click(await screen.findByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete rule' })).toBeNull());
    expect(mockDelete).not.toHaveBeenCalled();
    expect(screen.getByText('Modbus write to PLC')).toBeTruthy();
  });

  it('posts nothing when a manual rule is missing its content', async () => {
    mockWithRules();
    render(<HuntLab />);
    await screen.findByText('Modbus write to PLC');
    fireEvent.click(screen.getByRole('button', { name: /new rule/i }));
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Incomplete' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    await new Promise(r => setTimeout(r, 50));
    expect(mockPost).not.toHaveBeenCalled();
  });
});

describe('Detection rule loading truth', () => {
  it('does not claim no rules exist while the request is pending', async () => {
    mockGet.mockImplementation(url => url.endsWith('/detections') ? new Promise(() => {}) : Promise.resolve({ data: { sessions: [], total: 0 } }));
    render(<HuntLab />);
    expect(screen.getByLabelText('Loading detection rules')).toBeTruthy();
    expect(screen.queryByText(/No detection rules saved yet/)).toBeNull();
  });

  it('shows a failed read as unavailable, retries, and keeps hunt history available', async () => {
    let fail = true;
    mockGet.mockImplementation(url => {
      if (url.endsWith('/detections')) return fail ? Promise.reject(new Error('Rule store unavailable')) : Promise.resolve({ data: [] });
      return Promise.resolve({ data: { sessions: [session], total: 1 } });
    });
    render(<HuntLab />);
    expect(await screen.findByText('Detection rules unavailable')).toBeTruthy();
    expect(screen.queryByText(/No detection rules saved yet/)).toBeNull();
    expect(screen.getByRole('button', { name: /reopen hunt: dns tunneling/i })).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText(/No detection rules saved yet/)).toBeTruthy();
  });
});

it('reopens query evidence stored in the historical list format', async () => {
  mockGet.mockImplementation(url => Promise.resolve({
    data: url.endsWith('/5') ? { ...sessionDetail, result_data: sessionDetail.result_data.query_results }
      : url.endsWith('/detections') ? [] : { sessions: [session], total: 1 },
  }));
  render(<HuntLab />);
  fireEvent.click(await screen.findByRole('button', { name: /reopen hunt: dns tunneling/i }));
  expect(await screen.findByText('plc-02')).toBeTruthy();
  expect(screen.getByText('SELECT host, count(*) FROM dns')).toBeTruthy();
  expect(screen.getByText(/title: DNS tunneling/)).toBeTruthy();
  expect(screen.queryByText('Found periodic TXT lookups consistent with tunneling.')).toBeNull();
});

it('pages retained query evidence beyond twenty rows and resets paging on a reopened session', async () => {
  mockGet.mockImplementation(url => Promise.resolve({ data: url.endsWith('/5') ? {
    ...sessionDetail, result_data: { query_results: [{ row_count: 60, rows: Array.from({ length: 25 }, (_, index) => ({ host: `recorded-${index + 1}` })) }] },
  } : url.endsWith('/detections') ? [] : { sessions: [session], total: 1 } }));
  render(<HuntLab />);
  fireEvent.click(await screen.findByRole('button', { name: /reopen hunt: dns tunneling/i }));
  await screen.findByText('recorded-1');
  fireEvent.click(screen.getByRole('button', { name: 'Next rows for query 1' }));
  expect(screen.getByText('recorded-25')).toBeTruthy();
  expect(screen.queryByText('recorded-1')).toBeNull();
  expect(screen.getByText(/35 reported rows were not retained/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /reopen hunt: dns tunneling/i }));
  expect(await screen.findByText('recorded-1')).toBeTruthy();
  expect(screen.queryByText('recorded-25')).toBeNull();
});

it('does not launch duplicate hunts when Enter repeats during an in-flight hunt', async () => {
  mockGet.mockImplementation(url => Promise.resolve({ data: url.endsWith('/detections') ? [] : { sessions: [session], total: 1 } }));
  mockPost.mockReturnValue(new Promise(() => {}));
  render(<HuntLab />);
  const input = await screen.findByLabelText('Hunting Hypothesis');
  fireEvent.change(input, { target: { value: 'Check DNS records' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect((screen.getByRole('button', { name: 'Hunting...' }) as HTMLButtonElement).disabled).toBe(true);
});

it('does not start a hunt while a historical session is loading', async () => {
  mockGet.mockImplementation(url => url.endsWith('/5') ? new Promise(() => {})
    : Promise.resolve({ data: url.endsWith('/detections') ? [] : { sessions: [session], total: 1 } }));
  render(<HuntLab />);
  const input = await screen.findByLabelText('Hunting Hypothesis');
  fireEvent.change(input, { target: { value: 'Check DNS records' } });
  fireEvent.click(await screen.findByRole('button', { name: /reopen hunt: dns tunneling/i }));
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(mockPost).not.toHaveBeenCalled();
  expect((screen.getByRole('button', { name: 'Hunt' }) as HTMLButtonElement).disabled).toBe(true);
});

it('allows another hunt after a failed request', async () => {
  mockGet.mockImplementation(url => Promise.resolve({ data: url.endsWith('/detections') ? [] : { sessions: [session], total: 1 } }));
  mockPost.mockRejectedValueOnce(new Error('Hunt unavailable')).mockResolvedValueOnce({ data: { data: { explanation: 'Retry completed' } } });
  render(<HuntLab />);
  fireEvent.change(await screen.findByLabelText('Hunting Hypothesis'), { target: { value: 'Check DNS records' } });
  fireEvent.click(screen.getByRole('button', { name: 'Hunt' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Hunt' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Hunt' }));
  expect(await screen.findByText('Retry completed')).toBeTruthy();
  expect(mockPost).toHaveBeenCalledTimes(2);
});


it('inspects and clones immutable rule content into an untested disabled draft without changing the original', async () => {
  const original = { id: 7, name: 'Retained guard', description: 'Full retained rule description', rule_type: 'sigma', rule_content: 'title: Retained guard\ndetection:\n  condition: selection', mitre_techniques: ['T1110'], confidence: 'high', tested: true, enabled: true, created_by: 'human', created_at: '2026-11-20T08:00:00Z' };
  mockGet.mockImplementation(async url => ({ data: url.endsWith('/detections') ? [original] : { sessions: [], total: 0 } }));
  mockPost.mockResolvedValue({ data: { ...original, id: 8, enabled: false, tested: false } });
  render(<HuntLab />);
  fireEvent.click(await screen.findByLabelText('Inspect saved rule Retained guard'));
  expect(screen.getByText(/condition: selection/)).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Clone rule Retained guard as disabled draft'));
  expect(mockPost).not.toHaveBeenCalled();
  expect(mockPatch).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Name *')).toHaveProperty('value', 'Retained guard copy');
  expect(screen.getByLabelText('Rule content *')).toHaveProperty('value', original.rule_content);
  expect(screen.getByLabelText('Rule MITRE techniques')).toHaveProperty('value', 'T1110');
  expect(screen.getByLabelText('Enable rule after saving')).toHaveProperty('checked', false);
  fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
  await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/hunt/detections', { name: 'Retained guard copy', description: original.description, rule_type: 'sigma', rule_content: original.rule_content, confidence: 'high', enabled: false, mitre_techniques: ['T1110'] }));
  expect(mockPatch).not.toHaveBeenCalled();
});

it('pages and searches loaded rule content locally and resets the page when scope changes', async () => {
  const rules = Array.from({ length: 23 }, (_, index) => ({ id: index, name: `Saved rule ${index}`, description: null, rule_type: 'sigma', rule_content: index === 22 ? 'Distinct retained selector' : 'saved selector', mitre_techniques: [], confidence: 'medium', tested: false, enabled: index % 2 === 0, created_by: 'human', created_at: '2026-11-20T08:00:00Z' }));
  mockGet.mockImplementation(async url => ({ data: url.endsWith('/detections') ? rules : { sessions: [], total: 0 } }));
  render(<HuntLab />);
  await screen.findByText('Saved rule 0');
  expect(screen.queryByText('Saved rule 10')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'More rules' }));
  expect(screen.getByText('Saved rule 10')).toBeTruthy();
  const reads = mockGet.mock.calls.length;
  fireEvent.change(screen.getByLabelText('Search saved detection rules'), { target: { value: 'distinct retained' } });
  expect(screen.getByText('Saved rule 22')).toBeTruthy();
  expect(screen.getByText('Rule page 1 of 1')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Detection rule scope'), { target: { value: 'disabled' } });
  expect(screen.getByText('No loaded detection rules match.')).toBeTruthy();
  expect(mockGet).toHaveBeenCalledTimes(reads);
  expect(mockPost).not.toHaveBeenCalled();
  expect(mockPatch).not.toHaveBeenCalled();
});

it('retains a failed rule draft and only enables it when explicitly selected', async () => {
  mockGet.mockImplementation(async url => ({ data: url.endsWith('/detections') ? [] : { sessions: [], total: 0 } }));
  mockPost.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ data: {} });
  render(<HuntLab />);
  fireEvent.click(await screen.findByRole('button', { name: 'New rule' }));
  fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Reviewed guard' } });
  fireEvent.change(screen.getByLabelText('Rule content *'), { target: { value: 'Retained selector' } });
  fireEvent.click(screen.getByLabelText('Enable rule after saving'));
  fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save rule' })).toHaveProperty('disabled', false));
  expect(screen.getByLabelText('Name *')).toHaveProperty('value', 'Reviewed guard');
  expect(screen.getByLabelText('Enable rule after saving')).toHaveProperty('checked', true);
  fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
  await waitFor(() => expect(mockPost).toHaveBeenLastCalledWith('/hunt/detections', expect.objectContaining({ enabled: true })));
});

it('searches complete hunt history with explicit draft apply, server filters and paging', async () => {
  mockGet.mockImplementation(async (url, config) => {
    if (url.endsWith('/detections')) return { data: [] };
    const params = (config?.params ?? {}) as Record<string, string | number | boolean>;
    return { data: { total: params.search ? 1 : 66, sessions: [{ ...session, hypothesis: params.search ? 'Older matching hunt' : params.page === 2 ? 'Second history page' : 'First history page' }] } };
  });
  render(<HuntLab />);
  await screen.findByRole('button', { name: 'Reopen hunt: First history page' });
  fireEvent.click(screen.getByRole('button', { name: 'More hunts' }));
  await screen.findByRole('button', { name: 'Reopen hunt: Second history page' });
  fireEvent.change(screen.getByLabelText('Search hunt history'), { target: { value: 'older retained' } });
  expect(screen.getByText(/History search draft not applied/)).toBeTruthy();
  expect(mockGet.mock.calls.filter(([url]) => url === '/hunt/history')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Search hunts' }));
  await screen.findByRole('button', { name: 'Reopen hunt: Older matching hunt' });
  expect(mockGet).toHaveBeenLastCalledWith('/hunt/history', { params: { page: 1, size: 20, search: 'older retained' } });
  fireEvent.change(screen.getByLabelText('Hunt history status'), { target: { value: 'completed' } });
  fireEvent.click(screen.getByLabelText('With recorded findings'));
  await waitFor(() => expect(mockGet).toHaveBeenLastCalledWith('/hunt/history', { params: { page: 1, size: 20, search: 'older retained', state: 'completed', with_findings: true } }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear hunt history filters' }));
  await screen.findByRole('button', { name: 'Reopen hunt: First history page' });
  expect(mockPost).not.toHaveBeenCalled();
});

it('discards a late history page after filters change and keeps controls available for recovery', async () => {
  let resolveOld!: (value: unknown) => void;
  let fail = false;
  mockGet.mockImplementation((url, config) => {
    if (url.endsWith('/detections')) return Promise.resolve({ data: [] });
    const params = (config?.params ?? {}) as Record<string, string | number>;
    if (params.page === 2) return new Promise(resolve => { resolveOld = resolve; });
    if (fail && params.search) return Promise.reject(new Error('History temporarily unavailable'));
    return Promise.resolve({ data: { total: params.search ? 1 : 40, sessions: [{ ...session, hypothesis: params.search ? 'Filtered saved hunt' : 'Original hunt' }] } });
  });
  render(<HuntLab />);
  await screen.findByRole('button', { name: 'Reopen hunt: Original hunt' });
  fireEvent.click(screen.getByRole('button', { name: 'More hunts' }));
  fireEvent.change(screen.getByLabelText('Search hunt history'), { target: { value: 'filtered' } });
  fail = true;
  fireEvent.click(screen.getByRole('button', { name: 'Search hunts' }));
  await screen.findByText('Hunt history unavailable');
  expect(screen.queryByRole('button', { name: 'Reopen hunt: Original hunt' })).toBeNull();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByRole('button', { name: 'Reopen hunt: Filtered saved hunt' });
  await act(async () => resolveOld({ data: { total: 40, sessions: [{ ...session, hypothesis: 'Stale hunt' }] } }));
  expect(screen.queryByRole('button', { name: 'Reopen hunt: Stale hunt' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Reopen hunt: Filtered saved hunt' })).toBeTruthy();
});

it('refreshes the current history filters when a new hunt finishes after the view changed', async () => {
  let finishHunt!: (value: unknown) => void;
  mockPost.mockImplementation(() => new Promise(resolve => { finishHunt = resolve; }));
  mockGet.mockImplementation(async url => ({ data: url.endsWith('/detections') ? [] : { sessions: [session], total: 1 } }));
  render(<HuntLab />);
  await screen.findByRole('button', { name: /reopen hunt:/i });
  fireEvent.change(screen.getByLabelText('Hunting Hypothesis'), { target: { value: 'new hypothesis' } });
  fireEvent.click(screen.getByRole('button', { name: 'Hunt' }));
  fireEvent.change(screen.getByLabelText('Search hunt history'), { target: { value: 'current keyword' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search hunts' }));
  await waitFor(() => expect(mockGet).toHaveBeenLastCalledWith('/hunt/history', { params: { page: 1, size: 20, search: 'current keyword' } }));
  const reads = mockGet.mock.calls.filter(([url]) => url === '/hunt/history').length;
  await act(async () => finishHunt({ data: { data: { explanation: 'New saved hunt evidence' } } }));
  await screen.findByText('New saved hunt evidence');
  await waitFor(() => expect(mockGet.mock.calls.filter(([url]) => url === '/hunt/history')).toHaveLength(reads + 1));
  expect(mockGet).toHaveBeenLastCalledWith('/hunt/history', { params: { page: 1, size: 20, search: 'current keyword' } });
});

describe('Recorded hunt completion and handoff', () => {
  it('reopens partial outcomes without relabeling errors as success, and filters partial history', async () => {
    mockGet.mockImplementation(url => Promise.resolve({ data: url.endsWith('/5') ? {
      ...sessionDetail, result_data: {
        status: 'partial', recorded_at: '2026-11-20T12:00:00Z',
        execution_summary: { completed: 1, rejected: 1, failed: 1, attempted: 2, skipped: 0 },
        query_results: [
          { outcome: 'completed', rows: [{ id: 1 }], row_count: 1 },
          { outcome: 'rejected', error: 'Unsupported projection', rows: [] },
          { outcome: 'failed', error: 'Database unavailable', rows: [] },
        ],
      },
    } : url.endsWith('/detections') ? [] : { sessions: [session], total: 1 } }));
    render(<HuntLab />);
    fireEvent.click(await screen.findByRole('button', { name: /reopen hunt: dns tunneling/i }));
    expect(await screen.findByText('Recorded outcome: partial')).toBeTruthy();
    expect(screen.getByText('1 completed · 1 rejected before execution · 1 execution errors')).toBeTruthy();
    expect(screen.getByText('2 database queries attempted · 0 skipped by the three-query cap')).toBeTruthy();
    expect(screen.getByText('Rejected before execution')).toBeTruthy();
    expect(screen.getByText('Execution failed')).toBeTruthy();
    expect(screen.getByText('Unsupported projection')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Export retained rows for query 2' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Hunt history status'), { target: { value: 'partial' } });
    await waitFor(() => expect(mockGet).toHaveBeenCalledWith('/hunt/history', { params: { page: 1, size: 20, state: 'partial' } }));
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it('shows top-level generation failures instead of an empty successful result', async () => {
    mockGet.mockImplementation(url => Promise.resolve({ data: url.endsWith('/detections') ? [] : { sessions: [], total: 0 } }));
    mockPost.mockResolvedValue({ data: { data: { status: 'failed', error: 'No hunt queries were generated', execution_summary: { completed: 0, rejected: 0, failed: 0, attempted: 0, skipped: 0 }, query_results: [] } } });
    render(<HuntLab />);
    fireEvent.change(screen.getByLabelText('Hunting Hypothesis'), { target: { value: 'review gateway' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hunt' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('No hunt queries were generated')).toBeTruthy();
    expect(screen.getByText('Recorded outcome: failed')).toBeTruthy();
  });

  it('does not backfill detailed execution outcomes for legacy sessions', async () => {
    mockGet.mockImplementation(url => Promise.resolve({ data: url.endsWith('/5') ? sessionDetail : url.endsWith('/detections') ? [] : { sessions: [session], total: 1 } }));
    render(<HuntLab />);
    fireEvent.click(await screen.findByRole('button', { name: /reopen hunt: dns tunneling/i }));
    expect(await screen.findByText('Detailed execution outcome was not recorded for this result. Historical completion labels do not prove that every query succeeded.')).toBeTruthy();
    expect(screen.queryByLabelText('Recorded hunt execution summary')).toBeNull();
    expect(screen.getByRole('button', { name: 'Export recorded evidence JSON' })).toBeTruthy();
  });
});

describe('Exact hunt run continuity', () => {
  it('opens the saved exact run without executing or inferring a latest run', async () => {
    mockGet.mockImplementation(url => Promise.resolve({ data: url.endsWith('/5') ? { ...sessionDetail, result_data: { ...sessionDetail.result_data, agent_run_id: 81 } } : url.endsWith('/detections') ? [] : { sessions: [session], total: 1 } }));
    render(<HuntLab />); fireEvent.click(await screen.findByRole('button', { name: /reopen hunt: dns tunneling/i }));
    expect((await screen.findByRole('link', { name: 'Inspect recorded hunt run #81' })).getAttribute('href')).toBe('/app/audit-log?run=81'); expect(mockPost).not.toHaveBeenCalled(); expect(screen.getByText(/not the latest hunt run/)).toBeTruthy();
  });
  it.each([undefined, null, -1, '81', 1.5])('does not invent a run link from missing or invalid metadata %s', async runId => {
    mockGet.mockImplementation(url => Promise.resolve({ data: url.endsWith('/5') ? { ...sessionDetail, result_data: { ...sessionDetail.result_data, agent_run_id: runId } } : url.endsWith('/detections') ? [] : { sessions: [session], total: 1 } }));
    render(<HuntLab />); fireEvent.click(await screen.findByRole('button', { name: /reopen hunt: dns tunneling/i })); await screen.findByText(/No verified run link/); expect(screen.queryByRole('link', { name: /Inspect recorded hunt run/ })).toBeNull(); expect(mockPost).not.toHaveBeenCalled();
  });
  it('keeps interrupted hunt failure distinct from zero findings and links the failed run', async () => {
    mockGet.mockImplementation(url => Promise.resolve({ data: url.endsWith('/detections') ? [] : { sessions: [], total: 0 } }));
    mockPost.mockResolvedValue({ data: { data: { session_id: 20, agent_run_id: 81, status: 'failed', error: 'No complete query results are retained. This is not a zero-finding result.' } } });
    render(<HuntLab />); fireEvent.change(await screen.findByLabelText('Hunting Hypothesis'), { target: { value: 'Review gateway' } }); fireEvent.click(screen.getByRole('button', { name: 'Hunt' }));
    await screen.findByRole('link', { name: 'Inspect recorded hunt run #81' }); expect(screen.getByRole('alert').textContent).toContain('not a zero-finding result'); expect(screen.queryByRole('region', { name: 'Recorded hunt execution summary' })).toBeNull(); expect(mockPost).toHaveBeenCalledOnce();
  });
});

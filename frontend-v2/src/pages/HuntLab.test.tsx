import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HuntLab } from './HuntLab';

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import apiClient from '../api/client';

const mockGet = vi.mocked(apiClient.get);
const mockPost = vi.mocked(apiClient.post);

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
      data: url.endsWith('/5') ? sessionDetail : url.endsWith('/detections') ? [] : [session],
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
      data: url.endsWith('/5') ? sessionDetail : url.endsWith('/detections') ? [] : [session],
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
      return Promise.resolve({ data: url.endsWith('/detections') ? [] : [session] });
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

describe('Detection rules', () => {
  const rules = [
    { id: 1, name: 'Modbus write to PLC', description: 'Flags write function codes', rule_type: 'sigma', rule_content: 'title: x', mitre_techniques: ['T0855'], confidence: 'high', tested: true, enabled: true, created_by: 'human', created_at: '2026-11-10T08:00:00Z' },
    { id: 2, name: 'DNS tunneling heuristic', description: null, rule_type: 'sql', rule_content: 'select 1', mitre_techniques: null, confidence: 'low', tested: false, enabled: false, created_by: 'agent', created_at: '2026-11-12T08:00:00Z' },
  ];

  function mockWithRules() {
    mockGet.mockImplementation(url => Promise.resolve({
      data: url.endsWith('/5') ? sessionDetail : url.endsWith('/detections') ? rules : [session],
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
    }));
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

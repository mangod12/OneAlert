import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { DetectionRunReceipt } from './DetectionRunReceipt';
const lead = { method: 'ai', title: '<b>Review lead</b>', severity: 'high', description: 'Recorded aggregate explanation', affected_ips: ['192.0.2.1'], recommended_actions: ['Review telemetry'] };
const receipt = { format: 'onealert-detection-review', version: 1, run_id: 3, window_from: '2026-11-20T12:00:00Z', window_until: '2026-11-21T12:00:00Z', total_events: 60, alert_events: 60, rule_count: 0, ai_count: 1, ai_status: 'completed', included: 1, omitted: 0, limit: 30, findings: [lead], scope: 'Bounded review leads, not event evidence.' };
afterEach(cleanup);
it('renders saved bounded AI leads as text, not confirmed detections or executable actions', () => {
  render(<DetectionRunReceipt runId={3} text={JSON.stringify(receipt)} />);
  expect(screen.getByText('1. <b>Review lead</b>').querySelector('b')).toBeNull();
  expect(screen.getByText(/AI-generated lead/)).toBeTruthy();
  expect(screen.getByText(/Suggested next steps, not executed/)).toBeTruthy();
  expect(screen.queryByRole('link')).toBeNull(); expect(screen.queryByRole('button')).toBeNull();
});
it('distinguishes incomplete rule-only analysis, omitted leads and empty results', () => {
  const { unmount } = render(<DetectionRunReceipt runId={3} text={JSON.stringify({ ...receipt, rule_count: 2, ai_count: 0, ai_status: 'failed', omitted: 1, findings: [{ ...lead, method: 'rule' }] })} />);
  expect(screen.getByText(/Only rule leads were retained/)).toBeTruthy();
  expect(screen.getByText(/1 omitted/)).toBeTruthy(); expect(screen.getByText(/Rule-derived lead/)).toBeTruthy(); unmount();
  render(<DetectionRunReceipt runId={3} text={JSON.stringify({ ...receipt, ai_status: 'skipped', ai_count: 0, included: 0, findings: [] })} />);
  expect(screen.getByText(/does not establish that the environment is safe/)).toBeTruthy();
});
it('accepts bounded unicode by character count rather than UTF-16 units', () => {
  render(<DetectionRunReceipt runId={3} text={JSON.stringify({ ...receipt, findings: [{ ...lead, title: '😀'.repeat(160) }] })} />);
  expect(screen.queryByRole('alert')).toBeNull();
});
it.each([null, '', '{bad', JSON.stringify({}), ...[{ run_id: 99 }, { version: 2 }, { included: 2 }, { omitted: -1 }, { ai_status: 'safe' }, { total_events: '60' }, { findings: [{ ...lead, affected_ips: '192.0.2.1' }] }, { findings: [{ ...lead, severity: 'urgent' }] }, { window_from: 'bad' }, { window_from: '2027-01-01' }, { findings: [{ ...lead, title: 'x'.repeat(161) }] }].map(change => JSON.stringify({ ...receipt, ...change }))])('fails closed for invalid, wrong-run or shortened receipts %#', text => {
  render(<DetectionRunReceipt runId={3} text={text} />); expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.queryByText(lead.description)).toBeNull();
});

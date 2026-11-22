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

const input = { format: 'bounded_aggregate_json_v1', max_context_characters: 64000, text_character_limit: 128, included_groups: { severity_distribution: 100, top_source_ips: 10, top_dest_ports: 2, top_signatures: 10 }, omitted_groups: { severity_distribution: 3, top_source_ips: 10, top_dest_ports: 0, top_signatures: 0 }, shortened_labels: [{ group: 'top_signatures', position: 1 }] };
it('shows prepared input bounds, supplied aggregate omissions and shortened label positions separately from findings', () => {
  render(<DetectionRunReceipt runId={3} text={JSON.stringify({ ...receipt, input_context: input })} />); expect(screen.getByText(/At most 128 Unicode characters per text label/)).toBeTruthy(); expect(screen.getByText('100 supplied rows included · 3 supplied rows omitted')).toBeTruthy(); expect(screen.getByText('top signatures: prepared row 1')).toBeTruthy(); expect(screen.getByText(/not all distinct labels in the database/)).toBeTruthy(); expect(screen.getByText(/not confirmation of provider success/)).toBeTruthy(); expect(screen.queryByRole('button')).toBeNull();
});
it.each([{ format: 'wrong' }, { ...input, included_groups: { ...input.included_groups, unknown: 1 } }, { ...input, omitted_groups: { ...input.omitted_groups, unknown: 1 } }, { ...input, text_character_limit: 13 }, { ...input, included_groups: { ...input.included_groups, top_signatures: 11 } }, { ...input, shortened_labels: [{ group: 'raw_data', position: 1 }] }, { ...input, shortened_labels: [{ group: 'top_signatures', position: 11 }] }, { ...input, shortened_labels: [{ group: 'top_signatures', position: 1 }, { group: 'top_signatures', position: 1 }] }])('does not interpret inconsistent input metadata as full aggregate coverage %#', input_context => {
  render(<DetectionRunReceipt runId={3} text={JSON.stringify({ ...receipt, input_context })} />); expect(screen.getByText(/input bounds and aggregate omissions were not recorded/)).toBeTruthy(); expect(screen.queryByRole('region', { name: 'Saved detection aggregate input scope' })).toBeNull(); expect(screen.getByText(/AI-generated lead/)).toBeTruthy();
});
it('does not claim prepared AI input for a skipped analysis, even if old scope metadata is present', () => {
  render(<DetectionRunReceipt runId={3} text={JSON.stringify({ ...receipt, ai_status: 'skipped', ai_count: 0, included: 0, findings: [], input_context: input })} />); expect(screen.queryByRole('region', { name: 'Saved detection aggregate input scope' })).toBeNull();
});

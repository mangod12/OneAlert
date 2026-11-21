import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { TriageGroupReceipt } from './TriageGroupReceipt';
const receipt = { version: 1, position: 1, outcome: 'nonincident', case_id: null, alerts_total: 30, events_total: 0, alert_sample_ids: [1, 2, 3], event_sample_ids: [], method: 'ai_sample', alert_inputs: 20, event_inputs: 0 };
afterEach(cleanup);
it('explains saved nonincident decision with omitted input and exact bounded source links', () => {
  render(<TriageGroupReceipt text={JSON.stringify(receipt)} />);
  expect(screen.getByText(/Recorded nonincident decision/)).toBeTruthy(); expect(screen.getByText(/not an all-clear/)).toBeTruthy();
  expect(screen.getByText(/10 alerts and 0 events were omitted/)).toBeTruthy(); expect(screen.getByText(/not full records or raw payloads/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Open alert #2' }).getAttribute('href')).toBe('/app/alerts?alert=2'); expect(screen.getAllByRole('link')).toHaveLength(3);
});
it('distinguishes rule fallback and links its saved case without claiming AI approval', () => {
  render(<TriageGroupReceipt text={JSON.stringify({ ...receipt, outcome: 'case_created', case_id: 81, method: 'rule_based_fallback', alert_inputs: 30 })} />);
  expect(screen.getByText(/Rule-based fallback, not an AI decision/)).toBeTruthy(); expect(screen.queryByText(/omitted from AI/)).toBeNull();
  expect(screen.getByRole('link', { name: 'Open saved case #81' }).getAttribute('href')).toBe('/app/cases/81');
});
it('shows failed rollback and unknown coverage rather than a nonincident or saved case', () => {
  render(<TriageGroupReceipt text={JSON.stringify({ ...receipt, outcome: 'failed', method: 'unavailable', alert_inputs: null, event_inputs: null })} />);
  expect(screen.getByText(/Failed, needs review or retry/)).toBeTruthy(); expect(screen.getByText(/writes were rolled back/)).toBeTruthy(); expect(screen.queryByText(/not an all-clear/)).toBeNull();
});
it.each([{ version: 2 }, { position: -1 }, { alerts_total: 101 }, { events_total: 501 }, { alert_sample_ids: [1, 1, 3] }, { alert_sample_ids: ['https://bad.test', 2, 3] }, { method: 'unavailable' }, { outcome: 'failed' }, { outcome: 'case_created', case_id: null }, { outcome: 'unknown' }, { alert_inputs: 30 }, { case_id: 9 }, { alert_sample_ids: [] }, { alert_sample_ids: [1.2, 2, 3] }])('rejects invalid receipt without inventing links or status %j', change => {
  render(<TriageGroupReceipt text={JSON.stringify({ ...receipt, ...change })} />); expect(screen.getByText(/incomplete or unsupported/)).toBeTruthy(); expect(screen.queryByRole('link')).toBeNull();
});
it.each([null, '', '{"version":1', '<b>unsafe</b>'])('handles shortened or legacy text as unsupported %s', text => {
  render(<TriageGroupReceipt text={text} />); expect(screen.getByText(/incomplete or unsupported/)).toBeTruthy(); expect(screen.queryByRole('link')).toBeNull();
});

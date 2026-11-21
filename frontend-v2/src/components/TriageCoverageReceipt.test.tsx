import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { TriageCoverageReceipt } from './TriageCoverageReceipt';
const value = { version: 1, method: 'ai_sample', model: 'saved-model', alerts_total: 22, events_total: 52, alerts_omitted: 2, events_omitted: 2, alert_input_ids: Array.from({ length: 20 }, (_, i) => i + 1), event_input_ids: Array.from({ length: 50 }, (_, i) => i + 100) };
afterEach(cleanup);
it('reports saved exact summary scope, omitted counts and historical limits without offering original access', () => {
  render(<TriageCoverageReceipt metadata={{ triage_coverage: value }} />);
  expect(screen.getByText(/AI summary-field analysis · Model: saved-model/)).toBeTruthy();
  expect(screen.getByText(/Sent to AI: 20 alert summaries and 50 event summaries/)).toBeTruthy();
  expect(screen.getByText(/2 alerts and 2 events were omitted/)).toBeTruthy();
  expect(screen.getByText(/not recalculated when links change/)).toBeTruthy();
  expect(screen.getByText(/Alerts: 1, 2, 3/)).toBeTruthy(); expect(screen.queryByRole('link')).toBeNull();
});
it('labels full small input without claiming full raw-record review', () => {
  render(<TriageCoverageReceipt metadata={{ triage_coverage: { ...value, alerts_total: 1, events_total: 0, alerts_omitted: 0, events_omitted: 0, alert_input_ids: [7], event_input_ids: [], model: null } }} />);
  expect(screen.getByText(/Model: Not recorded/)).toBeTruthy(); expect(screen.getByText(/not full records or raw payloads/)).toBeTruthy(); expect(screen.queryByText(/Limited input:/)).toBeNull();
});
it('labels rule-based fallback without attributing conclusions or confidence to an AI model', () => {
  render(<TriageCoverageReceipt metadata={{ triage_coverage: { ...value, method: 'rule_based_fallback', model: null, alerts_total: 1, events_total: 0, alerts_omitted: 0, events_omitted: 0, alert_input_ids: [7], event_input_ids: [] } }} />);
  expect(screen.getByText(/No AI-generated conclusions used/)).toBeTruthy(); expect(screen.getByText(/Manual review is required/)).toBeTruthy(); expect(screen.queryByText(/Sent to AI/)).toBeNull();
});
it.each([null, {}, { triage_coverage: null }, { triage_coverage: { ...value, version: 2 } }, { triage_coverage: { ...value, alerts_omitted: 1 } }, { triage_coverage: { ...value, event_input_ids: [] } }, { triage_coverage: { ...value, method: 'manual' } }, { triage_coverage: { ...value, model: {} } }, { triage_coverage: { ...value, alert_input_ids: [0] } }, { triage_coverage: { ...value, alert_input_ids: Array(20).fill(7) } }, { triage_coverage: { ...value, alerts_total: 101, alerts_omitted: 81 } }, { triage_coverage: { ...value, method: 'rule_based_fallback' } }])('does not interpret legacy or inconsistent data as full AI coverage %j', metadata => {
  render(<TriageCoverageReceipt metadata={metadata} />); expect(screen.getByText(/coverage was not recorded in a supported format/)).toBeTruthy(); expect(screen.queryByRole('region')).toBeNull();
});

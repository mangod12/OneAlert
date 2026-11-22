import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { EventImportPreviewComparison } from './EventImportPreviewComparison';
import { compareImportPreview } from '../utils/eventImportComparison';
const preview = { format: 'onealert_event_parser_preview_v1', source_type: 'suricata' as const, fingerprint: 'a'.repeat(64), byte_size: 10, previewed_at: '2026-11-22T06:30:00Z', received: 2, accepted: 1, skipped: 1, redactions_in_accepted: 2, skip_reasons: { invalid_timestamp: 1 }, skipped_positions: { invalid_timestamp: { record_positions: [2], omitted_positions: 0 } } };
const actual = { received: 2, ingested: 1, skipped: 1, redacted: 2, skip_reasons: { invalid_timestamp: 1 } };
afterEach(cleanup);
it('shows no attached preview rather than inventing an earlier check', () => { render(<EventImportPreviewComparison comparison={compareImportPreview(undefined, 'suricata', actual)} />); expect(screen.getByText(/No parser preview was attached/)).toBeTruthy(); expect(screen.queryByRole('region')).toBeNull(); });
it('shows matching loaded metadata with context and explicit non-live scope', () => {
  render(<EventImportPreviewComparison comparison={compareImportPreview(preview, 'suricata', actual)} />);
  expect(screen.getByText(/All recorded counters/)).toBeTruthy(); expect(screen.getByText(/not an independently authenticated receipt/)).toBeTruthy(); expect(screen.getByText(/Do not re-upload just to make counts match/)).toBeTruthy();
  expect(screen.getByText(/File\/parser fingerprint/).textContent).toContain(preview.fingerprint);
});
it('shows missing counts as unknown, not a zero delta', () => {
  render(<EventImportPreviewComparison comparison={compareImportPreview(preview, 'suricata', { ...actual, redacted: undefined })} />);
  expect(screen.getByText(/Some comparison metadata was not recorded/)).toBeTruthy(); expect(screen.getAllByText('Not recorded').length).toBe(2);
});
it('shows positive and negative differences including reason-only changes', () => {
  render(<EventImportPreviewComparison comparison={compareImportPreview(preview, 'suricata', { ...actual, skip_reasons: { invalid_fields: 1 } })} />);
  expect(screen.getByText(/Import response differs/)).toBeTruthy(); expect(screen.getByText('+1')).toBeTruthy(); expect(screen.getByText('-1')).toBeTruthy();
});
it('does not echo malformed preview values or private unknown reason labels', () => {
  render(<EventImportPreviewComparison comparison={compareImportPreview({ private: 'PRIVATE' }, 'suricata', actual)} />);
  expect(screen.getByText(/could not be verified/)).toBeTruthy(); expect(screen.queryByText(/PRIVATE/)).toBeNull();
});

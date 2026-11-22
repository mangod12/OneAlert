import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { EvidenceNoteReference } from './EvidenceNoteReference';
afterEach(cleanup);
const metadata = { kind: 'reviewed_evidence_note', schema_version: 1, case_id: 7, record_kind: 'event', record_id: 21, record_fingerprint: 'a'.repeat(64), reviewed_fingerprint: 'b'.repeat(64), record_snapshot: { label_at_review: 'Saved authentication event', label_truncated: false, severity: 'high', recorded_at: '2026-01-01T00:00:00Z', processing_label: 'in_case' } };
it('shows a historical application snapshot, exact original and digest without claiming immutable current evidence', () => {
  render(<EvidenceNoteReference metadata={metadata} caseId={7} canOpenOriginal />); expect(screen.getByText('Saved source reference: event #21')).toBeTruthy(); expect(screen.getByText(metadata.record_fingerprint)).toBeTruthy(); expect(screen.getByText(/not signed or tamper-proof/)).toBeTruthy(); expect(screen.getByText(/Editing this note does not re-review/)).toBeTruthy(); expect(screen.getByRole('link').getAttribute('href')).toBe('/app/events/21');
});
it('supports exact alert originals and explicitly labels truncated excerpts', () => {
  render(<EvidenceNoteReference metadata={{ ...metadata, record_kind: 'alert', record_id: 11, record_snapshot: { ...metadata.record_snapshot, label_truncated: true, processing_label: 'acknowledged' } }} caseId={7} canOpenOriginal />); expect(screen.getByRole('link').getAttribute('href')).toBe('/app/alerts?alert=11'); expect(screen.getByText(/truncated at 500 characters/)).toBeTruthy(); expect(screen.getByText(/alert status acknowledged/)).toBeTruthy();
});
it('viewers retain readable provenance without an owner-only original management link', () => {
  render(<EvidenceNoteReference metadata={metadata} caseId={7} canOpenOriginal={false} />); expect(screen.getByText('Saved authentication event')).toBeTruthy(); expect(screen.queryByRole('link')).toBeNull();
});
it('keeps source label HTML inert', () => {
  render(<EvidenceNoteReference metadata={{ ...metadata, record_snapshot: { ...metadata.record_snapshot, label_at_review: '<img src=x onerror=alert(1)>' } }} caseId={7} canOpenOriginal />); expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy(); expect(document.querySelector('img')).toBeNull();
});
it.each([{ ...metadata, schema_version: 2 }, { ...metadata, case_id: 8 }, { ...metadata, record_id: 1.5 }, { ...metadata, record_kind: 'private' }, { ...metadata, record_fingerprint: 'bad' }, { ...metadata, reviewed_fingerprint: 'bad' }, { ...metadata, record_snapshot: null }, { ...metadata, record_snapshot: { ...metadata.record_snapshot, label_at_review: 'x'.repeat(501) } }, { ...metadata, record_snapshot: { ...metadata.record_snapshot, recorded_at: 'bad' } }, { ...metadata, record_snapshot: { ...metadata.record_snapshot, processing_label: {} } }])('fails closed without an original link for malformed source provenance %#', value => {
  render(<EvidenceNoteReference metadata={value} caseId={7} canOpenOriginal />); expect(screen.getByText(/Saved evidence reference could not be verified/)).toBeTruthy(); expect(screen.queryByRole('link')).toBeNull();
});
it.each([null, {}, { kind: 'other' }])('does not label unrelated timeline metadata as reviewed evidence %#', value => {
  const view = render(<EvidenceNoteReference metadata={value} caseId={7} canOpenOriginal />); expect(view.container.textContent).toBe('');
});

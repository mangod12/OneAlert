import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AssessmentHistoryExplorer, type HistoryAssessment } from './AssessmentHistoryExplorer';
import { assessmentHistoryCsv } from '../utils/assessmentHistoryCsv';
const rows: HistoryAssessment[] = Array.from({ length: 22 }, (_, index) => ({ id: index + 1, control_id: 11, status: index % 2 ? 'partial' : 'compliant', evidence_type: index === 0 ? 'scanner' : null, evidence_detail: index === 0 ? 'Rare needle\nFull evidence' : index % 2 ? '   ' : null, assessed_by: index === 0 ? 'Reviewer alpha' : 'Reviewer beta', assessed_at: `2026-11-${String(index + 1).padStart(2, '0')}T12:00:00Z` }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function show(history = rows, selectedIds: number[] = []) { return render(<AssessmentHistoryExplorer history={history} controlId={11} selectedIds={selectedIds}>{row => <li key={row.id}>Saved #{row.id}</li>}</AssessmentHistoryExplorer>); }
it('searches every loaded page and resets paging without mutating input order', () => {
  show(); expect(screen.getAllByRole('listitem')).toHaveLength(10); expect(screen.getByText('Saved #22')).toBeTruthy();
  fireEvent.click(screen.getByText('More records')); expect(screen.getByText('Page 2 of 3')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Search assessment history'), { target: { value: 'rare NEEDLE' } });
  expect(screen.getByText('Saved #1')).toBeTruthy(); expect(screen.getByText('Page 1 of 1')).toBeTruthy(); expect(rows[0].id).toBe(1);
});
it.each(['scanner', 'Reviewer alpha', '1'])('matches literal full-loaded record values %s', value => {
  show([rows[0], rows[21]]); fireEvent.change(screen.getByLabelText('Search assessment history'), { target: { value } }); expect(screen.getByText('Saved #1')).toBeTruthy();
});
it('combines saved status and blank evidence scope without inferring compliance', () => {
  show(); fireEvent.change(screen.getByLabelText('History assessment status'), { target: { value: 'compliant' } });
  fireEvent.change(screen.getByLabelText('History evidence detail scope'), { target: { value: 'present' } });
  expect(screen.getByText(/1 of 22 loaded assessment/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('History evidence detail scope'), { target: { value: 'missing' } }); expect(screen.getByText(/10 of 22 loaded/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Search assessment history'), { target: { value: '.*' } }); expect(screen.getByText(/No loaded assessment records match/)).toBeTruthy();
  expect((screen.getByText('Download matching assessment history CSV') as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByText('Clear history filters')); expect(screen.getByText(/22 of 22 loaded/)).toBeTruthy();
});
it('keeps hidden comparison selections with an explicit explanation', () => {
  show(rows, [22, 21]); fireEvent.change(screen.getByLabelText('Search assessment history'), { target: { value: 'rare' } }); expect(screen.getByText(/2 selected comparison records are outside/)).toBeTruthy();
});
it('uses inclusive UTC dates, supports naive UTC, excludes invalid dates and rejects reversed ranges', () => {
  show([{ ...rows[0], assessed_at: '2026-11-02T00:30:00+02:00' }, { ...rows[1], assessed_at: '2026-11-01T23:59:00' }, { ...rows[2], assessed_at: 'invalid' }]);
  fireEvent.change(screen.getByLabelText('History from UTC date'), { target: { value: '2026-11-01' } }); fireEvent.change(screen.getByLabelText('History through UTC date'), { target: { value: '2026-11-01' } }); expect(screen.getByText(/2 of 3 loaded/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('History from UTC date'), { target: { value: '2026-11-02' } }); expect(screen.getByRole('alert').textContent).toContain('must not be after'); expect(screen.getByText(/Matching count unavailable/)).toBeTruthy();
});
it('exports all matches beyond the current page and revokes the temporary URL', () => {
  vi.useFakeTimers(); const create = vi.fn((blob: Blob) => { expect(blob.size).toBeGreaterThan(1000); return 'blob:history'; }); const revoke = vi.fn(); vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke }); const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try { show(); fireEvent.click(screen.getByText('Download matching assessment history CSV')); expect(create).toHaveBeenCalledTimes(1); expect(create.mock.calls[0][0]).toBeInstanceOf(Blob); expect(click).toHaveBeenCalledTimes(1); vi.runAllTimers(); expect(revoke).toHaveBeenCalledWith('blob:history'); }
  finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
});
it('reports download failure without hiding the unchanged records', () => {
  vi.stubGlobal('URL', { createObjectURL: () => { throw Error('No download'); } });
  try { show(); fireEvent.click(screen.getByText('Download matching assessment history CSV')); expect(screen.getByRole('alert').textContent).toContain('could not be downloaded'); expect(screen.getAllByRole('listitem')).toHaveLength(10); } finally { vi.unstubAllGlobals(); }
});
it('escapes full CSV evidence, formula prefixes, null flags and exact filter metadata', () => {
  const csv = assessmentHistoryCsv([{ ...rows[0], assessed_by: '\u0001\t=HYPERLINK("x")', evidence_type: '', evidence_detail: 'Quoted "detail"\nnext' }, { ...rows[1], evidence_detail: null }], 11, { query: ' =formula', status: 'partial', evidence: 'missing', from: '2026-11-01', through: '2026-11-20' }, 22);
  expect(csv.startsWith('\ufeff')).toBe(true); expect(csv).toContain('"\'\u0001\t=HYPERLINK(""x"")"'); expect(csv).toContain('"Quoted ""detail""\nnext"'); expect(csv).toContain('"\'=formula"'); expect(csv).toContain('"22","2"'); expect(csv).toContain('"","false"'); expect(csv).toContain('"","true"'); expect(csv).toContain('not immutable versions');
});

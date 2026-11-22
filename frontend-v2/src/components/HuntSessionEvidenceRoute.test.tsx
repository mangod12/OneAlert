import { reviewedAuditFixture } from '../utils/huntReviewedExecutionAudit.fixture';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { HuntSessionEvidenceRoute } from './HuntSessionEvidenceRoute';
import { savedHuntEvidence } from '../utils/huntSessionEvidence';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const get = vi.mocked(apiClient.get), writeText = vi.fn();
const result = { query: { description: 'Saved DNS query', sql: 'SELECT name FROM events', params: { search: 'private bound' } }, row_count: 100, rows: Array.from({ length: 25 }, (_, id) => ({ id, name: id === 24 ? 'Last retained row' : 'Other row' })) };
const session = { id: 99, hypothesis: 'Saved DNS review', status: 'partial', queries_run: 2, findings_count: 100, created_at: '2026-11-21T08:00:00Z', sigma_rule: null, result_data: { query_results: [result], error: 'One query was rejected' } };
function Navigation() { const navigate = useNavigate(), location = useLocation(); return <><button onClick={() => navigate('?session=100&keep=1')}>Another saved hunt</button><output data-testid="location">{location.search}</output></>; }
function show(query = '?session=99') { return render(<MemoryRouter initialEntries={[`/hunt${query}`]}><HuntSessionEvidenceRoute><label>Hypothesis draft<input aria-label="Hypothesis draft" defaultValue="Private draft" /></label></HuntSessionEvidenceRoute><Navigation /></MemoryRouter>); }
beforeEach(() => { vi.resetAllMocks(); writeText.mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } }); get.mockImplementation(async url => ({ data: url.endsWith('/100') ? { ...session, id: 100, hypothesis: 'Other saved review' } : session })); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('reads exact off-list retained evidence without rerunning queries or replacing a draft', async () => {
  show(); await screen.findByText('Saved DNS review'); expect(get).toHaveBeenCalledExactlyOnceWith('/hunt/99'); expect(apiClient.post).not.toHaveBeenCalled(); expect((screen.getByLabelText('Hypothesis draft') as HTMLInputElement).value).toBe('Private draft'); expect(screen.getByText('75 reported rows were not retained in this result. They are not available through paging.')).toBeTruthy(); expect(screen.getByText(/Detailed execution outcome was not recorded/)).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Next rows for query 1')); expect(screen.getByText('Last retained row')).toBeTruthy(); fireEvent.change(screen.getByLabelText('Search retained rows for query 1'), { target: { value: 'Last retained' } }); expect(screen.getByText('1 of 25 retained rows match.')).toBeTruthy();
});
it.each(['?session=', '?session=0', '?session=-2', '?session=1.5', '?session=99&session=100', '?session=9007199254740992', '?session=abc'])('rejects invalid exact session links without a fallback read %s', query => { show(query); expect(screen.getByRole('alert').textContent).toContain('exactly one positive'); expect(get).not.toHaveBeenCalled(); });
it('copies only the loaded session ID and closes without erasing unrelated route state or draft', async () => {
  show('?session=99&rule=7&keep=1#private'); await screen.findByText('Saved DNS review'); fireEvent.click(screen.getByText('Copy exact saved hunt link')); await screen.findByText('Saved hunt link copied.'); expect(writeText).toHaveBeenCalledWith(`${location.origin}/app/hunt?session=99`); fireEvent.click(screen.getByText('Close saved hunt evidence')); expect(screen.getByTestId('location').textContent).toBe('?rule=7&keep=1'); expect(screen.queryByText('Saved DNS review')).toBeNull();
});
it('keeps absent evidence distinct from a zero-result or successful hunt', async () => {
  get.mockResolvedValueOnce({ data: { ...session, result_data: null } }); show(); await screen.findByText(/No query evidence was retained/); expect(screen.getByText(/does not establish zero results or a successful hunt/)).toBeTruthy();
});
it('supports historical array result data without inventing execution outcomes', async () => {
  get.mockResolvedValueOnce({ data: { ...session, result_data: [result] } }); show(); await screen.findByText('Saved DNS review'); expect(screen.getByText('Query outcome not recorded')).toBeTruthy(); expect(screen.getByText('100 results reported · 25 evidence rows retained')).toBeTruthy();
});
it.each([{ id: 100 }, { result_data: 'unsupported' }, { result_data: { query_results: [{ rows: [null] }] } }, { result_data: { query_results: [{ execution: { selected_columns: null } }] } }, { result_data: { query_results: [{ query: { params: [] } }] } }, { result_data: { execution_summary: { completed: -1 } } }])('rejects mismatched or malformed evidence without presenting another record %j', async change => {
  get.mockResolvedValueOnce({ data: { ...session, ...change } }); show(); await screen.findByRole('alert'); expect(screen.queryByText('Download exact saved hunt JSON')).toBeNull();
});
it('ignores a late earlier selection and a late clipboard confirmation', async () => {
  let finish!: (value: unknown) => void; get.mockReturnValueOnce(new Promise(resolve => { finish = resolve; })); show(); fireEvent.click(screen.getByText('Another saved hunt')); await screen.findByText('Other saved review'); await act(async () => finish({ data: session })); expect(screen.queryByText('Saved DNS review')).toBeNull();
  let copied!: () => void; writeText.mockReturnValueOnce(new Promise<void>(resolve => { copied = resolve; })); fireEvent.click(screen.getByText('Copy exact saved hunt link')); fireEvent.click(screen.getByText('Refresh saved hunt evidence')); await screen.findByText('Other saved review'); await act(async () => copied()); expect(screen.queryByText('Saved hunt link copied.')).toBeNull();
});
it('separates failure and retry from absent evidence', async () => {
  get.mockRejectedValueOnce(Error('Unavailable')); show(); await screen.findByRole('alert'); expect(screen.queryByText(/No query evidence was retained/)).toBeNull(); fireEvent.click(screen.getByText('Retry saved hunt evidence')); await screen.findByText('Saved DNS review');
});
it('exports full original saved record and handles download failure without dropping loaded rows', async () => {
  let blob!: Blob; vi.stubGlobal('URL', class extends URL { static createObjectURL(value: Blob) { blob = value; return 'blob:hunt'; } static revokeObjectURL() {} }); const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {}); show(); await screen.findByText('Saved DNS review'); fireEvent.click(screen.getByText('Download exact saved hunt JSON')); expect(blob.size).toBeGreaterThan(1000); expect(blob.type).toBe('application/json'); click.mockImplementation(() => { throw Error('Blocked'); }); fireEvent.click(screen.getByText('Download exact saved hunt JSON')); await screen.findByText(/could not be downloaded/); expect(screen.getByText('Saved DNS review')).toBeTruthy();
});
it('preserves original array and full result data in downloadable record, including null versus empty Sigma output', () => {
  const parsed = savedHuntEvidence({ ...session, result_data: [result], sigma_rule: '' }, 99); expect(parsed.session.result_data).toEqual([result]); expect(parsed.session.sigma_rule).toBe(''); expect(parsed.evidence.query_results).toEqual([result]); expect(parsed.evidence.sigma_rule).toBe('');
});

it('shows the verified exact hunt run from a saved-session link without running another hunt', async () => {
  get.mockResolvedValueOnce({ data: { ...session, result_data: { ...session.result_data, agent_run_id: 81 } } }); show();
  expect((await screen.findByRole('link', { name: 'Inspect recorded hunt run #81' })).getAttribute('href')).toBe('/app/audit-log?run=81'); expect(apiClient.post).not.toHaveBeenCalled();
});

it('routes an exact prepared record to its saved compiler review without inventing an executed result', async () => {
  get.mockResolvedValueOnce({ data: { ...session, status: 'prepared', queries_run: 0, findings_count: 0, result_data: { status: 'prepared' } } }); show();
  const link = await screen.findByRole('link', { name: 'Review this exact saved query draft' }); expect(link.getAttribute('href')).toBe('/app/hunt?query_draft=99');
  expect(screen.queryByText(/Detailed execution outcome was not recorded/)).toBeNull(); expect(screen.queryByText(/No query evidence was retained/)).toBeNull(); expect(apiClient.post).not.toHaveBeenCalled();
});
it('rejects malformed new reviewed-draft provenance without a false source link or result label', () => {
  expect(() => savedHuntEvidence({ ...session, result_data: { reviewed_draft: { session_id: 7, query_numbers: 'not an array' } } }, 99)).toThrow();
});

it('opens a saved execution audit only on demand and drops its old source match when saved evidence refreshes', async () => {
  const { source, result } = reviewedAuditFixture();
  const saved = { id: 81, hypothesis: source.hypothesis, status: 'completed', queries_run: 1, findings_count: 1, created_at: '2026-11-22T03:15:00Z', sigma_rule: null, result_data: result };
  get.mockImplementation(async url => ({ data: url === '/hunt/81' ? saved : source }));
  show('?session=81'); await screen.findByRole('button', { name: 'Audit exact reviewed draft' });
  expect(get).toHaveBeenCalledExactlyOnceWith('/hunt/81');
  fireEvent.click(screen.getByRole('button', { name: 'Audit exact reviewed draft' }));
  await screen.findByRole('heading', { name: 'Original draft query 2' }); expect(get).toHaveBeenLastCalledWith('/hunt/query-drafts/7');
  fireEvent.click(screen.getByRole('button', { name: 'Refresh saved hunt evidence' }));
  await screen.findByRole('button', { name: 'Audit exact reviewed draft' });
  expect(screen.queryByRole('heading', { name: 'Original draft query 2' })).toBeNull();
  expect(get.mock.calls.filter(([url]) => url === '/hunt/query-drafts/7')).toHaveLength(1); expect(apiClient.post).not.toHaveBeenCalled();
});

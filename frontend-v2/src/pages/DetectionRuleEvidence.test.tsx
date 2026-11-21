import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { HuntLabRoute } from './HuntLab';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
const get = vi.mocked(apiClient.get), writeText = vi.fn();
const rule = { id: 99, name: 'Exact saved rule', description: null, rule_type: 'sigma', rule_content: 'title: Example\nselection: <script>not executed</script>', mitre_techniques: ['T1059'], enabled: false, tested: false, confidence: 'medium', created_by: 'human', created_at: '2026-11-21T08:00:00Z' };
function Navigate() { const navigate = useNavigate(), location = useLocation(); return <><button onClick={() => navigate('?rule=100&keep=1')}>Another exact rule</button><span data-testid="location">{location.search}</span></>; }
function show(query = '?rule=99') { return render(<MemoryRouter initialEntries={[`/hunt${query}`]}><HuntLabRoute /><Navigate /></MemoryRouter>); }
const detailCalls = () => get.mock.calls.filter(([url]) => /\/hunt\/detections\//.test(url));
beforeEach(() => {
  vi.resetAllMocks(); writeText.mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  get.mockImplementation(async url => ({ data: url.endsWith('/99') ? rule : url.endsWith('/100') ? { ...rule, id: 100, name: 'Other saved rule' } : url.endsWith('/detections') ? [] : { sessions: [], total: 0 } }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('opens an exact owned off-list rule by ID without relying on the library or executing anything', async () => {
  show(); await screen.findByText('Exact saved rule'); expect(detailCalls()).toHaveLength(1); expect(screen.getByText((_text, element) => element?.tagName === 'PRE' && element.textContent === rule.rule_content)).toBeTruthy(); expect(document.querySelector('script')).toBeNull();
  expect(screen.getByText('Disabled')).toBeTruthy(); expect(screen.getByText('Not tested')).toBeTruthy(); expect(screen.getByText(/not proof of deployment/)).toBeTruthy();
  expect(apiClient.post).not.toHaveBeenCalled(); expect(apiClient.patch).not.toHaveBeenCalled(); expect(apiClient.delete).not.toHaveBeenCalled();
});
it.each(['?rule=0', '?rule=-1', '?rule=1.5', '?rule=', '?rule=99&rule=100', '?rule=9007199254740992', '?rule=abc'])('rejects an invalid or ambiguous handoff without fetching a fallback record %s', async query => {
  show(query); expect(screen.getByRole('alert').textContent).toContain('exactly one positive'); await waitFor(() => expect(get).toHaveBeenCalled()); expect(detailCalls()).toHaveLength(0);
});
it('copies only the loaded exact ID, not drafts or unrelated route parameters', async () => {
  show('?rule=99&private=omit#secret'); await screen.findByText('Exact saved rule'); fireEvent.change(screen.getByLabelText('Hunting Hypothesis'), { target: { value: 'Private draft' } }); fireEvent.click(screen.getByText('Copy exact saved rule link')); await screen.findByText('Saved rule link copied.'); expect(writeText).toHaveBeenCalledWith(`${location.origin}/app/hunt?rule=99`);
});
it('close preserves unrelated parameters and removes current evidence', async () => {
  show('?rule=99&keep=1'); await screen.findByText('Exact saved rule'); fireEvent.click(screen.getByText('Close saved rule')); expect(screen.getByTestId('location').textContent).toBe('?keep=1'); expect(screen.queryByText('Exact saved rule')).toBeNull();
});
it('replaces same-page selection and ignores old late reads', async () => {
  let finish!: (value: unknown) => void; get.mockImplementation(async url => url.endsWith('/99') ? new Promise(resolve => { finish = resolve; }) : { data: url.endsWith('/100') ? { ...rule, id: 100, name: 'Other saved rule' } : url.endsWith('/detections') ? [] : { sessions: [], total: 0 } }); show(); fireEvent.click(screen.getByText('Another exact rule')); await screen.findByText('Other saved rule'); await act(async () => finish({ data: rule })); expect(screen.queryByText('Exact saved rule')).toBeNull();
});
it('does not show a stale copy confirmation after navigation', async () => {
  let finish!: () => void; writeText.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; })); show(); await screen.findByText('Exact saved rule'); fireEvent.click(screen.getByText('Copy exact saved rule link')); fireEvent.click(screen.getByText('Another exact rule')); await screen.findByText('Other saved rule'); await act(async () => finish()); expect(screen.queryByText('Saved rule link copied.')).toBeNull();
});
it.each([{ id: 100 }, { rule_content: null }, { tested: null }, { mitre_techniques: {} }])('rejects malformed or mismatched exact evidence %j', async change => {
  get.mockImplementation(async url => ({ data: url.endsWith('/99') ? { ...rule, ...change } : url.endsWith('/detections') ? [] : { sessions: [], total: 0 } })); show(); await screen.findByRole('alert'); expect(screen.queryByText('Copy exact saved rule link')).toBeNull();
});
it('separates unavailable reads, retries and copy failure without inventing absent rules', async () => {
  get.mockImplementation(async url => { if (url.endsWith('/99')) throw Error('Unavailable'); return { data: url.endsWith('/detections') ? [] : { sessions: [], total: 0 } }; }); show(); await screen.findByRole('alert');
  get.mockResolvedValueOnce({ data: rule }); fireEvent.click(screen.getByText('Retry saved rule')); await screen.findByText('Exact saved rule'); writeText.mockRejectedValueOnce(Error('Denied')); fireEvent.click(screen.getByText('Copy exact saved rule link')); await screen.findByText(/The rule link could not be copied/); expect(screen.getByText((_text, element) => element?.tagName === 'PRE' && element.textContent === rule.rule_content)).toBeTruthy();
});
it('exports the exact full saved record and read-time context as JSON', async () => {
  let saved!: Blob; vi.stubGlobal('URL', class extends URL { static createObjectURL(blob: Blob) { saved = blob; return 'blob:rule'; } static revokeObjectURL() {} }); vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  show(); await screen.findByText('Exact saved rule'); fireEvent.click(screen.getByText('Download saved rule evidence JSON')); expect(saved.type).toBe('application/json'); expect(saved.size).toBeGreaterThan(300);
});

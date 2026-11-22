import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { TriageCandidateMembers } from './TriageCandidateMembers';
import { TriageCorrelationPreview } from './TriageCorrelationPreview';
import { saveHuntDownload } from '../utils/huntEvidence';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../utils/huntEvidence', () => ({ saveHuntDownload: vi.fn() }));
const get = vi.mocked(apiClient.get), save = vi.mocked(saveHuntDownload);
const group = { position: 1, membership_fingerprint: 'a'.repeat(64), basis: 'shared_ip_component', alert_count: 0, event_count: 53, alert_ai_input_count: 0, event_ai_input_count: 50 };
const data = (page = 1) => ({ ...group, hours_back: 72, cutoff: '2026-11-19T00:00:00Z', retrieved_at: '2026-11-22T00:00:00Z', page, size: 10, total: 53, scope: 'Current membership, not a reservation', records: Array.from({ length: page < 6 ? 10 : 3 }, (_, i) => { const position = (page - 1) * 10 + i + 1; return { kind: 'event', id: position, intake_position: position, label: '<script>saved label</script>', severity: 'high', recorded_at: null, included_in_ai_context: position <= 50 }; }) });
const preview = () => ({ hours_back: 72, cutoff: '2026-11-19T00:00:00Z', retrieved_at: '2026-11-22T00:00:00Z', page: 1, size: 10, groups_total: 1, alerts_selected: 0, events_selected: 53, events_excluded_info_only: 0, records: [{ ...group, alert_sample: [], event_sample: data().records.slice(0, 5) }] });
const show = () => render(<TriageCandidateMembers selection={group} hours={72} previewReadAt="2026-11-21T23:59:00Z" onClose={vi.fn()} />);
beforeEach(() => { vi.resetAllMocks(); get.mockImplementation(async (_url, options) => ({ data: data((options?.params as { page: number }).page) })); });
afterEach(cleanup);
it('reads the full selected group with guarded membership, exact links and current input cap flags', async () => {
  show(); await screen.findByText('53 selected candidate records · Page 1 of 6'); expect(get).toHaveBeenCalledWith('/cases/triage-correlation/1/members', { params: { hours_back: 72, membership: 'a'.repeat(64), page: 1, size: 10 } }); expect(screen.getByRole('link', { name: 'event #1: <script>saved label</script>' })).toHaveAttribute('href', '/app/events/1'); expect(document.querySelector('script')).toBeNull(); expect(apiClient.post).not.toHaveBeenCalled();
});
it('pages in intact selection order and exports only the loaded page without another read', async () => {
  show(); for (let page = 1; page < 6; page++) { await screen.findByText(`53 selected candidate records · Page ${page} of 6`); fireEvent.click(screen.getByRole('button', { name: 'More candidate records' })); } await screen.findByText('53 selected candidate records · Page 6 of 6'); expect(screen.getAllByText('Outside current AI summary-input cap. Still a candidate member, not reviewed by AI.')).toHaveLength(3); fireEvent.click(screen.getByRole('button', { name: 'Download loaded candidate page JSON' })); const output = JSON.parse(save.mock.calls[0][0]); expect(output.records).toHaveLength(3); expect(output.records[0].id).toBe(51); expect(output.membership_fingerprint).toBe(group.membership_fingerprint); expect(output.page).toBe(6); expect(get).toHaveBeenCalledTimes(6);
});
it.each(['position', 'membership_fingerprint', 'hours_back', 'total', 'event_count', 'event_ai_input_count', 'page', 'size', 'cutoff', 'retrieved_at', 'records'])('rejects returned mismatched scope or incomplete page %s', async key => {
  get.mockResolvedValueOnce({ data: { ...data(), [key]: key === 'records' ? [] : 'wrong' } }); show(); expect(await screen.findByRole('alert')).toHaveTextContent('did not match'); expect(screen.queryByRole('link')).toBeNull(); expect(screen.queryByRole('button', { name: 'Download loaded candidate page JSON' })).toBeNull();
});
it.each(['kind', 'intake_position', 'included_in_ai_context', 'id', 'recorded_at'])('rejects misleading row membership or cap metadata %s', async key => {
  const value = data(); (value.records[0] as Record<string, unknown>)[key] = key === 'included_in_ai_context' ? false : 'wrong'; get.mockResolvedValueOnce({ data: value }); show(); expect(await screen.findByRole('alert')).toHaveTextContent('did not match');
});
it('marks changed membership stale and never silently opens or retries a replacement group', async () => {
  get.mockRejectedValueOnce({ response: { status: 409, data: { detail: 'Candidate changed. Refresh the correlation preview.' } } }); show(); expect(await screen.findByRole('alert')).toHaveTextContent('no replacement group was opened'); expect(screen.getByRole('button', { name: 'Refresh same candidate records' })).toBeDisabled(); expect(screen.queryByRole('link')).toBeNull(); expect(apiClient.post).not.toHaveBeenCalled();
});
it('keeps transient read failure distinct from empty membership and permits explicit same-candidate retry', async () => {
  get.mockRejectedValueOnce(Error('offline')); show(); expect(await screen.findByRole('alert')).toHaveTextContent('No triage or AI action'); fireEvent.click(screen.getByRole('button', { name: 'Refresh same candidate records' })); await screen.findByText('53 selected candidate records · Page 1 of 6');
});
it('ignores late member reads after unmount', async () => {
  let finish!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); const view = show(); view.unmount(); await act(async () => finish({ data: data() })); expect(screen.queryByRole('link')).toBeNull();
});
it('opens members only after a separate group click and clears them on parent refresh', async () => {
  get.mockImplementation(async url => ({ data: String(url).endsWith('/members') ? data() : preview() })); render(<TriageCorrelationPreview />); fireEvent.click(screen.getByRole('button', { name: 'Preview triage correlation groups' })); await screen.findByText('1 candidate groups · 0 selected alerts · 53 selected events'); expect(get).toHaveBeenCalledTimes(1); fireEvent.click(screen.getByRole('button', { name: 'Read all selected records in candidate 1' })); await screen.findByText('53 selected candidate records · Page 1 of 6'); fireEvent.click(screen.getByRole('button', { name: 'Refresh correlation preview' })); await screen.findByText('1 candidate groups · 0 selected alerts · 53 selected events'); expect(screen.queryByRole('region', { name: 'Selected triage candidate members' })).toBeNull(); expect(apiClient.post).not.toHaveBeenCalled();
});
it('keeps download failure local without discarding the reviewed page', async () => {
  show(); await screen.findByText('53 selected candidate records · Page 1 of 6'); save.mockImplementationOnce(() => { throw Error('download unavailable'); }); fireEvent.click(screen.getByRole('button', { name: 'Download loaded candidate page JSON' })); expect(await screen.findByRole('alert')).toHaveTextContent('could not be downloaded'); expect(screen.getByRole('link', { name: 'event #1: <script>saved label</script>' })).toBeInTheDocument();
});

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { saveHuntDownload } from '../utils/huntEvidence';
import { EventLinkedInvestigations } from './EventLinkedInvestigations';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
vi.mock('../utils/huntEvidence', () => ({ saveHuntDownload: vi.fn() }));
const get = vi.mocked(apiClient.get), save = vi.mocked(saveHuntDownload);
const data = (page = 1, status = 'all') => ({ event_id: 99, status, page, size: 10, total: 11, available_count: 11, records: Array.from({ length: page === 1 ? 10 : 1 }, (_, index) => ({ id: 100 - (page - 1) * 10 - index, title: '<script>Stored case title</script>', status: status === 'all' ? 'closed' : status, severity: 'high', created_at: '2026-11-01T12:00:00Z', due_date: null, closed_at: null })), retrieved_at: '2026-11-22T00:00:00Z', scope: 'Only current owned investigation links' });
async function read() { fireEvent.click(screen.getByRole('button', { name: 'Read linked investigations' })); await screen.findByText(/11 matching owned investigations/); }
beforeEach(() => { get.mockReset(); save.mockReset(); get.mockImplementation(async (_url, options) => { const p = options?.params as { page: number; status: string }; return { data: data(p.page, p.status) }; }); });
afterEach(cleanup);
it('only reads on explicit submission, preserving exact status and event ID', async () => {
  render(<EventLinkedInvestigations eventId={99} />); expect(get).not.toHaveBeenCalled(); fireEvent.change(screen.getByLabelText('Linked investigation status'), { target: { value: 'closed' } }); expect(get).not.toHaveBeenCalled(); await read(); expect(get).toHaveBeenLastCalledWith('/events/99/linked-investigations', { params: { status: 'closed', page: 1, size: 10 } }); expect(document.querySelector('script')).toBeNull();
});
it('pages to historical investigations and links exact case plus event evidence', async () => {
  render(<EventLinkedInvestigations eventId={99} />); await read(); fireEvent.click(screen.getByRole('button', { name: 'More linked investigations' })); await screen.findByText('Page 2 of 2'); expect(screen.getByRole('link', { name: 'Open investigation #90' })).toHaveAttribute('href', '/app/cases/90'); expect(screen.getByRole('link', { name: 'Review linked events for investigation #90' })).toHaveAttribute('href', '/app/cases/90/evidence?kind=event');
});
it('keeps status drafts separate and blocks paging, refresh and export', async () => {
  render(<EventLinkedInvestigations eventId={99} />); await read(); fireEvent.change(screen.getByLabelText('Linked investigation status'), { target: { value: 'open' } }); expect(screen.getByText(/Status draft is not applied/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'More linked investigations' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Refresh applied investigation links' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Download this linked investigation page JSON' })).toBeDisabled(); expect(get).toHaveBeenCalledTimes(1);
});
it('downloads only the currently loaded page without an additional read', async () => {
  render(<EventLinkedInvestigations eventId={99} />); await read(); fireEvent.click(screen.getByRole('button', { name: 'More linked investigations' })); await screen.findByText('Page 2 of 2'); fireEvent.click(screen.getByRole('button', { name: 'Download this linked investigation page JSON' })); const output = JSON.parse(save.mock.calls[0][0]); expect(output.records).toHaveLength(1); expect(output.records[0].id).toBe(90); expect(output.total).toBe(11); expect(output.page).toBe(2); expect(output.download_scope).toContain('not all matching cases'); expect(get).toHaveBeenCalledTimes(2);
});
it.each(['event_id', 'status', 'total', 'available_count', 'records', 'retrieved_at'])('refuses malformed, incomplete or broader scope %s', async key => {
  get.mockResolvedValueOnce({ data: { ...data(), [key]: key === 'records' ? [] : 'invalid' } }); render(<EventLinkedInvestigations eventId={99} />); fireEvent.click(screen.getByRole('button', { name: 'Read linked investigations' })); expect(await screen.findByRole('alert')).toHaveTextContent(/did not match|incomplete page/); expect(screen.queryByText(/11 matching owned investigations/)).not.toBeInTheDocument();
});
it('refuses a status-filtered row that does not match its requested status', async () => {
  get.mockResolvedValueOnce({ data: { ...data(1, 'open'), records: data().records } }); render(<EventLinkedInvestigations eventId={99} />); fireEvent.change(screen.getByLabelText('Linked investigation status'), { target: { value: 'open' } }); fireEvent.click(screen.getByRole('button', { name: 'Read linked investigations' })); expect(await screen.findByRole('alert')).toHaveTextContent('did not match');
});
it('handles an empty owned result without claiming the event was never investigated', async () => {
  get.mockResolvedValueOnce({ data: { ...data(), total: 0, available_count: 0, records: [] } }); render(<EventLinkedInvestigations eventId={99} />); fireEvent.click(screen.getByRole('button', { name: 'Read linked investigations' })); expect(await screen.findByText(/does not establish that this event has never been investigated/)).toBeInTheDocument();
});
it('ignores late reads after clear', async () => {
  let resolve!: (value: unknown) => void; get.mockImplementationOnce(() => new Promise(r => { resolve = r; })); render(<EventLinkedInvestigations eventId={99} />); fireEvent.click(screen.getByRole('button', { name: 'Read linked investigations' })); fireEvent.click(screen.getByRole('button', { name: 'Clear linked investigations' })); await act(async () => resolve({ data: data() })); expect(screen.queryByText(/matching owned investigations/)).not.toBeInTheDocument();
});
it('retries a read error without treating it as an empty result', async () => {
  get.mockRejectedValueOnce(Error('Unavailable')); render(<EventLinkedInvestigations eventId={99} />); fireEvent.click(screen.getByRole('button', { name: 'Read linked investigations' })); expect(await screen.findByRole('alert')).toHaveTextContent('No absence'); await read();
});
it('clamps a last page that disappeared to the current last page', async () => {
  render(<EventLinkedInvestigations eventId={99} />); await read(); get.mockResolvedValueOnce({ data: { ...data(2), total: 1, available_count: 1, records: [] } }).mockResolvedValueOnce({ data: { ...data(), total: 1, available_count: 1, records: data().records.slice(0, 1) } }); fireEvent.click(screen.getByRole('button', { name: 'More linked investigations' })); await screen.findByText(/1 matching owned investigations/); expect(get).toHaveBeenLastCalledWith('/events/99/linked-investigations', { params: { status: 'all', page: 1, size: 10 } });
});
it('keeps loaded investigations visible on a local download failure', async () => {
  render(<EventLinkedInvestigations eventId={99} />); await read(); save.mockImplementationOnce(() => { throw Error('failed'); }); fireEvent.click(screen.getByRole('button', { name: 'Download this linked investigation page JSON' })); expect(screen.getByRole('alert')).toHaveTextContent('could not be downloaded'); expect(screen.getByText(/11 matching owned investigations/)).toBeInTheDocument(); expect(get).toHaveBeenCalledTimes(1);
});

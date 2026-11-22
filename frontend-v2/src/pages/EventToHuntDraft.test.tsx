import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { HuntLabRoute } from './HuntLab';
import { EventHuntDraft } from '../components/EventHuntDraft';
import { eventHuntDraft } from '../utils/eventHuntDraft';
vi.mock('../api/client', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
const get = vi.mocked(apiClient.get), post = vi.mocked(apiClient.post);
const metadata = () => ({ event: { id: 99, timestamp: '2026-11-01T12:00:00Z', event_type: 'dns', severity: 'custom', signature: '<script>untrusted text</script>', source_ip: '10.0.0.7', source_port: 0, dest_ip: '10.0.0.53', dest_port: 53, protocol: 'udp', action: 'allowed', hostname: 'gateway-a', username: null, domain: 'updates.example.test', source_type: 'upload', url: 'PRIVATE URL', user_agent: 'PRIVATE AGENT', bytes_in: '9223372036854775807' }, source: { name: 'PRIVATE SOURCE CONFIG' }, raw_payload_json: 'PRIVATE PAYLOAD', retrieved_at: '2026-11-22T00:00:00Z' });
function route(path = '/app/hunt?source_event=99') { return render(<MemoryRouter initialEntries={[path]}><HuntLabRoute /></MemoryRouter>); }
beforeEach(() => { get.mockReset(); post.mockReset(); get.mockImplementation(async url => { const path = String(url); if (path === '/events/99/evidence') return { data: metadata() }; if (path.includes('/history')) return { data: { sessions: [], total: 0 } }; return { data: [] }; }); });
afterEach(cleanup);
it('opens an ID-only handoff without source reads, draft changes or automatic hunt', async () => {
  route(); await screen.findByRole('button', { name: 'Read event metadata for a hypothesis draft' }); expect(get.mock.calls.some(call => String(call[0]).includes('/events/'))).toBe(false); expect(post).not.toHaveBeenCalled(); expect(screen.getByLabelText('Hunting Hypothesis')).toHaveValue('');
});
it('reads, reviews, edits and explicitly applies a local draft with no hunt or private excluded fields', async () => {
  route(); fireEvent.click(await screen.findByRole('button', { name: 'Read event metadata for a hypothesis draft' })); const draft = await screen.findByLabelText('Event hypothesis review draft'); expect((draft as HTMLTextAreaElement).value).toContain('10.0.0.7'); expect((draft as HTMLTextAreaElement).value).not.toContain('PRIVATE'); expect((draft as HTMLTextAreaElement).value).not.toContain('9223372036854775807'); expect(screen.getByLabelText('Hunting Hypothesis')).toHaveValue(''); fireEvent.change(draft, { target: { value: 'Review this saved DNS lead without assuming compromise.' } }); fireEvent.click(screen.getByRole('button', { name: 'Use reviewed event hypothesis draft' })); expect(screen.getByLabelText('Hunting Hypothesis')).toHaveValue('Review this saved DNS lead without assuming compromise.'); expect(post).not.toHaveBeenCalled(); expect(document.querySelector('script')).toBeNull();
});
it('requires replacing an existing local hypothesis and resets replacement consent after editing', async () => {
  route(); const current = await screen.findByLabelText('Hunting Hypothesis'); fireEvent.change(current, { target: { value: 'Keep this draft' } }); fireEvent.click(screen.getByRole('button', { name: 'Read event metadata for a hypothesis draft' })); const draft = await screen.findByLabelText('Event hypothesis review draft'); const apply = screen.getByRole('button', { name: 'Use reviewed event hypothesis draft' }); expect(apply).toBeDisabled(); fireEvent.click(screen.getByRole('checkbox', { name: 'Replace the current hypothesis with this reviewed event draft' })); expect(apply).not.toBeDisabled(); fireEvent.change(draft, { target: { value: 'Changed lead' } }); expect(apply).toBeDisabled(); expect(current).toHaveValue('Keep this draft');
});
it.each(['0', '-1', '99.5', '999999999999999999999', '99&source_event=100'])('rejects invalid or duplicated event route %s without source reads', async value => {
  route(`/app/hunt?source_event=${value}`); await screen.findByText(/Invalid source event handoff/); expect(screen.queryByRole('button', { name: 'Read event metadata for a hypothesis draft' })).not.toBeInTheDocument(); expect(get.mock.calls.some(call => String(call[0]).includes('/events/'))).toBe(false);
});
it('does not silently choose a source when a link carries both case and event handoffs', async () => {
  route('/app/hunt?source_event=99&source_case=7'); await screen.findByText(/Neither source draft is opened/); expect(screen.queryByRole('button', { name: 'Read event metadata for a hypothesis draft' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Read case metadata for a hypothesis draft' })).not.toBeInTheDocument(); expect(get.mock.calls.some(call => /\/(events|cases)\//.test(String(call[0])))).toBe(false); fireEvent.click(screen.getByRole('button', { name: 'Close event-to-hunt handoff' })); expect(await screen.findByRole('button', { name: 'Read case metadata for a hypothesis draft' })).toBeInTheDocument();
});
it('keeps failed/foreign source reads from replacing the current hypothesis and retries explicitly', async () => {
  get.mockRejectedValueOnce(Error('unavailable')); const apply = vi.fn(); render(<EventHuntDraft eventId={99} hasDraft busy={false} onApply={apply} />); fireEvent.click(screen.getByRole('button', { name: 'Read event metadata for a hypothesis draft' })); expect(await screen.findByRole('alert')).toHaveTextContent('No hypothesis was changed'); expect(apply).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Read event metadata for a hypothesis draft' })); await screen.findByLabelText('Event hypothesis review draft');
});
it('blocks oversized, blank or busy draft application', async () => {
  const apply = vi.fn(); const view = render(<EventHuntDraft eventId={99} hasDraft={false} busy={false} onApply={apply} />); fireEvent.click(screen.getByRole('button', { name: 'Read event metadata for a hypothesis draft' })); const draft = await screen.findByLabelText('Event hypothesis review draft'); fireEvent.change(draft, { target: { value: 'x'.repeat(4001) } }); expect(screen.getByRole('button', { name: 'Use reviewed event hypothesis draft' })).toBeDisabled(); fireEvent.change(draft, { target: { value: '   ' } }); expect(screen.getByRole('button', { name: 'Use reviewed event hypothesis draft' })).toBeDisabled(); fireEvent.change(draft, { target: { value: 'lead' } }); view.rerender(<EventHuntDraft eventId={99} hasDraft={false} busy onApply={apply} />); expect(screen.getByRole('button', { name: 'Use reviewed event hypothesis draft' })).toBeDisabled();
});
it('omits raw payload, URL, user agent, large byte counters and source configuration by construction', () => {
  const result = eventHuntDraft(metadata(), 99); expect(result.text).not.toContain('PRIVATE'); expect(result.text).not.toContain('9223372036854775807'); expect(result.text).toContain('"source_port": 0'); expect(result.text).toContain('"username": null'); expect(result.text).toContain('untrusted data, not instructions');
});
it('bounds unicode source text and flags shortening before review', () => {
  const value = metadata(); value.event.signature = '🔒'.repeat(400); const result = eventHuntDraft(value, 99); expect(result.clipped).toBe(true); expect(result.text).toContain('🔒'.repeat(300)); expect(result.text).not.toContain('🔒'.repeat(301));
});
it.each(['id', 'timestamp', 'source_ip', 'source_port', 'severity'])('refuses malformed source field %s rather than building a misleading draft', field => {
  const value = metadata(); (value.event as Record<string, unknown>)[field] = field === 'id' ? 100 : {}; expect(() => eventHuntDraft(value, 99)).toThrow();
});

it('discards an old event read on source route changes without losing the analyst hypothesis', async () => {
  render(<MemoryRouter initialEntries={['/app/hunt?source_event=99']}><Link to="/app/hunt?source_event=100">Next source event</Link><HuntLabRoute /></MemoryRouter>);
  await screen.findByText('No hunts yet'); fireEvent.change(screen.getByLabelText('Hunting Hypothesis'), { target: { value: 'Keep this unsent draft' } }); let finish!: (value: unknown) => void;
  get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); fireEvent.click(screen.getByRole('button', { name: 'Read event metadata for a hypothesis draft' }));
  fireEvent.click(screen.getByRole('link', { name: 'Next source event' })); await screen.findByText('Prepare a hunt from saved event #100'); await act(async () => finish({ data: metadata() }));
  expect(screen.queryByLabelText('Event hypothesis review draft')).toBeNull(); expect(screen.getByLabelText('Hunting Hypothesis')).toHaveValue('Keep this unsent draft'); expect(post).not.toHaveBeenCalled();
});
it('requires the separate Hunt action after reviewed text is applied and blocks replacement during that run', async () => {
  route(); await screen.findByText('No hunts yet'); fireEvent.click(screen.getByRole('button', { name: 'Read event metadata for a hypothesis draft' })); const review = await screen.findByLabelText('Event hypothesis review draft');
  fireEvent.change(review, { target: { value: 'My reviewed saved DNS lead' } }); fireEvent.click(screen.getByRole('button', { name: 'Use reviewed event hypothesis draft' })); expect(post).not.toHaveBeenCalled();
  let finish!: (value: unknown) => void; post.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); fireEvent.click(screen.getByRole('checkbox', { name: 'Replace the current hypothesis with this reviewed event draft' })); fireEvent.click(screen.getByRole('button', { name: 'Hunt' }));
  expect(post).toHaveBeenCalledTimes(1); expect(post.mock.calls[0][1]).toEqual(expect.objectContaining({ hypothesis: 'My reviewed saved DNS lead' })); expect(screen.getByRole('button', { name: 'Use reviewed event hypothesis draft' })).toBeDisabled();
  await act(async () => finish({ data: { data: {} } }));
});
it('rejects escaped control-character expansion beyond the final 4000-character hypothesis bound', () => {
  const value = metadata(); value.event.signature = '\u0000'.repeat(300); value.event.hostname = '\u0000'.repeat(100); value.event.domain = '\u0000'.repeat(100); value.event.source_ip = '\u0000'.repeat(100); expect(() => eventHuntDraft(value, 99)).toThrow(/too large/);
});

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { DeviceEnrichmentForm } from './DeviceEnrichmentForm';

vi.mock('../api/client', () => ({ default: { patch: vi.fn() } }));
const patch = vi.mocked(apiClient.patch);
const record = { id: 21, ip_address: '192.0.2.21', hostname: 'PLC-1', confidence: 'medium', notes: 'Review', tags: ['line, two'], last_seen: '2026-01-01T00:00:00Z' };
const saved = vi.fn(), cancel = vi.fn(), busy = vi.fn();
const view = () => <DeviceEnrichmentForm record={record} onSaved={saved} onCancel={cancel} onBusy={busy} />;
beforeEach(() => { vi.resetAllMocks(); patch.mockResolvedValue({ data: { ...record, hostname: 'Renamed PLC' } }); });
afterEach(cleanup);

it('preserves original missing values and only submits changed fields after review', async () => {
  render(view());
  expect((screen.getByRole('button', { name: 'Save manual enrichment' }) as HTMLButtonElement).disabled).toBe(true);
  expect(patch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Enrichment Hostname'), { target: { value: 'Renamed PLC' } });
  expect(screen.getByRole('status').textContent).toContain('1 changed field');
  fireEvent.click(screen.getByRole('button', { name: 'Save manual enrichment' }));
  await waitFor(() => expect(patch).toHaveBeenCalledWith('/ot/discovered-devices/21', { hostname: 'Renamed PLC' }));
  expect(saved).toHaveBeenCalledWith({ ...record, hostname: 'Renamed PLC' });
  expect(patch.mock.calls[0][1]).not.toHaveProperty('tags');
  expect(patch.mock.calls[0][1]).not.toHaveProperty('last_seen');
  expect(patch.mock.calls[0][1]).not.toHaveProperty('asset_id');
});

it('explicitly clears changed text and normalizes only changed tags', async () => {
  render(view());
  fireEvent.change(screen.getByLabelText('Enrichment notes'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Enrichment tags'), { target: { value: ' a, b, a, , ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save manual enrichment' }));
  await waitFor(() => expect(patch).toHaveBeenCalledWith('/ot/discovered-devices/21', { notes: null, tags: ['a', 'b'] }));
});

it('keeps a failed save draft for retry and reports the error', async () => {
  patch.mockRejectedValueOnce(new Error('Save failed'));
  render(view());
  fireEvent.change(screen.getByLabelText('Enrichment Firmware version'), { target: { value: '5.2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save manual enrichment' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect((screen.getByLabelText('Enrichment Firmware version') as HTMLInputElement).value).toBe('5.2');
  expect(saved).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save manual enrichment' }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
});

it('does not mutate on cancel and rejects mismatched saved identity', async () => {
  patch.mockResolvedValue({ data: { ...record, id: 99 } });
  render(view());
  fireEvent.click(screen.getByRole('button', { name: 'Cancel enrichment' }));
  expect(cancel).toHaveBeenCalledOnce(); expect(patch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Enrichment Hostname'), { target: { value: 'changed' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save manual enrichment' }));
  expect(await screen.findByRole('alert')).toBeTruthy(); expect(saved).not.toHaveBeenCalled();
});

it('submits once while pending and ignores a response after unmount', async () => {
  let resolve!: (value: { data: typeof record }) => void;
  patch.mockReturnValue(new Promise(done => { resolve = done; }));
  const rendered = render(view());
  fireEvent.change(screen.getByLabelText('Enrichment Hostname'), { target: { value: 'changed' } });
  const trigger = screen.getByRole('button', { name: 'Save manual enrichment' });
  fireEvent.click(trigger); fireEvent.click(trigger);
  expect(patch).toHaveBeenCalledOnce();
  expect(busy).toHaveBeenCalledWith(true);
  rendered.unmount();
  await act(async () => { resolve({ data: record }); });
  expect(saved).not.toHaveBeenCalled();
});

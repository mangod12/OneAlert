import apiClient from '../api/client';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventImportReceipt } from './EventImportReceipt';
import { importResponseMetadata, type ImportReceipt } from '../utils/eventImportReceipt';

vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const receipt: ImportReceipt = { filename: 'sensor.ndjson', parser: 'suricata', received_at: '2026-11-20T17:30:00Z', result: { received: 4, ingested: 1, skipped: 3, redacted: 2, source_id: 7, skip_reasons: { invalid_fields: 2, invalid_timestamp: 1 } } };
afterEach(() => { vi.mocked(apiClient.get).mockReset(); cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('Event import receipt', () => {
  it('copies only bounded receipt counters, never raw fields or arbitrary reason labels', () => {
    expect(importResponseMetadata({ received: 2, ingested: 1, raw_data: { secret: 'do not include' }, skipped: -1, redacted: NaN, source_id: Infinity, skip_reasons: { invalid_fields: 1, arbitrary_secret_label: 7, invalid_timestamp: '2' } })).toEqual({ received: 2, ingested: 1, skip_reasons: { invalid_fields: 1 } });
    expect(importResponseMetadata(null)).toEqual({});
  });
  it('shows recorded outcomes with source, parser, time and bounded reason labels', () => {
    render(<EventImportReceipt receipt={receipt} onDismiss={vi.fn()} />);
    expect(screen.getByText('Import finished with skipped records.')).toBeTruthy();
    expect(screen.getByText('Invalid normalized field types or values: 2')).toBeTruthy();
    expect(screen.getByText(/Source ID: 7/)).toBeTruthy();
    expect(screen.getByText(/not the events' observation time/)).toBeTruthy();
    expect(screen.getByText(/Re-uploading the same file can create duplicate events/)).toBeTruthy();
  });
  it('does not imply success for an all-skipped import or fabricate missing legacy metadata', () => {
    render(<EventImportReceipt receipt={{ ...receipt, result: { ingested: 0, skipped: 4 } }} onDismiss={vi.fn()} />);
    expect(screen.getByText('No events were imported.')).toBeTruthy();
    expect(screen.getByText('Skip reasons were not recorded in this response.')).toBeTruthy();
    expect(screen.getAllByText('Not recorded').length).toBe(2);
  });
  it('downloads response metadata without raw input or extra network requests', async () => {
    let saved: Blob | undefined;
    const create = vi.fn((blob: Blob) => { saved = blob; return 'blob:receipt'; });
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    render(<EventImportReceipt receipt={receipt} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download import receipt JSON' }));
    expect(click).toHaveBeenCalledOnce(); expect(create).toHaveBeenCalledOnce();
    const text = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.readAsText(saved!); });
    const body = JSON.parse(text);
    expect(body.format).toBe('onealert_event_import_receipt_v1');
    expect(body.result).toEqual(receipt.result);
    expect(body.filename).toBe('sensor.ndjson');
    expect(text).not.toContain('raw_data'); expect(fetcher).not.toHaveBeenCalled();
  });
  it('keeps the response visible when download fails and supports dismissal', () => {
    vi.stubGlobal('URL', { createObjectURL: () => { throw new Error('failed'); } });
    const dismiss = vi.fn(); render(<EventImportReceipt receipt={receipt} onDismiss={dismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download import receipt JSON' }));
    expect(screen.getByRole('alert').textContent).toContain('could not be downloaded');
    expect(screen.getByText('Import finished with skipped records.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss import response' })); expect(dismiss).toHaveBeenCalledOnce();
  });
});

it('keeps the original receipt export separate from explicitly loaded current source evidence', async () => {
  const stamp = '2026-01-01T00:00:00Z'; vi.mocked(apiClient.get).mockResolvedValue({ data: { source: { id: 7, name: 'private-profile-name', source_type: 'suricata', status: null, event_count: 33, last_event_at: null, created_at: stamp }, retained_event_count: 0, first_observed_at: null, last_observed_at: null, first_created_at: null, last_created_at: null, nonempty_field_counts: { source_ip: 0, dest_ip: 0, hostname: 0, username: 0, domain: 0 }, groups: { severity: [], event_type: [], source_type: [], processed: [] }, retrieved_at: stamp, scope: 'Current source, not the upload batch', raw_data: 'PRIVATE_EXTRA' } });
  let saved: Blob | undefined; vi.stubGlobal('URL', { createObjectURL: vi.fn((blob: Blob) => { saved = blob; return 'blob:receipt'; }), revokeObjectURL: vi.fn() }); vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<EventImportReceipt receipt={receipt} onDismiss={vi.fn()} />); expect(vi.mocked(apiClient.get)).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Show source investigation tools' })); expect(vi.mocked(apiClient.get)).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Read recorded source profile' })); await screen.findByText('Retained owned events: 0');
  fireEvent.click(screen.getByRole('button', { name: 'Download import receipt JSON' })); const text = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as string); reader.readAsText(saved!); }); expect(JSON.parse(text).result).toEqual(receipt.result); expect(text).not.toContain('private-profile-name'); expect(text).not.toContain('PRIVATE_EXTRA'); expect(text).not.toContain('retained_event_count'); expect(vi.mocked(apiClient.get)).toHaveBeenCalledTimes(1);
});

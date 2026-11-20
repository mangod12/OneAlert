import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventImportReceipt } from './EventImportReceipt';
import { importResponseMetadata, type ImportReceipt } from '../utils/eventImportReceipt';

const receipt: ImportReceipt = { filename: 'sensor.ndjson', parser: 'suricata', received_at: '2026-11-20T17:30:00Z', result: { received: 4, ingested: 1, skipped: 3, redacted: 2, source_id: 7, skip_reasons: { invalid_fields: 2, invalid_timestamp: 1 } } };
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
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

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ChecklistSnapshotExport } from './ChecklistSnapshotExport';
import { checklistExportSnapshot } from '../utils/checklistSnapshotExport';
import { defaultChecklistFilters } from '../utils/checklistTriage';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const snapshot = checklistExportSnapshot(12, [{ id: 7, title: '<b>Untrusted title</b>', done: false, position: 0, due_date: null, assignee_id: 99 }], 23, { ...defaultChecklistFilters, assignee: '99' }, '2026-11-24', 'now');
it('reviews exact scope and literal task identity without automatically downloading or rendering markup', () => {
  const onClose = vi.fn(); render(<ChecklistSnapshotExport snapshot={snapshot} onClose={onClose} />);
  expect(screen.getByRole('dialog').textContent).toContain('1 matching tasks of 23 loaded tasks');
  expect(screen.getByRole('list').textContent).toContain('#7: <b>Untrusted title</b>');
  expect(screen.getByRole('dialog').querySelector('b')).toBeNull();
  expect(screen.getByText(/not freshly fetched/)).toBeTruthy();
  fireEvent.click(screen.getByText('Cancel checklist export')); expect(onClose).toHaveBeenCalledOnce();
});
it('downloads only after review using the exact case filename and frees the object URL', () => {
  const create = vi.fn(() => 'blob:reviewed'), revoke = vi.fn(); Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke }); const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(this: HTMLAnchorElement) { expect(this.download).toBe('investigation-12-checklist-snapshot.csv'); });
  render(<ChecklistSnapshotExport snapshot={snapshot} onClose={() => {}} />); expect(create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Download reviewed checklist CSV (1 tasks)')); expect(create).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledWith('blob:reviewed');
});

it('downloads JSON only on explicit choice with case-specific name, JSON MIME and cleanup', () => {
 const create = vi.fn(() => 'blob:json'), revoke = vi.fn(); Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke }); const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(this: HTMLAnchorElement) { expect(this.download).toBe('investigation-12-checklist-snapshot.json'); });
 render(<ChecklistSnapshotExport snapshot={snapshot} onClose={() => {}} />); expect(create).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText('Download reviewed checklist JSON (1 tasks)')); expect(create).toHaveBeenCalledOnce(); expect((create.mock.calls[0] as unknown as Blob[])[0].type).toBe('application/json;charset=utf-8'); expect(click).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledWith('blob:json');
});
it('inspection search never changes the reviewed JSON or CSV download counts', () => {
 const create = vi.fn(() => 'blob:search'), revoke = vi.fn(); Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke }); vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
 render(<ChecklistSnapshotExport snapshot={snapshot} onClose={() => {}} />); fireEvent.change(screen.getByLabelText('Find within captured checklist tasks'), { target: { value: 'no matches' } });
 expect(screen.getByText(/0 inspection matches; 1 tasks remain/)).toBeTruthy();
 expect(screen.getByRole('button', { name: 'Download reviewed checklist CSV (1 tasks)' })).toHaveProperty('disabled', false); fireEvent.click(screen.getByRole('button', { name: 'Download reviewed checklist JSON (1 tasks)' })); expect(create).toHaveBeenCalledOnce();
});

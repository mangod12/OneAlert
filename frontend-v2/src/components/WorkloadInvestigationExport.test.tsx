import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkloadInvestigationExport } from './WorkloadInvestigationExport';
import { investigationExportSnapshot } from '../utils/workloadInvestigationExport';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const filters = { query: '<b>sensitive</b>', severity: 'all', due: 'all', today: '2026-11-24', completion: 'all', investigations: 'active', dueFrom: '', dueThrough: '', sort: 'task_due' };
const snapshot = investigationExportSnapshot(Array.from({ length: 50 }, (_, i) => ({ case_id: i + 1, total: 1, open: 1, completed: 0, without_due_date: 0 })), 51, 50, 51, filters, 'loaded', 'captured')!;
it('shows exact capped scope and literal applied filters with no automatic download', () => {
  const close = vi.fn(); render(<WorkloadInvestigationExport snapshot={snapshot} onClose={close} />); const dialog = screen.getByRole('dialog');
  expect(dialog.textContent).toContain('50 loaded groups of 51'); expect(dialog.textContent).toContain('1 matching investigations are not included'); expect(dialog.textContent).toContain('not the whole matching workload'); expect(dialog.querySelector('b')).toBeNull(); expect(dialog.textContent).toContain('<b>sensitive</b>'); expect(dialog.textContent).toContain('task order task_due');
  fireEvent.click(screen.getByText('Cancel investigation summary export')); expect(close).toHaveBeenCalledOnce();
});
it('downloads the frozen groups only on explicit confirmation and releases the object URL', () => {
  const create = vi.fn(() => 'blob:groups'), revoke = vi.fn(); Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke }); const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(this: HTMLAnchorElement) { expect(this.download).toBe('assigned-workload-investigation-summary.csv'); });
  render(<WorkloadInvestigationExport snapshot={snapshot} onClose={() => {}} />); expect(create).not.toHaveBeenCalled(); fireEvent.click(screen.getByText('Download reviewed investigation summary CSV (50 groups)')); expect(create).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledWith('blob:groups');
});

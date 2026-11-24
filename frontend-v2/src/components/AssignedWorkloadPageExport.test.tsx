import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AssignedWorkloadPageExport } from './AssignedWorkloadPageExport';
import { workloadPageSnapshot } from '../utils/assignedWorkloadExport';
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const snapshot = workloadPageSnapshot([{ task_id: 209, case_id: 7, title: '<b>Untrusted title</b>', case_title: 'Gateway', case_severity: 'high', case_status: 'open', done: true, completed_at: null, due_date: '2026-11-20', case_due_date: null }], { query: 'applied', severity: 'all', due: 'range', today: '2026-11-24', completion: 'all', investigations: 'active', dueFrom: '2026-11-20', dueThrough: '2026-11-24' }, 2, 30, 'loaded', 'captured');
it('reviews literal records with page-only scope, dates and no implicit download', () => {
  const close = vi.fn(); render(<AssignedWorkloadPageExport snapshot={snapshot} onClose={close} />);
  const dialog = screen.getByRole('dialog'); expect(dialog.textContent).toContain('Only page 2: 1 loaded task records of 30'); expect(dialog.textContent).toContain('Other pages are not included'); expect(dialog.textContent).toContain('2026-11-20 through 2026-11-24, inclusive'); expect(dialog.textContent).toContain('<b>Untrusted title</b>'); expect(dialog.querySelector('b')).toBeNull();
  fireEvent.click(screen.getByText('Cancel workload page export')); expect(close).toHaveBeenCalledOnce();
});
it('downloads only the reviewed page on confirmation and releases its object URL', () => {
  const create = vi.fn(() => 'blob:reviewed'), revoke = vi.fn(); Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke }); const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function(this: HTMLAnchorElement) { expect(this.download).toBe('assigned-workload-page-2.csv'); });
  render(<AssignedWorkloadPageExport snapshot={snapshot} onClose={() => {}} />); expect(create).not.toHaveBeenCalled(); fireEvent.click(screen.getByText('Download reviewed workload page CSV (1 records)')); expect(create).toHaveBeenCalledOnce(); expect(click).toHaveBeenCalledOnce(); expect(revoke).toHaveBeenCalledWith('blob:reviewed');
});

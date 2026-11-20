import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import { ChecklistImportPreview } from './ChecklistImportPreview';
vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));
const get = vi.mocked(apiClient.get);
const data = { case_id: 7, plan_id: 21, plan_status: 'partial', review_fingerprint: 'a'.repeat(64), proposals: [
  { action_index: 2, title: 'inspect: gateway', reason: 'Review before action', priority: 0, available: true, already_present: false },
  { action_index: 0, title: 'notify: soc', reason: null, priority: null, available: false, already_present: true },
  { action_index: 1, title: 'collect: logs', reason: null, priority: 2, available: true, already_present: false },
] };
const props = { caseId: 7, planId: 21, onImport: vi.fn(), onClose: vi.fn(), busy: false };
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue({ data }); });
afterEach(cleanup);
it('selects nothing by default, shows duplicates and imports only explicit original indexes', async () => {
  props.onImport.mockResolvedValue(true);
  render(<ChecklistImportPreview {...props} />);
  await screen.findByText(/2 new tasks available/);
  expect((screen.getByRole('button', { name: 'Add 0 selected tasks' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByLabelText('Select action 1 for checklist') as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByText('Recorded priority: 0')).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Select action 3 for checklist'));
  fireEvent.click(screen.getByRole('button', { name: 'Add 1 selected task' }));
  await waitFor(() => expect(props.onImport).toHaveBeenCalledWith({ reviewed_fingerprint: data.review_fingerprint, action_indexes: [2] }));
  expect(props.onClose).toHaveBeenCalledTimes(1);
});
it('selects only new tasks, clears selection and resets after a refresh', async () => {
  render(<ChecklistImportPreview {...props} />); await screen.findByText(/2 new tasks available/);
  fireEvent.click(screen.getByRole('button', { name: 'Select all new tasks' })); expect(screen.getByRole('button', { name: 'Add 2 selected tasks' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Clear task selection' })); expect(screen.getByRole('button', { name: 'Add 0 selected tasks' })).toBeTruthy();
  fireEvent.click(screen.getByLabelText('Select action 3 for checklist')); fireEvent.click(screen.getByRole('button', { name: 'Refresh checklist preview' }));
  await screen.findByText(/2 new tasks available/); expect(screen.getByRole('button', { name: 'Add 0 selected tasks' })).toBeTruthy();
});
it('invalidates the selection after an unconfirmed import and requires a fresh preview', async () => {
  props.onImport.mockResolvedValue(false);
  render(<ChecklistImportPreview {...props} />); await screen.findByText(/2 new tasks available/);
  fireEvent.click(screen.getByLabelText('Select action 3 for checklist')); fireEvent.click(screen.getByRole('button', { name: 'Add 1 selected task' }));
  await screen.findByText(/No import was confirmed/); expect(screen.queryByRole('checkbox')).toBeNull(); expect(props.onClose).not.toHaveBeenCalled();
});
it.each([{ ...data, case_id: 8 }, { ...data, plan_id: 22 }, { ...data, review_fingerprint: '' }, { ...data, proposals: [...data.proposals, data.proposals[0]] }])('rejects mismatched or malformed preview evidence', async value => {
  get.mockResolvedValue({ data: value }); render(<ChecklistImportPreview {...props} />); await screen.findByRole('alert');
  expect(screen.queryByRole('checkbox')).toBeNull(); expect(props.onImport).not.toHaveBeenCalled();
});
it('ignores late preview responses after unmount', async () => {
  let finish!: (v: unknown) => void; get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<ChecklistImportPreview {...props} />); view.unmount();
  await act(async () => finish({ data })); expect(props.onImport).not.toHaveBeenCalled();
});

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ResponseApprovalReview } from './ResponseApprovalReview';
afterEach(cleanup);
const base = { planId: 7, caseId: 4, reviewFingerprint: 'a'.repeat(64), busy: false, onApprove: vi.fn(), onCancel: vi.fn() };
it('renders structured legacy evidence as JSON and preserves zero priority', () => {
  const unusual = { toString: 'legacy-data' };
  const actions = [{ priority: 0, action_type: unusual, target: unusual, reason: unusual }];
  render(<ResponseApprovalReview {...base} actions={actions as unknown as Parameters<typeof ResponseApprovalReview>[0]['actions']} />);
  expect(screen.getByText('Recorded priority: 0')).toBeTruthy();
  expect(screen.getByText(`Target: ${JSON.stringify(unusual)}`)).toBeTruthy();
  fireEvent.click(screen.getByRole('checkbox'));
  expect((screen.getByRole('button', { name: 'Approve reviewed plan #7' }) as HTMLButtonElement).disabled).toBe(false);
});
it('does not permit approval when saved actions contain a malformed record', () => {
  render(<ResponseApprovalReview {...base} actions={[null] as unknown as Parameters<typeof ResponseApprovalReview>[0]['actions']} />);
  expect(screen.getByRole('alert').textContent).toContain('malformed');
  expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Approve reviewed plan #7' }) as HTMLButtonElement).disabled).toBe(true);
});

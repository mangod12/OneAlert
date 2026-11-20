import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { toast, ToastContainer } from './Toast';
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
it('preserves full long messages and their whitespace for reading', () => {
  render(<ToastContainer />);
  const message = `A failed request returned a long identifier: ${'host.'.repeat(100)}\nReview the recorded details.`;
  act(() => toast(message, 'warning'));
  expect(screen.getByRole('status').textContent).toContain(message);
  expect(screen.getByRole('button', { name: 'Dismiss notification' })).toBeTruthy();
});
it('dismisses a single notification without removing later messages', () => {
  render(<ToastContainer />); act(() => { toast('First'); toast('Second'); });
  fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss notification' })[0]);
  expect(screen.queryByText('First')).toBeNull(); expect(screen.getByText('Second')).toBeTruthy();
});
it('still expires notifications after four seconds', () => {
  render(<ToastContainer />); act(() => toast('Temporary message'));
  act(() => vi.advanceTimersByTime(3999)); expect(screen.getByText('Temporary message')).toBeTruthy();
  act(() => vi.advanceTimersByTime(1)); expect(screen.queryByRole('status')).toBeNull();
});

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { RecordedRunLinks } from './RecordedRunLinks';
afterEach(cleanup);
it('links each exact stage run and explains current shortened evidence rather than retrying', () => {
  render(<RecordedRunLinks runs={[{ label: 'Detect', id: 81 }, { label: 'Triage', id: 82 }]} />);
  expect(screen.getByRole('link', { name: 'Inspect detect run #81' }).getAttribute('href')).toBe('/app/audit-log?run=81');
  expect(screen.getByRole('link', { name: 'Inspect triage run #82' }).getAttribute('href')).toBe('/app/audit-log?run=82');
  expect(screen.getByText(/does not retry an agent/)).toBeTruthy();
});
it.each([null, undefined, 0, -1, 1.5, NaN, 9007199254740992])('does not invent a latest run for missing or invalid IDs %s', id => {
  render(<RecordedRunLinks runs={[{ label: 'Triage', id }]} />); expect(screen.queryByRole('link')).toBeNull(); expect(screen.getByText('Triage: no exact run link recorded.')).toBeTruthy();
});

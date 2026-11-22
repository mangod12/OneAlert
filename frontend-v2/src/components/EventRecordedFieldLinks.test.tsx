import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { EventRecordedFieldLinks } from './EventRecordedFieldLinks';
afterEach(cleanup);
it('offers only supported nonempty saved fields, not raw actor or target values', () => {
  render(<EventRecordedFieldLinks event={{ username: ' Actor_%+名 ', hostname: 'host.example', domain: null, action: '', raw_data: { username: 'PRIVATE_RAW', actor: 'PRIVATE_ACTOR', target: 'PRIVATE_TARGET' } }} />);
  expect(screen.getAllByRole('link')).toHaveLength(2);
  const link = new URL(screen.getByRole('link', { name: 'Search exact recorded username' }).getAttribute('href')!, 'https://example.invalid');
  expect([...link.searchParams]).toEqual([['recorded_field', 'username'], ['recorded_value', ' Actor_%+名 ']]);
  expect(screen.getByLabelText('Recorded label search handoff').textContent).toContain('sensitive label'); expect(document.body.textContent).not.toMatch(/PRIVATE_RAW|PRIVATE_ACTOR|PRIVATE_TARGET/);
});
it('has no handoff for missing, malformed, oversized or unusable labels', () => {
  const { container } = render(<EventRecordedFieldLinks event={{ username: null, hostname: ' ', domain: true, action: 'x'.repeat(1025) }} />); expect(container.textContent).toBe('');
});
it('keeps action and domain labels in their own fields without adding a source or timestamp', () => {
  render(<EventRecordedFieldLinks event={{ domain: 'Name.EXAMPLE', action: 'recorded_outcome:SUCCESS', source_id: 7, timestamp: '2026-01-01T00:00:00Z' }} />);
  for (const field of ['domain', 'action']) { const params = new URL(screen.getByRole('link', { name: `Search exact recorded ${field}` }).getAttribute('href')!, 'https://example.invalid').searchParams; expect([...params.keys()]).toEqual(['recorded_field', 'recorded_value']); expect(params.get('recorded_field')).toBe(field); }
});

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { EventScopeHandoff } from './EventScopeHandoff';
import { emptyEventScope, eventScopeFromParams } from '../utils/eventInvestigationScope';
afterEach(cleanup);
it('shows full boundaries and a private recipe link, never frozen-evidence or permission claims', () => {
  const scope = { ...emptyEventScope, recorded_field: 'username', recorded_value: ' Actor_%+名 ', source_id: '7' };
  render(<EventScopeHandoff scope={scope} hasDraft={false} />);
  const href = screen.getByRole('link', { name: 'Open complete applied-scope event link' }).getAttribute('href')!;
  expect(eventScopeFromParams(new URL(href, 'https://example.test').searchParams)).toEqual(scope);
  expect(screen.getByLabelText('Private applied event scope').textContent).toContain('not frozen results'); expect(screen.getByText(/Keep the link private/)).toBeTruthy(); expect(screen.getByText(/10,000-row limit/)).toBeTruthy(); expect(screen.queryByRole('status')).toBeNull(); expect(document.querySelectorAll('dd')).toHaveLength(11);
});
it('warns that local unapplied drafts are absent while still linking the applied scope', () => {
  render(<EventScopeHandoff scope={emptyEventScope} hasDraft />); expect(screen.getByRole('status').textContent).toContain('drafts are excluded'); expect(screen.getByRole('link', { name: 'Open complete applied-scope event link' })).toBeTruthy();
});
it('fails closed when a current filter is not representable rather than stripping it from a link', () => {
  render(<EventScopeHandoff scope={{ ...emptyEventScope, signature: 'x'.repeat(1025) }} hasDraft={false} />); expect(screen.getByRole('alert').textContent).toContain('No broader link was substituted'); expect(screen.queryByRole('link')).toBeNull();
});
it('renders untrusted labels only as text, not active markup or external links', () => {
  render(<EventScopeHandoff scope={{ ...emptyEventScope, recorded_field: 'username', recorded_value: '<img src=x onerror=alert(1)> https://external.invalid' }} hasDraft={false} />);
  expect(document.querySelector('img')).toBeNull(); expect(document.querySelectorAll('a')).toHaveLength(1); expect(screen.getByRole('link').getAttribute('href')?.startsWith('/app/events?')).toBe(true);
});

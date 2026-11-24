import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { TimelineEntryLinkStatus } from './TimelineEntryLinkStatus';
afterEach(cleanup);
it('does not warn on an absent link or the exact loaded entry', () => {
  const view = render(<TimelineEntryLinkStatus id={null} invalid={false} loadedIds={[21]} />);
  expect(view.container).toBeEmptyDOMElement();
  view.rerender(<TimelineEntryLinkStatus id={21} invalid={false} loadedIds={[21]} />);
  expect(view.container).toBeEmptyDOMElement();
});
it('rejects invalid links without claiming unavailable entries or broadening the selection', () => {
  render(<TimelineEntryLinkStatus id={null} invalid loadedIds={[21]} />);
  expect(screen.getByRole('alert')).toHaveTextContent('link is invalid');
  expect(screen.getByRole('alert')).toHaveTextContent('No entry was selected');
});
it('reports a missing loaded entry without asserting deletion or access elsewhere', () => {
  const view = render(<TimelineEntryLinkStatus id={99} invalid={false} loadedIds={[21]} />);
  expect(screen.getByRole('alert')).toHaveTextContent('Linked entry #99 is not present');
  expect(screen.getByRole('alert')).toHaveTextContent('does not prove deletion');
  view.rerender(<TimelineEntryLinkStatus id={99} invalid={false} loadedIds={[21, 99]} />);
  expect(view.container).toBeEmptyDOMElement();
});

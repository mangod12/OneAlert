import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { TimelineCapturedRows } from './TimelineCapturedRows';
import { TimelineExplorer } from './TimelineExplorer';
const rows = Array.from({ length: 23 }, (_, i) => ({ id: i + 1, timestamp: '2026-11-24T00:30:00+05:30', entry_type: 'note', source: 'human', author_email: 'author@example.com', content: `Saved evidence ${i + 1}` }));
afterEach(cleanup);
it('previews bounded pages in captured order including the final partial page', () => {
  render(<TimelineCapturedRows rows={rows} />); fireEvent.click(screen.getByText('Inspect captured matching rows (23)'));
  expect(screen.getAllByRole('listitem')).toHaveLength(10);
  expect(screen.getByRole('button', { name: 'Previous captured rows' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Next captured rows' }));
  expect(screen.getByText('Captured entry #11')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next captured rows' }));
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
  expect(screen.getAllByRole('status')[0]).toHaveTextContent('Captured rows 21-23 of 23');
  expect(screen.getByRole('button', { name: 'Next captured rows' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Previous captured rows' }));
  expect(screen.getByText('Captured entry #11')).toBeInTheDocument();
});
it('shows raw timestamp and literal saved text without executing HTML, links or formulas', () => {
  render(<TimelineCapturedRows rows={[{ ...rows[0], author_email: null, source: '', content: '=HYPERLINK("https://example.test","<img src=x onerror=alert(1)>")\nsecond line' }]} />);
  fireEvent.click(screen.getByText('Inspect captured matching rows (1)'));
  expect(screen.getByText('2026-11-24T00:30:00+05:30')).toBeInTheDocument();
  expect(screen.getAllByText('Not recorded')).toHaveLength(2);
  expect(screen.getByText(/=HYPERLINK/)).toHaveTextContent('<img src=x onerror=alert(1)>');
  expect(document.querySelector('img,a')).toBeNull();
});
it('keeps preview rows frozen through live filter and record changes, excludes pinned nonmatches, resets on discard and recapture', () => {
  const view = render(<TimelineExplorer entries={rows} pinnedIds={[23]} exportContext={{ caseId: 7, title: 'Seven' }}>{row => <p key={row.id}>{row.content}</p>}</TimelineExplorer>);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find timeline evidence' }), { target: { value: 'Saved evidence 1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review matching timeline CSV' }));
  const review = screen.getByRole('region', { name: 'Matching timeline CSV review' });
  fireEvent.click(within(review).getByText('Inspect captured matching rows (11)'));
  expect(within(review).queryByText('Captured entry #23')).toBeNull();
  fireEvent.click(within(review).getByRole('button', { name: 'Next captured rows' }));
  expect(within(review).getByText('Captured entry #19')).toBeInTheDocument();
  view.rerender(<TimelineExplorer entries={[{ ...rows[0], content: 'Changed live text' }]} exportContext={{ caseId: 7, title: 'Seven' }}>{row => <p key={row.id}>{row.content}</p>}</TimelineExplorer>);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Find timeline evidence' }), { target: { value: 'Changed' } });
  expect(within(review).getByText('Saved evidence 19')).toBeInTheDocument();
  expect(within(review).queryByText('Changed live text')).toBeNull();
  fireEvent.click(within(review).getByRole('button', { name: 'Discard captured review' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review matching timeline CSV' }));
  const next = screen.getByRole('region', { name: 'Matching timeline CSV review' });
  fireEvent.click(within(next).getByText('Inspect captured matching rows (1)'));
  expect(within(next).getByText('Changed live text')).toBeInTheDocument();
  expect(within(next).getAllByRole('status')[0]).toHaveTextContent('Captured rows 1-1 of 1');
});

it('searches only frozen rows and resets inspection pagination without changing capture count', () => {
  render(<TimelineCapturedRows rows={rows} />); fireEvent.click(screen.getByText('Inspect captured matching rows (23)'));
  fireEvent.click(screen.getByRole('button', { name: 'Next captured rows' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Find within captured rows' }), { target: { value: '  EVIDENCE 2  ' } });
  expect(screen.getAllByRole('status')[0]).toHaveTextContent('5 inspection matches of 23 captured rows');
  expect(screen.getByText('Captured entry #2')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Next captured rows' })).toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: 'Find within captured rows' }), { target: { value: '2026-11-24T00:30:00+05:30' } });
  expect(screen.getAllByRole('status')[0]).toHaveTextContent('23 inspection matches of 23 captured rows');
  fireEvent.change(screen.getByRole('textbox', { name: 'Find within captured rows' }), { target: { value: '%notpresent' } });
  expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  expect(screen.getByText(/No captured rows match this inspection text/)).toBeInTheDocument();
  expect(screen.getByText('Inspect captured matching rows (23)')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'Find within captured rows' }), { target: { value: ' ' } });
  expect(screen.getAllByRole('status')[0]).toHaveTextContent('Captured rows 1-10 of 23');
});

it('summarizes all frozen rows independent of inspection pages/text and narrows exact categories only', () => {
 render(<TimelineCapturedRows rows={rows.map((row, index) => ({ ...row, source: index === 22 ? 'human-extra' : 'human' }))} />); fireEvent.click(screen.getByText('Inspect captured matching rows (23)')); fireEvent.click(screen.getByRole('button', { name: 'Next captured rows' })); fireEvent.click(screen.getByRole('button', { name: 'Explore captured timeline composition' }));
 const composition = screen.getByRole('region', { name: 'Captured timeline composition' }); expect(within(composition).getByRole('button', { name: 'Source: human · 22 entries' })).toBeInTheDocument(); fireEvent.click(within(composition).getByRole('button', { name: 'Source: human-extra · 1 entry' })); expect(screen.getAllByRole('listitem')).toHaveLength(1); expect(screen.getByText('Captured entry #23')).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Find within captured rows'), { target: { value: 'Saved evidence 1' } }); expect(screen.queryAllByRole('listitem')).toHaveLength(0); expect(within(composition).getByRole('button', { name: 'Type: note · 23 entries' })).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Clear captured category' })); expect(screen.getAllByRole('listitem')).toHaveLength(10); expect(screen.getByText('Captured entry #1')).toBeInTheDocument();
});
it('keeps null and empty raw authors separate and groups dates by UTC including unusable timestamps', () => {
 render(<TimelineCapturedRows rows={[{ ...rows[0], author_email: null, timestamp: 'invalid' }, { ...rows[1], author_email: '', timestamp: '2026-11-25T00:30:00+05:30' }, { ...rows[2], author_email: 'unrecorded', timestamp: '2026-11-24T19:00:00Z' }]} />); fireEvent.click(screen.getByText('Inspect captured matching rows (3)')); fireEvent.click(screen.getByRole('button', { name: 'Explore captured timeline composition' }));
 const region = screen.getByRole('region'); expect(within(region).getByRole('button', { name: 'Recorded author: unrecorded · 1 entry' })).toBeInTheDocument(); fireEvent.click(within(region).getByRole('button', { name: 'Recorded author: (Empty saved value) · 1 entry' })); expect(screen.getByText('Captured entry #2')).toBeInTheDocument(); expect(screen.queryByText('Captured entry #1')).toBeNull(); fireEvent.click(within(region).getByRole('button', { name: 'Recorded UTC day: 2026-11-24 · 2 entries' })); expect(screen.getAllByRole('listitem')).toHaveLength(2); fireEvent.click(within(region).getByRole('button', { name: 'Recorded UTC day: (No usable UTC day) · 1 entry' })); expect(screen.getByText('Captured entry #1')).toBeInTheDocument(); expect(screen.getAllByRole('listitem')).toHaveLength(1);
});
it('retains comparison selections when category inspection hides the chosen rows', () => {
 render(<TimelineCapturedRows rows={[rows[0], { ...rows[1], source: 'agent' }, rows[2]]} />); fireEvent.click(screen.getByText('Inspect captured matching rows (3)')); fireEvent.click(screen.getByRole('button', { name: 'Compare captured entry 1' })); fireEvent.click(screen.getByRole('button', { name: 'Compare captured entry 3' })); fireEvent.click(screen.getByRole('button', { name: 'Explore captured timeline composition' })); fireEvent.click(screen.getByRole('button', { name: 'Source: agent · 1 entry' })); expect(screen.getByRole('region', { name: 'Captured timeline entry comparison' })).toHaveTextContent('Captured entry #1 compared with #3'); expect(screen.getAllByRole('listitem')).toHaveLength(1);
});

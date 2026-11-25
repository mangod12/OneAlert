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
 const region = screen.getByRole('region'); expect(within(region).getByRole('button', { name: 'Recorded author: unrecorded · 1 entry' })).toBeInTheDocument(); fireEvent.click(within(region).getByRole('button', { name: 'Recorded author: (Empty saved value) · 1 entry' })); expect(screen.getByText('Captured entry #2')).toBeInTheDocument(); expect(screen.queryByText('Captured entry #1')).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Remove captured author_email category' })); fireEvent.click(within(region).getByRole('button', { name: 'Recorded UTC day: 2026-11-24 · 2 entries' })); expect(screen.getAllByRole('listitem')).toHaveLength(2); fireEvent.click(within(region).getByRole('button', { name: 'Recorded UTC day: (No usable UTC day) · 1 entry' })); expect(screen.getByText('Captured entry #1')).toBeInTheDocument(); expect(screen.getAllByRole('listitem')).toHaveLength(1);
});
it('retains comparison selections when category inspection hides the chosen rows', () => {
 render(<TimelineCapturedRows rows={[rows[0], { ...rows[1], source: 'agent' }, rows[2]]} />); fireEvent.click(screen.getByText('Inspect captured matching rows (3)')); fireEvent.click(screen.getByRole('button', { name: 'Compare captured entry 1' })); fireEvent.click(screen.getByRole('button', { name: 'Compare captured entry 3' })); fireEvent.click(screen.getByRole('button', { name: 'Explore captured timeline composition' })); fireEvent.click(screen.getByRole('button', { name: 'Source: agent · 1 entry' })); expect(screen.getByRole('region', { name: 'Captured timeline entry comparison' })).toHaveTextContent('Captured entry #1 compared with #3'); expect(screen.getAllByRole('listitem')).toHaveLength(1);
});

it('sorts inspection by recorded UTC time with stable equivalent instants and invalid timestamps last', () => {
 const data = [{ ...rows[0], id: 9, timestamp: 'invalid' }, { ...rows[0], id: 8, timestamp: '2026-11-25T00:30:00+05:30' }, { ...rows[0], id: 7, timestamp: '2026-11-24T19:00:00Z' }, { ...rows[0], id: 6, timestamp: '2026-11-25T00:00:00' }, { ...rows[0], id: 5, timestamp: '' }];
 render(<TimelineCapturedRows rows={data} />); fireEvent.click(screen.getByText('Inspect captured matching rows (5)')); const ids = () => screen.getAllByRole('listitem').map(item => within(item).getByText(/Captured entry #/).textContent);
 fireEvent.change(screen.getByLabelText('Captured row inspection order'), { target: { value: 'newest' } }); expect(ids()).toEqual([6, 8, 7, 9, 5].map(id => `Captured entry #${id}`));
 fireEvent.change(screen.getByLabelText('Captured row inspection order'), { target: { value: 'oldest' } }); expect(ids()).toEqual([8, 7, 6, 9, 5].map(id => `Captured entry #${id}`));
 fireEvent.change(screen.getByLabelText('Captured row inspection order'), { target: { value: 'id' } }); expect(ids()).toEqual([5, 6, 7, 8, 9].map(id => `Captured entry #${id}`));
 fireEvent.change(screen.getByLabelText('Captured row inspection order'), { target: { value: 'captured' } }); expect(ids()).toEqual([9, 8, 7, 6, 5].map(id => `Captured entry #${id}`)); expect(data.map(row => row.id)).toEqual([9, 8, 7, 6, 5]);
});
it('resets inspection page on order change and retains search category and comparison selection', () => {
 render(<TimelineCapturedRows rows={rows.map(row => ({ ...row, timestamp: row.id === 23 ? '2026-11-26T00:00:00Z' : row.timestamp }))} />); fireEvent.click(screen.getByText('Inspect captured matching rows (23)')); fireEvent.click(screen.getByRole('button', { name: 'Compare captured entry 1' })); fireEvent.click(screen.getByRole('button', { name: 'Next captured rows' })); fireEvent.click(screen.getByRole('button', { name: 'Compare captured entry 11' })); fireEvent.click(screen.getByRole('button', { name: 'Explore captured timeline composition' })); fireEvent.click(screen.getByRole('button', { name: 'Type: note · 23 entries' })); fireEvent.change(screen.getByLabelText('Find within captured rows'), { target: { value: 'evidence' } }); fireEvent.click(screen.getByRole('button', { name: 'Next captured rows' })); fireEvent.change(screen.getByLabelText('Captured row inspection order'), { target: { value: 'newest' } }); expect(screen.getByText('Captured entry #23')).toBeInTheDocument(); expect(screen.getByText(/Captured rows 1-10 of 23/)).toBeInTheDocument(); expect(screen.getByLabelText('Find within captured rows')).toHaveValue('evidence'); expect(screen.getByText(/Inspection category: entry_type = note/)).toBeInTheDocument(); expect(screen.getByRole('region', { name: 'Captured timeline entry comparison' })).toHaveTextContent('#1 compared with #11');
});

it('limits captured search to exact chosen raw fields rather than matching incidental metadata', () => {
 render(<TimelineCapturedRows rows={[{ ...rows[0], id: 1, content: 'author@test in note', author_email: 'other@test' }, { ...rows[0], id: 11, content: 'different text', author_email: 'author@test' }]} />); fireEvent.click(screen.getByText('Inspect captured matching rows (2)')); fireEvent.change(screen.getByLabelText('Find within captured rows'), { target: { value: 'AUTHOR@TEST' } }); fireEvent.change(screen.getByLabelText('Search captured field'), { target: { value: 'author' } }); expect(screen.getAllByRole('listitem')).toHaveLength(1); expect(screen.getByText('Captured entry #11')).toBeInTheDocument(); fireEvent.change(screen.getByLabelText('Search captured field'), { target: { value: 'content' } }); expect(screen.getByText('Captured entry #1')).toBeInTheDocument(); expect(screen.queryByText('Captured entry #11')).toBeNull();
});
it.each(['01', '1.0', '-1', '1e1', '9007199254740992', 'author'])('rejects ambiguous exact captured ID %s without widening export', query => {
 render(<TimelineCapturedRows rows={rows} />); fireEvent.click(screen.getByText('Inspect captured matching rows (23)')); fireEvent.change(screen.getByLabelText('Search captured field'), { target: { value: 'id' } }); fireEvent.change(screen.getByLabelText('Find within captured rows'), { target: { value: query } }); expect(screen.queryAllByRole('listitem')).toHaveLength(0); expect(screen.getByText(/Enter one positive whole captured entry ID/)).toBeInTheDocument(); expect(screen.getByText('Inspect captured matching rows (23)')).toBeInTheDocument();
});
it('matches exact captured ID not partial and resets page while retaining category/order', () => {
 render(<TimelineCapturedRows rows={rows} />); fireEvent.click(screen.getByText('Inspect captured matching rows (23)')); fireEvent.click(screen.getByRole('button', { name: 'Next captured rows' })); fireEvent.change(screen.getByLabelText('Captured row inspection order'), { target: { value: 'id' } }); fireEvent.change(screen.getByLabelText('Search captured field'), { target: { value: 'id' } }); fireEvent.change(screen.getByLabelText('Find within captured rows'), { target: { value: ' 1 ' } }); expect(screen.getAllByRole('listitem')).toHaveLength(1); expect(screen.getByText('Captured entry #1')).toBeInTheDocument(); expect(screen.queryByText('Captured entry #11')).toBeNull(); fireEvent.change(screen.getByLabelText('Find within captured rows'), { target: { value: '' } }); expect(screen.getAllByRole('listitem')).toHaveLength(10); expect(screen.getByLabelText('Captured row inspection order')).toHaveValue('id');
});
it.each([['timestamp', '00:30'], ['type', 'note'], ['source', 'human']])('searches the chosen %s raw field', (field, query) => {
 render(<TimelineCapturedRows rows={rows} />); fireEvent.click(screen.getByText('Inspect captured matching rows (23)')); fireEvent.change(screen.getByLabelText('Search captured field'), { target: { value: field } }); fireEvent.change(screen.getByLabelText('Find within captured rows'), { target: { value: query } }); expect(screen.getByText(/23 inspection matches of 23 captured rows/)).toBeInTheDocument();
});

it('intersects categories across dimensions, replaces within one dimension and keeps full-capture counts', () => {
 const data = [rows[0], { ...rows[1], source: 'agent' }, { ...rows[2], entry_type: 'event' }, { ...rows[3], source: 'agent', entry_type: 'event' }];
 render(<TimelineCapturedRows rows={data} />); fireEvent.click(screen.getByText('Inspect captured matching rows (4)')); fireEvent.click(screen.getByRole('button', { name: 'Explore captured timeline composition' }));
 fireEvent.click(screen.getByRole('button', { name: 'Type: note · 2 entries' })); fireEvent.click(screen.getByRole('button', { name: 'Source: human · 2 entries' }));
 expect(screen.getAllByRole('listitem')).toHaveLength(1); expect(screen.getByText('Captured entry #1')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Type: event · 2 entries' })).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button', { name: 'Type: event · 2 entries' })); expect(screen.getByText('Captured entry #3')).toBeInTheDocument(); expect(screen.getAllByRole('listitem')).toHaveLength(1);
 fireEvent.click(screen.getByRole('button', { name: 'Source: human · 2 entries' })); expect(screen.getAllByRole('listitem')).toHaveLength(2); expect(screen.queryByText(/Inspection category: source/)).toBeNull();
});
it('keeps null and empty author categories exact when intersecting UTC day and allows independent removal', () => {
 const data = [{ ...rows[0], author_email: null, timestamp: 'invalid' }, { ...rows[1], author_email: '', timestamp: 'invalid' }, { ...rows[2], author_email: null, timestamp: '2026-11-24T00:00:00Z' }];
 render(<TimelineCapturedRows rows={data} />); fireEvent.click(screen.getByText('Inspect captured matching rows (3)')); fireEvent.click(screen.getByRole('button', { name: 'Explore captured timeline composition' }));
 fireEvent.click(screen.getByRole('button', { name: 'Recorded author: (Not recorded) · 2 entries' })); fireEvent.click(screen.getByRole('button', { name: 'Recorded UTC day: (No usable UTC day) · 2 entries' })); expect(screen.getAllByRole('listitem')).toHaveLength(1); expect(screen.getByText('Captured entry #1')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button', { name: 'Remove captured author_email category' })); expect(screen.getAllByRole('listitem')).toHaveLength(2); fireEvent.click(screen.getByRole('button', { name: 'Clear captured category' })); expect(screen.getAllByRole('listitem')).toHaveLength(3);
});
it('preserves search order comparison and export count through combined zero-match categories', () => {
 render(<TimelineCapturedRows rows={rows.map(row => ({ ...row, source: row.id === 23 ? 'agent' : 'human' }))} />); fireEvent.click(screen.getByText('Inspect captured matching rows (23)')); fireEvent.click(screen.getByRole('button', { name: 'Compare captured entry 1' })); fireEvent.click(screen.getByRole('button', { name: 'Compare captured entry 2' })); fireEvent.change(screen.getByLabelText('Captured row inspection order'), { target: { value: 'id' } }); fireEvent.change(screen.getByLabelText('Find within captured rows'), { target: { value: 'Saved evidence 1' } }); fireEvent.click(screen.getByRole('button', { name: 'Explore captured timeline composition' }));
 fireEvent.click(screen.getByRole('button', { name: 'Type: note · 23 entries' })); fireEvent.click(screen.getByRole('button', { name: 'Source: agent · 1 entry' })); expect(screen.queryAllByRole('listitem')).toHaveLength(0); expect(screen.getByText('Inspect captured matching rows (23)')).toBeInTheDocument(); expect(screen.getByRole('region', { name: 'Captured timeline entry comparison' })).toHaveTextContent('#1 compared with #2');
 fireEvent.click(screen.getByRole('button', { name: 'Clear captured category' })); expect(screen.getByLabelText('Find within captured rows')).toHaveValue('Saved evidence 1'); expect(screen.getByLabelText('Captured row inspection order')).toHaveValue('id'); expect(screen.getByText(/Captured rows 1-10 of 11/)).toBeInTheDocument();
});

it('narrows inclusive recorded UTC dates with offsets and UTC-convention timestamps while excluding invalid times', () => {
 const data = [{ ...rows[0], timestamp: '2026-11-25T00:30:00+05:30' }, { ...rows[1], timestamp: '2026-11-24T23:59:59Z' }, { ...rows[2], timestamp: '2026-11-25T00:00:00' }, { ...rows[3], timestamp: 'invalid' }];
 render(<TimelineCapturedRows rows={data} />); fireEvent.click(screen.getByText('Inspect captured matching rows (4)')); fireEvent.change(screen.getByLabelText('Captured from UTC date'), { target: { value: '2026-11-24' } }); fireEvent.change(screen.getByLabelText('Captured through UTC date'), { target: { value: '2026-11-24' } }); expect(screen.getAllByRole('listitem')).toHaveLength(2); expect(screen.getByText('Captured entry #1')).toBeInTheDocument(); expect(screen.getByText('Captured entry #2')).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Captured through UTC date'), { target: { value: '' } }); expect(screen.getAllByRole('listitem')).toHaveLength(3); fireEvent.click(screen.getByRole('button', { name: 'Clear captured UTC window' })); expect(screen.getAllByRole('listitem')).toHaveLength(4);
});
it('fails closed for reversed frozen windows then restores without clearing comparison text order or categories', () => {
 render(<TimelineCapturedRows rows={rows} />); fireEvent.click(screen.getByText('Inspect captured matching rows (23)')); fireEvent.click(screen.getByRole('button', { name: 'Compare captured entry 1' })); fireEvent.click(screen.getByRole('button', { name: 'Compare captured entry 2' })); fireEvent.change(screen.getByLabelText('Find within captured rows'), { target: { value: 'evidence' } }); fireEvent.change(screen.getByLabelText('Captured row inspection order'), { target: { value: 'id' } }); fireEvent.click(screen.getByRole('button', { name: 'Explore captured timeline composition' })); fireEvent.click(screen.getByRole('button', { name: 'Type: note · 23 entries' })); fireEvent.click(screen.getByRole('button', { name: 'Next captured rows' }));
 fireEvent.change(screen.getByLabelText('Captured from UTC date'), { target: { value: '2026-11-25' } }); fireEvent.change(screen.getByLabelText('Captured through UTC date'), { target: { value: '2026-11-24' } }); expect(screen.queryAllByRole('listitem')).toHaveLength(0); expect(screen.getByText(/Captured UTC date window is invalid/)).toBeInTheDocument(); expect(screen.getByRole('region', { name: 'Captured timeline entry comparison' })).toHaveTextContent('#1 compared with #2');
 fireEvent.click(screen.getByRole('button', { name: 'Clear captured UTC window' })); expect(screen.getByText(/Captured rows 1-10 of 23/)).toBeInTheDocument(); expect(screen.getByLabelText('Find within captured rows')).toHaveValue('evidence'); expect(screen.getByLabelText('Captured row inspection order')).toHaveValue('id'); expect(screen.getByText(/Inspection category: entry_type = note/)).toBeInTheDocument();
});
it('intersects UTC window with exact day category rather than silently replacing it', () => {
 render(<TimelineCapturedRows rows={rows} />); fireEvent.click(screen.getByText('Inspect captured matching rows (23)')); fireEvent.click(screen.getByRole('button', { name: 'Explore captured timeline composition' })); fireEvent.click(screen.getByRole('button', { name: 'Recorded UTC day: 2026-11-23 · 23 entries' })); fireEvent.change(screen.getByLabelText('Captured from UTC date'), { target: { value: '2026-11-24' } }); expect(screen.queryAllByRole('listitem')).toHaveLength(0); expect(screen.getByText(/Inspection category: day = 2026-11-23/)).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Recorded UTC day: 2026-11-23 · 23 entries' })).toBeInTheDocument(); fireEvent.change(screen.getByLabelText('Captured from UTC date'), { target: { value: '' } }); expect(screen.getAllByRole('listitem')).toHaveLength(10);
});

it('resets all frozen inspection controls and first page while preserving selection and composition', () => {
 render(<TimelineCapturedRows rows={rows} />); fireEvent.click(screen.getByText('Inspect captured matching rows (23)')); expect(screen.queryByRole('button', { name: 'Reset frozen timeline inspection' })).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Compare captured entry 1' })); fireEvent.click(screen.getByRole('button', { name: 'Compare captured entry 2' })); fireEvent.click(screen.getByRole('button', { name: 'Explore captured timeline composition' })); fireEvent.click(screen.getByRole('button', { name: 'Type: note · 23 entries' })); fireEvent.change(screen.getByLabelText('Captured row inspection order'), { target: { value: 'newest' } }); fireEvent.change(screen.getByLabelText('Search captured field'), { target: { value: 'id' } }); fireEvent.change(screen.getByLabelText('Find within captured rows'), { target: { value: '01' } }); fireEvent.change(screen.getByLabelText('Captured from UTC date'), { target: { value: '2026-11-25' } }); fireEvent.change(screen.getByLabelText('Captured through UTC date'), { target: { value: '2026-11-24' } });
 fireEvent.click(screen.getByRole('button', { name: 'Reset frozen timeline inspection' })); expect(screen.getByLabelText('Find within captured rows')).toHaveValue(''); expect(screen.getByLabelText('Search captured field')).toHaveValue('all'); expect(screen.getByLabelText('Captured from UTC date')).toHaveValue(''); expect(screen.getByLabelText('Captured through UTC date')).toHaveValue(''); expect(screen.getByLabelText('Captured row inspection order')).toHaveValue('captured'); expect(screen.queryByText(/Inspection category:/)).toBeNull(); expect(screen.getByText(/Captured rows 1-10 of 23/)).toBeInTheDocument(); expect(screen.getByRole('region', { name: 'Captured timeline entry comparison' })).toHaveTextContent('#1 compared with #2'); expect(screen.getByRole('region', { name: 'Captured timeline composition' })).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Reset frozen timeline inspection' })).toBeNull();
});
it('offers reset for page navigation alone and restores original captured order without changing input rows', () => {
 const before = JSON.stringify(rows); render(<TimelineCapturedRows rows={rows} />); fireEvent.click(screen.getByText('Inspect captured matching rows (23)')); fireEvent.click(screen.getByRole('button', { name: 'Next captured rows' })); fireEvent.click(screen.getByRole('button', { name: 'Reset frozen timeline inspection' })); expect(screen.getByText('Captured entry #1')).toBeInTheDocument(); expect(screen.queryByText('Captured entry #11')).toBeNull(); expect(JSON.stringify(rows)).toBe(before);
});

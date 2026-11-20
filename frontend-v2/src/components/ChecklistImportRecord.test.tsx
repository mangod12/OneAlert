import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ChecklistImportRecord } from './ChecklistImportRecord';
afterEach(cleanup);
const metadata = { kind: 'reviewed_checklist_import', schema_version: 1, case_id: 7, plan_id: 21, reviewed_fingerprint: 'a'.repeat(64), selected_action_indexes: [0, 2], skipped_existing_titles: 1, created_tasks: [{ task_id: 5, action_index: 2, title_at_import: 'collect: gateway logs' }] };
it('shows recorded task identifiers and original action positions with current-plan caveats', () => {
  render(<MemoryRouter><ChecklistImportRecord metadata={metadata} caseId={7} /></MemoryRouter>);
  expect(screen.getByText('Task #5 from saved action position 3: collect: gateway logs')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Open current decision evidence for plan #21', hidden: true }).getAttribute('href')).toBe('/response-plans?plan=21');
  expect(screen.getByText(/not a signed receipt or immutable audit log/)).toBeTruthy();
  expect(screen.getByText(/Tasks created: 1. Selected titles skipped: 1/)).toBeTruthy();
});
it.each([null, {}, { ...metadata, case_id: 8 }, { ...metadata, plan_id: -1 }, { ...metadata, reviewed_fingerprint: '' }, { ...metadata, created_tasks: [{ task_id: 5, action_index: 99, title_at_import: 'wrong' }] }, { ...metadata, schema_version: 2 }])('does not invent provenance for missing, malformed or mismatched records', value => {
  const view = render(<MemoryRouter><ChecklistImportRecord metadata={value} caseId={7} /></MemoryRouter>);
  expect(view.container.textContent).toBe('');
});

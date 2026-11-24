import { useState } from 'react';
import { checklistFilterLink } from '../utils/checklistFilterLink';
import { type ChecklistFilters } from '../utils/checklistTriage';
export function ChecklistFilterHandoff({ caseId, filters, currentUserId, disabled }: { caseId: number; filters: ChecklistFilters; currentUserId: number | null; disabled: boolean }) {
  const [notice, setNotice] = useState('');
  const copy = async () => {
    setNotice('');
    try { await navigator.clipboard.writeText(checklistFilterLink(window.location.origin, caseId, filters, currentUserId)); setNotice('Checklist filter link copied. No message was sent or access granted.'); }
    catch { setNotice('Checklist filter link could not be copied. Verify the selected account/filter scope and try again.'); }
  };
  return <section aria-label="Checklist filter handoff" className="space-y-2 rounded border border-surface-800 p-3 text-xs text-surface-400"><button type="button" disabled={disabled || (filters.assignee === 'mine' && currentUserId === null)} onClick={() => void copy()} className="rounded border border-surface-700 px-3 py-2 text-primary-300 disabled:opacity-40">Copy current checklist filter link</button><p>The link includes the current title query, status, exact assignee scope, due filter and order. Assigned to me becomes your exact account ID, not the recipient's account. Query text and IDs may be sensitive. Share only with an appropriate audience. No tasks, page selection, notes or task edits are included. Opening requires current access and reads current loaded tasks; relative due filters use the viewer's local day. No notification or access grant is sent.</p>{notice && <p role="status">{notice}</p>}</section>;
}

import { useState } from 'react';

export function TimelineEntryHandoff({ caseId, entryId }: { caseId: number; entryId: number }) {
  const [notice, setNotice] = useState('');
  if (![caseId, entryId].every(id => Number.isSafeInteger(id) && id > 0)) return null;
  const path = `/app/cases/${caseId}?note=${entryId}`;
  const copy = async () => {
    setNotice('');
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).href);
      setNotice('Exact timeline entry link copied. No message was sent or access granted.');
    } catch {
      setNotice('Copy unavailable. Use the exact entry link below.');
    }
  };
  return <details className="mt-2 max-w-full text-xs text-surface-400 [overflow-wrap:anywhere]">
    <summary className="min-h-9 cursor-pointer py-2">Entry #{entryId} link</summary>
    <p>This link identifies saved entry #{entryId} in investigation #{caseId}. It includes IDs, not note text, search criteria or unsaved edits. Share only with an appropriate audience. Opening requires current access and shows the current saved entry, not a frozen copy or edit history. No notification or access grant is sent.</p>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => void copy()} className="min-h-9 rounded-md border border-surface-600 px-2 text-primary-300">Copy exact timeline entry link</button>
      <a href={path} className="inline-flex min-h-9 items-center text-primary-300 underline">Open exact entry #{entryId}</a>
    </div>
    {notice && <p role="status" className="mt-2">{notice}</p>}
  </details>;
}

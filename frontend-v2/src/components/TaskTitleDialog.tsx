import { useRef, useState } from 'react';
import { useDialogFocus } from './ui/useDialogFocus';
import { getApiErrorMessage } from '../api/errors';

export function TaskTitleDialog({ title, onSave, onClose }: {
  title: string;
  onSave: (title: string) => Promise<void>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useDialogFocus(ref, () => { if (!busy) onClose(); });
  const save = async () => {
    const next = value.trim();
    if (busy || !next || next.length > 300 || next === title) return;
    setBusy(true);
    setError('');
    try {
      await onSave(next);
      onClose();
    } catch (err) {
      setError(getApiErrorMessage(err, 'The task title could not be saved. Your edit is still here.'));
    } finally { setBusy(false); }
  };
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-950/80 p-4">
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="task-title-dialog" className="w-full max-w-lg rounded-xl border border-surface-700 bg-surface-900 p-5">
      <h2 id="task-title-dialog" className="text-lg font-semibold text-surface-50">Edit task title</h2>
      <p className="mt-2 text-sm text-surface-400">Update the checklist wording without changing its owner, due date or completion state.</p>
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <label htmlFor="task-title-edit" className="mt-4 block text-sm text-surface-200">Task title</label>
        <input id="task-title-edit" value={value} onChange={event => setValue(event.target.value)} maxLength={300} disabled={busy}
          className="mt-1 min-h-10 w-full rounded-md border border-surface-600 bg-surface-950 px-3 text-sm text-surface-100 disabled:opacity-50" />
        <p className="mt-1 text-xs text-surface-500">{value.length}/300 characters</p>
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        {busy && <p role="status" className="mt-3 text-sm text-surface-400">Saving task title...</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-md border border-surface-600 px-3 py-2 text-sm text-surface-200 disabled:opacity-40">Cancel edit</button>
          <button type="submit" disabled={busy || !value.trim() || value.trim() === title || value.trim().length > 300} className="rounded-md bg-primary-600 px-3 py-2 text-sm text-white disabled:opacity-40">Save task title</button>
        </div>
      </form>
    </div>
  </div>;
}

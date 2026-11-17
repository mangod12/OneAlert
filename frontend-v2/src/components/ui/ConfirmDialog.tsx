import { useRef, useState } from 'react';
import clsx from 'clsx';
import { useDialogFocus } from './useDialogFocus';

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  reasonLabel?: string;
  reasonPlaceholder?: string;
  defaultReason?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}

// Accessible confirmation dialog for destructive or consequential actions.
// Replaces window.confirm so the action, its consequences, and an optional
// reason stay inside the app's focus management and styling.
export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  tone = 'primary',
  reasonLabel,
  reasonPlaceholder,
  defaultReason = '',
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [reason, setReason] = useState(defaultReason);
  useDialogFocus(dialogRef, onCancel);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-surface-950/70"
        aria-hidden="true"
        onClick={() => { if (!busy) onCancel(); }}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-description"
        className="relative w-full max-w-md rounded-lg border border-surface-700 bg-surface-900 p-6 shadow-[var(--oa-shadow-float)]"
      >
        <h2 id="confirm-dialog-title" className="text-lg font-semibold text-surface-50">{title}</h2>
        <p id="confirm-dialog-description" className="mt-2 text-sm text-surface-400">{description}</p>

        {reasonLabel && (
          <div className="mt-4">
            <label htmlFor="confirm-dialog-reason" className="block text-xs font-medium text-surface-300">
              {reasonLabel}
            </label>
            <textarea
              id="confirm-dialog-reason"
              value={reason}
              onChange={event => setReason(event.target.value)}
              placeholder={reasonPlaceholder}
              rows={3}
              disabled={busy}
              className="mt-1 w-full rounded-md border border-surface-700 bg-surface-950 p-2 text-sm text-surface-50 placeholder:text-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:opacity-40"
            />
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded px-3 py-1.5 text-xs font-medium text-surface-300 transition-colors hover:bg-surface-800 hover:text-surface-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason.trim())}
            disabled={busy}
            className={clsx(
              'rounded px-3 py-1.5 text-xs font-medium text-surface-950 transition-colors disabled:cursor-not-allowed disabled:opacity-40',
              tone === 'danger' ? 'bg-danger hover:bg-danger/80' : 'bg-primary-500 hover:bg-primary-400',
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

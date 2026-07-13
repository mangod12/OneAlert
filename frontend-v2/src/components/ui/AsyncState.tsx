import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';

interface StateProps {
  title: string;
  description: string;
  action?: ReactNode;
}

export function ErrorState({ title, description, action }: StateProps) {
  return (
    <div className="oa-panel flex min-h-44 flex-col items-center justify-center px-6 py-10 text-center" role="alert">
      <span className="mb-4 grid h-10 w-10 place-items-center rounded-md border border-danger/30 bg-danger/10 text-danger">
        <AlertTriangle className="h-5 w-5" aria-hidden="true" />
      </span>
      <h2 className="text-base font-semibold text-surface-50">{title}</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-surface-400">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function EmptyState({ title, description, action }: StateProps) {
  return (
    <div className="oa-panel flex min-h-40 flex-col items-center justify-center px-6 py-9 text-center">
      <Inbox className="mb-3 h-6 w-6 text-surface-500" aria-hidden="true" />
      <h2 className="text-sm font-semibold text-surface-200">{title}</h2>
      <p className="mt-1 max-w-lg text-sm text-surface-400">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function RetryButton({ onClick, label = 'Retry' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-surface-600 bg-surface-800 px-3 text-sm font-semibold text-surface-100 transition hover:border-primary-500/60 hover:text-primary-200">
      <RefreshCw className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
}

export function LoadingSurface({ rows = 4, label = 'Loading data' }: { rows?: number; label?: string }) {
  return (
    <div className="oa-panel space-y-3 p-5" role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="oa-skeleton h-10 rounded-md" style={{ opacity: 1 - index * 0.1 }} />
      ))}
    </div>
  );
}

export function DegradedBanner({ messages, onRetry }: { messages: string[]; onRetry: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-warning/30 bg-warning/8 px-4 py-3 text-sm text-warning sm:flex-row sm:items-center sm:justify-between" role="status">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">Some live data is unavailable</p>
          <p className="mt-0.5 text-xs text-surface-300">{messages.join(' · ')}</p>
        </div>
      </div>
      <RetryButton onClick={onRetry} />
    </div>
  );
}

/* eslint-disable react-refresh/only-export-components -- imperative toast API is shared by route actions */
import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import clsx from 'clsx';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

const ICONS = {
  success: CheckCircle,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const STYLES = {
  success: 'bg-success/10 border-success/30 text-success',
  error: 'bg-danger/10 border-danger/30 text-danger',
  warning: 'bg-warning/10 border-warning/30 text-warning',
  info: 'bg-info/10 border-info/30 text-info',
};

let toastId = 0;
let addToastFn: ((message: string, type: ToastType) => void) | null = null;

export function toast(message: string, type: ToastType = 'info') {
  addToastFn?.(message, type);
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((message: string, type: ToastType) => {
    const id = ++toastId;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  useEffect(() => {
    addToastFn = addToast;
    return () => { addToastFn = null; };
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-[100] flex max-h-[calc(100dvh-2rem)] flex-col gap-2 overflow-y-auto sm:left-auto sm:w-96 sm:max-w-[calc(100vw-2rem)]" role="status" aria-live="polite">
      {toasts.map(t => {
        const Icon = ICONS[t.type];
        return (
          <div key={t.id}
            className={clsx('flex min-w-0 shrink-0 items-start gap-3 px-4 py-3 rounded-lg border text-sm animate-in slide-in-from-right', STYLES[t.type])}>
            <Icon className="w-4 h-4 shrink-0" />
            <span className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{t.message}</span>
            <button onClick={() => removeToast(t.id)} aria-label="Dismiss notification"
              className="shrink-0 text-current opacity-60 hover:opacity-100 transition-opacity">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

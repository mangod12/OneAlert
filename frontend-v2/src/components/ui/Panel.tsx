import type { HTMLAttributes, ReactNode } from 'react';
import clsx from 'clsx';

interface PanelProps extends HTMLAttributes<HTMLElement> {
  title?: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}

export function Panel({ title, description, action, children, className, ...props }: PanelProps) {
  return (
    <section className={clsx('oa-panel', className)} {...props}>
      {(title || description || action) && (
        <div className="flex items-start justify-between gap-4 border-b border-surface-800 px-5 py-4">
          <div>
            {title && <h2 className="text-sm font-semibold text-surface-100">{title}</h2>}
            {description && <p className="mt-1 text-xs leading-5 text-surface-400">{description}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

import type { ReactNode } from 'react';

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
  meta?: ReactNode;
}

export function PageHeader({ eyebrow, title, description, actions, meta }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 border-b border-surface-800 pb-5 xl:flex-row xl:items-end xl:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-primary-300">{eyebrow}</p>}
        <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-surface-50 sm:text-[1.75rem]">{title}</h1>
        <p className="mt-1.5 max-w-3xl text-sm leading-6 text-surface-400">{description}</p>
        {meta && <div className="mt-3">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

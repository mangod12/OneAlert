import type { ReactNode } from 'react';
import clsx from 'clsx';

const tones = {
  neutral: 'border-surface-600 bg-surface-700/35 text-surface-300',
  info: 'border-info/30 bg-info/10 text-info',
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  danger: 'border-danger/30 bg-danger/10 text-danger',
};

export function StatusBadge({ children, tone = 'neutral' }: { children: ReactNode; tone?: keyof typeof tones }) {
  return <span className={clsx('inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide border', tones[tone])}>{children}</span>;
}

import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';

interface KPICardProps {
  title: string;
  value: number | string;
  icon: LucideIcon;
  color: 'info' | 'danger' | 'success' | 'warning';
  detail?: string;
}

const colorMap = {
  info: 'text-info bg-info/10 border-info/20',
  danger: 'text-danger bg-danger/10 border-danger/20',
  success: 'text-success bg-success/10 border-success/20',
  warning: 'text-warning bg-warning/10 border-warning/20',
};

export function KPICard({ title, value, icon: Icon, color, detail }: KPICardProps) {
  return (
    <div className="oa-panel p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-surface-400">{title}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums text-surface-50 sm:text-3xl">{value}</p>
          {detail && <p className="mt-1 text-[11px] text-surface-500">{detail}</p>}
        </div>
        <div className={clsx('rounded-md border p-2.5', colorMap[color])}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}

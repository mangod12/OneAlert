import type { LucideIcon } from 'lucide-react';
import clsx from 'clsx';

interface KPICardProps {
  title: string;
  value: number;
  icon: LucideIcon;
  color: 'info' | 'danger' | 'success' | 'warning';
}

const colorMap = {
  info: 'text-info bg-info/10 border-info/20',
  danger: 'text-danger bg-danger/10 border-danger/20',
  success: 'text-success bg-success/10 border-success/20',
  warning: 'text-warning bg-warning/10 border-warning/20',
};

export function KPICard({ title, value, icon: Icon, color }: KPICardProps) {
  return (
    <div className="bg-surface-800/50 border border-surface-700 rounded-xl p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-surface-400">{title}</p>
          <p className="text-3xl font-bold text-white mt-1">{value}</p>
        </div>
        <div className={clsx('p-3 rounded-lg border', colorMap[color])}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </div>
  );
}

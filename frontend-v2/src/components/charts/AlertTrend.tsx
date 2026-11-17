import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { Alert } from '../../api/types';
import { chartColors, tooltipStyle } from './theme';

interface Props {
  alerts: Alert[];
}

export function AlertTrend({ alerts }: Props) {
  const data = useMemo(() => {
    const days: Record<string, { critical: number; high: number; medium: number; low: number }> = {};

    // Build 7-day range
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const key = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      days[key] = { critical: 0, high: 0, medium: 0, low: 0 };
    }

    // Bucket alerts by day
    for (const alert of alerts) {
      const created = new Date(alert.created_at);
      const diffDays = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
      if (diffDays >= 0 && diffDays < 7) {
        const key = created.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        if (days[key]) {
          const sev = alert.severity as keyof typeof days[typeof key];
          if (sev in days[key]) {
            days[key][sev]++;
          }
        }
      }
    }

    return Object.entries(days).map(([date, counts]) => ({
      date,
      ...counts,
      total: counts.critical + counts.high + counts.medium + counts.low,
    }));
  }, [alerts]);

  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} vertical={false} />
        <XAxis dataKey="date" stroke={chartColors.axis} fontSize={11} tickLine={false} axisLine={false} />
        <YAxis stroke={chartColors.axis} fontSize={12} allowDecimals={false} tickLine={false} axisLine={false} width={28} />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={{ color: chartColors.tooltipText }}
          cursor={{ fill: 'oklch(90% 0.02 220 / 0.05)' }}
        />
        <Bar dataKey="critical" stackId="a" fill={chartColors.critical} name="Critical" />
        <Bar dataKey="high" stackId="a" fill={chartColors.high} name="High" />
        <Bar dataKey="medium" stackId="a" fill={chartColors.medium} name="Medium" />
        <Bar dataKey="low" stackId="a" fill={chartColors.low} name="Low" />
      </BarChart>
    </ResponsiveContainer>
  );
}

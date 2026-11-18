import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { Alert } from '../../api/types';
import { chartColors, tooltipStyle } from './theme';
import { buildTrendData, formatTimeline } from './trendData';
import type { TimelineDay } from './trendData';

interface Props {
  alerts: Alert[];
  timeline?: TimelineDay[] | null;
}

export function AlertTrend({ alerts, timeline }: Props) {
  const data = useMemo(
    () => (timeline && timeline.length > 0 ? formatTimeline(timeline) : buildTrendData(alerts)),
    [alerts, timeline]
  );
  const totals = data.reduce(
    (acc, day) => ({
      critical: acc.critical + day.critical,
      high: acc.high + day.high,
      medium: acc.medium + day.medium,
      low: acc.low + day.low,
    }),
    { critical: 0, high: 0, medium: 0, low: 0 }
  );
  const summary = `${totals.critical} critical, ${totals.high} high, ${totals.medium} medium, ${totals.low} low`;

  return (
    <div role="img" aria-label={`Alert activity over the last ${data.length} days: ${summary}`}>
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
    </div>
  );
}

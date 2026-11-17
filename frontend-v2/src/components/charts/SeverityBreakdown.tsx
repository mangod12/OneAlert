import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import type { AlertStats } from '../../api/types';
import { chartColors, tooltipStyle } from './theme';

const COLORS = {
  Critical: chartColors.critical,
  High: chartColors.high,
  Medium: chartColors.medium,
  Low: chartColors.low,
};

interface Props {
  stats: AlertStats | null;
}

export function SeverityBreakdown({ stats }: Props) {
  if (!stats) return null;

  const data = [
    { name: 'Critical', value: stats.critical_alerts },
    { name: 'High', value: stats.high_alerts },
    { name: 'Medium', value: stats.medium_alerts },
    { name: 'Low', value: stats.low_alerts },
  ].filter((d) => d.value > 0);

  if (data.length === 0) {
    return <p className="text-surface-500 text-center py-8">No alerts yet</p>;
  }

  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <ResponsiveContainer width="100%" height={250}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="44%"
          innerRadius={60}
          outerRadius={90}
          paddingAngle={4}
          dataKey="value"
        >
          {data.map((entry) => (
            <Cell
              key={entry.name}
              fill={COLORS[entry.name as keyof typeof COLORS]}
            />
          ))}
        </Pie>
        <text x="50%" y="41%" textAnchor="middle" dominantBaseline="middle" className="fill-surface-50" fontSize="26" fontWeight="700">
          {total}
        </text>
        <text x="50%" y="52%" textAnchor="middle" dominantBaseline="middle" className="fill-surface-500" fontSize="11">
          {total === 1 ? 'alert' : 'alerts'}
        </text>
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={{ color: chartColors.tooltipText }}
        />
        <Legend
          formatter={(value) => <span className="text-surface-300 text-sm">{value}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

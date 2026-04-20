import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import type { AlertStats } from '../../api/types';

const COLORS = {
  Critical: '#ef4444',
  High: '#f59e0b',
  Medium: '#3b82f6',
  Low: '#10b981',
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

  return (
    <ResponsiveContainer width="100%" height={250}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
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
        <Tooltip
          contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }}
          labelStyle={{ color: '#f1f5f9' }}
        />
        <Legend
          formatter={(value) => <span className="text-surface-300 text-sm">{value}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

import type { Alert } from '../../api/types';

export interface TrendDay {
  date: string;
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
}

// Buckets alerts into the trailing 7-day window, grouped by severity per day.
export function buildTrendData(alerts: Alert[], now: Date = new Date()): TrendDay[] {
  const days: Record<string, { critical: number; high: number; medium: number; low: number }> = {};

  for (let i = 6; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const key = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    days[key] = { critical: 0, high: 0, medium: 0, low: 0 };
  }

  for (const alert of alerts) {
    const created = new Date(alert.created_at);
    const diffDays = Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays >= 0 && diffDays < 7) {
      const key = created.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      if (days[key]) {
        const sev = alert.severity as keyof (typeof days)[typeof key];
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
}

export interface TimelineDay {
  date: string; // ISO yyyy-mm-dd
  critical: number;
  high: number;
  medium: number;
  low: number;
}

// Formats server-supplied per-day counts into chart rows with display labels.
export function formatTimeline(days: TimelineDay[]): TrendDay[] {
  return days.map(day => ({
    date: new Date(`${day.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
    critical: day.critical,
    high: day.high,
    medium: day.medium,
    low: day.low,
    total: day.critical + day.high + day.medium + day.low,
  }));
}

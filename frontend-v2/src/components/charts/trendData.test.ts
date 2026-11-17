import { describe, expect, it } from 'vitest';

import type { Alert } from '../../api/types';
import { buildTrendData } from './trendData';

const NOW = new Date('2026-11-17T12:00:00');

function alertOn(daysAgo: number, severity: string): Alert {
  const created = new Date(NOW);
  created.setDate(created.getDate() - daysAgo);
  return { created_at: created.toISOString(), severity } as Alert;
}

describe('buildTrendData', () => {
  it('always returns 7 day buckets', () => {
    expect(buildTrendData([], NOW)).toHaveLength(7);
  });

  it('counts alerts by severity per day', () => {
    const data = buildTrendData([
      alertOn(0, 'critical'),
      alertOn(0, 'critical'),
      alertOn(0, 'high'),
      alertOn(2, 'medium'),
    ], NOW);
    const today = data[6];
    expect(today.critical).toBe(2);
    expect(today.high).toBe(1);
    expect(today.total).toBe(3);
    expect(data[4].medium).toBe(1);
  });

  it('ignores alerts older than 7 days', () => {
    const data = buildTrendData([alertOn(8, 'critical'), alertOn(30, 'high')], NOW);
    expect(data.reduce((sum, d) => sum + d.total, 0)).toBe(0);
  });

  it('orders buckets oldest to newest', () => {
    const data = buildTrendData([], NOW);
    const todayKey = NOW.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    expect(data[6].date).toBe(todayKey);
  });
});

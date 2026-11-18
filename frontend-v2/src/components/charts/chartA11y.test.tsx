import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Alert, AlertStats } from '../../api/types';
import { AlertTrend } from './AlertTrend';
import { SeverityBreakdown } from './SeverityBreakdown';

afterEach(cleanup);

const STATS: AlertStats = {
  total_alerts: 8,
  critical_alerts: 2,
  high_alerts: 3,
  medium_alerts: 2,
  low_alerts: 1,
  pending_alerts: 4,
  acknowledged_alerts: 1,
};

function makeAlert(severity: Alert['severity'], createdAt: string): Alert {
  return {
    id: 1, user_id: 5, cve_id: 'CVE-2026-0001', title: 't', description: 'd', severity,
    status: 'pending', source: 'NVD', cvss_score: null, asset_id: 1,
    asset_name: 'a', asset_vendor: 'v', asset_product: 'p', remediation: null,
    created_at: createdAt, acknowledged_at: null, assigned_to_id: null, assigned_to_email: null,
  };
}

describe('chart text alternatives', () => {
  it('SeverityBreakdown exposes the distribution to assistive technology', () => {
    render(<SeverityBreakdown stats={STATS} />);
    const chart = screen.getByRole('img', { name: /alert severity distribution/i });
    expect(chart.getAttribute('aria-label')).toBe(
      'Alert severity distribution: 2 critical, 3 high, 2 medium, 1 low'
    );
  });

  it('AlertTrend exposes the 7-day totals to assistive technology', () => {
    const now = new Date().toISOString();
    const alerts = [makeAlert('critical', now), makeAlert('high', now), makeAlert('high', now)];
    render(<AlertTrend alerts={alerts} />);
    const chart = screen.getByRole('img', { name: /alert activity over the last 7 days/i });
    expect(chart.getAttribute('aria-label')).toContain('1 critical, 2 high, 0 medium, 0 low');
  });
});

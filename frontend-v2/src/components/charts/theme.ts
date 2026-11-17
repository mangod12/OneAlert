// Colors for recharts elements, resolved from the design tokens in index.css
// so charts stay in sync with the theme instead of hardcoded hex values.
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export const chartColors = {
  critical: cssVar('--color-danger', '#ef4444'),
  high: cssVar('--color-warning', '#f59e0b'),
  medium: cssVar('--color-info', '#3b82f6'),
  low: cssVar('--color-success', '#10b981'),
  grid: cssVar('--color-surface-700', '#334155'),
  axis: cssVar('--color-surface-500', '#94a3b8'),
  tooltipBg: cssVar('--color-surface-800', '#1e293b'),
  tooltipBorder: cssVar('--color-surface-600', '#334155'),
  tooltipText: cssVar('--color-surface-50', '#f1f5f9'),
};

export const tooltipStyle = {
  backgroundColor: chartColors.tooltipBg,
  border: `1px solid ${chartColors.tooltipBorder}`,
  borderRadius: '8px',
} as const;

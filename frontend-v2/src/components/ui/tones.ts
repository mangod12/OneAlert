import type { ComponentProps } from 'react';
import type { StatusBadge } from './StatusBadge';

export type BadgeTone = ComponentProps<typeof StatusBadge>['tone'];

export const alertSeverityTones: Record<string, BadgeTone> = {
  critical: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'success',
};

export const eventSeverityTones: Record<string, BadgeTone> = {
  critical: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
  info: 'neutral',
};

export const alertStatusTones: Record<string, BadgeTone> = {
  pending: 'warning',
  acknowledged: 'info',
  resolved: 'success',
};

export const caseStatusTones: Record<string, BadgeTone> = {
  open: 'warning',
  investigating: 'info',
  resolved: 'success',
  closed: 'neutral',
};

export const criticalityTones: Record<string, BadgeTone> = {
  high: 'danger',
  medium: 'warning',
  low: 'success',
};

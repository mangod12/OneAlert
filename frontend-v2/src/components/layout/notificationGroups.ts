import type { AppNotification } from './NotificationBell';

export interface NotificationGroup {
  key: string;
  items: AppNotification[];
}

/** Collapse runs of consecutive notifications with the same kind + link. */
export function groupNotifications(items: AppNotification[]): NotificationGroup[] {
  const groups: NotificationGroup[] = [];
  for (const item of items) {
    const key = `${item.kind}|${item.link ?? ''}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, items: [item] });
  }
  return groups;
}

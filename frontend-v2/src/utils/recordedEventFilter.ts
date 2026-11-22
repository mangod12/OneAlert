export const recordedEventFields = ['username', 'hostname', 'domain', 'action'] as const;
export type RecordedEventField = typeof recordedEventFields[number];
export interface RecordedEventFilter { field: RecordedEventField; value: string }
export function recordedEventFilter(field: unknown, value: unknown): RecordedEventFilter | null {
  if (field === undefined && value === undefined) return null;
  if (!recordedEventFields.includes(field as RecordedEventField) || typeof value !== 'string' || !value.trim() || Array.from(value).length > 1024 || /[\uD800-\uDFFF]/u.test(value) || value.includes(String.fromCharCode(0))) throw Error('Use one supported recorded field and nonblank exact text of at most 1,024 characters. No unfiltered read was substituted.');
  return { field: field as RecordedEventField, value };
}
export function recordedEventFilterLink(field: RecordedEventField, value: string) {
  const checked = recordedEventFilter(field, value)!;
  return `/app/events?${new URLSearchParams({ recorded_field: checked.field, recorded_value: checked.value })}`;
}

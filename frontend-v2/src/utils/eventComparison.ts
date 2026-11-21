export const eventComparisonFields = ['source_id', 'timestamp', 'event_type', 'severity', 'signature', 'signature_id', 'category', 'source_ip', 'source_port', 'dest_ip', 'dest_port', 'protocol', 'action', 'hostname', 'username', 'domain', 'url', 'user_agent', 'source_type', 'processed', 'created_at', 'bytes_in', 'bytes_out'] as const;
export type ComparedField = typeof eventComparisonFields[number];
export interface ComparedEvent { id: number; [key: string]: unknown }
export interface ComparedSnapshot { event: ComparedEvent; retrieved_at: string }
const validTime = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function validComparedSnapshot(value: unknown, id: number): value is ComparedSnapshot {
  if (!value || typeof value !== 'object') return false;
  const { event, retrieved_at } = value as ComparedSnapshot;
  if (!event || typeof event !== 'object' || event.id !== id || !validTime(retrieved_at)) return false;
  return eventComparisonFields.every(field => {
    const item = event[field];
    if (field === 'timestamp' || field === 'created_at') return validTime(item);
    if (field === 'source_id') return item === null || (Number.isSafeInteger(item) && Number(item) > 0);
    if (field === 'source_port' || field === 'dest_port') return item === null || (Number.isSafeInteger(item) && Number(item) >= 0 && Number(item) <= 65535);
    if (field === 'bytes_in' || field === 'bytes_out') return item === null || (typeof item === 'string' && /^-?[0-9]+$/.test(item));
    if (field === 'event_type') return typeof item === 'string';
    return item === null || typeof item === 'string';
  });
}
export function comparedValue(value: unknown): string {
  return value === null ? '(not recorded)' : value === '' ? '(empty text)' : String(value);
}

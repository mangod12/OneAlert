export interface WatchedRemovalRow { kind: 'alert' | 'case'; id: number; name: string; detail: string | null; severity: string; status: string; created_at: string; due_date: string | null; href: string }
export function watchKey(row: Pick<WatchedRemovalRow, 'kind' | 'id'>) { return `${row.kind}-${row.id}`; }
export function watchPath(row: Pick<WatchedRemovalRow, 'kind' | 'id'>) { return row.kind === 'alert' ? `/alerts/${row.id}` : `/cases/${row.id}`; }
export function checkedWatchRecord(row: WatchedRemovalRow, value: unknown) {
  const current = value as Record<string, unknown> | null;
  if (!current || current.id !== row.id || typeof current.title !== 'string' || (row.kind === 'alert' && current.cve_id ? `${current.cve_id} - ${current.title}` : current.title) !== row.name || current.severity !== row.severity || current.status !== row.status || current.created_at !== row.created_at || (row.kind === 'case' && current.due_date !== row.due_date)) throw Error('The reviewed watched record changed.');
}
export function checkedWatchMembership(value: unknown, userId: number) {
  if (!Array.isArray(value) || !value.every(row => row && Number.isSafeInteger(row.user_id) && row.user_id > 0) || new Set(value.map(row => row.user_id)).size !== value.length || !value.some(row => row.user_id === userId)) throw Error('Current watch membership could not be verified.');
}
export function checkedUnwatchResult(status: number, value: unknown) {
  const result = value as Record<string, unknown> | null;
  if (status !== 200 || result?.success !== true || result.watching !== false) throw Error('Unwatch outcome is unknown.');
}
export function checkedRemovalRows(rows: WatchedRemovalRow[]) {
  if (!rows.length || new Set(rows.map(watchKey)).size !== rows.length || rows.some(row => !['alert', 'case'].includes(row.kind) || !Number.isSafeInteger(row.id) || row.id < 1 || typeof row.name !== 'string' || !row.name.trim() || !['critical', 'high', 'medium', 'low', 'info'].includes(row.severity) || typeof row.status !== 'string' || !row.status || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at)))) throw Error('Exact loaded records could not be verified.');
  return rows.map(row => ({ ...row }));
}

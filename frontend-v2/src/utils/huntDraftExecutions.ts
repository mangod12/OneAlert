import { parseHuntQueryDraft, type HuntQueryDraft } from './huntQueryDraft';
export interface DraftExecutionReceipt {
  session_id: number; status: string; created_at: string | null; receipt_supported: boolean;
  query_numbers: number[] | null; agent_run_id: number | null;
  recorded_queries_run: number | null; recorded_row_count: number | null;
}
export interface DraftExecutionPage {
  source_session_id: number; source_fingerprint: string; read_at: string;
  offset: number; limit: number; total: number; executions: DraftExecutionReceipt[]; scope: string;
}
const id = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 2147483647;
const count = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
export function parseDraftExecutionPage(value: unknown, sourceValue: HuntQueryDraft, offset: number, limit: number): DraftExecutionPage {
  const source = parseHuntQueryDraft(sourceValue), page = value as DraftExecutionPage;
  const invalid = () => { throw Error('Saved execution receipts did not match this exact draft, fingerprint and requested page. No replacement or query execution was requested.'); };
  if (!page || page.source_session_id !== source.session_id || page.source_fingerprint !== source.fingerprint || page.offset !== offset || page.limit !== limit || !count(offset) || offset > 10000 || !Number.isInteger(limit) || limit < 1 || limit > 20 || !count(page.total) || typeof page.read_at !== 'string' || page.read_at.length > 80 || !/(Z|[+-]\d{2}:\d{2})$/.test(page.read_at) || !Number.isFinite(Date.parse(page.read_at)) || typeof page.scope !== 'string' || !page.scope || page.scope.length > 4000 || !Array.isArray(page.executions) || page.executions.length > limit || page.executions.length > Math.max(0, page.total - offset)) invalid();
  const seen = new Set<number>();
  for (const [index, row] of page.executions.entries()) {
    if (!row || !id(row.session_id) || seen.has(row.session_id) || (index > 0 && row.session_id >= page.executions[index - 1].session_id) || !['completed', 'partial', 'failed', 'running', 'prepared', 'unsupported'].includes(row.status) || (row.created_at !== null && (typeof row.created_at !== 'string' || !row.created_at || row.created_at.length > 80)) || typeof row.receipt_supported !== 'boolean' || (row.agent_run_id !== null && !id(row.agent_run_id)) || [row.recorded_queries_run, row.recorded_row_count].some(value => value !== null && !count(value))) invalid();
    if (row.receipt_supported) {
      if (row.session_id === source.session_id || !['completed', 'partial', 'failed'].includes(row.status) || !Array.isArray(row.query_numbers) || row.query_numbers.length < 1 || row.query_numbers.length > 3 || row.query_numbers.some((number, index, values) => !Number.isInteger(number) || !source.draft.queries[number - 1]?.accepted || (index > 0 && number <= values[index - 1]))) invalid();
    } else if (row.query_numbers !== null) invalid();
    seen.add(row.session_id);
  }
  return page;
}
export function draftExecutionPageJson(page: DraftExecutionPage, source: HuntQueryDraft, exportedAt: string): string {
  if (!Number.isFinite(Date.parse(exportedAt))) throw Error('A valid export time is required.');
  const checked = parseDraftExecutionPage(page, source, page.offset, page.limit);
  return JSON.stringify({ format: 'onealert_hunt_draft_execution_receipts_v1', exported_at: exportedAt,
    source_session_id: checked.source_session_id, source_fingerprint: checked.source_fingerprint,
    read_at: checked.read_at, offset: checked.offset, limit: checked.limit, total: checked.total, scope: checked.scope,
    executions: checked.executions.map(row => ({ session_id: row.session_id, status: row.status, created_at: row.created_at,
      receipt_supported: row.receipt_supported, query_numbers: row.query_numbers, agent_run_id: row.agent_run_id,
      recorded_queries_run: row.recorded_queries_run, recorded_row_count: row.recorded_row_count })),
    download_scope: 'Only this loaded metadata page, not every saved receipt. No SQL, query parameters or retained event rows. IDs, counts, statuses and selected positions can still be sensitive. Keep private; downloaded copies have no application access controls. No extra read, execution or sharing. An empty page or missing saved receipt does not prove no database query ran. Open exact saved records and their audits before retrying an uncertain execution.' }, null, 2) + '\n';
}

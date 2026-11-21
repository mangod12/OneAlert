export type Source = { key: string; kind: 'case' | 'alert' | 'event'; id: number; title?: string; label?: string; summary?: string; severity?: string | null; status?: string | null; recorded_at?: string | null };
type Scope = { linked: number; available: number; included: number; omitted: number; unavailable: number; limit: number };
interface Briefing {
  format: string; version: number; case_id: number; run_id: number; mode: string; captured_at: string;
  observations: { text: string; sources: string[] }[]; gaps: string[]; review_questions: string[];
  sources: Source[]; scope: { alert: Scope; event: Scope };
}
export interface SavedBriefing { timeline_id: number; briefing: Briefing }
const positive = (id: unknown): id is number => typeof id === 'number' && Number.isSafeInteger(id) && id > 0;
export function verifySavedBriefing(value: SavedBriefing, caseId: number) {
  const b = value?.briefing;
  return positive(value?.timeline_id) && b?.format === 'onealert-case-briefing' && b.version === 1 && b.case_id === caseId
    && positive(b.run_id) && ['ai_draft', 'recorded_metadata_fallback'].includes(b.mode)
    && typeof b.captured_at === 'string' && Number.isFinite(Date.parse(b.captured_at))
    && Array.isArray(b.sources) && b.sources.length <= 71 && b.sources.every(s => s && positive(s.id)
      && ['case', 'alert', 'event'].includes(s.kind) && s.key === `${s.kind}:${s.id}`
      && (s.kind !== 'case' || s.id === caseId)
      && [s.title, s.label, s.summary].every(t => t === undefined || typeof t === 'string')
      && [s.severity, s.status, s.recorded_at].every(t => t === undefined || t === null || typeof t === 'string'))
    && Array.isArray(b.observations) && b.observations.length > 0 && b.observations.length <= 12
    && b.observations.every(o => o && typeof o.text === 'string' && o.text.length <= 400 && Array.isArray(o.sources)
      && o.sources.length > 0 && o.sources.length <= 5 && o.sources.every(key => b.sources.some(s => s.key === key)))
    && [b.gaps, b.review_questions].every(items => Array.isArray(items) && items.length <= 6
      && items.every(t => typeof t === 'string' && t.length <= 400))
    && [b.scope?.alert, b.scope?.event].every(scope => scope && ['linked', 'available', 'included', 'omitted', 'unavailable', 'limit']
      .every(key => Number.isSafeInteger(scope[key as keyof Scope]) && scope[key as keyof Scope] >= 0)
      && scope.linked === scope.available + scope.unavailable && scope.available === scope.included + scope.omitted)
    && b.sources.filter(s => s.kind === 'case').length === 1
    && b.scope.alert.included <= 20 && b.scope.event.included <= 50
    && (['alert', 'event'] as const).every(kind => b.sources.filter(s => s.kind === kind).length === b.scope[kind].included);
}
export function briefingEvidencePayload(row: SavedBriefing, readAt: string, exportedAt: string) {
  const { briefing: b, timeline_id } = row;
  const scope = ({ linked, available, included, omitted, unavailable, limit }: Scope) => ({ linked, available, included, omitted, unavailable, limit });
  return {
    format: 'onealert-case-briefing-evidence', version: 1, case_id: b.case_id, read_at: readAt, exported_at: exportedAt,
    scope: 'Selected saved draft and its recorded shortened AI inputs. Not refreshed source records, a full transcript, verified interpretation or proof of a security action. Keep private; downloaded copies have no application access controls.',
    record: { timeline_id, briefing: { format: b.format, version: b.version, case_id: b.case_id, run_id: b.run_id,
      mode: b.mode, captured_at: b.captured_at, scope: { alert: scope(b.scope.alert), event: scope(b.scope.event) },
      observations: b.observations.map(({ text, sources }) => ({ text, sources: [...sources] })),
      gaps: [...b.gaps], review_questions: [...b.review_questions], sources: b.sources.map(({ key, kind, id, title, label, summary, severity, status, recorded_at }) => ({ key, kind, id, title, label, summary, severity, status, recorded_at })),
    } },
  };
}

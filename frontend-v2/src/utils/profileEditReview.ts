export interface ReviewedProfile { id: number; email: string; role: string; org_id: number | null; full_name: string | null; company: string | null; is_active: true; is_verified: boolean; mfa_enabled: boolean; created_at: string; updated_at: string | null }
export interface ProfileDraft { full_name: string; company: string }
const fail = () => Error('Complete current profile could not be verified.');
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const nullableText = (value: unknown): value is string | null => value === null || typeof value === 'string' && value.length <= 10000;
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
export function checkedProfile(value: unknown): ReviewedProfile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail();
  const row = value as Record<string, unknown>;
  if (!positive(row.id) || typeof row.email !== 'string' || !row.email.trim() || !['admin', 'analyst', 'viewer'].includes(row.role as string) || row.org_id !== null && !positive(row.org_id) || row.is_active !== true || typeof row.is_verified !== 'boolean' || row.mfa_enabled !== null && typeof row.mfa_enabled !== 'boolean' || !nullableText(row.full_name) || !nullableText(row.company) || !date(row.created_at) || row.updated_at !== null && !date(row.updated_at)) throw fail();
  return { id: row.id, email: row.email, role: row.role as string, org_id: row.org_id as number | null, full_name: row.full_name as string | null, company: row.company as string | null, is_active: true, is_verified: row.is_verified, mfa_enabled: row.mfa_enabled === true, created_at: row.created_at, updated_at: row.updated_at as string | null };
}
export function checkedProfileDraft(draft: ProfileDraft): ProfileDraft {
  const values = [draft.full_name, draft.company];
  if (values.some(value => typeof value !== 'string' || value.length > 1000 || Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))) throw fail();
  return { full_name: draft.full_name.trim(), company: draft.company.trim() };
}
export const sameProfile = (a: ReviewedProfile, b: ReviewedProfile) => JSON.stringify(a) === JSON.stringify(b);
export const sameProfileIdentity = (a: ReviewedProfile, b: ReviewedProfile) => a.id === b.id && a.email === b.email && a.role === b.role && a.org_id === b.org_id && a.is_active === b.is_active && a.is_verified === b.is_verified && a.mfa_enabled === b.mfa_enabled && a.created_at === b.created_at;
export const unchangedProfileDraft = (before: ReviewedProfile, draft: ProfileDraft) => before.full_name === (draft.full_name || null) && before.company === (draft.company || null);
export function checkedProfileResult(before: ReviewedProfile, response: unknown, postread: unknown, draft: ProfileDraft): ReviewedProfile {
  const result = checkedProfile(response), after = checkedProfile(postread);
  if (!sameProfileIdentity(before, result) || !sameProfileIdentity(before, after) || !sameProfile(result, after) || result.full_name !== (draft.full_name || null) || result.company !== (draft.company || null)) throw fail();
  return after;
}

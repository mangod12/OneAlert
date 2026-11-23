export interface OrganizationIdentity { id: number; name: string; slug: string; plan: string; max_users: number; max_assets: number; created_at: string }
export interface OrganizationSnapshot { userId: number; email: string; role: string; org: OrganizationIdentity | null }
const fail = () => Error('Current account and organization could not be verified.');
const record = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(); return value as Record<string, unknown>; };
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 1000;
export function checkedOrganization(value: unknown): OrganizationIdentity {
  const row = record(value);
  if (!positive(row.id) || !text(row.name) || !text(row.slug) || !text(row.plan) || !positive(row.max_users) || !positive(row.max_assets) || !text(row.created_at) || !Number.isFinite(Date.parse(row.created_at))) throw fail();
  return { id: row.id, name: row.name, slug: row.slug, plan: row.plan, max_users: row.max_users, max_assets: row.max_assets, created_at: row.created_at };
}
export function checkedOrganizationSnapshot(identity: unknown, organization: unknown): OrganizationSnapshot {
  const who = record(identity);
  if (!positive(who.id) || !text(who.email) || who.is_active !== true || !['admin', 'analyst', 'viewer'].includes(who.role as string) || who.org_id !== null && !positive(who.org_id)) throw fail();
  const org = who.org_id === null ? null : checkedOrganization(organization);
  if (who.org_id === null && organization !== null || org && org.id !== who.org_id) throw fail();
  return { userId: who.id, email: who.email, role: who.role as string, org };
}
export function organizationName(value: string) { const name = value.trim(); if (!text(name) || Array.from(name).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw fail(); return name; }
export function organizationSlug(value: string) { const slug = value.trim().toLowerCase(); if (slug.length > 100 || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw fail(); return slug; }
export const sameOrganization = (a: OrganizationIdentity | null, b: OrganizationIdentity | null) => JSON.stringify(a) === JSON.stringify(b);
export const sameOrganizationSnapshot = (a: OrganizationSnapshot, b: OrganizationSnapshot) => a.userId === b.userId && a.email === b.email && a.role === b.role && sameOrganization(a.org, b.org);
export function checkedOrganizationResult(before: OrganizationSnapshot, after: OrganizationSnapshot, response: unknown, name: string, slug?: string) {
  const result = checkedOrganization(response);
  if (after.userId !== before.userId || after.email !== before.email || !after.org || !sameOrganization(result, after.org) || result.name !== name) throw fail();
  if (before.org) {
    if (before.role !== 'admin' || after.role !== before.role || !sameOrganization({ ...before.org, name }, result)) throw fail();
  } else if (after.role !== 'admin' || result.slug !== slug || result.plan !== 'free') throw fail();
  return after;
}

export interface TeamMember { id: number; email: string; full_name: string | null; is_active: boolean; role: string; org_id: number }
export interface TeamSnapshot { userId: number; role: string; org: { id: number; name: string; slug: string; max_users: number }; members: TeamMember[] }
export type MembershipProposal = { kind: 'add'; email: string } | { kind: 'remove'; target: TeamMember };
const fail = () => Error('Complete current account, organization and membership could not be verified.');
const record = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(); return value as Record<string, unknown>; };
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const text = (value: unknown, max = 1000): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const role = (value: unknown): value is string => ['admin', 'analyst', 'viewer'].includes(value as string);
export function membershipEmail(value: string): string {
  const email = value.trim();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail();
  return email; // Preserve case: the existing server lookup compares the entered email exactly.
}
export function checkedTeamSnapshot(identity: unknown, organization: unknown, roster: unknown): TeamSnapshot {
  const who = record(identity), org = record(organization);
  if (!positive(who.id) || !positive(who.org_id) || who.is_active !== true || !role(who.role) || org.id !== who.org_id || !text(org.name) || !text(org.slug) || !positive(org.max_users) || !Array.isArray(roster) || roster.length > 10000) throw fail();
  const members = roster.map(value => {
    const row = record(value);
    if (!positive(row.id) || !text(row.email, 254) || row.full_name !== null && !text(row.full_name) || typeof row.is_active !== 'boolean' || !role(row.role) || row.org_id !== org.id) throw fail();
    return { id: row.id, email: row.email, full_name: row.full_name as string | null, is_active: row.is_active, role: row.role, org_id: row.org_id as number };
  });
  if (new Set(members.map(member => member.id)).size !== members.length || new Set(members.map(member => member.email)).size !== members.length || !members.some(member => member.id === who.id && member.role === who.role && member.is_active)) throw fail();
  return { userId: who.id, role: who.role, org: { id: org.id as number, name: org.name, slug: org.slug, max_users: org.max_users }, members };
}
export const sameTeamMember = (a: TeamMember, b: TeamMember) => a.id === b.id && a.email === b.email && a.full_name === b.full_name && a.is_active === b.is_active && a.role === b.role && a.org_id === b.org_id;
export const sameTeamAccess = (a: TeamSnapshot, b: TeamSnapshot) => a.userId === b.userId && a.role === b.role && a.org.id === b.org.id && a.org.name === b.org.name && a.org.slug === b.org.slug && a.org.max_users === b.org.max_users;
export function sameTeamBaseline(a: TeamSnapshot, b: TeamSnapshot) { return sameTeamAccess(a, b) && a.members.length === b.members.length && a.members.every(member => b.members.some(other => sameTeamMember(member, other))); }
export function checkedMembershipProposal(proposal: MembershipProposal, snapshot: TeamSnapshot): MembershipProposal {
  if (snapshot.role !== 'admin') throw fail();
  if (proposal.kind === 'add') {
    const email = membershipEmail(proposal.email);
    if (snapshot.members.length >= snapshot.org.max_users || snapshot.members.some(member => member.email === email)) throw fail();
    return { kind: 'add', email };
  }
  const target = snapshot.members.find(member => sameTeamMember(member, proposal.target));
  if (!target || target.id === snapshot.userId || target.role === 'admin' && snapshot.members.filter(member => member.role === 'admin').length <= 1) throw fail();
  return { kind: 'remove', target: { ...target } };
}
export function checkedMembershipResult(before: TeamSnapshot, after: TeamSnapshot, proposal: MembershipProposal): TeamMember | null {
  if (!sameTeamAccess(before, after)) throw fail();
  if (proposal.kind === 'add') {
    const additions = after.members.filter(member => !before.members.some(old => old.id === member.id));
    if (additions.length !== 1 || additions[0].email !== proposal.email || after.members.length !== before.members.length + 1 || !before.members.every(member => after.members.some(other => sameTeamMember(member, other)))) throw fail();
    return additions[0];
  }
  if (after.members.length !== before.members.length - 1 || after.members.some(member => member.id === proposal.target.id) || !after.members.every(member => before.members.some(old => sameTeamMember(member, old)))) throw fail();
  return null;
}

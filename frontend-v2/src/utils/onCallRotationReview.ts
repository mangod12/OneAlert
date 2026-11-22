export interface RotationMember { id: number; email: string; full_name: string | null; is_active: boolean }
export interface SavedRotation { member_ids: number[]; anchor_date: string | null; current_member_id: number | null }
export interface RotationSnapshot { userId: number; orgId: number; role: string; rotation: SavedRotation; members: RotationMember[] }
const fail = () => Error('The complete saved rotation, organization access or roster could not be verified.');
const record = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail(); return value as Record<string, unknown>; };
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 1000 && !/[\uD800-\uDFFF]/u.test(value);
export const rotationDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
export function checkedRotation(value: unknown): SavedRotation {
  const raw = record(value);
  if (!Array.isArray(raw.member_ids) || raw.member_ids.length > 1000 || raw.member_ids.some(id => !positive(id)) || new Set(raw.member_ids).size !== raw.member_ids.length || (raw.member_ids.length ? !rotationDay(raw.anchor_date) : raw.anchor_date !== null || raw.current_member_id !== null) || raw.current_member_id !== null && (!positive(raw.current_member_id) || !raw.member_ids.includes(raw.current_member_id))) throw fail();
  return { member_ids: [...raw.member_ids], anchor_date: raw.anchor_date as string | null, current_member_id: raw.current_member_id as number | null };
}
export function checkedRotationSnapshot(identity: unknown, roster: unknown, rotation: unknown): RotationSnapshot {
  const user = record(identity), saved = checkedRotation(rotation);
  if (!positive(user.id) || !positive(user.org_id) || user.is_active !== true || !['admin', 'analyst', 'viewer'].includes(user.role as string) || !Array.isArray(roster) || roster.length > 1000) throw fail();
  const members = roster.map(value => { const row = record(value); if (!positive(row.id) || !text(row.email) || row.full_name !== null && !text(row.full_name) || typeof row.is_active !== 'boolean') throw fail(); return { id: row.id, email: row.email, full_name: row.full_name as string | null, is_active: row.is_active }; });
  if (new Set(members.map(member => member.id)).size !== members.length || !members.some(member => member.id === user.id && member.is_active) || saved.current_member_id !== null && !members.some(member => member.id === saved.current_member_id && member.is_active)) throw fail();
  return { userId: user.id, orgId: user.org_id, role: user.role as string, members, rotation: saved };
}
export const sameRotationOrder = (a: number[], b: number[]) => a.length === b.length && a.every((id, index) => id === b[index]);
export function sameRotationBaseline(a: RotationSnapshot, b: RotationSnapshot) {
  // Current on-call selection can advance at a UTC handoff without a configuration edit.
  const roster = (snapshot: RotationSnapshot) => [...snapshot.members].sort((x, y) => x.id - y.id).map(member => [member.id, member.email, member.full_name, member.is_active]);
  return a.userId === b.userId && a.orgId === b.orgId && a.role === b.role && a.rotation.anchor_date === b.rotation.anchor_date && sameRotationOrder(a.rotation.member_ids, b.rotation.member_ids) && JSON.stringify(roster(a)) === JSON.stringify(roster(b));
}
export function checkedRotationDraft(ids: number[], snapshot: RotationSnapshot): number[] {
  if (!Array.isArray(ids) || ids.length > 1000 || ids.some(id => !positive(id) || !snapshot.members.some(member => member.id === id && member.is_active)) || new Set(ids).size !== ids.length) throw fail();
  return [...ids];
}
export function checkedRotationSave(value: unknown, proposed: number[], before: RotationSnapshot): SavedRotation {
  const saved = checkedRotation(value);
  if (!sameRotationOrder(saved.member_ids, proposed)) throw fail();
  if (saved.current_member_id !== null && !before.members.some(member => member.id === saved.current_member_id && member.is_active)) throw fail();
  return saved;
}
export const rotationMemberName = (snapshot: RotationSnapshot, id: number) => { const member = snapshot.members.find(row => row.id === id); return member ? `${member.full_name || member.email} · Member #${id}${member.is_active ? '' : ' (inactive)'}` : `Member #${id} (not in current roster)`; };

export interface AccessPerson {
  id: number; email: string; full_name: string | null; role: string; org_id: number | null; is_active: boolean;
  reasons: string[]; can_manage_investigation: boolean; can_manage_checklist: boolean; can_add_notes: boolean;
  receives_watcher_updates: boolean; assigned_tasks: Array<{ id: number; title: string; done: boolean }>;
}
export interface AccessSnapshot { case_id: number; owner_id: number; title: string; retrieved_at: string; records: AccessPerson[] }
export interface AccessChange { id: number; kind: 'added' | 'removed' | 'changed'; before: AccessPerson | null; after: AccessPerson | null; details: string[] }
function signature(person: AccessPerson) {
  return JSON.stringify({ ...person, reasons: [...person.reasons].sort(), assigned_tasks: [...person.assigned_tasks].sort((a, b) => a.id - b.id) });
}
export function compareAccessSnapshots(before: AccessSnapshot, after: AccessSnapshot): AccessChange[] {
  if (before.case_id !== after.case_id || before.owner_id !== after.owner_id) throw Error('Different investigation scope');
  const previous = new Map(before.records.map(person => [person.id, person])), current = new Map(after.records.map(person => [person.id, person]));
  return [...new Set([...previous.keys(), ...current.keys()])].sort((a, b) => a - b).flatMap<AccessChange>(id => {
    const left = previous.get(id), right = current.get(id);
    if (!left && right) return [{ id, kind: 'added' as const, before: null, after: right, details: ['Account now has a saved access relationship.'] }];
    if (left && !right) return [{ id, kind: 'removed' as const, before: left, after: null, details: ['No saved access relationship in the latest complete map. Earlier copies and notifications are not retracted.'] }];
    if (!left || !right || signature(left) === signature(right)) return [];
    const details: string[] = [];
    if (JSON.stringify([...left.reasons].sort()) !== JSON.stringify([...right.reasons].sort())) details.push(`Access reasons: ${left.reasons.join(', ')} → ${right.reasons.join(', ')}`);
    if (left.email !== right.email || left.full_name !== right.full_name || left.role !== right.role || left.org_id !== right.org_id) details.push('Saved account identity or organization changed.');
    if (left.is_active !== right.is_active) details.push(`Account status: ${left.is_active ? 'Active' : 'Inactive'} → ${right.is_active ? 'Active' : 'Inactive'}`);
    if (left.can_manage_investigation !== right.can_manage_investigation || left.can_manage_checklist !== right.can_manage_checklist || left.can_add_notes !== right.can_add_notes) details.push('Saved action permissions changed.');
    if (left.receives_watcher_updates !== right.receives_watcher_updates) details.push(`Watcher audience: ${left.receives_watcher_updates ? 'Included' : 'Not included'} → ${right.receives_watcher_updates ? 'Included' : 'Not included'}`);
    const tasks = (person: AccessPerson) => JSON.stringify([...person.assigned_tasks].sort((a, b) => a.id - b.id));
    if (tasks(left) !== tasks(right)) details.push('Assigned task records changed, including title, completion or task membership.');
    return [{ id, kind: 'changed' as const, before: left, after: right, details }];
  });
}

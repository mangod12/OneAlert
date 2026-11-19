import { useState, type ReactNode } from 'react';

export interface WorkloadRecord {
  user_id: number;
  email: string;
  full_name: string | null;
  alerts_open: number;
  alerts_overdue: number;
  cases_open: number;
  cases_overdue: number;
  tasks_open: number;
  tasks_overdue: number;
}
const open = (member: WorkloadRecord) => member.alerts_open + member.cases_open + member.tasks_open;
const overdue = (member: WorkloadRecord) => member.alerts_overdue + member.cases_overdue + member.tasks_overdue;

export function WorkloadExplorer<T extends WorkloadRecord>({ members, generatedAt, children }: {
  members: T[];
  generatedAt: string;
  children: (member: T) => ReactNode;
}) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('all');
  const [sort, setSort] = useState('recorded');
  const needle = query.trim().toLowerCase();
  const visible = members.filter(member => (!needle || [member.full_name, member.email].some(value => value?.toLowerCase().includes(needle)))
    && (scope === 'all' || (scope === 'overdue' ? overdue(member) > 0 : scope === 'open' ? open(member) > 0 : open(member) === 0)));
  const name = (member: T) => member.full_name || member.email;
  if (sort !== 'recorded') visible.sort((a, b) => {
    const delta = sort === 'overdue' ? overdue(b) - overdue(a) || open(b) - open(a) : sort === 'open' ? open(b) - open(a) : 0;
    return delta || name(a).localeCompare(name(b)) || a.user_id - b.user_id;
  });
  const totalOpen = visible.reduce((sum, member) => sum + open(member), 0);
  const totalOverdue = visible.reduce((sum, member) => sum + overdue(member), 0);
  const activeFilters = !!query || scope !== 'all' || sort !== 'recorded';
  return <>
    <div className="space-y-3 border-b border-surface-800 p-4">
      <p className="text-xs text-surface-400">Workload snapshot: {generatedAt}. Counts describe assigned records, not staffing capacity or performance.</p>
      <label htmlFor="workload-search" className="block text-xs font-medium text-surface-300">Find team member</label>
      <input id="workload-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Name or email"
        className="min-h-9 w-full min-w-0 rounded-md border border-surface-600 bg-surface-950 px-3 text-sm text-surface-100" />
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Workload scope" value={scope} onChange={event => setScope(event.target.value)} className="min-h-9 max-w-full rounded-md border border-surface-600 bg-surface-950 px-2 text-xs text-surface-200">
          <option value="all">All members</option><option value="overdue">With overdue work</option><option value="open">With open work</option><option value="none">No open assigned work</option>
        </select>
        <select aria-label="Workload order" value={sort} onChange={event => setSort(event.target.value)} className="min-h-9 max-w-full rounded-md border border-surface-600 bg-surface-950 px-2 text-xs text-surface-200">
          <option value="recorded">Recorded order</option><option value="overdue">Most overdue first</option><option value="open">Most open work first</option><option value="name">Name A to Z</option>
        </select>
        {activeFilters && <button type="button" onClick={() => { setQuery(''); setScope('all'); setSort('recorded'); }} className="min-h-9 rounded-md border border-surface-600 px-2 text-xs text-surface-200">Clear workload filters</button>}
      </div>
      <p role="status" className="text-xs text-surface-300">{visible.length} of {members.length} members shown. Matching members: {totalOpen} open assigned records, {totalOverdue} overdue.</p>
      <p className="text-xs text-surface-500">These filters affect this workload snapshot only. Alert, investigation and task totals count separate records.</p>
    </div>
    {visible.length ? <ul className="divide-y divide-surface-800" data-testid="team-workload">{visible.map(children)}</ul>
      : <p className="px-4 py-6 text-sm text-surface-400">No team members match these filters. Clear filters to see the loaded team.</p>}
  </>;
}

import { useSearchParams } from 'react-router-dom';
import { Events } from './Events';
import { PageHeader } from '../components/ui/PageHeader';

/** A source-only link never silently broadens an invalid source to the whole stream. */
export function EventSourceRoute() {
  const [params] = useSearchParams();
  const values = params.getAll('source_id');
  const sourceId = values[0] ?? '';
  const valid = values.length === 0 || (values.length === 1 && /^[1-9][0-9]*$/.test(sourceId) && Number(sourceId) <= 2147483647);
  if (!valid) return <div className="space-y-4"><PageHeader eyebrow="Observe" title="Invalid recorded source link" description="No event list or export has been loaded." /><p role="alert" className="text-sm text-danger">This source-only link needs exactly one positive whole-number source ID. It was not broadened to all sources.</p><a href="/app/events" className="inline-block text-sm text-primary-300">Open all recorded events instead</a></div>;
  return <Events key={sourceId} initialSourceId={sourceId} />;
}

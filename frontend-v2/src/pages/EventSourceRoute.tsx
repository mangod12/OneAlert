import { eventScopeFromParams } from '../utils/eventInvestigationScope';
import { useSearchParams } from 'react-router-dom';
import { recordedEventFilter } from '../utils/recordedEventFilter';
import { Events } from './Events';
import { PageHeader } from '../components/ui/PageHeader';

/** A source-only link never silently broadens an invalid source to the whole stream. */
export function EventSourceRoute() {
  const [params] = useSearchParams();
  let scope;
  try { scope = eventScopeFromParams(params); } catch {
    return <div className="space-y-4"><PageHeader eyebrow="Observe" title="Invalid complete event scope link" description="No event list or export has been loaded." /><p role="alert" className="text-sm text-danger">This link needs one complete supported event scope, without missing fields, mixed parameters or ambiguous values. It was not broadened to all events. Open the original complete link or choose all events explicitly.</p><a href="/app/events" className="inline-block text-sm text-primary-300">Open all recorded events instead</a></div>;
  }
  if (scope) return <Events key={JSON.stringify(scope)} initialScope={scope} />;
  const values = params.getAll('source_id');
  const sourceId = values[0] ?? '';
  const valid = values.length === 0 || (values.length === 1 && /^[1-9][0-9]*$/.test(sourceId) && Number(sourceId) <= 2147483647);
  if (!valid) return <div className="space-y-4"><PageHeader eyebrow="Observe" title="Invalid recorded source link" description="No event list or export has been loaded." /><p role="alert" className="text-sm text-danger">This source-only link needs exactly one positive whole-number source ID. It was not broadened to all sources.</p><a href="/app/events" className="inline-block text-sm text-primary-300">Open all recorded events instead</a></div>;
  const fields = params.getAll('recorded_field'), labels = params.getAll('recorded_value');
  let exact = null;
  try {
    if (fields.length > 1 || labels.length > 1) throw Error('Repeated field scope');
    exact = recordedEventFilter(fields[0], labels[0]);
  } catch {
    return <div className="space-y-4"><PageHeader eyebrow="Observe" title="Invalid exact recorded-field link" description="No event list or export has been loaded." /><p role="alert" className="text-sm text-danger">This recorded-field link needs exactly one supported field and nonblank exact text of at most 1,024 characters. It was not broadened to all events.</p><a href="/app/events" className="inline-block text-sm text-primary-300">Open all recorded events instead</a></div>;
  }
  return <Events key={JSON.stringify([sourceId, exact])} initialSourceId={sourceId} initialRecordedFilter={exact} />;
}

import { timelineRecordedTime } from '../utils/timelineReview';
export function TimelineRecordedTime({ timestamp }: { timestamp: string }) {
  const time = timelineRecordedTime(timestamp);
  return <details className="max-w-full text-xs text-surface-400 [overflow-wrap:anywhere]">
    <summary className="min-h-9 cursor-pointer py-2">{time === null ? 'Recorded time unavailable' : <time dateTime={new Date(time).toISOString()}>{new Date(time).toISOString().replace('T', ' ').replace('Z', ' UTC')}</time>}</summary>
    <p className="whitespace-pre-wrap">Recorded timestamp: {timestamp || 'not recorded'}</p>
    <p>{time === null ? 'No usable recorded time. This entry remains visible without a date boundary and is not assigned to a UTC day.' : 'UTC display, matching timeline date filters, day groups and timestamp sorting. A server ISO timestamp without an offset is treated as UTC. This is the saved entry time, not proof of source event time or response duration.'}</p>
  </details>;
}

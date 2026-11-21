import type { SavedBriefing, Source } from './caseBriefingEvidence';
const sourceValue = ({ key, kind, id, title, label, summary, severity, status, recorded_at }: Source) => ({ key, kind, id, title, label, summary, severity, status, recorded_at });
export function compareBriefingSources(a: Source[], b: Source[]) {
  const left = new Map(a.map(source => [source.key, sourceValue(source)]));
  const right = new Map(b.map(source => [source.key, sourceValue(source)]));
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort();
  const sources = keys.map(key => ({ key, a: left.get(key), b: right.get(key),
    change: !left.has(key) ? 'only_b' : !right.has(key) ? 'only_a'
      : JSON.stringify(sourceValue(left.get(key)!)) === JSON.stringify(sourceValue(right.get(key)!)) ? 'same' : 'different' }));
  return sources;
}
export function compareBriefings(a: SavedBriefing, b: SavedBriefing) {
  const sources = compareBriefingSources(a.briefing.sources, b.briefing.sources);
  const observationKey = (o: { text: string; sources: string[] }) => JSON.stringify([o.text, [...new Set(o.sources)].sort()]);
  const aKeys = new Set(a.briefing.observations.map(observationKey)), bKeys = new Set(b.briefing.observations.map(observationKey));
  return { sources,
    onlyA: a.briefing.observations.filter(o => !bKeys.has(observationKey(o))),
    onlyB: b.briefing.observations.filter(o => !aKeys.has(observationKey(o))),
    shared: a.briefing.observations.filter(o => bKeys.has(observationKey(o))).length,
  };
}

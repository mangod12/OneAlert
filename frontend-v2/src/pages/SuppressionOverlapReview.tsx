import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { PageHeader } from '../components/ui/PageHeader';
import { checkedSuppressionOverlap, suppressionOverlapPackage, type SuppressionOverlap } from '../utils/suppressionOverlapReview';
import type { SuppressionRuleSnapshot } from '../utils/suppressionStatusReview';
function Criteria({ rule }: { rule: SuppressionRuleSnapshot }) {
  return <dl className="grid gap-3 text-xs sm:grid-cols-2">{Object.entries({ 'CVE, case-insensitive exact': rule.cve_id, 'Asset record ID, exact': rule.asset_id, 'Severity, case-insensitive exact': rule.severity, 'Title contains, literal and case-insensitive': rule.title_contains, 'Rule created, as recorded': rule.created_at }).map(([label, value]) => <div key={label}><dt className="text-surface-400">{label}</dt><dd className="whitespace-pre-wrap">{value === null || value === '' ? 'Not set, no restriction' : value}</dd></div>)}</dl>;
}
export function SuppressionOverlapReview() {
  const { ruleId = '' } = useParams();
  const id = /^[1-9][0-9]*$/.test(ruleId) && Number.isSafeInteger(Number(ruleId)) ? Number(ruleId) : null;
  const request = useRef(0);
  const invalidate = useCallback(() => { request.current++; }, []);
  const [retry, setRetry] = useState(0), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<{ read: number; data: SuppressionOverlap } | null>(null);
  useEffect(() => {
    const read = ++request.current; setSnapshot(null); setError('');
    if (id === null) { setLoading(false); return; } setLoading(true);
    void (async () => {
      try {
        const { data } = await apiClient.get(`/suppression-rules/${id}/overlap-review`);
        const checked = await checkedSuppressionOverlap(data, id);
        if (read === request.current) setSnapshot({ read, data: checked });
      } catch (failure) {
        if (read === request.current) {
          const status = (failure as { response?: { status?: number } })?.response?.status;
          setError(status === 422 ? getApiErrorMessage(failure, 'This rule cannot be compared within the review limits. No partial counts are shown.') : 'The current overlap review could not be verified. No counts or export are available. Read it again. Secure hashing support is required.');
        }
      } finally { if (read === request.current) setLoading(false); }
    })();
    return invalidate;
  }, [id, retry, invalidate]);
  const current = !loading && !error && snapshot?.data.rule.id === id ? snapshot.data : null;
  const download = () => {
    if (!current || snapshot?.read !== request.current) return;
    const content = JSON.stringify(suppressionOverlapPackage(current), null, 2) + '\n';
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `suppression-rule-${current.rule.id}-current-overlap.json`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="space-y-5 text-surface-300 [overflow-wrap:anywhere]">
    <PageHeader eyebrow="Govern" title="Suppression overlap review" description="See which current alert rows also match other enabled rules, before deciding what to change elsewhere." />
    <a href="/app/settings" className="inline-block text-sm text-primary-300">Back to settings</a>
    <p className="max-w-4xl text-sm text-surface-400">Read-only criteria comparison. No rule or alert is changed. This does not predict future volume, identify past suppression or tell you which rule wins. The runtime uses the first matching enabled rule, but this review does not establish that execution order.</p>
    {id === null ? <p role="alert">This review needs an exact positive whole-number rule ID. No rule was loaded.</p> : <>
      <div className="flex flex-wrap gap-3"><button type="button" disabled={loading} onClick={() => { invalidate(); setSnapshot(null); setLoading(true); setError(''); setRetry(value => value + 1); }} className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300 disabled:opacity-40">Read current overlap</button>{current && <button type="button" onClick={download} className="rounded border border-primary-500/50 px-3 py-2 text-xs text-primary-300">Download verified overlap JSON</button>}</div>
      {loading && <p role="status">Reading saved criteria and current active-alert overlaps...</p>}{error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {current && <>
        <section aria-label="Selected rule criteria" className="oa-panel space-y-3 p-4"><h2 className="font-semibold text-surface-100">Rule #{current.rule.id}: {current.rule.name}</h2><p className="text-sm">{current.rule.enabled ? 'Enabled when read' : 'Paused when read; criteria-only comparison'} · Snooze window {current.rule.duration_hours}h</p><Criteria rule={current.rule} /><p className="text-xs text-surface-400">Every set criterion must match; unset criteria impose no restriction. Rule values are checksum-verified for this read, not locked against later changes.</p><a href={`/app/settings/suppression-rules/${current.rule.id}`} className="inline-block text-xs text-primary-300">Open full current matches for selected rule #{current.rule.id}</a></section>
        <div className="grid gap-3 sm:grid-cols-3">{[
          ['Selected criteria matches', current.matching_alert_count, 'Current active alerts matching every selected criterion.'],
          ['Shared with other enabled criteria', current.shared_matching_alert_count, 'Each alert is counted once, even when several other rules match.'],
          ['Exclusive within this comparison', current.exclusive_matching_alert_count, 'No other compared enabled rule matches these current alert rows.'],
        ].map(([label, value, note]) => <section key={label} aria-label={String(label)} className="oa-panel space-y-2 p-4"><h2 className="text-xs text-surface-400">{label}</h2><p className="text-2xl font-semibold text-surface-100">{value}</p><p className="text-xs text-surface-400">{note}</p></section>)}</div>
        <p className="text-xs text-surface-400">Active means pending, sent or acknowledged. Read {current.active_alert_count} owned active alert rows. Compared {current.compared_other_rule_count} other enabled rules with criteria; skipped {current.ignored_empty_other_rule_count} empty enabled records, as automatic suppression does. The selected rule, paused rules and other users' records are excluded from the other-rule set. A review over {current.other_enabled_rule_limit} other enabled rules or {current.active_alert_limit.toLocaleString()} owned active alert rows is refused, never silently truncated.</p>
        {current.matching_alert_count === 0 && <p className="text-sm text-warning">No active rows match the selected criteria now. Zero matches do not make a rule safe to enable or pause for future alerts.</p>}
        <section aria-label="Other enabled rules with shared current matches" className="space-y-3"><h2 className="font-semibold text-surface-100">Other enabled criteria with shared matches</h2><p className="text-xs text-surface-400">Sorted by current matching-alert count, then record ID, not by execution order. Per-rule counts can overlap and must not be added to the shared-alert total.</p>{!current.overlapping_rules.length && <p className="text-sm">No other compared enabled rule shares a current matching alert. This is not proof of future exclusivity.</p>}{current.overlapping_rules.map(row => <article id={`overlap-rule-${row.rule.id}`} key={row.rule.id} className="oa-panel space-y-3 p-4"><h3 className="font-semibold text-surface-100">Rule #{row.rule.id}: {row.rule.name}</h3><p className="text-sm">{row.matching_alert_count} shared current alerts · Enabled when read · {row.rule.duration_hours}h snooze window</p><details className="space-y-3 text-xs"><summary className="cursor-pointer text-primary-300">Review exact criteria for rule #{row.rule.id}</summary><Criteria rule={row.rule} /></details><a href={`/app/settings/suppression-rules/${row.rule.id}`} className="inline-block text-xs text-primary-300">Open full current matches for other rule #{row.rule.id}</a></article>)}</section>
        <section aria-label="Bounded current alert examples" className="space-y-3"><h2 className="font-semibold text-surface-100">Current alert examples</h2><p className="text-xs text-surface-400">Showing {current.examples.length} highest matching alert IDs, at most {current.example_limit}. This is not the full alert list. A row can appear under multiple rule counts.</p>{current.examples.map(row => <article key={row.alert.id} className="oa-panel space-y-2 p-4 text-sm"><h3 className="font-semibold text-surface-100">Alert #{row.alert.id}: {row.alert.title}</h3><p>{row.alert.severity} · {row.alert.status} · Asset {row.alert.asset_id ?? 'not recorded'} · {row.alert.cve_id || 'No CVE recorded'}</p><p className="text-xs text-surface-400">{row.other_rule_ids.length ? `Also matches enabled criteria in rule IDs ${row.other_rule_ids.join(', ')}.` : 'Exclusive within the compared enabled-criteria set at this read.'}</p><a href={`/app/alerts?alert=${row.alert.id}`} className="inline-block text-xs text-primary-300">Open exact current alert #{row.alert.id}</a></article>)}</section>
        <p className="text-xs text-surface-400">Read at {current.retrieved_at}. Rule records and alert rows are separate current reads, not a frozen transaction or history. The JSON download contains these verified criteria, counts and bounded alert examples, including private alert titles. Keep it private. It grants no app access and makes no safe-to-pause recommendation.</p>
      </>}
    </>}
  </div>;
}

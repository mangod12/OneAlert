import { useCallback, useEffect, useRef, useState } from 'react';
import { Mail } from 'lucide-react';
import apiClient from '../../api/client';
import { Panel } from '../ui/Panel';
import { notificationPreferenceKeys, type SavedNotificationPreferences } from '../../utils/notificationPolicyPreview';
import { checkedEditableNotificationPreferences, notificationDigestHour, notificationDraftClock, notificationKindLabels, notificationPreferenceChanges, notificationPreferenceLabels, notificationPreferenceText, sameNotificationPreferences } from '../../utils/notificationPreferenceReview';

const buttonClass = 'rounded border border-surface-600 px-3 py-2 text-xs text-primary-300 disabled:opacity-40';
const path = '/auth/me/notification-preferences';
export function NotificationPreferencesPanel() {
  const [notifEnabled, setNotifEnabled] = useState(false), [notifMinSeverity, setNotifMinSeverity] = useState('');
  const [notifMutedKinds, setNotifMutedKinds] = useState<string[]>([]), [quietStart, setQuietStart] = useState(''), [quietEnd, setQuietEnd] = useState('');
  const [digestEnabled, setDigestEnabled] = useState(false), [digestHour, setDigestHour] = useState('');
  const [snapshot, setSnapshot] = useState<SavedNotificationPreferences | null>(null), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState('');
  const [notifSaving, setNotifSaving] = useState(false), [notice, setNotice] = useState(''), [readAt, setReadAt] = useState('');
  const [review, setReview] = useState<{ before: SavedNotificationPreferences; next: SavedNotificationPreferences } | null>(null);
  const reads = useRef(0), ready = useRef(false), operation = useRef(false), reviewRef = useRef<HTMLElement | null>(null);
  const applyDraft = useCallback((current: SavedNotificationPreferences) => {
    setNotifEnabled(current.email_notifications_enabled); setNotifMinSeverity(current.notify_min_severity); setNotifMutedKinds([...current.muted_kinds]);
    setQuietStart(current.quiet_hours_start ?? ''); setQuietEnd(current.quiet_hours_end ?? ''); setDigestEnabled(current.digest_enabled); setDigestHour(String(current.digest_hour_utc));
  }, []);
  const load = useCallback(async () => {
    if (operation.current) return;
    const id = ++reads.current; ready.current = false; setLoading(true); setSnapshot(null); setReview(null); setLoadError(''); setNotice('');
    try {
      const { data } = await apiClient.get(path); if (id !== reads.current) return;
      const checked = checkedEditableNotificationPreferences(data); setSnapshot(checked); applyDraft(checked); ready.current = true; setReadAt(new Date().toISOString());
    } catch { if (id === reads.current) setLoadError('Current notification preferences could not be verified. No editable defaults or save controls are offered. Read them again before making a change. Unsupported legacy values are not silently replaced.'); }
    finally { if (id === reads.current) setLoading(false); }
  }, [applyDraft]);
  const invalidateRead = useCallback(() => { reads.current++; ready.current = false; }, []);
  useEffect(() => { void load(); return invalidateRead; }, [load, invalidateRead]);
  useEffect(() => { if (review) reviewRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [review]);
  const draft = () => checkedEditableNotificationPreferences({ email_notifications_enabled: notifEnabled, notify_min_severity: notifMinSeverity, muted_kinds: notifMutedKinds, quiet_hours_start: notificationDraftClock(quietStart), quiet_hours_end: notificationDraftClock(quietEnd), digest_enabled: digestEnabled, digest_hour_utc: notificationDigestHour(digestHour) });
  const reviewDraft = () => {
    if (!ready.current || !snapshot || loading || loadError || operation.current) return;
    try { const next = draft(); setNotice(''); if (sameNotificationPreferences(snapshot, next)) { setReview(null); setNotice('No notification preference changes to review. Nothing was sent.'); return; } setReview({ before: snapshot, next }); }
    catch { setReview(null); setNotice('Use a supported severity, a whole UTC digest hour from 0 to 23, and either two complete UTC quiet times or neither. No save request was sent.'); }
  };
  const confirmSave = async () => {
    if (!ready.current || !snapshot || !review || loading || loadError || operation.current) return;
    try { if (!sameNotificationPreferences(draft(), review.next) || !sameNotificationPreferences(snapshot, review.before)) { setReview(null); setNotice('The draft or saved read changed. Review again before saving.'); return; } } catch { setReview(null); return; }
    operation.current = true; setNotifSaving(true); setNotice(''); const id = reads.current; let sent = false;
    try {
      const { data } = await apiClient.get(path); if (id !== reads.current) return;
      const current = checkedEditableNotificationPreferences(data);
      if (!sameNotificationPreferences(current, review.before)) { setSnapshot(current); setReadAt(new Date().toISOString()); setReview(null); setNotice('Saved notification preferences changed since your read. No save request was sent. Your draft is kept; review it against the new saved values.'); return; }
      sent = true; const response = await apiClient.patch(path, review.next); if (id !== reads.current) return;
      const confirmed = checkedEditableNotificationPreferences(response.data); if (!sameNotificationPreferences(confirmed, review.next)) throw Error('Save response differed from review.');
      setSnapshot(confirmed); applyDraft(confirmed); setReadAt(new Date().toISOString()); setReview(null); setNotice('The save response matches your reviewed notification preferences. Other sessions can still change them. No event was replayed or notification sent.');
    } catch {
      if (id !== reads.current) return;
      ready.current = false; setSnapshot(null); setReview(null); setLoadError(sent ? 'The save outcome could not be verified. It may already have applied. Read current notification preferences before any retry. No automatic retry was sent.' : 'Current notification preferences could not be checked. No save request was sent. Read them again before reviewing a change.');
    } finally { operation.current = false; if (id === reads.current) setNotifSaving(false); }
  };
  return (
        <Panel title="Email notifications" description="Review the complete saved preference set before changing notification gates." action={<Mail className="h-4 w-4 text-warning" />}>
          <div className="space-y-3 p-5 pb-0">
            <p className="text-xs text-surface-400">No editable defaults are shown before a verified saved read. Review first, then confirm after a new current-value check. This is not an atomic lock; another session can still change preferences between the check and save.</p>
            <button type="button" disabled={loading || notifSaving} onClick={() => void load()} className={buttonClass}>{snapshot ? 'Discard draft and reread notification preferences' : 'Read current notification preferences'}</button>
            {loading && <p role="status" className="text-sm">Reading current notification preferences...</p>}
            {loadError && <p role="alert" className="text-sm text-danger">{loadError}</p>}
            {notice && <p role="status" className="text-sm text-primary-300">{notice}</p>}
            {snapshot && <p className="text-xs text-surface-400">Verified read or matching save response at {readAt}. All seven fields are sent on confirmation, including unchanged fields.</p>}
          </div>
          {snapshot && !loading && <form className="space-y-5 p-5" onChange={() => { setReview(null); setNotice(''); }} onSubmit={event => { event.preventDefault(); reviewDraft(); }}>
            <fieldset disabled={notifSaving} className="min-w-0 space-y-5">
            <label className="flex items-center gap-3 text-sm text-surface-200">
              <input
                type="checkbox"
                checked={notifEnabled}
                onChange={event => setNotifEnabled(event.target.checked)}
                className="h-4 w-4 rounded border-surface-600 bg-surface-950 text-primary-500 focus:ring-2 focus:ring-primary-500"
              />
              Email me about new alerts
            </label>
            <div>
              <label htmlFor="notif-min-severity" className="mb-1.5 block text-sm font-medium text-surface-300">Minimum severity</label>
              <select
                id="notif-min-severity"
                value={notifMinSeverity}
                onChange={event => setNotifMinSeverity(event.target.value)}
                disabled={!notifEnabled}
                className="w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2.5 text-sm text-surface-100 disabled:opacity-50"
              >
                <option value="low">Low and above</option>
                <option value="medium">Medium and above</option>
                <option value="high">High and above</option>
                <option value="critical">Critical only</option>
              </select>
              <p className="mt-1.5 text-xs text-surface-500">Alerts below this severity still appear in the app but do not trigger an email.</p>
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium text-surface-300">In-app notifications</p>
              <p className="mb-2 text-xs text-surface-500">Muted kinds stay recorded but are hidden from the feed and unread count. Mutes also gate supported investigation dispatch paths, but not new CVE/advisory alert email.</p>
              {(Object.entries(notificationKindLabels) as Array<[string, string]>).map(([kind, label]) => (
                <label key={kind} className="flex items-center gap-3 py-1 text-sm text-surface-200">
                  <input
                    type="checkbox"
                    checked={!notifMutedKinds.includes(kind)}
                    onChange={event => setNotifMutedKinds(current =>
                      event.target.checked ? current.filter(k => k !== kind) : [...current, kind]
                    )}
                    className="h-4 w-4 rounded border-surface-600 bg-surface-950 text-primary-500 focus:ring-2 focus:ring-primary-500"
                  />
                  {label}
                </label>
              ))}
            </div>
            <div>
              <label className="flex items-center gap-3 text-sm text-surface-200">
                <input
                  type="checkbox"
                  checked={digestEnabled}
                  onChange={event => setDigestEnabled(event.target.checked)}
                  disabled={!notifEnabled}
                  className="h-4 w-4 rounded border-surface-600 bg-surface-950 text-primary-500 focus:ring-2 focus:ring-primary-500"
                />
                Send me a daily digest
              </label>
              <div className="mt-2">
                <label htmlFor="digest-hour" className="mb-1.5 block text-xs font-medium text-surface-300">Send at (UTC hour)</label>
                <select
                  id="digest-hour"
                  value={digestHour}
                  onChange={event => setDigestHour(event.target.value)}
                  disabled={!notifEnabled || !digestEnabled}
                  className="w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 disabled:opacity-50"
                >
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={String(h)}>{`${String(h).padStart(2, '0')}:00 UTC`}</option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-surface-500">A morning summary of open and overdue investigations plus fresh critical and high alerts. Quiet days get no email.</p>
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-sm font-medium text-surface-300">Quiet hours (UTC)</p>
              <p className="mb-2 text-xs text-surface-500">This UTC window filters noncritical events in the shared immediate-dispatch preference check. Critical bypasses quiet hours only, not a disabled global toggle or an applicable kind mute. Digests follow separate rules.</p>
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <label htmlFor="quiet-start" className="text-xs text-surface-400">From</label>
                <input
                  id="quiet-start"
                  type="time"
                  value={quietStart}
                  onChange={event => setQuietStart(event.target.value)}
                  disabled={!notifEnabled}
                  className="rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 disabled:opacity-50"
                />
                <label htmlFor="quiet-end" className="text-xs text-surface-400">Until</label>
                <input
                  id="quiet-end"
                  type="time"
                  value={quietEnd}
                  onChange={event => setQuietEnd(event.target.value)}
                  disabled={!notifEnabled}
                  className="rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 disabled:opacity-50"
                />
                {(quietStart || quietEnd) && (
                  <button type="button" onClick={() => { setQuietStart(''); setQuietEnd(''); }} className="text-xs text-surface-400 hover:text-surface-200">
                    Clear
                  </button>
                )}
              </div>
            </div>
            </fieldset>
            <div className="flex items-center justify-end gap-4 border-t border-surface-800 pt-4">
              <button type="submit" disabled={notifSaving || !!loadError} className="min-h-9 rounded-md bg-primary-500 px-4 text-sm font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-50">Review notification changes</button>
            </div>
          </form>}
          {review && <section ref={reviewRef} aria-label="Notification preference change review" className="m-5 min-w-0 space-y-3 rounded border border-warning/40 bg-surface-950 p-4 [overflow-wrap:anywhere]">
            <h3 className="font-semibold text-surface-100">Review notification changes</h3>
            <p className="text-xs text-surface-400">Confirm sends the complete reviewed seven-field set after checking current saved values. It sends no notification, replays no event and does not prove future delivery. Existing notification records are not deleted.</p>
            <dl className="space-y-3 text-xs">{notificationPreferenceChanges(review.before, review.next).map(change => <div key={change.key}><dt className="font-medium text-surface-200">{change.label}</dt><dd className="text-surface-400">{notificationPreferenceText(change.before)} to {notificationPreferenceText(change.after)}</dd></div>)}</dl>
            <details className="text-xs text-surface-400"><summary>Complete seven-field proposal</summary><dl className="mt-3 space-y-2">{notificationPreferenceKeys.map(key => <div key={key} className="flex flex-wrap justify-between gap-2"><dt>{notificationPreferenceLabels[key]}</dt><dd>{notificationPreferenceText(review.next[key])}</dd></div>)}</dl></details>
            <div className="flex flex-wrap gap-2"><button type="button" disabled={notifSaving} onClick={() => setReview(null)} className={buttonClass}>Cancel notification review</button><button type="button" disabled={notifSaving} onClick={() => void confirmSave()} className="rounded bg-primary-500 px-3 py-2 text-xs font-semibold text-surface-950 disabled:opacity-40">{notifSaving ? 'Checking and saving notification preferences...' : 'Confirm reviewed notification preferences'}</button></div>
          </section>}
        </Panel>
  );
}

import { useEffect, useRef, useState } from 'react';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
interface Rule { id: number; name: string; description: string | null; rule_type: string; rule_content: string; mitre_techniques: unknown[] | null; confidence: string; tested: boolean; enabled: boolean; created_by: string; created_at: string; }
const control = 'max-w-full rounded border border-surface-600 px-3 py-2 text-left text-xs text-surface-200 disabled:opacity-40';
export function DetectionRuleInspector({ ruleId, onClose }: { ruleId: number; onClose: () => void }) {
  const [record, setRecord] = useState<{ rule: Rule; readAt: string } | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [retry, setRetry] = useState(0), [copied, setCopied] = useState(false), [copyError, setCopyError] = useState(''), [downloadError, setDownloadError] = useState('');
  const requestId = useRef(0);
  useEffect(() => {
    const request = ++requestId.current; setRecord(null); setLoading(true); setError(''); setCopied(false); setCopyError(''); setDownloadError('');
    void apiClient.get<Rule>(`/hunt/detections/${ruleId}`).then(response => {
      if (request !== requestId.current) return;
      const rule = response.data;
      if (!rule || rule.id !== ruleId || ['name','rule_type','rule_content','confidence','created_by','created_at'].some(key => typeof rule[key as keyof Rule] !== 'string') || (rule.description !== null && typeof rule.description !== 'string') || typeof rule.enabled !== 'boolean' || typeof rule.tested !== 'boolean' || (rule.mitre_techniques !== null && !Array.isArray(rule.mitre_techniques))) throw Error('The saved rule response did not match this exact record. Try again.');
      setRecord({ rule, readAt: new Date().toISOString() });
    }).catch(err => { if (request === requestId.current) setError(getApiErrorMessage(err, 'The saved rule could not be loaded. It may be unavailable or outside your access.')); }).finally(() => { if (request === requestId.current) setLoading(false); });
    return () => { requestId.current += 1; };
  }, [ruleId, retry]);
  const copy = async () => {
    if (!record || loading) return;
    const request = requestId.current; setCopied(false); setCopyError('');
    try { const url = new URL('/app/hunt', window.location.origin); url.searchParams.set('rule', String(ruleId)); await navigator.clipboard.writeText(url.toString()); if (requestId.current === request) setCopied(true); }
    catch { if (requestId.current === request) setCopyError('The rule link could not be copied. The saved evidence is unchanged.'); }
  };
  const download = () => {
    if (!record || loading) return; setDownloadError('');
    try { const content = { evidence_type: 'saved_detection_rule', scope: 'One current owner-visible saved rule. Flags are recorded metadata, not proof of deployment, testing or live detection. No rule was enabled, tested or executed.', loaded_at: record.readAt, exported_at: new Date().toISOString(), rule: record.rule }; const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2) + '\n'], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `saved-detection-rule-${ruleId}.json`; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch { setDownloadError('Saved rule evidence could not be downloaded. The loaded record is unchanged.'); }
  };
  return <section aria-label={`Exact saved detection rule ${ruleId}`} className="oa-panel mb-6 min-w-0 space-y-4 p-4 sm:p-6">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold text-surface-100">Saved detection rule #{ruleId}</h2><button type="button" className={control} onClick={onClose}>Close saved rule</button></div>
    <p className="text-xs text-surface-400">Read-only current saved configuration, independent of the loaded rule library or search filters. Enabled and tested flags are recorded metadata, not proof of deployment, successful tests or live detection. Opening this record does not enable, test, execute or change the rule.</p>
    {loading && <p role="status" className="text-sm text-surface-300">Loading exact saved rule...</p>}
    {error && <div className="space-y-2"><p role="alert" className="text-sm text-danger">{error}</p><button type="button" className={control} onClick={() => setRetry(retry + 1)}>Retry saved rule</button></div>}
    {!loading && !error && record && <>
      <h3 className="break-words text-base font-semibold text-surface-100 [overflow-wrap:anywhere]">{record.rule.name}</h3>
      <p className="whitespace-pre-wrap break-words text-sm text-surface-300">{record.rule.description ?? 'Description not recorded'}{record.rule.description === '' ? '(Empty description)' : ''}</p>
      <dl className="grid gap-3 text-xs text-surface-300 sm:grid-cols-2">{[['Rule type',record.rule.rule_type],['Recorded confidence',record.rule.confidence],['Recorded enabled flag',record.rule.enabled ? 'Enabled' : 'Disabled'],['Recorded tested flag',record.rule.tested ? 'Tested' : 'Not tested'],['Recorded creator',record.rule.created_by],['Created at',record.rule.created_at],['Read at',record.readAt]].map(([label,value]) => <div key={label} className="min-w-0"><dt className="text-surface-400">{label}</dt><dd className="break-words [overflow-wrap:anywhere]">{value}</dd></div>)}</dl>
      <details><summary className="cursor-pointer text-xs text-primary-300">Recorded ATT&amp;CK associations</summary><pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap break-all text-xs text-surface-300">{record.rule.mitre_techniques === null ? 'Not recorded (null)' : JSON.stringify(record.rule.mitre_techniques, null, 2)}</pre></details>
      <div><h4 className="mb-2 text-sm font-semibold text-surface-200">Full saved rule content</h4><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded border border-surface-700 bg-surface-950 p-3 text-xs text-surface-300">{record.rule.rule_content || '(Empty saved content)'}</pre></div>
      <div className="flex flex-wrap gap-2"><button type="button" className={control} onClick={() => setRetry(retry + 1)}>Refresh saved rule</button><button type="button" className={control} onClick={() => void copy()}>Copy exact saved rule link</button><button type="button" className={control} onClick={download}>Download saved rule evidence JSON</button></div>
      <p className="text-xs text-surface-400">The link contains only this rule ID, no content, filters or drafts. Recipients need their own permission. Downloads include full rule content and recorded metadata, review before sharing. Refresh reads the latest record, not an immutable version.</p>
      {copied && <p role="status" className="text-xs text-primary-300">Saved rule link copied.</p>}{copyError && <p role="alert" className="text-xs text-danger">{copyError}</p>}{downloadError && <p role="alert" className="text-xs text-danger">{downloadError}</p>}
    </>}
  </section>;
}

import { useState, useEffect, useRef } from 'react';
import apiClient from '../api/client';
import { Play, FileCode, Clock, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { getApiErrorMessage } from '../api/errors';
import { EmptyState, ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusBadge } from '../components/ui/StatusBadge';
import { toast } from '../components/Toast';
import { HuntQueryEvidence, type HuntQueryResult } from '../components/HuntQueryEvidence';

interface HuntSession {
  id: number;
  hypothesis: string;
  status: string;
  queries_run: number;
  findings_count: number;
  sigma_rule: string | null;
  created_at: string;
}

interface HuntResult {
  explanation?: string;
  query_results?: HuntQueryResult[];
  sigma_rule?: string;
}

interface DetectionRule {
  id: number;
  name: string;
  description: string | null;
  rule_type: string;
  rule_content: string;
  mitre_techniques: string[] | null;
  confidence: string;
  tested: boolean;
  enabled: boolean;
  created_by: string;
  created_at: string;
}

interface RuleFormState {
  name: string;
  description: string;
  rule_type: string;
  rule_content: string;
  confidence: string;
}

const emptyRuleForm: RuleFormState = { name: '', description: '', rule_type: 'sigma', rule_content: '', confidence: 'medium' };

export function HuntLab() {
  const [hypothesis, setHypothesis] = useState('');
  const [sessions, setSessions] = useState<HuntSession[]>([]);
  const [resultVersion, setResultVersion] = useState(0);
  const [activeResult, setActiveResult] = useState<HuntResult | null>(null);
  const [hunting, setHunting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detectionsLoading, setDetectionsLoading] = useState(true);
  const [detectionsError, setDetectionsError] = useState('');
  const detectionsRequest = useRef(0);
  const [detections, setDetections] = useState<DetectionRule[]>([]);
  const [ruleForm, setRuleForm] = useState<RuleFormState | null>(null);
  const [editingRule, setEditingRule] = useState<DetectionRule | null>(null);
  const [savingRule, setSavingRule] = useState(false);
  const [togglingRuleId, setTogglingRuleId] = useState<number | null>(null);
  const [deletingRule, setDeletingRule] = useState<DetectionRule | null>(null);
  const [deletingRuleBusy, setDeletingRuleBusy] = useState(false);
  const [deletingSession, setDeletingSession] = useState<HuntSession | null>(null);
  const [deletingSessionBusy, setDeletingSessionBusy] = useState(false);
  const fetchSessions = async () => {
    try {
      const res = await apiClient.get('/hunt/');
      setSessions(res.data);
      setError('');
    } catch (err) {
      setError(getApiErrorMessage(err, 'Hunt history could not be loaded.'));
    } finally { setLoading(false); }
  };

  const startHunt = async () => {
    if (!hypothesis.trim()) return;
    setHunting(true);
    setActiveResult(null);
    try {
      const res = await apiClient.post('/hunt/', { hypothesis });
      setResultVersion(value => value + 1);
      setActiveResult(res.data.data);
      await fetchSessions();
    } catch (err) {
      toast(getApiErrorMessage(err, 'The hunt could not be completed.'), 'error');
    } finally {
      setHunting(false);
    }
  };

  const [loadingSessionId, setLoadingSessionId] = useState<number | null>(null);

  const viewSession = async (sessionId: number) => {
    if (loadingSessionId !== null || hunting) return;
    setLoadingSessionId(sessionId);
    try {
      const res = await apiClient.get(`/hunt/${sessionId}`);
      const detail = res.data;
      const resultData: HuntResult = Array.isArray(detail.result_data)
        ? { query_results: detail.result_data } : detail.result_data ?? {};
      setHypothesis(detail.hypothesis ?? '');
      setResultVersion(value => value + 1);
      setActiveResult({
        explanation: resultData.explanation,
        query_results: resultData.query_results,
        sigma_rule: detail.sigma_rule ?? resultData.sigma_rule,
      });
    } catch (err) {
      toast(getApiErrorMessage(err, 'That hunt session could not be loaded.'), 'error');
    } finally {
      setLoadingSessionId(null);
    }
  };

  const fetchDetections = async () => {
    const request = ++detectionsRequest.current;
    setDetectionsLoading(true); setDetectionsError('');
    try {
      const res = await apiClient.get('/hunt/detections');
      if (request === detectionsRequest.current) setDetections(res.data);
    } catch (err: unknown) {
      if (request === detectionsRequest.current) setDetectionsError(getApiErrorMessage(err, 'Detection rules could not be loaded.'));
    } finally {
      if (request === detectionsRequest.current) setDetectionsLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions(); void fetchDetections();
    return () => { detectionsRequest.current += 1; };
  }, []);

  const toggleRule = async (rule: DetectionRule) => {
    if (togglingRuleId !== null) return;
    setTogglingRuleId(rule.id);
    try {
      const res = await apiClient.patch(`/hunt/detections/${rule.id}`, { enabled: !rule.enabled });
      setDetections(prev => prev.map(r => (r.id === rule.id ? res.data : r)));
      toast(res.data.enabled ? 'Detection rule enabled.' : 'Detection rule disabled.', 'success');
    } catch (err) {
      toast(getApiErrorMessage(err, 'The detection rule could not be updated.'), 'error');
    } finally {
      setTogglingRuleId(null);
    }
  };

  const deleteRule = async () => {
    if (!deletingRule || deletingRuleBusy) return;
    setDeletingRuleBusy(true);
    try {
      await apiClient.delete(`/hunt/detections/${deletingRule.id}`);
      setDetections(prev => prev.filter(r => r.id !== deletingRule.id));
      toast('Detection rule deleted.', 'success');
      setDeletingRule(null);
    } catch (err) {
      toast(getApiErrorMessage(err, 'The detection rule could not be deleted.'), 'error');
    } finally {
      setDeletingRuleBusy(false);
    }
  };

  const deleteSession = async () => {
    if (!deletingSession || deletingSessionBusy) return;
    setDeletingSessionBusy(true);
    try {
      await apiClient.delete(`/hunt/${deletingSession.id}`);
      setSessions(prev => prev.filter(s => s.id !== deletingSession.id));
      toast('Hunt session deleted.', 'success');
      setDeletingSession(null);
    } catch (err) {
      toast(getApiErrorMessage(err, 'The hunt session could not be deleted.'), 'error');
    } finally {
      setDeletingSessionBusy(false);
    }
  };

  const startEditRule = (rule: DetectionRule) => {
    setEditingRule(rule);
    setRuleForm({
      name: rule.name,
      description: rule.description ?? '',
      rule_type: rule.rule_type,
      rule_content: rule.rule_content,
      confidence: rule.confidence,
    });
  };

  const closeRuleForm = () => { setRuleForm(null); setEditingRule(null); };

  const saveRule = async () => {
    if (!ruleForm || savingRule) return;
    if (!ruleForm.name.trim() || (!editingRule && !ruleForm.rule_content.trim())) {
      toast(editingRule ? 'Name is required.' : 'Name and rule content are required.', 'error');
      return;
    }
    setSavingRule(true);
    try {
      if (editingRule) {
        const res = await apiClient.patch(`/hunt/detections/${editingRule.id}`, {
          name: ruleForm.name.trim(),
          description: ruleForm.description.trim() || null,
          confidence: ruleForm.confidence,
        });
        setDetections(prev => prev.map(r => (r.id === editingRule.id ? res.data : r)));
        toast('Detection rule updated.', 'success');
      } else {
        await apiClient.post('/hunt/detections', {
          name: ruleForm.name.trim(),
          rule_type: ruleForm.rule_type,
          rule_content: ruleForm.rule_content,
          description: ruleForm.description.trim() || null,
          confidence: ruleForm.confidence,
        });
        toast('Detection rule saved.', 'success');
        await fetchDetections();
      }
      closeRuleForm();
    } catch (err) {
      toast(getApiErrorMessage(err, 'The detection rule could not be saved.'), 'error');
    } finally {
      setSavingRule(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Analyze" title="Threat Hunt Lab" description="Turn an investigation hypothesis into reviewable queries, evidence, and detection content." />

      {/* Hunt Input */}
      <div className="oa-panel p-6">
        <label htmlFor="hunt-hypothesis" className="block text-sm font-medium text-surface-300 mb-2">Hunting Hypothesis</label>
        <div className="flex gap-3">
          <input
            type="text"
            id="hunt-hypothesis"
            value={hypothesis}
            onChange={e => setHypothesis(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && startHunt()}
            placeholder="e.g. Look for lateral movement from engineering workstation to PLC subnet"
            className="flex-1 min-w-0 px-4 py-3 bg-surface-900 border border-surface-600 rounded-lg text-surface-50 placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <button
            onClick={startHunt}
            disabled={hunting || !hypothesis.trim()}
            className="flex items-center gap-2 px-6 py-3 bg-primary-500 hover:bg-primary-400 disabled:opacity-50 text-surface-950 rounded-lg font-medium transition-colors"
          >
            <Play className="w-4 h-4" />
            {hunting ? 'Hunting...' : 'Hunt'}
          </button>
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          {['Port scan from 10.0.0.0/24', 'DNS tunneling to external domains', 'Modbus write commands to PLCs',
            'Failed auth attempts across multiple hosts'].map(example => (
            <button
              key={example}
              onClick={() => setHypothesis(example)}
              className="px-3 py-1 text-xs bg-surface-700 text-surface-400 rounded-full hover:bg-surface-600 hover:text-surface-300 transition-colors"
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      {/* Active Result */}
      {activeResult && (
        <div key={resultVersion} className="min-w-0 space-y-4">
          <div className="oa-panel min-w-0 p-6">
            <h2 className="text-lg font-semibold text-surface-50 mb-3">Hunt Results</h2>
            {activeResult.explanation && (
              <p className="text-surface-300 text-sm mb-4">{activeResult.explanation}</p>
            )}

            {activeResult.query_results?.map((result, index) => (
              <HuntQueryEvidence key={index} result={result} index={index} />
            ))}
          </div>

          {activeResult.sigma_rule && (
            <div className="oa-panel p-6">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-surface-50 flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-primary-400" />
                  Generated Sigma Rule
                </h3>
                <button
                  type="button"
                  onClick={() => { setEditingRule(null); setRuleForm({ ...emptyRuleForm, rule_type: 'sigma', rule_content: activeResult.sigma_rule ?? '' }); }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-primary-500/40 px-2.5 py-1 text-xs font-semibold text-primary-300 hover:bg-primary-500/10"
                >
                  <ShieldCheck className="h-3.5 w-3.5" /> Save as detection rule
                </button>
              </div>
              <pre className="bg-surface-900 p-4 rounded-lg text-xs text-success overflow-x-auto whitespace-pre-wrap">
                {activeResult.sigma_rule}
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Detection Rules */}
      <div className="oa-panel p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-surface-50">Detection Rules</h2>
          {!ruleForm && (
            <button
              type="button"
              onClick={() => { setEditingRule(null); setRuleForm({ ...emptyRuleForm }); }}
              className="inline-flex items-center gap-1.5 rounded-md border border-primary-500/40 px-2.5 py-1 text-xs font-semibold text-primary-300 hover:bg-primary-500/10"
            >
              <Plus className="h-3.5 w-3.5" /> New rule
            </button>
          )}
        </div>

        {ruleForm && (
          <form className="mb-4 space-y-3 rounded-lg border border-surface-700 bg-surface-950/60 p-4" onSubmit={e => { e.preventDefault(); void saveRule(); }}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label htmlFor="rule-name" className="mb-1 block text-xs font-medium text-surface-300">Name *</label>
                <input id="rule-name" type="text" autoComplete="off" value={ruleForm.name} onChange={e => setRuleForm({ ...ruleForm, name: e.target.value })} placeholder="Modbus write to PLC" className="w-full rounded-md border border-surface-600 bg-surface-900 px-3 py-2 text-sm text-surface-100 placeholder-surface-500" />
              </div>
              <div>
                <label htmlFor="rule-type" className="mb-1 block text-xs font-medium text-surface-300">Type</label>
                <select id="rule-type" disabled={editingRule !== null} value={ruleForm.rule_type} onChange={e => setRuleForm({ ...ruleForm, rule_type: e.target.value })} className="w-full rounded-md border border-surface-600 bg-surface-900 px-3 py-2 text-sm text-surface-100 disabled:opacity-50">
                  <option value="sigma">Sigma</option>
                  <option value="suricata">Suricata</option>
                  <option value="yara">YARA</option>
                  <option value="sql">SQL</option>
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="rule-content" className="mb-1 block text-xs font-medium text-surface-300">Rule content *</label>
              <textarea id="rule-content" rows={6} disabled={editingRule !== null} value={ruleForm.rule_content} onChange={e => setRuleForm({ ...ruleForm, rule_content: e.target.value })} className="w-full rounded-md border border-surface-600 bg-surface-900 px-3 py-2 font-mono text-xs text-surface-100 disabled:opacity-50" />
              {editingRule && <p className="mt-1 text-xs text-surface-500">Type and content are fixed after a rule is saved; create a new rule to change them.</p>}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label htmlFor="rule-description" className="mb-1 block text-xs font-medium text-surface-300">Description</label>
                <input id="rule-description" type="text" autoComplete="off" value={ruleForm.description} onChange={e => setRuleForm({ ...ruleForm, description: e.target.value })} className="w-full rounded-md border border-surface-600 bg-surface-900 px-3 py-2 text-sm text-surface-100" />
              </div>
              <div>
                <label htmlFor="rule-confidence" className="mb-1 block text-xs font-medium text-surface-300">Confidence</label>
                <select id="rule-confidence" value={ruleForm.confidence} onChange={e => setRuleForm({ ...ruleForm, confidence: e.target.value })} className="w-full rounded-md border border-surface-600 bg-surface-900 px-3 py-2 text-sm text-surface-100">
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button type="submit" disabled={savingRule} className="min-h-9 rounded-md bg-primary-500 px-4 text-sm font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-50">{savingRule ? 'Saving…' : editingRule ? 'Update rule' : 'Save rule'}</button>
              <button type="button" onClick={closeRuleForm} className="rounded-md border border-surface-600 px-3 py-2 text-sm text-surface-300 hover:bg-surface-800">Cancel</button>
            </div>
          </form>
        )}

        {detectionsLoading ? <LoadingSurface rows={3} label="Loading detection rules" /> : detectionsError ? (
          <ErrorState title="Detection rules unavailable" description={detectionsError} action={<RetryButton onClick={() => void fetchDetections()} />} />
        ) : detections.length === 0 && !ruleForm ? (
          <p className="text-sm text-surface-500">No detection rules saved yet. Run a hunt and save its Sigma output, or add a rule manually.</p>
        ) : (
          <ul className="divide-y divide-surface-800">
            {detections.map(rule => (
              <li key={rule.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-surface-100">{rule.name}</p>
                  {rule.description && <p className="mt-0.5 truncate text-xs text-surface-500">{rule.description}</p>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <StatusBadge tone="info">{rule.rule_type}</StatusBadge>
                    <StatusBadge tone={rule.confidence === 'high' ? 'success' : rule.confidence === 'low' ? 'neutral' : 'warning'}>{rule.confidence}</StatusBadge>
                    {!rule.enabled && <StatusBadge tone="neutral">disabled</StatusBadge>}
                    {rule.tested && <StatusBadge tone="success">tested</StatusBadge>}
                    {rule.mitre_techniques?.map(t => <span key={t} className="font-mono text-xs text-primary-400">{t}</span>)}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <span className="text-xs text-surface-500">{rule.created_by} · {new Date(rule.created_at).toLocaleDateString()}</span>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      aria-label={`Edit rule ${rule.name}`}
                      onClick={() => startEditRule(rule)}
                      className="min-h-8 rounded-md border border-surface-600 px-2.5 text-xs text-surface-200 hover:bg-surface-800"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      aria-label={`${rule.enabled ? 'Disable' : 'Enable'} rule ${rule.name}`}
                      disabled={togglingRuleId !== null}
                      onClick={() => void toggleRule(rule)}
                      className="min-h-8 rounded-md border border-surface-600 px-2.5 text-xs text-surface-200 hover:bg-surface-800 disabled:opacity-50"
                    >
                      {rule.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete rule ${rule.name}`}
                      onClick={() => setDeletingRule(rule)}
                      className="min-h-8 rounded-md border border-surface-600 px-2.5 text-xs text-danger hover:border-danger/50"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Past Sessions */}
      {loading ? <LoadingSurface label="Loading hunt history" /> : error ? (
        <ErrorState title="Hunt history unavailable" description={error} action={<RetryButton onClick={fetchSessions} />} />
      ) : <div className="oa-panel p-6">
        <h2 className="text-lg font-semibold text-surface-50 mb-4">Hunt History</h2>
        {sessions.length === 0 ? (
          <EmptyState title="No hunts yet" description="Enter a hypothesis above to start the first investigation." />
        ) : (
          <div className="space-y-2">
            {sessions.map(s => (
              <div key={s.id} className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={loadingSessionId !== null || hunting}
                  onClick={() => void viewSession(s.id)}
                  aria-label={`Reopen hunt: ${s.hypothesis}`}
                  className="flex flex-1 min-w-0 items-center gap-4 rounded-lg bg-surface-900/50 p-3 text-left transition-colors hover:bg-surface-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Clock className="w-4 h-4 text-surface-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-surface-50 truncate">{s.hypothesis}</p>
                    <p className="text-xs text-surface-500">
                      {s.queries_run} queries · {s.findings_count} findings · {new Date(s.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span className={clsx('text-xs px-2 py-0.5 rounded',
                    s.status === 'completed' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')}>
                    {s.status}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete hunt: ${s.hypothesis}`}
                  title="Delete this hunt session"
                  onClick={() => setDeletingSession(s)}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-surface-600 text-surface-300 hover:bg-surface-800 hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>}

      {deletingSession && (
        <ConfirmDialog
          title="Delete hunt session"
          description={`Delete the hunt "${deletingSession.hypothesis}"? Its stored queries and findings are removed and cannot be restored.`}
          confirmLabel="Delete hunt"
          tone="danger"
          busy={deletingSessionBusy}
          onCancel={() => setDeletingSession(null)}
          onConfirm={() => void deleteSession()}
        />
      )}
      {deletingRule && (
        <ConfirmDialog
          title="Delete detection rule"
          description={`Delete "${deletingRule.name}"? The rule stops matching future hunts and cannot be restored.`}
          confirmLabel="Delete rule"
          tone="danger"
          busy={deletingRuleBusy}
          onCancel={() => setDeletingRule(null)}
          onConfirm={() => void deleteRule()}
        />
      )}
    </div>
  );
}

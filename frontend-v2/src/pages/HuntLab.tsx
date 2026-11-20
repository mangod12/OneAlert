import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import apiClient from '../api/client';
import { Play, FileCode, Clock, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { getApiErrorMessage } from '../api/errors';
import { EmptyState, ErrorState, LoadingSurface, RetryButton } from '../components/ui/AsyncState';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusBadge } from '../components/ui/StatusBadge';
import { toast } from '../components/Toast';
import { huntEvidenceJson, saveHuntDownload, type HuntEvidenceResult } from '../utils/huntEvidence';
import { HuntQueryEvidence } from '../components/HuntQueryEvidence';

interface HuntSession {
  id: number;
  hypothesis: string;
  status: string;
  queries_run: number;
  findings_count: number;
  created_at: string;
}

type HuntResult = HuntEvidenceResult;

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
  enabled: boolean;
  techniques: string;
  name: string;
  description: string;
  rule_type: string;
  rule_content: string;
  confidence: string;
}

const emptyRuleForm: RuleFormState = { name: '', description: '', rule_type: 'sigma', rule_content: '', confidence: 'medium', enabled: false, techniques: '' };

export function HuntLab() {
  const [hypothesis, setHypothesis] = useState('');
  const [sessions, setSessions] = useState<HuntSession[]>([]);
  const [resultVersion, setResultVersion] = useState(0);
  const [activeResult, setActiveResult] = useState<HuntResult | null>(null);
  const huntInFlight = useRef(false);
  const [hunting, setHunting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detectionsLoading, setDetectionsLoading] = useState(true);
  const [detectionsError, setDetectionsError] = useState('');
  const detectionsRequest = useRef(0);
  const [detections, setDetections] = useState<DetectionRule[]>([]);
  const [ruleSearch, setRuleSearch] = useState('');
  const [ruleScope, setRuleScope] = useState('all');
  const [rulePage, setRulePage] = useState(1);
  const [ruleForm, setRuleForm] = useState<RuleFormState | null>(null);
  const [editingRule, setEditingRule] = useState<DetectionRule | null>(null);
  const [savingRule, setSavingRule] = useState(false);
  const [togglingRuleId, setTogglingRuleId] = useState<number | null>(null);
  const [deletingRule, setDeletingRule] = useState<DetectionRule | null>(null);
  const [deletingRuleBusy, setDeletingRuleBusy] = useState(false);
  const [deletingSession, setDeletingSession] = useState<HuntSession | null>(null);
  const [deletingSessionBusy, setDeletingSessionBusy] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historyKeyword, setHistoryKeyword] = useState('');
  const [historyState, setHistoryState] = useState('');
  const [historyFindings, setHistoryFindings] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const historyRequest = useRef(0);
  const historyKey = JSON.stringify([historyKeyword, historyState, historyFindings, historyPage, historyRefresh]);
  const currentHistoryKey = useRef(historyKey);
  useLayoutEffect(() => { currentHistoryKey.current = historyKey; }, [historyKey]);
  const fetchSessions = useCallback(async () => {
    if (currentHistoryKey.current !== historyKey) return;
    const request = ++historyRequest.current;
    let redirected = false;
    setLoading(true); setError('');
    try {
      const res = await apiClient.get<{ sessions: HuntSession[]; total: number }>('/hunt/history', { params: {
        page: historyPage, size: 20, ...(historyKeyword ? { search: historyKeyword } : {}),
        ...(historyState ? { state: historyState } : {}), ...(historyFindings ? { with_findings: true } : {}),
      } });
      if (request !== historyRequest.current || currentHistoryKey.current !== historyKey) return;
      const lastPage = Math.max(1, Math.ceil(res.data.total / 20));
      if (historyPage > lastPage) { redirected = true; setHistoryPage(lastPage); return; }
      setSessions(res.data.sessions); setHistoryTotal(res.data.total);
    } catch (err) {
      if (request === historyRequest.current && currentHistoryKey.current === historyKey) setError(getApiErrorMessage(err, 'Hunt history could not be loaded.'));
    } finally { if (!redirected && request === historyRequest.current) setLoading(false); }
  }, [historyPage, historyKeyword, historyState, historyFindings, historyKey]);
  useEffect(() => { void fetchSessions(); return () => { historyRequest.current += 1; }; }, [fetchSessions]);

  const startHunt = async () => {
    if (huntInFlight.current || loadingSessionId !== null || !hypothesis.trim()) return;
    huntInFlight.current = true;
    setHunting(true);
    setActiveResult(null);
    try {
      const res = await apiClient.post('/hunt/', { hypothesis });
      setResultVersion(value => value + 1);
      setActiveResult({ ...res.data.data, hypothesis });
      setHistoryRefresh(value => value + 1);
    } catch (err) {
      toast(getApiErrorMessage(err, 'The hunt could not be completed.'), 'error');
    } finally {
      huntInFlight.current = false;
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
        ...resultData, session_id: detail.id, hypothesis: detail.hypothesis,
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
    void fetchDetections();
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
      setHistoryRefresh(value => value + 1);
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
      enabled: rule.enabled,
      techniques: (rule.mitre_techniques ?? []).join(', '),
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
          enabled: ruleForm.enabled,
          mitre_techniques: [...new Set(ruleForm.techniques.split(',').map(value => value.trim()).filter(Boolean))],
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

  const ruleNeedle = ruleSearch.trim().toLowerCase();
  const matchingRules = detections.filter(rule =>
    (ruleScope === 'all' || (ruleScope === 'enabled' ? rule.enabled : ruleScope === 'disabled' ? !rule.enabled : ruleScope === 'tested' ? rule.tested : !rule.tested))
    && (!ruleNeedle || [rule.name, rule.description, rule.rule_type, rule.rule_content, ...(rule.mitre_techniques ?? [])].some(value => value?.toLowerCase().includes(ruleNeedle))));
  const rulePages = Math.max(1, Math.ceil(matchingRules.length / 10));
  const currentRulePage = Math.min(rulePage, rulePages);
  const shownRules = matchingRules.slice((currentRulePage - 1) * 10, currentRulePage * 10);


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
            disabled={hunting || loadingSessionId !== null || !hypothesis.trim()}
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
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-surface-50">Hunt Results</h2>
              <button type="button" onClick={() => saveHuntDownload(huntEvidenceJson(activeResult, new Date().toISOString()), `hunt-${activeResult.session_id ?? 'unsaved'}-evidence.json`, 'application/json')} className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300">Export recorded evidence JSON</button>
            </div>
            <p className="mb-3 text-xs text-surface-400">Exports contain the currently retained evidence, including errors and applied metadata where recorded. They do not run a hunt or fetch additional rows. Exports may contain sensitive telemetry and parameters.</p>
            {activeResult.execution_summary ? <section aria-label="Recorded hunt execution summary" className="mb-4 space-y-2 rounded border border-surface-700 p-3 text-sm text-surface-300">
              <p className="font-semibold text-surface-100">Recorded outcome: {activeResult.status ?? 'not recorded'}</p>
              <p>{activeResult.execution_summary.completed} completed · {activeResult.execution_summary.rejected} rejected before execution · {activeResult.execution_summary.failed} execution errors</p>
              <p className="text-xs">{activeResult.execution_summary.attempted} database queries attempted · {activeResult.execution_summary.skipped} skipped by the three-query cap</p>
              {activeResult.recorded_at && <p className="break-all text-xs text-surface-400">Recorded at {activeResult.recorded_at}</p>}
              {activeResult.status !== 'completed' && <p className="text-xs text-warning">This hunt did not complete every generated query. Review rejected queries and execution errors before relying on the retained rows.</p>}
            </section> : <p className="mb-3 text-xs text-surface-500">Detailed execution outcome was not recorded for this result. Historical completion labels do not prove that every query succeeded.</p>}
            {activeResult.error && <p role="alert" className="mb-3 whitespace-pre-wrap break-words text-sm text-danger">{activeResult.error}</p>}
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
                  disabled={ruleForm !== null}
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
            <fieldset disabled={savingRule} className="contents">
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
            {!editingRule && <div className="space-y-3">
              <label className="block text-xs text-surface-300">MITRE technique IDs (comma separated)
                <input aria-label="Rule MITRE techniques" value={ruleForm.techniques} onChange={event => setRuleForm({ ...ruleForm, techniques: event.target.value })}
                  className="mt-1 w-full rounded border border-surface-600 bg-surface-900 px-3 py-2 text-sm text-surface-100" />
              </label>
              <label className="flex items-center gap-2 text-sm text-surface-300"><input type="checkbox" checked={ruleForm.enabled} onChange={event => setRuleForm({ ...ruleForm, enabled: event.target.checked })} />Enable rule after saving</label>
              <p className="text-xs text-surface-400">New rules are untested and saved disabled unless you choose to enable them. Saving does not test or execute the rule.</p>
            </div>}
            <div className="flex items-center gap-2">
              <button type="submit" disabled={savingRule} className="min-h-9 rounded-md bg-primary-500 px-4 text-sm font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-50">{savingRule ? 'Saving…' : editingRule ? 'Update rule' : 'Save rule'}</button>
              <button type="button" onClick={closeRuleForm} className="rounded-md border border-surface-600 px-3 py-2 text-sm text-surface-300 hover:bg-surface-800">Cancel</button>
            </div>
            </fieldset>
          </form>
        )}

        {detectionsLoading ? <LoadingSurface rows={3} label="Loading detection rules" /> : detectionsError ? (
          <ErrorState title="Detection rules unavailable" description={detectionsError} action={<RetryButton onClick={() => void fetchDetections()} />} />
        ) : detections.length === 0 && !ruleForm ? (
          <p className="text-sm text-surface-500">No detection rules saved yet. Run a hunt and save its Sigma output, or add a rule manually.</p>
        ) : (
          <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap gap-2">
            <input aria-label="Search saved detection rules" value={ruleSearch} onChange={event => { setRuleSearch(event.target.value); setRulePage(1); }} placeholder="Name, content or MITRE technique"
              className="min-w-0 basis-full rounded border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 sm:flex-1 sm:basis-auto" />
            <select aria-label="Detection rule scope" value={ruleScope} onChange={event => { setRuleScope(event.target.value); setRulePage(1); }} className="rounded border border-surface-600 bg-surface-950 px-2 py-2 text-sm text-surface-200">
              <option value="all">All saved rules</option><option value="enabled">Enabled</option><option value="disabled">Disabled</option><option value="tested">Tested</option><option value="untested">Not tested</option>
            </select>
          </div>
          <p className="text-xs text-surface-400">{matchingRules.length} of {detections.length} loaded rules match. Search and pages review saved content; they do not test or execute rules.</p>
          <nav aria-label="Detection rule pages" className="flex flex-wrap items-center justify-between gap-2 text-xs text-surface-300"><span>Rule page {currentRulePage} of {rulePages}</span><div className="flex gap-2">
            <button type="button" disabled={currentRulePage === 1} onClick={() => setRulePage(currentRulePage - 1)} className="rounded border border-surface-600 px-2 py-1 disabled:opacity-40">Previous rules</button>
            <button type="button" disabled={currentRulePage === rulePages} onClick={() => setRulePage(currentRulePage + 1)} className="rounded border border-surface-600 px-2 py-1 disabled:opacity-40">More rules</button>
          </div></nav>
          {!matchingRules.length && <p className="text-sm text-surface-400">No loaded detection rules match.</p>}
          <ul className="divide-y divide-surface-800">
            {shownRules.map(rule => (
              <li key={rule.id} className="min-w-0 space-y-3 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
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
                      disabled={ruleForm !== null}
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
              </div>
              <details className="min-w-0 rounded border border-surface-700 p-3">
                <summary aria-label={`Inspect saved rule ${rule.name}`} className="cursor-pointer text-xs text-primary-300">Inspect full saved rule</summary>
                <p className="mt-2 whitespace-pre-wrap break-words text-xs text-surface-400">{rule.description || 'No description recorded.'}</p>
                <pre className="mt-3 whitespace-pre-wrap break-words font-mono text-xs text-surface-200">{rule.rule_content}</pre>
                <p className="mt-3 text-xs text-surface-400">{rule.tested ? 'Recorded as tested' : 'No recorded test confirmation'}. Enabled state is not proof of detection.</p>
                <button type="button" disabled={ruleForm !== null} onClick={() => {
                  setEditingRule(null);
                  setRuleForm({ name: `${rule.name} copy`, description: rule.description ?? '', rule_type: rule.rule_type, rule_content: rule.rule_content, confidence: rule.confidence, enabled: false, techniques: (rule.mitre_techniques ?? []).join(', ') });
                }} aria-label={`Clone rule ${rule.name} as disabled draft`} className="mt-3 rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40">Clone as disabled draft</button>
              </details>
              </li>
            ))}
          </ul>
          </div>
        )}
      </div>

      {/* Past Sessions */}
      <section aria-label="Hunt history workspace" className="oa-panel min-w-0 space-y-4 p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-surface-50">Hunt History</h2>
        <p className="text-xs text-surface-400">Search all your recorded hunt hypotheses and session IDs, including sessions beyond the latest 50. Findings counts describe saved query output, not confirmed threats. Reopening reads stored evidence and does not run a new hunt.</p>
        <form onSubmit={event => { event.preventDefault(); setHistoryKeyword(historySearch.trim()); setHistoryPage(1); }} className="flex flex-wrap gap-2">
          <input aria-label="Search hunt history" maxLength={200} value={historySearch} onChange={event => setHistorySearch(event.target.value)} placeholder="Hypothesis or session ID" className="min-w-0 basis-full sm:basis-0 sm:flex-1 rounded border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100" />
          <button type="submit" className="rounded border border-surface-600 px-3 py-2 text-xs text-primary-300">Search hunts</button>
          <select aria-label="Hunt history status" value={historyState} onChange={event => { setHistoryState(event.target.value); setHistoryPage(1); }} className="max-w-full rounded border border-surface-600 bg-surface-950 px-2 py-2 text-xs text-surface-200"><option value="">All statuses</option>{['running','completed','partial','failed'].map(value => <option key={value} value={value}>{value}</option>)}</select>
          <label className="flex items-center gap-2 text-xs text-surface-300"><input type="checkbox" checked={historyFindings} onChange={event => { setHistoryFindings(event.target.checked); setHistoryPage(1); }} />With recorded findings</label>
          {(historyKeyword || historyState || historyFindings) && <button type="button" onClick={() => { setHistorySearch(''); setHistoryKeyword(''); setHistoryState(''); setHistoryFindings(false); setHistoryPage(1); }} className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-200">Clear hunt history filters</button>}
        </form>
        {historySearch.trim() !== historyKeyword && <p className="text-xs text-warning-300">History search draft not applied. Results still use the applied keyword.</p>}
        {loading ? <LoadingSurface label="Loading hunt history" /> : error ? <ErrorState title="Hunt history unavailable" description={error} action={<RetryButton onClick={() => void fetchSessions()} />} /> : <>
        <p className="text-xs text-surface-400">{historyTotal} matching sessions. History page {historyPage} of {Math.max(1, Math.ceil(historyTotal / 20))}.</p>
        {sessions.length === 0 ? (
          <EmptyState title={historyKeyword || historyState || historyFindings ? "No hunts match these filters" : "No hunts yet"} description="Adjust the history filters, or enter a hypothesis above to start a new hunt." />
        ) : (
          <div className="space-y-2">
            {sessions.map(s => (
              <div key={s.id} className="flex items-start gap-2">
                <button
                  type="button"
                  disabled={loadingSessionId !== null || hunting}
                  onClick={() => void viewSession(s.id)}
                  aria-label={`Reopen hunt: ${s.hypothesis}`}
                  className="flex flex-1 min-w-0 flex-wrap items-start gap-2 rounded-lg bg-surface-900/50 p-3 text-left transition-colors hover:bg-surface-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Clock className="w-4 h-4 text-surface-500 shrink-0" />
                  <div className="flex-1 min-w-0 basis-40">
                    <p className="break-words text-sm text-surface-50 [overflow-wrap:anywhere]">#{s.id}: {s.hypothesis}</p>
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
        <nav aria-label="Hunt history pages" className="mt-4 flex flex-wrap justify-between gap-2"><button type="button" disabled={historyPage === 1} onClick={() => setHistoryPage(value => value - 1)} className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40">Previous hunts</button><button type="button" disabled={historyPage * 20 >= historyTotal} onClick={() => setHistoryPage(value => value + 1)} className="rounded border border-surface-600 px-3 py-2 text-xs text-surface-200 disabled:opacity-40">More hunts</button></nav>
        </>}
      </section>

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

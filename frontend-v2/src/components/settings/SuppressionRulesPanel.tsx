import { useCallback, useEffect, useState } from 'react';
import { BellOff, Trash2 } from 'lucide-react';
import apiClient from '../../api/client';
import { getApiErrorMessage } from '../../api/errors';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Panel } from '../ui/Panel';
import { StatusBadge } from '../ui/StatusBadge';
import { toast } from '../Toast';

interface SuppressionRule {
  id: number;
  name: string;
  cve_id: string | null;
  asset_id: number | null;
  severity: string | null;
  title_contains: string | null;
  duration_hours: number;
  enabled: boolean;
  created_at: string;
  matching_active_alerts: number;
}

interface AssetOption {
  id: number;
  name: string;
}

const inputClass = 'w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 placeholder-surface-500';

function describeRule(rule: SuppressionRule, assetNames: Map<number, string>): string {
  const parts: string[] = [];
  if (rule.cve_id) parts.push(rule.cve_id);
  if (rule.asset_id !== null) parts.push(assetNames.get(rule.asset_id) ?? `asset #${rule.asset_id}`);
  if (rule.severity) parts.push(rule.severity);
  if (rule.title_contains) parts.push(`title contains "${rule.title_contains}"`);
  return parts.join(' · ');
}

export function SuppressionRulesPanel() {
  const [rules, setRules] = useState<SuppressionRule[]>([]);
  const [assetNames, setAssetNames] = useState<Map<number, string>>(new Map());
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [cveId, setCveId] = useState('');
  const [assetId, setAssetId] = useState('');
  const [severity, setSeverity] = useState('');
  const [titleContains, setTitleContains] = useState('');
  const [durationHours, setDurationHours] = useState('24');
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SuppressionRule | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadRules = useCallback(async () => {
    try {
      const resp = await apiClient.get<SuppressionRule[]>('/suppression-rules/');
      setRules(resp.data);
      setLoadError(null);
    } catch {
      setLoadError('Suppression rules could not be loaded.');
    }
  }, []);

  useEffect(() => {
    void loadRules();
    (async () => {
      try {
        const resp = await apiClient.get('/assets/', { params: { size: 100 } });
        const list: AssetOption[] = resp.data.assets ?? [];
        setAssets(list);
        setAssetNames(new Map(list.map((a) => [a.id, a.name])));
      } catch {
        // Asset dropdown is optional; criteria can still use CVE/severity/title.
      }
    })();
  }, [loadRules]);

  const resetForm = () => {
    setName('');
    setCveId('');
    setAssetId('');
    setSeverity('');
    setTitleContains('');
    setDurationHours('24');
  };

  const createRule = async () => {
    const trimmed = name.trim();
    const hours = parseInt(durationHours, 10);
    if (!trimmed || creating) return;
    if (!cveId.trim() && !assetId && !severity && !titleContains.trim()) {
      setFormError('Set at least one criterion: a CVE, an asset, a severity, or title text.');
      return;
    }
    if (!Number.isFinite(hours) || hours < 1 || hours > 720) {
      setFormError('Snooze duration must be between 1 and 720 hours.');
      return;
    }
    setFormError(null);
    setCreating(true);
    try {
      await apiClient.post('/suppression-rules/', {
        name: trimmed,
        ...(cveId.trim() ? { cve_id: cveId.trim() } : {}),
        ...(assetId ? { asset_id: parseInt(assetId, 10) } : {}),
        ...(severity ? { severity } : {}),
        ...(titleContains.trim() ? { title_contains: titleContains.trim() } : {}),
        duration_hours: hours,
      });
      toast('Suppression rule created. New matching alerts will be snoozed.', 'success');
      resetForm();
      await loadRules();
    } catch (error) {
      toast(getApiErrorMessage(error, 'The rule could not be created.'), 'error');
    } finally {
      setCreating(false);
    }
  };

  const toggleRule = async (rule: SuppressionRule) => {
    try {
      const resp = await apiClient.patch<SuppressionRule>(`/suppression-rules/${rule.id}`, { enabled: !rule.enabled });
      setRules((prev) => prev.map((r) => (r.id === rule.id ? { ...r, enabled: resp.data.enabled } : r)));
      toast(resp.data.enabled ? 'Rule enabled.' : 'Rule paused.', 'success');
    } catch (error) {
      toast(getApiErrorMessage(error, 'The rule could not be updated.'), 'error');
    }
  };

  const deleteRule = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      await apiClient.delete(`/suppression-rules/${pendingDelete.id}`);
      setRules((prev) => prev.filter((r) => r.id !== pendingDelete.id));
      toast('Suppression rule deleted.', 'success');
      setPendingDelete(null);
    } catch (error) {
      toast(getApiErrorMessage(error, 'The rule could not be deleted.'), 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Panel
      title="Alert suppression rules"
      description="Automatically snooze new alerts that match known noise. Matching alerts stay in the system but leave the active queue for the snooze window."
      action={<BellOff className="h-4 w-4 text-warning" />}
    >
      <div className="space-y-4 p-5">
        {loadError && <p role="alert" className="text-sm text-danger">{loadError}</p>}

        {rules.length > 0 && (
          <ul className="divide-y divide-surface-800 rounded-lg border border-surface-800">
            {rules.map((rule) => (
              <li key={rule.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-surface-100">{rule.name}</span>
                    <StatusBadge tone={rule.enabled ? 'success' : 'neutral'}>{rule.enabled ? 'active' : 'paused'}</StatusBadge>
                  </div>
                  <p className="mt-1 text-xs text-surface-500">
                    {describeRule(rule, assetNames)} · snoozes for {rule.duration_hours}h
                    {rule.matching_active_alerts > 0 && ` · matches ${rule.matching_active_alerts} active alert${rule.matching_active_alerts === 1 ? '' : 's'} now`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void toggleRule(rule)}
                    className="rounded-md border border-surface-600 px-2.5 py-1.5 text-xs text-surface-300 transition-colors hover:text-surface-100"
                  >
                    {rule.enabled ? 'Pause' : 'Enable'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(rule)}
                    aria-label={`Delete rule ${rule.name}`}
                    className="rounded-md border border-surface-600 p-1.5 text-surface-400 transition-colors hover:border-danger/50 hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <form
          className="space-y-3"
          onSubmit={(event) => { event.preventDefault(); void createRule(); }}
        >
          {formError && <p role="alert" className="text-sm text-danger">{formError}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="suppression-name" className="mb-1.5 block text-xs font-medium text-surface-300">Rule name</label>
              <input id="suppression-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Known scanner noise" className={inputClass} />
            </div>
            <div>
              <label htmlFor="suppression-cve" className="mb-1.5 block text-xs font-medium text-surface-300">CVE (optional)</label>
              <input id="suppression-cve" value={cveId} onChange={(e) => setCveId(e.target.value)} placeholder="CVE-2026-1234" className={inputClass} />
            </div>
            <div>
              <label htmlFor="suppression-asset" className="mb-1.5 block text-xs font-medium text-surface-300">Asset (optional)</label>
              <select id="suppression-asset" value={assetId} onChange={(e) => setAssetId(e.target.value)} className={inputClass}>
                <option value="">Any asset</option>
                {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="suppression-severity" className="mb-1.5 block text-xs font-medium text-surface-300">Severity (optional)</label>
              <select id="suppression-severity" value={severity} onChange={(e) => setSeverity(e.target.value)} className={inputClass}>
                <option value="">Any severity</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label htmlFor="suppression-title" className="mb-1.5 block text-xs font-medium text-surface-300">Title contains (optional)</label>
              <input id="suppression-title" value={titleContains} onChange={(e) => setTitleContains(e.target.value)} placeholder="scanner" className={inputClass} />
            </div>
            <div>
              <label htmlFor="suppression-duration" className="mb-1.5 block text-xs font-medium text-surface-300">Snooze hours</label>
              <input id="suppression-duration" type="number" min={1} max={720} value={durationHours} onChange={(e) => setDurationHours(e.target.value)} className={inputClass} />
            </div>
          </div>
          <button
            type="submit"
            disabled={creating || !name.trim()}
            className="rounded-md bg-primary-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create rule'}
          </button>
        </form>
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete suppression rule?"
          description={`New alerts matching "${pendingDelete.name}" will no longer be snoozed automatically.`}
          confirmLabel="Delete rule"
          tone="danger"
          busy={deleting}
          onConfirm={() => void deleteRule()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </Panel>
  );
}

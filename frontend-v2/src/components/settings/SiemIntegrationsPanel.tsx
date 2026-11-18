import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plug, Plus, Trash2 } from 'lucide-react';
import apiClient from '../../api/client';
import { getApiErrorMessage } from '../../api/errors';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Panel } from '../ui/Panel';
import { StatusBadge } from '../ui/StatusBadge';

interface IntegrationType {
  type: string;
  name: string;
  description: string;
}

interface Integration {
  id: number;
  integration_type: string;
  name: string;
  config: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
}

interface FieldSpec {
  key: string;
  label: string;
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
}

// Field sets mirror backend/services/integrations/*.py.
const TYPE_FIELDS: Record<string, FieldSpec[]> = {
  splunk: [
    { key: 'hec_url', label: 'HEC URL', required: true, placeholder: 'https://splunk.example.com:8088' },
    { key: 'hec_token', label: 'HEC token', secret: true, required: true },
    { key: 'index', label: 'Index', placeholder: 'main' },
    { key: 'source_type', label: 'Source type', placeholder: 'onealert:vulnerability' },
  ],
  sentinel: [
    { key: 'workspace_id', label: 'Workspace ID', required: true },
    { key: 'shared_key', label: 'Shared key', secret: true, required: true },
    { key: 'log_type', label: 'Log type', placeholder: 'OneAlert_Vulnerability' },
  ],
  servicenow: [
    { key: 'instance_url', label: 'Instance URL', required: true, placeholder: 'https://example.service-now.com' },
    { key: 'username', label: 'Username', required: true },
    { key: 'password', label: 'Password', secret: true, required: true },
  ],
  pagerduty: [
    { key: 'routing_key', label: 'Routing key', secret: true, required: true },
  ],
};

const inputClass = 'w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 placeholder-surface-500';

export function SiemIntegrationsPanel() {
  const [types, setTypes] = useState<IntegrationType[]>([]);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Integration | null>(null);
  const [name, setName] = useState('');
  const [selectedType, setSelectedType] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Integration | null>(null);

  const unwrap = <T,>(payload: unknown): T[] => {
    const body = payload as { data?: T[] | { data?: T[] } };
    const inner = body?.data;
    if (Array.isArray(inner)) return inner;
    if (inner && Array.isArray(inner.data)) return inner.data;
    return [];
  };

  const fetchAll = useCallback(async () => {
    setLoadError(null);
    const [typesResult, listResult] = await Promise.allSettled([
      apiClient.get('/integrations/types'),
      apiClient.get('/integrations/'),
    ]);
    if (typesResult.status === 'fulfilled') setTypes(unwrap<IntegrationType>(typesResult.value.data));
    if (listResult.status === 'fulfilled') setIntegrations(unwrap<Integration>(listResult.value.data));
    if (typesResult.status === 'rejected' && listResult.status === 'rejected') {
      setLoadError(getApiErrorMessage(listResult.reason, 'Integrations could not be loaded.'));
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const typeName = (type: string) => types.find(t => t.type === type)?.name ?? type;

  const resetForm = () => {
    setAdding(false);
    setEditing(null);
    setName('');
    setSelectedType('');
    setFields({});
  };

  const startEdit = (integration: Integration) => {
    setAdding(false);
    setEditing(integration);
    setName(integration.name);
    setSelectedType(integration.integration_type);
    const spec = TYPE_FIELDS[integration.integration_type] ?? [];
    const nextFields: Record<string, string> = {};
    for (const f of spec) {
      const value = integration.config?.[f.key];
      // Secrets come back masked; leave them blank so the stored value is kept.
      if (!f.secret && typeof value === 'string') nextFields[f.key] = value;
    }
    setFields(nextFields);
    setMessage(null);
  };

  const handleSave = async () => {
    if (saving) return;
    const spec = TYPE_FIELDS[selectedType] ?? [];
    const missing = spec.filter(f => f.required && !(f.secret && editing) && !fields[f.key]?.trim());
    if (!name.trim() || !selectedType || missing.length > 0) {
      setMessage({ text: 'Fill in the name, type and every required field.', error: true });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const config: Record<string, string> = {};
      for (const f of spec) {
        const value = fields[f.key]?.trim();
        if (value) config[f.key] = value;
      }
      if (editing) {
        await apiClient.patch(`/integrations/${editing.id}`, { name: name.trim(), config });
        setMessage({ text: `${typeName(selectedType)} integration updated.`, error: false });
      } else {
        await apiClient.post('/integrations/', { integration_type: selectedType, name: name.trim(), config });
        setMessage({ text: `${typeName(selectedType)} integration added.`, error: false });
      }
      resetForm();
      await fetchAll();
    } catch (error: unknown) {
      setMessage({ text: getApiErrorMessage(error, 'The integration could not be saved.'), error: true });
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (integration: Integration) => {
    if (busyId) return;
    setBusyId(integration.id);
    setMessage(null);
    try {
      await apiClient.patch(`/integrations/${integration.id}`, { is_active: !integration.is_active });
      await fetchAll();
    } catch (error: unknown) {
      setMessage({ text: getApiErrorMessage(error, 'The integration could not be updated.'), error: true });
    } finally {
      setBusyId(null);
    }
  };

  const handleTest = async (integration: Integration) => {
    if (busyId) return;
    setBusyId(integration.id);
    setMessage(null);
    try {
      await apiClient.post(`/integrations/${integration.id}/test`);
      setMessage({ text: `${integration.name} connected successfully.`, error: false });
    } catch (error: unknown) {
      setMessage({ text: getApiErrorMessage(error, `The ${integration.name} connection test failed.`), error: true });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete || busyId) return;
    setBusyId(pendingDelete.id);
    setMessage(null);
    try {
      await apiClient.delete(`/integrations/${pendingDelete.id}`);
      setPendingDelete(null);
      setMessage({ text: 'Integration deleted.', error: false });
      await fetchAll();
    } catch (error: unknown) {
      setMessage({ text: getApiErrorMessage(error, 'The integration could not be deleted.'), error: true });
    } finally {
      setBusyId(null);
    }
  };

  const spec = TYPE_FIELDS[selectedType] ?? [];

  return (
    <Panel title="SIEM & SOAR" description="Forward alerts and cases to your security stack. Credentials are stored server-side and never shown here." action={<Plug className="h-4 w-4 text-info" />}>
      <div className="p-5">
        {loadError && <p role="alert" className="mb-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">{loadError}</p>}
        {message && <div role={message.error ? 'alert' : 'status'} className={`mb-3 rounded-md border px-3 py-2 text-xs ${message.error ? 'border-danger/30 bg-danger/10 text-danger' : 'border-success/30 bg-success/10 text-success'}`}>{message.text}</div>}

        {integrations.length === 0 && !loadError && <p className="mb-3 text-sm text-surface-400">No integrations configured yet.</p>}
        <ul className="divide-y divide-surface-800">
          {integrations.map(integration => (
            <li key={integration.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium text-surface-200">{integration.name}</p>
                <p className="truncate text-xs text-surface-500">{typeName(integration.integration_type)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <StatusBadge tone={integration.is_active ? 'success' : 'neutral'}>{integration.is_active ? 'Active' : 'Inactive'}</StatusBadge>
                <button type="button" aria-label={`Edit ${integration.name}`} disabled={busyId === integration.id} onClick={() => startEdit(integration)} className="rounded-md border border-surface-600 p-1.5 text-surface-300 hover:bg-surface-800 disabled:opacity-50"><Pencil className="h-3.5 w-3.5" /></button>
                <button type="button" disabled={busyId === integration.id} onClick={() => void handleTest(integration)} className="rounded-md border border-surface-600 px-2 py-1 text-xs text-surface-300 hover:bg-surface-800 disabled:opacity-50">Test</button>
                <button type="button" disabled={busyId === integration.id} onClick={() => void handleToggle(integration)} className="rounded-md border border-surface-600 px-2 py-1 text-xs text-surface-300 hover:bg-surface-800 disabled:opacity-50">{integration.is_active ? 'Disable' : 'Enable'}</button>
                <button type="button" aria-label={`Delete ${integration.name}`} disabled={busyId === integration.id} onClick={() => setPendingDelete(integration)} className="rounded-md border border-danger/40 p-1.5 text-danger hover:bg-danger/10 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            </li>
          ))}
        </ul>

        {!adding && !editing && (
          <button type="button" onClick={() => { setAdding(true); setMessage(null); }} className="mt-4 inline-flex min-h-9 items-center gap-1.5 rounded-md border border-primary-500/40 px-3 text-sm font-semibold text-primary-300 hover:bg-primary-500/10">
            <Plus className="h-4 w-4" /> Add integration
          </button>
        )}

        {(adding || editing) && (
          <form className="mt-4 space-y-3 rounded-md border border-surface-700 bg-surface-950/60 p-4" onSubmit={event => { event.preventDefault(); void handleSave(); }}>
            <div>
              <label htmlFor="siem-name" className="mb-1 block text-xs font-medium text-surface-300">Name</label>
              <input id="siem-name" type="text" autoComplete="off" value={name} onChange={e => setName(e.target.value)} placeholder="Production Splunk" className={inputClass} />
            </div>
            <div>
              <label htmlFor="siem-type" className="mb-1 block text-xs font-medium text-surface-300">Type</label>
              <select id="siem-type" disabled={editing !== null} value={selectedType} onChange={e => { setSelectedType(e.target.value); setFields({}); }} className={`${inputClass} disabled:opacity-50`}>
                <option value="">Choose a type…</option>
                {types.map(t => <option key={t.type} value={t.type}>{t.name} - {t.description}</option>)}
              </select>
            </div>
            {spec.map(f => (
              <div key={f.key}>
                <label htmlFor={`siem-field-${f.key}`} className="mb-1 block text-xs font-medium text-surface-300">
                  {f.label}{f.required && !(f.secret && editing) ? ' *' : ''}
                  {f.secret && editing && <span className="ml-1 font-normal text-surface-500">(stored - leave blank to keep)</span>}
                </label>
                <input
                  id={`siem-field-${f.key}`}
                  type={f.secret ? 'password' : 'text'}
                  autoComplete="off"
                  value={fields[f.key] ?? ''}
                  placeholder={f.placeholder}
                  onChange={e => setFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                  className={inputClass}
                />
              </div>
            ))}
            <div className="flex items-center gap-2 pt-1">
              <button type="submit" disabled={saving} className="min-h-9 rounded-md bg-primary-500 px-4 text-sm font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-50">{saving ? 'Saving…' : editing ? 'Update integration' : 'Save integration'}</button>
              <button type="button" onClick={resetForm} className="rounded-md border border-surface-600 px-3 py-2 text-sm text-surface-300 hover:bg-surface-800">Cancel</button>
            </div>
          </form>
        )}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete integration"
          description={`Delete ${pendingDelete.name}? Alerts and cases will stop flowing to this destination.`}
          confirmLabel="Delete integration"
          tone="danger"
          busy={busyId === pendingDelete.id}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void handleDelete()}
        />
      )}
    </Panel>
  );
}

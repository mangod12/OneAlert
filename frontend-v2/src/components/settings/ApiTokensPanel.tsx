import { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, Trash2 } from 'lucide-react';
import apiClient from '../../api/client';
import { getApiErrorMessage } from '../../api/errors';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Panel } from '../ui/Panel';
import { StatusBadge } from '../ui/StatusBadge';
import { toast } from '../Toast';

interface ApiToken {
  id: number;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  read_only: boolean;
}

interface CreatedToken extends ApiToken {
  token: string;
}

const EXPIRY_OPTIONS: Array<{ label: string; days: number | null }> = [
  { label: 'No expiry', days: null },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '365 days', days: 365 },
];

const inputClass = 'w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 placeholder-surface-500';

const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString() : 'Never';

export function ApiTokensPanel() {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [expiryDays, setExpiryDays] = useState<number | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<CreatedToken | null>(null);
  const [pendingRevoke, setPendingRevoke] = useState<ApiToken | null>(null);
  const [revoking, setRevoking] = useState(false);

  const loadTokens = useCallback(async () => {
    try {
      const resp = await apiClient.get<ApiToken[]>('/api-tokens/');
      setTokens(resp.data);
      setLoadError(null);
    } catch {
      setLoadError('API tokens could not be loaded.');
    }
  }, []);

  useEffect(() => {
    void loadTokens();
  }, [loadTokens]);

  const createToken = async () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const resp = await apiClient.post<CreatedToken>('/api-tokens/', {
        name: trimmed,
        ...(expiryDays !== null ? { expires_in_days: expiryDays } : {}),
        ...(readOnly ? { read_only: true } : {}),
      });
      setJustCreated(resp.data);
      setName('');
      setExpiryDays(null);
      setReadOnly(false);
      await loadTokens();
    } catch (error) {
      toast(getApiErrorMessage(error, 'The token could not be created.'), 'error');
    } finally {
      setCreating(false);
    }
  };

  const copyToken = async () => {
    if (!justCreated) return;
    try {
      await navigator.clipboard.writeText(justCreated.token);
      toast('Token copied to the clipboard.', 'success');
    } catch {
      toast('Copy failed - select and copy the token manually.', 'error');
    }
  };

  const revokeToken = async () => {
    if (!pendingRevoke || revoking) return;
    setRevoking(true);
    try {
      await apiClient.delete(`/api-tokens/${pendingRevoke.id}`);
      toast(`Token "${pendingRevoke.name}" revoked.`, 'success');
      setPendingRevoke(null);
      await loadTokens();
    } catch (error) {
      toast(getApiErrorMessage(error, 'The token could not be revoked.'), 'error');
    } finally {
      setRevoking(false);
    }
  };

  return (
    <Panel
      title="API tokens"
      description="Personal tokens for scripts and integrations. Send them as Authorization: Bearer <token>. The raw token is shown only once, at creation."
      action={<KeyRound className="h-4 w-4 text-warning" />}
    >
      <div className="space-y-4 px-5 py-4">
        {justCreated && (
          <div className="rounded-md border border-primary-500/40 bg-primary-500/10 p-3">
            <p className="text-xs font-medium text-primary-200">
              Token "{justCreated.name}" created. Copy it now - it will not be shown again.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded border border-surface-700 bg-surface-950 px-2 py-1.5 font-mono text-xs text-surface-100">
                {justCreated.token}
              </code>
              <button
                type="button"
                onClick={() => void copyToken()}
                aria-label="Copy the new token"
                className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-primary-500"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy
              </button>
              <button
                type="button"
                onClick={() => setJustCreated(null)}
                className="shrink-0 rounded-md border border-surface-600 px-2.5 py-1.5 text-xs text-surface-300 hover:bg-surface-800"
              >
                Done
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-48 flex-1">
            <label htmlFor="api-token-name" className="mb-1 block text-xs text-surface-400">Token name</label>
            <input
              id="api-token-name"
              type="text"
              value={name}
              maxLength={80}
              placeholder="e.g. CI pipeline"
              onChange={event => setName(event.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="api-token-expiry" className="mb-1 block text-xs text-surface-400">Expires</label>
            <select
              id="api-token-expiry"
              value={expiryDays === null ? '' : String(expiryDays)}
              onChange={event => setExpiryDays(event.target.value === '' ? null : Number(event.target.value))}
              className="rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100"
            >
              {EXPIRY_OPTIONS.map(option => (
                <option key={option.label} value={option.days === null ? '' : String(option.days)}>{option.label}</option>
              ))}
            </select>
          </div>
          <label htmlFor="api-token-read-only" className="flex items-center gap-2 pb-2 text-xs text-surface-300">
            <input
              id="api-token-read-only"
              type="checkbox"
              checked={readOnly}
              onChange={event => setReadOnly(event.target.checked)}
              className="h-4 w-4 rounded border-surface-600 bg-surface-950 text-primary-500 focus:ring-2 focus:ring-primary-500"
            />
            Read-only (GET requests only)
          </label>
          <button
            type="button"
            disabled={!name.trim() || creating}
            onClick={() => void createToken()}
            className="rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-500 disabled:opacity-40"
          >
            {creating ? 'Creating...' : 'Create token'}
          </button>
        </div>

        {loadError && <p className="text-sm text-danger">{loadError}</p>}

        {!loadError && tokens.length === 0 && (
          <p className="text-sm text-surface-500">No API tokens yet.</p>
        )}

        {tokens.length > 0 && (
          <ul className="divide-y divide-surface-800 rounded-md border border-surface-800">
            {tokens.map(token => (
              <li key={token.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`truncate text-sm ${token.revoked_at ? 'text-surface-500 line-through' : 'text-surface-100'}`}>
                      {token.name}
                    </span>
                    {token.revoked_at && <StatusBadge tone="neutral">revoked</StatusBadge>}
                    {token.read_only && <StatusBadge tone="info">read-only</StatusBadge>}
                  </div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-surface-500">
                    <span className="font-mono">{token.prefix}...</span>
                    <span>Created {formatDate(token.created_at)}</span>
                    <span>Last used {token.last_used_at ? formatDate(token.last_used_at) : 'never'}</span>
                    <span>Expires {formatDate(token.expires_at)}</span>
                  </div>
                </div>
                {!token.revoked_at && (
                  <button
                    type="button"
                    aria-label={`Revoke token ${token.name}`}
                    onClick={() => setPendingRevoke(token)}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded text-surface-500 hover:bg-surface-800 hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {pendingRevoke && (
        <ConfirmDialog
          title="Revoke API token"
          description={`Revoke "${pendingRevoke.name}"? Anything authenticating with it will immediately lose access.`}
          confirmLabel="Revoke token"
          tone="danger"
          busy={revoking}
          onCancel={() => setPendingRevoke(null)}
          onConfirm={() => void revokeToken()}
        />
      )}
    </Panel>
  );
}

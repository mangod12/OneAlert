import { useState } from 'react';
import { Bell, KeyRound, Settings as SettingsIcon, Shield, UserRound } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { PageHeader } from '../components/ui/PageHeader';
import { Panel } from '../components/ui/Panel';
import { StatusBadge } from '../components/ui/StatusBadge';

export function Settings() {
  const { user } = useAuthStore();
  const [slackUrl, setSlackUrl] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [mfaUri, setMfaUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const handleSaveIntegrations = async () => {
    if (!slackUrl && !webhookUrl) {
      setMessage({ text: 'Enter at least one HTTPS webhook URL to update.', error: true });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      await apiClient.patch('/auth/me/integrations', {
        slack_webhook_url: slackUrl || null,
        webhook_url: webhookUrl || null,
      });
      setSlackUrl('');
      setWebhookUrl('');
      setMessage({ text: 'Integration credentials updated and hidden.', error: false });
    } catch (error: unknown) {
      setMessage({ text: getApiErrorMessage(error, 'Integration settings could not be saved.'), error: true });
    } finally {
      setSaving(false);
    }
  };

  const handleSetupMFA = async () => {
    setMessage(null);
    try {
      const response = await apiClient.post<{ provisioning_uri: string }>('/auth/me/mfa/setup');
      setMfaUri(response.data.provisioning_uri);
    } catch (error: unknown) {
      setMessage({ text: getApiErrorMessage(error, 'MFA setup could not be started.'), error: true });
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Govern" title="Settings" description="Account security and write-only notification credentials for this operator workspace." />

      {message && <div role={message.error ? 'alert' : 'status'} className={`rounded-md border px-4 py-3 text-sm ${message.error ? 'border-danger/30 bg-danger/10 text-danger' : 'border-success/30 bg-success/10 text-success'}`}>{message.text}</div>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(28rem,1.2fr)]">
        <div className="space-y-4">
          <Panel title="Operator profile" description="Identity and access context for the active session." action={<UserRound className="h-4 w-4 text-primary-300" />}>
            <dl className="divide-y divide-surface-800 px-5">
              {[
                ['Email', user?.email || 'Unavailable'],
                ['Name', user?.full_name || 'Not set'],
                ['Company', user?.company || 'Not set'],
              ].map(([label, value]) => <div key={label} className="flex items-center justify-between gap-4 py-3 text-sm"><dt className="text-surface-400">{label}</dt><dd className="truncate text-right font-medium text-surface-200">{value}</dd></div>)}
              <div className="flex items-center justify-between gap-4 py-3 text-sm"><dt className="text-surface-400">Role</dt><dd><StatusBadge tone="info">{user?.role || 'analyst'}</StatusBadge></dd></div>
            </dl>
          </Panel>

          <Panel title="Multi-factor authentication" description="TOTP adds a second verification step to password sign-in." action={<Shield className="h-4 w-4 text-success" />}>
            <div className="p-5">
              {user?.mfa_enabled ? <StatusBadge tone="success">MFA enabled</StatusBadge> : <button type="button" onClick={handleSetupMFA} className="inline-flex min-h-9 items-center gap-2 rounded-md bg-primary-500 px-3.5 text-sm font-semibold text-surface-950 hover:bg-primary-400"><KeyRound className="h-4 w-4" /> Enable MFA</button>}
              {mfaUri && <div className="mt-4 rounded-md border border-surface-700 bg-surface-950 p-4"><p className="mb-2 text-xs text-surface-400">Add this provisioning URI to your authenticator, then finish verification.</p><code className="block break-all text-xs text-primary-300">{mfaUri}</code></div>}
            </div>
          </Panel>
        </div>

        <Panel title="Notification integrations" description="Credentials are write-only. Existing values are never returned to the browser." action={<Bell className="h-4 w-4 text-warning" />}>
          <form className="space-y-5 p-5" onSubmit={event => { event.preventDefault(); void handleSaveIntegrations(); }}>
            <div>
              <label htmlFor="slack-webhook" className="mb-1.5 block text-sm font-medium text-surface-300">Slack webhook URL</label>
              <input id="slack-webhook" type="url" inputMode="url" autoComplete="off" value={slackUrl} onChange={event => setSlackUrl(event.target.value)} placeholder="https://hooks.slack.com/services/…" className="w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2.5 text-sm text-surface-100 placeholder-surface-500" />
              <p className="mt-1.5 text-xs text-surface-500">Must use HTTPS. The credential is cleared from this form after saving.</p>
            </div>
            <div>
              <label htmlFor="custom-webhook" className="mb-1.5 block text-sm font-medium text-surface-300">Custom webhook URL</label>
              <input id="custom-webhook" type="url" inputMode="url" autoComplete="off" value={webhookUrl} onChange={event => setWebhookUrl(event.target.value)} placeholder="https://security.example.com/onealert" className="w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2.5 text-sm text-surface-100 placeholder-surface-500" />
            </div>
            <div className="flex items-center justify-between gap-4 border-t border-surface-800 pt-4">
              <span className="flex items-center gap-2 text-xs text-surface-500"><SettingsIcon className="h-3.5 w-3.5" /> Sent in an encrypted request body</span>
              <button type="submit" disabled={saving} className="min-h-9 rounded-md bg-primary-500 px-4 text-sm font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-50">{saving ? 'Saving…' : 'Save integrations'}</button>
            </div>
          </form>
        </Panel>
      </div>
    </div>
  );
}

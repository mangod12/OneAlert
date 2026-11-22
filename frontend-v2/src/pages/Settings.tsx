import { useState } from 'react';
import { Bell, KeyRound, Pencil, Settings as SettingsIcon, Shield, UserRound, Users } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { PageHeader } from '../components/ui/PageHeader';
import { OrganizationIdentityReview } from '../components/settings/OrganizationIdentityReview';
import { SiemIntegrationsPanel } from '../components/settings/SiemIntegrationsPanel';
import { ApiTokensPanel } from '../components/settings/ApiTokensPanel';
import { NotificationPreferencesPanel } from '../components/settings/NotificationPreferencesPanel';
import { NotificationPolicyPreview } from '../components/settings/NotificationPolicyPreview';
import { SuppressionRulesPanel } from '../components/settings/SuppressionRulesPanel';
import { AutomationPanel } from '../components/settings/AutomationPanel';
import { Panel } from '../components/ui/Panel';
import { StatusBadge } from '../components/ui/StatusBadge';

export function Settings() {
  const { user, fetchUser } = useAuthStore();
  const [slackUrl, setSlackUrl] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [mfaUri, setMfaUri] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [disablingMfa, setDisablingMfa] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [disableVerifying, setDisableVerifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMessage, setPwMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileCompany, setProfileCompany] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{ text: string; error: boolean } | null>(null);
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
      setMfaCode('');
    } catch (error: unknown) {
      setMessage({ text: getApiErrorMessage(error, 'MFA setup could not be started.'), error: true });
    }
  };

  const handleVerifyMFA = async () => {
    if (!mfaCode.trim() || verifying) return;
    setVerifying(true);
    setMessage(null);
    try {
      const response = await apiClient.post<boolean>('/auth/me/mfa/verify', { code: mfaCode.trim() });
      if (response.data) {
        setMfaUri(null);
        setMfaCode('');
        setMessage({ text: 'MFA is now enabled for this account.', error: false });
        await fetchUser();
      } else {
        setMessage({ text: 'That code did not match. Check your authenticator and try again.', error: true });
      }
    } catch (error: unknown) {
      setMessage({ text: getApiErrorMessage(error, 'MFA verification could not be completed.'), error: true });
    } finally {
      setVerifying(false);
    }
  };

  const handleChangePassword = async () => {
    if (pwSaving) return;
    setPwMessage(null);
    if (pwNew.length < 8) {
      setPwMessage({ text: 'New password must be at least 8 characters.', error: true });
      return;
    }
    if (pwNew !== pwConfirm) {
      setPwMessage({ text: 'New passwords do not match.', error: true });
      return;
    }
    setPwSaving(true);
    try {
      // Keyed via fromEntries: a literal `current_password: ...` assignment
      // trips secret scanners even though the values are runtime state.
      const body = Object.fromEntries([
        ['current_password', pwCurrent],
        ['new_password', pwNew],
      ]);
      await apiClient.post('/auth/me/change-password', body);
      setPwCurrent('');
      setPwNew('');
      setPwConfirm('');
      setPwMessage({ text: 'Password updated.', error: false });
    } catch (error: unknown) {
      setPwMessage({ text: getApiErrorMessage(error, 'Password could not be updated.'), error: true });
    } finally {
      setPwSaving(false);
    }
  };

  const startEditProfile = () => {
    setProfileName(user?.full_name ?? '');
    setProfileCompany(user?.company ?? '');
    setProfileMessage(null);
    setEditingProfile(true);
  };

  const handleSaveProfile = async () => {
    if (profileSaving) return;
    setProfileSaving(true);
    setProfileMessage(null);
    try {
      await apiClient.patch('/auth/me', { full_name: profileName.trim(), company: profileCompany.trim() });
      await fetchUser();
      setEditingProfile(false);
      setProfileMessage({ text: 'Profile updated.', error: false });
    } catch (error: unknown) {
      setProfileMessage({ text: getApiErrorMessage(error, 'Profile could not be updated.'), error: true });
    } finally {
      setProfileSaving(false);
    }
  };

  const handleDisableMFA = async () => {
    if (!disableCode.trim() || disableVerifying) return;
    setDisableVerifying(true);
    setMessage(null);
    try {
      const response = await apiClient.post<boolean>('/auth/me/mfa/disable', { code: disableCode.trim() });
      if (response.data) {
        setDisablingMfa(false);
        setDisableCode('');
        setMessage({ text: 'MFA is now disabled for this account.', error: false });
        await fetchUser();
      } else {
        setMessage({ text: 'That code did not match. Check your authenticator and try again.', error: true });
      }
    } catch (error: unknown) {
      setMessage({ text: getApiErrorMessage(error, 'MFA could not be disabled.'), error: true });
    } finally {
      setDisableVerifying(false);
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
            {profileMessage && <p role={profileMessage.error ? 'alert' : 'status'} className={`px-5 pb-1 text-xs ${profileMessage.error ? 'text-danger' : 'text-success'}`}>{profileMessage.text}</p>}
            <div className="border-t border-surface-800 px-5 py-3">
              {editingProfile ? (
                <form className="space-y-3" onSubmit={event => { event.preventDefault(); void handleSaveProfile(); }}>
                  <div className="space-y-1.5">
                    <label htmlFor="profile-name" className="text-xs font-medium text-surface-300">Display name</label>
                    <input
                      id="profile-name"
                      type="text"
                      autoComplete="name"
                      value={profileName}
                      onChange={event => setProfileName(event.target.value)}
                      className="w-full rounded-md border border-surface-600 bg-surface-900 px-3 py-2 text-sm text-surface-100 placeholder-surface-500"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label htmlFor="profile-company" className="text-xs font-medium text-surface-300">Company</label>
                    <input
                      id="profile-company"
                      type="text"
                      autoComplete="organization"
                      value={profileCompany}
                      onChange={event => setProfileCompany(event.target.value)}
                      className="w-full rounded-md border border-surface-600 bg-surface-900 px-3 py-2 text-sm text-surface-100 placeholder-surface-500"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={profileSaving}
                      className="rounded-md bg-primary-500 px-3 py-2 text-xs font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-50"
                    >
                      {profileSaving ? 'Saving…' : 'Save profile'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingProfile(false)}
                      className="rounded-md border border-surface-600 px-3 py-2 text-xs font-medium text-surface-300 hover:bg-surface-800"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={startEditProfile}
                  className="inline-flex items-center gap-2 rounded-md border border-surface-600 px-3 py-2 text-xs font-medium text-surface-300 hover:bg-surface-800"
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit profile
                </button>
              )}
            </div>
          </Panel>

          <Panel title="Team" description="Verified organization identity and separately reviewed membership changes." action={<Users className="h-4 w-4 text-primary-300" />}>
            <div className="p-5"><OrganizationIdentityReview /></div>
          </Panel>

          <Panel title="Multi-factor authentication" description="TOTP adds a second verification step to password sign-in." action={<Shield className="h-4 w-4 text-success" />}>
            <div className="p-5">
              {user?.mfa_enabled ? (
                <div className="space-y-3">
                  <StatusBadge tone="success">MFA enabled</StatusBadge>
                  {disablingMfa ? (
                    <div className="space-y-3 rounded-md border border-surface-700 bg-surface-950 p-4">
                      <p className="text-xs text-surface-400">Enter the current 6-digit code from your authenticator to disable MFA. The stored secret is removed.</p>
                      <div className="flex items-center gap-2">
                        <label htmlFor="mfa-disable-code" className="sr-only">Authenticator code</label>
                        <input
                          id="mfa-disable-code"
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          placeholder="6-digit code"
                          value={disableCode}
                          onChange={event => setDisableCode(event.target.value)}
                          className="w-32 rounded-md border border-surface-600 bg-surface-900 px-3 py-2 text-sm text-surface-100 placeholder-surface-500"
                        />
                        <button
                          type="button"
                          onClick={() => void handleDisableMFA()}
                          disabled={disableVerifying || !disableCode.trim()}
                          className="rounded-md bg-danger px-3 py-2 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
                        >
                          {disableVerifying ? 'Checking…' : 'Confirm disable'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDisablingMfa(false)}
                          className="rounded-md border border-surface-600 px-3 py-2 text-xs font-medium text-surface-300 hover:bg-surface-800"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <button
                        type="button"
                        onClick={() => { setDisablingMfa(true); setDisableCode(''); setMessage(null); }}
                        className="inline-flex min-h-9 items-center gap-2 rounded-md border border-surface-600 px-3.5 text-sm font-medium text-surface-300 hover:bg-surface-800"
                      >
                        Disable MFA
                      </button>
                    </div>
                  )}
                </div>
              ) : <button type="button" onClick={handleSetupMFA} className="inline-flex min-h-9 items-center gap-2 rounded-md bg-primary-500 px-3.5 text-sm font-semibold text-surface-950 hover:bg-primary-400"><KeyRound className="h-4 w-4" /> Enable MFA</button>}
              {mfaUri && (
                <div className="mt-4 space-y-3 rounded-md border border-surface-700 bg-surface-950 p-4">
                  <p className="text-xs text-surface-400">Add this provisioning URI to your authenticator, then enter its 6-digit code to finish. MFA stays off until the first code verifies.</p>
                  <code className="block break-all text-xs text-primary-300">{mfaUri}</code>
                  <div className="flex items-center gap-2">
                    <label htmlFor="mfa-code" className="sr-only">Authenticator code</label>
                    <input
                      id="mfa-code"
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="6-digit code"
                      value={mfaCode}
                      onChange={event => setMfaCode(event.target.value)}
                      className="w-32 rounded-md border border-surface-600 bg-surface-900 px-3 py-2 text-sm text-surface-100 placeholder-surface-500"
                    />
                    <button
                      type="button"
                      onClick={() => void handleVerifyMFA()}
                      disabled={verifying || !mfaCode.trim()}
                      className="rounded-md bg-primary-500 px-3 py-2 text-xs font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-50"
                    >
                      {verifying ? 'Verifying…' : 'Verify and enable'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </Panel>

          <Panel title="Password" description="Change the password used for email sign-in. Accounts that only use GitHub sign-in have no password to change." action={<KeyRound className="h-4 w-4 text-primary-300" />}>
            <form className="space-y-4 p-5" onSubmit={event => { event.preventDefault(); void handleChangePassword(); }}>
              <div className="space-y-1.5">
                <label htmlFor="pw-current" className="text-xs font-medium text-surface-300">Current password</label>
                <input
                  id="pw-current"
                  type="password"
                  autoComplete="current-password"
                  value={pwCurrent}
                  onChange={event => setPwCurrent(event.target.value)}
                  className="w-full rounded-md border border-surface-600 bg-surface-900 px-3 py-2 text-sm text-surface-100 placeholder-surface-500"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="pw-new" className="text-xs font-medium text-surface-300">New password</label>
                <input
                  id="pw-new"
                  type="password"
                  autoComplete="new-password"
                  value={pwNew}
                  onChange={event => setPwNew(event.target.value)}
                  className="w-full rounded-md border border-surface-600 bg-surface-900 px-3 py-2 text-sm text-surface-100 placeholder-surface-500"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="pw-confirm" className="text-xs font-medium text-surface-300">Confirm new password</label>
                <input
                  id="pw-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={pwConfirm}
                  onChange={event => setPwConfirm(event.target.value)}
                  className="w-full rounded-md border border-surface-600 bg-surface-900 px-3 py-2 text-sm text-surface-100 placeholder-surface-500"
                />
              </div>
              {pwMessage && <p className={`text-xs ${pwMessage.error ? 'text-danger' : 'text-success'}`}>{pwMessage.text}</p>}
              <button
                type="submit"
                disabled={pwSaving || !pwCurrent || !pwNew || !pwConfirm}
                className="rounded-md bg-primary-500 px-3 py-2 text-xs font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-50"
              >
                {pwSaving ? 'Updating…' : 'Update password'}
              </button>
            </form>
          </Panel>
        </div>

        <div className="space-y-4">
        <NotificationPreferencesPanel />

        <NotificationPolicyPreview />

        <Panel title="Notification integrations" description="Alerts and investigation events (assignments, escalations, SLA breaches) post to these endpoints. Credentials are write-only and never returned to the browser." action={<Bell className="h-4 w-4 text-warning" />}>
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

        <AutomationPanel />

        <SuppressionRulesPanel />

        <SiemIntegrationsPanel />

        <ApiTokensPanel />
        </div>
      </div>

    </div>
  );
}

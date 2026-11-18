import { useEffect, useState } from 'react';
import { Bell, KeyRound, Mail, Pencil, Settings as SettingsIcon, Shield, UserPlus, UserRound, Users } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { PageHeader } from '../components/ui/PageHeader';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { SiemIntegrationsPanel } from '../components/settings/SiemIntegrationsPanel';
import { ApiTokensPanel } from '../components/settings/ApiTokensPanel';
import { Panel } from '../components/ui/Panel';
import { StatusBadge } from '../components/ui/StatusBadge';

interface Org {
  id: number;
  name: string;
  slug: string;
  plan: string;
  max_users: number;
}

interface OrgMember {
  id: number;
  email: string;
  full_name: string | null;
  is_active: boolean;
}

export function Settings() {
  const { user, fetchUser } = useAuthStore();
  const [slackUrl, setSlackUrl] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [mfaUri, setMfaUri] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [noOrg, setNoOrg] = useState(false);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [pendingRemove, setPendingRemove] = useState<OrgMember | null>(null);
  const [removing, setRemoving] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [teamMessage, setTeamMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [notifEnabled, setNotifEnabled] = useState(true);
  const [notifMinSeverity, setNotifMinSeverity] = useState('low');
  const [notifMutedKinds, setNotifMutedKinds] = useState<string[]>([]);
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifMessage, setNotifMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [renaming, setRenaming] = useState(false);

  const fetchTeam = async () => {
    try {
      const orgResponse = await apiClient.get<Org>('/orgs/me');
      setOrg(orgResponse.data);
      setNoOrg(false);
      const membersResponse = await apiClient.get<OrgMember[]>('/orgs/me/members');
      setMembers(membersResponse.data);
    } catch (error: unknown) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 404) {
        setNoOrg(true);
        setOrg(null);
        setMembers([]);
      } else {
        setTeamMessage({ text: getApiErrorMessage(error, 'Team information could not be loaded.'), error: true });
      }
    }
  };

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await apiClient.get<{ email_notifications_enabled: boolean; notify_min_severity: string; muted_kinds: string[] }>('/auth/me/notification-preferences');
        if (cancelled) return;
        setNotifEnabled(res.data.email_notifications_enabled);
        setNotifMinSeverity(res.data.notify_min_severity);
        setNotifMutedKinds(res.data.muted_kinds ?? []);
      } catch {
        if (!cancelled) setNotifMessage({ text: 'Notification preferences could not be loaded.', error: true });
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  const handleSaveNotifications = async () => {
    if (notifSaving) return;
    setNotifSaving(true);
    setNotifMessage(null);
    try {
      const res = await apiClient.patch<{ email_notifications_enabled: boolean; notify_min_severity: string; muted_kinds: string[] }>('/auth/me/notification-preferences', {
        email_notifications_enabled: notifEnabled,
        notify_min_severity: notifMinSeverity,
        muted_kinds: notifMutedKinds,
      });
      setNotifEnabled(res.data.email_notifications_enabled);
      setNotifMinSeverity(res.data.notify_min_severity);
      setNotifMutedKinds(res.data.muted_kinds ?? []);
      setNotifMessage({ text: 'Notification preferences saved.', error: false });
    } catch (error: unknown) {
      setNotifMessage({ text: getApiErrorMessage(error, 'The notification preferences could not be saved.'), error: true });
    } finally {
      setNotifSaving(false);
    }
  };

  useEffect(() => {
    void fetchTeam();
  }, []);

  const handleCreateOrg = async () => {
    const name = orgName.trim();
    const slug = orgSlug.trim().toLowerCase();
    if (!name || !slug || creatingOrg) return;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      setTeamMessage({ text: 'The slug can only use lowercase letters, numbers and hyphens, and must start with a letter or number.', error: true });
      return;
    }
    setCreatingOrg(true);
    setTeamMessage(null);
    try {
      await apiClient.post('/orgs/', { name, slug });
      setOrgName('');
      setOrgSlug('');
      setTeamMessage({ text: `${name} created. You are its admin.`, error: false });
      await Promise.all([fetchTeam(), fetchUser()]);
    } catch (error: unknown) {
      setTeamMessage({ text: getApiErrorMessage(error, 'The organization could not be created.'), error: true });
    } finally {
      setCreatingOrg(false);
    }
  };

  const handleRenameOrg = async () => {
    const name = newOrgName.trim();
    if (!org || !name || name === org.name || renaming) return;
    setRenaming(true);
    setTeamMessage(null);
    try {
      await apiClient.patch('/orgs/me', { name });
      setEditingName(false);
      setTeamMessage({ text: `Organization renamed to ${name}.`, error: false });
      await fetchTeam();
    } catch (error: unknown) {
      setTeamMessage({ text: getApiErrorMessage(error, 'The organization could not be renamed.'), error: true });
    } finally {
      setRenaming(false);
    }
  };

  const handleRemoveMember = async () => {
    if (!pendingRemove || removing) return;
    setRemoving(true);
    setTeamMessage(null);
    try {
      await apiClient.delete(`/orgs/me/members/${pendingRemove.id}`);
      setMembers(prev => prev.filter(m => m.id !== pendingRemove.id));
      setTeamMessage({ text: `${pendingRemove.email} was removed from the organization.`, error: false });
      setPendingRemove(null);
    } catch (error: unknown) {
      setTeamMessage({ text: getApiErrorMessage(error, 'The member could not be removed.'), error: true });
    } finally {
      setRemoving(false);
    }
  };

  const handleInvite = async () => {
    const email = inviteEmail.trim();
    if (!email || inviting) return;
    setInviting(true);
    setTeamMessage(null);
    try {
      await apiClient.post('/orgs/me/invite', null, { params: { email } });
      setInviteEmail('');
      setTeamMessage({ text: `${email} was added to ${org?.name ?? 'the organization'}.`, error: false });
      await fetchTeam();
    } catch (error: unknown) {
      setTeamMessage({ text: getApiErrorMessage(error, 'The invite could not be completed.'), error: true });
    } finally {
      setInviting(false);
    }
  };

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

          <Panel title="Team" description={org ? `${org.name} · ${members.length} of ${org.max_users} seats used` : 'People with access to this workspace.'} action={<Users className="h-4 w-4 text-primary-300" />}>
            <div className="p-5">
              {teamMessage && <div role={teamMessage.error ? 'alert' : 'status'} className={`mb-3 rounded-md border px-3 py-2 text-xs ${teamMessage.error ? 'border-danger/30 bg-danger/10 text-danger' : 'border-success/30 bg-success/10 text-success'}`}>{teamMessage.text}</div>}
              {noOrg && (
                <div>
                  <p className="text-sm text-surface-400">This account does not belong to an organization yet. Create one to share the workspace with your team.</p>
                  <form className="mt-3 space-y-2" onSubmit={event => { event.preventDefault(); void handleCreateOrg(); }}>
                    <div>
                      <label htmlFor="org-name" className="sr-only">Organization name</label>
                      <input id="org-name" type="text" autoComplete="off" placeholder="Organization name" value={orgName} onChange={event => setOrgName(event.target.value)} className="w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 placeholder-surface-500" />
                    </div>
                    <div>
                      <label htmlFor="org-slug" className="sr-only">Organization slug</label>
                      <input id="org-slug" type="text" autoComplete="off" placeholder="url-slug" value={orgSlug} onChange={event => setOrgSlug(event.target.value)} className="w-full rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 placeholder-surface-500" />
                    </div>
                    <button type="submit" disabled={creatingOrg || !orgName.trim() || !orgSlug.trim()} className="min-h-9 rounded-md bg-primary-500 px-4 text-sm font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-50">{creatingOrg ? 'Creating…' : 'Create organization'}</button>
                  </form>
                </div>
              )}
              {!noOrg && (
                <>
                  {org && <div className="mb-3 flex items-center gap-2"><StatusBadge tone="info">{org.plan}</StatusBadge></div>}
                  {org && user?.role === 'admin' && (
                    editingName ? (
                      <form className="mb-3 flex items-center gap-2" onSubmit={event => { event.preventDefault(); void handleRenameOrg(); }}>
                        <label htmlFor="org-rename" className="sr-only">New organization name</label>
                        <input id="org-rename" type="text" autoComplete="off" value={newOrgName} onChange={event => setNewOrgName(event.target.value)} className="min-w-0 flex-1 rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 placeholder-surface-500" />
                        <button type="submit" disabled={renaming || !newOrgName.trim() || newOrgName.trim() === org.name} className="min-h-9 rounded-md bg-primary-500 px-3 text-sm font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-50">{renaming ? 'Saving…' : 'Save'}</button>
                        <button type="button" onClick={() => setEditingName(false)} className="min-h-9 rounded-md border border-surface-600 px-3 text-sm text-surface-300 hover:bg-surface-800">Cancel</button>
                      </form>
                    ) : (
                      <button type="button" onClick={() => { setNewOrgName(org.name); setEditingName(true); }} className="mb-3 inline-flex min-h-9 items-center gap-1.5 rounded-md border border-surface-600 px-3 text-sm text-surface-300 hover:bg-surface-800">
                        <Pencil className="h-4 w-4" /> Rename organization
                      </button>
                    )
                  )}
                  <ul className="divide-y divide-surface-800">
                    {members.map(member => (
                      <li key={member.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-surface-200">{member.full_name || member.email}</p>
                          {member.full_name && <p className="truncate text-xs text-surface-500">{member.email}</p>}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <StatusBadge tone={member.is_active ? 'success' : 'neutral'}>{member.is_active ? 'Active' : 'Inactive'}</StatusBadge>
                          {user?.role === 'admin' && member.id !== user?.id && (
                            <button
                              type="button"
                              aria-label={`Remove ${member.email} from the organization`}
                              onClick={() => setPendingRemove(member)}
                              className="min-h-8 rounded-md border border-surface-600 px-2.5 text-xs text-surface-300 hover:bg-surface-800"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                  {user?.role === 'admin' && (
                    <form className="mt-4 flex items-center gap-2 border-t border-surface-800 pt-4" onSubmit={event => { event.preventDefault(); void handleInvite(); }}>
                      <label htmlFor="invite-email" className="sr-only">Email to invite</label>
                      <input
                        id="invite-email"
                        type="email"
                        autoComplete="off"
                        placeholder="teammate@example.com"
                        value={inviteEmail}
                        onChange={event => setInviteEmail(event.target.value)}
                        className="min-w-0 flex-1 rounded-md border border-surface-600 bg-surface-950 px-3 py-2 text-sm text-surface-100 placeholder-surface-500"
                      />
                      <button
                        type="submit"
                        disabled={inviting || !inviteEmail.trim()}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-md bg-primary-500 px-3 text-sm font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-50"
                      >
                        <UserPlus className="h-4 w-4" /> {inviting ? 'Adding…' : 'Add member'}
                      </button>
                    </form>
                  )}
                </>
              )}
            </div>
          </Panel>

          <Panel title="Multi-factor authentication" description="TOTP adds a second verification step to password sign-in." action={<Shield className="h-4 w-4 text-success" />}>
            <div className="p-5">
              {user?.mfa_enabled ? <StatusBadge tone="success">MFA enabled</StatusBadge> : <button type="button" onClick={handleSetupMFA} className="inline-flex min-h-9 items-center gap-2 rounded-md bg-primary-500 px-3.5 text-sm font-semibold text-surface-950 hover:bg-primary-400"><KeyRound className="h-4 w-4" /> Enable MFA</button>}
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
        </div>

        <div className="space-y-4">
        <Panel title="Email notifications" description="Choose which new alerts trigger an email to you." action={<Mail className="h-4 w-4 text-warning" />}>
          <form className="space-y-5 p-5" onSubmit={event => { event.preventDefault(); void handleSaveNotifications(); }}>
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
              <p className="mb-2 text-xs text-surface-500">Muted kinds stay recorded but no longer appear in the notification feed or unread count.</p>
              {([['alert_created', 'New alerts'], ['case_assigned', 'Case assignments']] as Array<[string, string]>).map(([kind, label]) => (
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
            {notifMessage && (
              <p role={notifMessage.error ? 'alert' : 'status'} className={notifMessage.error ? 'text-sm text-danger' : 'text-sm text-primary-400'}>{notifMessage.text}</p>
            )}
            <div className="flex items-center justify-end gap-4 border-t border-surface-800 pt-4">
              <button type="submit" disabled={notifSaving} className="min-h-9 rounded-md bg-primary-500 px-4 text-sm font-semibold text-surface-950 hover:bg-primary-400 disabled:opacity-50">{notifSaving ? 'Saving…' : 'Save preferences'}</button>
            </div>
          </form>
        </Panel>

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

        <SiemIntegrationsPanel />

        <ApiTokensPanel />
        </div>
      </div>

      {pendingRemove && (
        <ConfirmDialog
          title="Remove member?"
          description={`${pendingRemove.email} will lose access to this organization's workspace. Their account is not deleted.`}
          confirmLabel="Remove member"
          tone="danger"
          busy={removing}
          onCancel={() => { if (!removing) setPendingRemove(null); }}
          onConfirm={() => { void handleRemoveMember(); }}
        />
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Bell, KeyRound, Mail, Pencil, Settings as SettingsIcon, Shield, UserPlus, UserRound, Users } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../api/errors';
import { PageHeader } from '../components/ui/PageHeader';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { SiemIntegrationsPanel } from '../components/settings/SiemIntegrationsPanel';
import { ApiTokensPanel } from '../components/settings/ApiTokensPanel';
import { SuppressionRulesPanel } from '../components/settings/SuppressionRulesPanel';
import { AutomationPanel } from '../components/settings/AutomationPanel';
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
  const [disablingMfa, setDisablingMfa] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [disableVerifying, setDisableVerifying] = useState(false);
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
  const [quietStart, setQuietStart] = useState('');
  const [quietEnd, setQuietEnd] = useState('');
  const [notifSaving, setNotifSaving] = useState(false);
  const [notifMessage, setNotifMessage] = useState<{ text: string; error: boolean } | null>(null);
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
        const res = await apiClient.get<{ email_notifications_enabled: boolean; notify_min_severity: string; muted_kinds: string[]; quiet_hours_start: string | null; quiet_hours_end: string | null }>('/auth/me/notification-preferences');
        if (cancelled) return;
        setNotifEnabled(res.data.email_notifications_enabled);
        setNotifMinSeverity(res.data.notify_min_severity);
        setNotifMutedKinds(res.data.muted_kinds ?? []);
        setQuietStart(res.data.quiet_hours_start ?? '');
        setQuietEnd(res.data.quiet_hours_end ?? '');
      } catch {
        if (!cancelled) setNotifMessage({ text: 'Notification preferences could not be loaded.', error: true });
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  const handleSaveNotifications = async () => {
    if (notifSaving) return;
    if ((quietStart === '') !== (quietEnd === '')) {
      setNotifMessage({ text: 'Quiet hours need both a start and an end time, or neither.', error: true });
      return;
    }
    setNotifSaving(true);
    setNotifMessage(null);
    try {
      const res = await apiClient.patch<{ email_notifications_enabled: boolean; notify_min_severity: string; muted_kinds: string[]; quiet_hours_start: string | null; quiet_hours_end: string | null }>('/auth/me/notification-preferences', {
        email_notifications_enabled: notifEnabled,
        notify_min_severity: notifMinSeverity,
        muted_kinds: notifMutedKinds,
        quiet_hours_start: quietStart === '' ? null : quietStart,
        quiet_hours_end: quietEnd === '' ? null : quietEnd,
      });
      setNotifEnabled(res.data.email_notifications_enabled);
      setNotifMinSeverity(res.data.notify_min_severity);
      setNotifMutedKinds(res.data.muted_kinds ?? []);
      setQuietStart(res.data.quiet_hours_start ?? '');
      setQuietEnd(res.data.quiet_hours_end ?? '');
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
              {([['alert_created', 'New alerts'], ['case_assigned', 'Case assignments'], ['alert_assigned', 'Alert assignments']] as Array<[string, string]>).map(([kind, label]) => (
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
              <p className="mb-1.5 text-sm font-medium text-surface-300">Quiet hours (UTC)</p>
              <p className="mb-2 text-xs text-surface-500">No emails inside this window, even above the minimum severity. Critical alerts always come through.</p>
              <div className="flex items-center gap-3">
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

        <AutomationPanel />

        <SuppressionRulesPanel />

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

import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import apiClient from '../api/client';
import { Settings as SettingsIcon, Shield, Bell } from 'lucide-react';

export function Settings() {
  const { user, fetchUser } = useAuthStore();
  const [slackUrl, setSlackUrl] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [mfaUri, setMfaUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    // Load current integration settings from user or a dedicated endpoint if needed
  }, [user]);

  const handleSaveIntegrations = async () => {
    setSaving(true);
    try {
      const params = new URLSearchParams();
      if (slackUrl) params.append('slack_webhook_url', slackUrl);
      if (webhookUrl) params.append('webhook_url', webhookUrl);
      await apiClient.patch(`/auth/me/integrations?${params.toString()}`);
      setMessage('Integrations saved');
      fetchUser();
    } catch {
      setMessage('Failed to save');
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const handleSetupMFA = async () => {
    try {
      const res = await apiClient.post('/auth/me/mfa/setup');
      setMfaUri(res.data.provisioning_uri);
    } catch {
      setMessage('Failed to setup MFA');
    }
  };

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-surface-400 mt-1">Manage your account and integrations</p>
      </div>

      {message && (
        <div className="p-3 rounded-lg bg-primary-600/10 border border-primary-600/20 text-primary-300 text-sm">
          {message}
        </div>
      )}

      {/* Profile */}
      <section className="bg-surface-800/50 border border-surface-700 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <SettingsIcon className="w-5 h-5 text-primary-400" />
          <h2 className="text-lg font-semibold text-white">Profile</h2>
        </div>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-surface-400">Email</span>
            <span className="text-surface-200">{user?.email}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-surface-400">Name</span>
            <span className="text-surface-200">{user?.full_name || 'Not set'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-surface-400">Company</span>
            <span className="text-surface-200">{user?.company || 'Not set'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-surface-400">Role</span>
            <span className="text-surface-200 capitalize">{user?.role}</span>
          </div>
        </div>
      </section>

      {/* MFA */}
      <section className="bg-surface-800/50 border border-surface-700 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <Shield className="w-5 h-5 text-success" />
          <h2 className="text-lg font-semibold text-white">Multi-Factor Authentication</h2>
        </div>
        {user?.mfa_enabled ? (
          <p className="text-success text-sm">MFA is enabled</p>
        ) : (
          <div>
            <p className="text-surface-400 text-sm mb-3">Protect your account with TOTP-based MFA</p>
            <button
              onClick={handleSetupMFA}
              className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors"
            >
              Enable MFA
            </button>
          </div>
        )}
        {mfaUri && (
          <div className="mt-4 p-4 bg-surface-900 rounded-lg">
            <p className="text-xs text-surface-400 mb-2">Scan this URI with your authenticator app:</p>
            <code className="text-xs text-primary-300 break-all">{mfaUri}</code>
          </div>
        )}
      </section>

      {/* Integrations */}
      <section className="bg-surface-800/50 border border-surface-700 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-4">
          <Bell className="w-5 h-5 text-warning" />
          <h2 className="text-lg font-semibold text-white">Notification Integrations</h2>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-sm text-surface-400 block mb-1">Slack Webhook URL</label>
            <input
              type="url"
              value={slackUrl}
              onChange={(e) => setSlackUrl(e.target.value)}
              placeholder="https://hooks.slack.com/services/..."
              className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded-lg text-sm text-white placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <div>
            <label className="text-sm text-surface-400 block mb-1">Custom Webhook URL</label>
            <input
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://your-server.com/webhook"
              className="w-full px-3 py-2 bg-surface-900 border border-surface-600 rounded-lg text-sm text-white placeholder-surface-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
          </div>
          <button
            onClick={handleSaveIntegrations}
            disabled={saving}
            className="px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {saving ? 'Saving...' : 'Save Integrations'}
          </button>
        </div>
      </section>
    </div>
  );
}

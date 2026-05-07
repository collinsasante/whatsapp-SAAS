'use client';
import { useEffect, useState } from 'react';
import { tenantApi } from '@/lib/api';
import toast from 'react-hot-toast';

interface TenantData {
  id: string;
  name: string;
  slug: string;
  phoneNumberId: string | null;
  wabaId: string | null;
  webhookVerifyToken: string;
  settings: {
    businessName: string | null;
    businessEmail: string | null;
    timezone: string;
    autoReply: boolean;
    autoReplyMessage: string | null;
  } | null;
}

export default function SettingsPage() {
  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [waForm, setWaForm] = useState({ phoneNumberId: '', wabaId: '', accessToken: '' });
  const [settingsForm, setSettingsForm] = useState({ businessName: '', businessEmail: '', timezone: 'UTC', autoReply: false, autoReplyMessage: '' });

  useEffect(() => {
    const load = async () => {
      try {
        const res = await tenantApi.get();
        const data = res.data as TenantData;
        setTenant(data);
        setWaForm({
          phoneNumberId: data.phoneNumberId ?? '',
          wabaId: data.wabaId ?? '',
          accessToken: '',
        });
        if (data.settings) {
          setSettingsForm({
            businessName: data.settings.businessName ?? '',
            businessEmail: data.settings.businessEmail ?? '',
            timezone: data.settings.timezone,
            autoReply: data.settings.autoReply,
            autoReplyMessage: data.settings.autoReplyMessage ?? '',
          });
        }
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const saveWaConfig = async () => {
    setSaving(true);
    try {
      await tenantApi.update(waForm);
      toast.success('WhatsApp configuration saved');
    } catch { toast.error('Failed to save configuration'); }
    finally { setSaving(false); }
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      await tenantApi.updateSettings(settingsForm);
      toast.success('Settings saved');
    } catch { toast.error('Failed to save settings'); }
    finally { setSaving(false); }
  };

  if (loading) {
    return <div className="flex justify-center pt-16"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600" /></div>;
  }

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <h1 className="text-xl font-semibold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500">Manage workspace configuration</p>
      </div>

      <div className="p-6 space-y-6 max-w-2xl">
        <section className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Workspace Info</h2>
          <p className="text-sm text-gray-500 mb-4">Basic workspace details</p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span className="text-gray-600">Workspace Name</span>
              <span className="font-medium">{tenant?.name}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-100">
              <span className="text-gray-600">Slug</span>
              <code className="text-xs bg-gray-100 px-2 py-0.5 rounded">{tenant?.slug}</code>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-gray-600">Webhook Verify Token</span>
              <code className="text-xs bg-gray-100 px-2 py-0.5 rounded">{tenant?.webhookVerifyToken}</code>
            </div>
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">WhatsApp API Configuration</h2>
          <p className="text-sm text-gray-500 mb-4">Connect your WhatsApp Business API credentials</p>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number ID</label>
              <input type="text" value={waForm.phoneNumberId} onChange={(e) => setWaForm((f) => ({ ...f, phoneNumberId: e.target.value }))}
                placeholder="1234567890" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">WABA ID (WhatsApp Business Account ID)</label>
              <input type="text" value={waForm.wabaId} onChange={(e) => setWaForm((f) => ({ ...f, wabaId: e.target.value }))}
                placeholder="9876543210" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Permanent Access Token</label>
              <input type="password" value={waForm.accessToken} onChange={(e) => setWaForm((f) => ({ ...f, accessToken: e.target.value }))}
                placeholder="Leave blank to keep existing token" className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
              <strong>Webhook URL:</strong>{' '}
              <code className="text-xs">{process.env['NEXT_PUBLIC_API_URL'] ?? 'https://yourdomain.com/api/v1'}/webhook/whatsapp/{tenant?.slug}</code>
            </div>
            <button onClick={() => { void saveWaConfig(); }} disabled={saving}
              className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
              {saving ? 'Saving...' : 'Save WhatsApp Config'}
            </button>
          </div>
        </section>

        <section className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Business Settings</h2>
          <p className="text-sm text-gray-500 mb-4">Customize your workspace behavior</p>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Business Name</label>
              <input type="text" value={settingsForm.businessName} onChange={(e) => setSettingsForm((f) => ({ ...f, businessName: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Business Email</label>
              <input type="email" value={settingsForm.businessEmail} onChange={(e) => setSettingsForm((f) => ({ ...f, businessEmail: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500" />
            </div>
            <div className="flex items-center gap-3">
              <input type="checkbox" id="autoReply" checked={settingsForm.autoReply}
                onChange={(e) => setSettingsForm((f) => ({ ...f, autoReply: e.target.checked }))}
                className="w-4 h-4 text-green-600 rounded focus:ring-green-500" />
              <label htmlFor="autoReply" className="text-sm font-medium text-gray-700">Enable auto-reply for new conversations</label>
            </div>
            {settingsForm.autoReply && (
              <textarea value={settingsForm.autoReplyMessage} onChange={(e) => setSettingsForm((f) => ({ ...f, autoReplyMessage: e.target.value }))}
                placeholder="Hi! Thanks for reaching out. We'll get back to you shortly."
                rows={3} className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none" />
            )}
            <button onClick={() => { void saveSettings(); }} disabled={saving}
              className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors">
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

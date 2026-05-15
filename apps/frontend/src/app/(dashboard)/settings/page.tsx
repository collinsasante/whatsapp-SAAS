'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import {
  Building2, Phone, MapPin, Globe, FileText, Mail, Zap, Copy, Check,
  Plus, Trash2, Edit2, Eye, EyeOff, Key, Users, MessageSquare,
  Shield, RefreshCw, AlertTriangle, X, Save,
} from 'lucide-react';
import { tenantApi, cannedResponsesApi, apiKeysApi } from '@/lib/api';
import { TeamManagement } from '@/components/shared/TeamManagement';
import { useAuthStore } from '@/store/auth.store';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';

interface TenantData {
  id: string; name: string; slug: string;
  phoneNumberId: string | null; wabaId: string | null;
  webhookVerifyToken: string;
  settings: {
    businessName: string | null; businessEmail: string | null;
    businessPhone: string | null; businessDescription: string | null;
    businessAddress: string | null; businessWebsite: string | null;
    timezone: string; autoReply: boolean; autoReplyMessage: string | null;
  } | null;
}


interface CannedResponse {
  id: string; shortcut: string; content: string; category: string | null;
  createdBy: { id: string; name: string };
}

interface ApiKey {
  id: string; name: string; keyPrefix: string; isActive: boolean;
  lastUsedAt: string | null; expiresAt: string | null; createdAt: string;
  createdBy: { id: string; name: string };
}

function CopyButton({ value, size = 'sm' }: { value: string; size?: 'sm' | 'xs' }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={copy} className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0 ml-1">
      {copied
        ? <Check className={size === 'xs' ? 'w-3 h-3 text-teal-500' : 'w-3.5 h-3.5 text-teal-500'} />
        : <Copy className={size === 'xs' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      }
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">{label}</label>
      {children}
    </div>
  );
}

const INPUT = 'w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-gray-50 focus:bg-white';
const INPUT_ICON = 'w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-gray-50 focus:bg-white';
const BTN_PRIMARY = 'px-5 py-2.5 bg-teal-600 text-white text-sm rounded-xl font-semibold hover:bg-teal-700 disabled:opacity-50 transition-colors';


const TABS = ['Business Profile', 'WhatsApp API', 'Team', 'API Keys', 'Automation'] as const;
type Tab = typeof TABS[number];

export default function SettingsPage() {
  const { tenant: authTenant } = useAuthStore();
  const [tenant, setTenant] = useState<TenantData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('Business Profile');

  // Forms
  const [waForm, setWaForm] = useState({ phoneNumberId: '', wabaId: '', accessToken: '' });
  const [profileForm, setProfileForm] = useState({
    businessName: '', businessEmail: '', businessPhone: '',
    businessDescription: '', businessAddress: '', businessWebsite: '',
  });
  const [autoForm, setAutoForm] = useState({ autoReply: false, autoReplyMessage: '', timezone: 'UTC' });

  // API keys
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [showNewKey, setShowNewKey] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await tenantApi.get();
        const data = res.data as TenantData;
        setTenant(data);
        setWaForm({ phoneNumberId: data.phoneNumberId ?? '', wabaId: data.wabaId ?? '', accessToken: '' });
        if (data.settings) {
          setProfileForm({
            businessName: data.settings.businessName ?? '',
            businessEmail: data.settings.businessEmail ?? '',
            businessPhone: data.settings.businessPhone ?? '',
            businessDescription: data.settings.businessDescription ?? '',
            businessAddress: data.settings.businessAddress ?? '',
            businessWebsite: data.settings.businessWebsite ?? '',
          });
          setAutoForm({ autoReply: data.settings.autoReply, autoReplyMessage: data.settings.autoReplyMessage ?? '', timezone: data.settings.timezone });
        }
      } finally { setLoading(false); }
    };
    void load();
  }, []);

  const loadApiKeys = useCallback(async () => {
    setApiKeysLoading(true);
    try {
      const res = await apiKeysApi.list();
      setApiKeys(res.data as ApiKey[]);
    } finally { setApiKeysLoading(false); }
  }, []);

  useEffect(() => {
    if (activeTab === 'API Keys') void loadApiKeys();
  }, [activeTab, loadApiKeys]);

  const saveProfile = async () => {
    setSaving(true);
    try { await tenantApi.updateSettings(profileForm); toast.success('Business profile saved'); }
    catch { toast.error('Failed to save profile'); }
    finally { setSaving(false); }
  };

  const saveWaConfig = async () => {
    setSaving(true);
    try { await tenantApi.update(waForm); toast.success('WhatsApp configuration saved'); }
    catch { toast.error('Failed to save configuration'); }
    finally { setSaving(false); }
  };

  const saveAuto = async () => {
    setSaving(true);
    try { await tenantApi.updateSettings(autoForm); toast.success('Automation settings saved'); }
    catch { toast.error('Failed to save settings'); }
    finally { setSaving(false); }
  };

  const createApiKey = async () => {
    if (!newKeyName.trim()) { toast.error('Enter a name for this key'); return; }
    try {
      const res = await apiKeysApi.create({ name: newKeyName.trim() });
      const data = res.data as ApiKey & { key: string };
      setCreatedKey(data.key);
      setNewKeyName('');
      void loadApiKeys();
    } catch { toast.error('Failed to create API key'); }
  };

  const revokeKey = async (id: string) => {
    try { await apiKeysApi.revoke(id); toast.success('Key revoked'); void loadApiKeys(); }
    catch { toast.error('Failed to revoke key'); }
  };

  const deleteKey = async (id: string) => {
    try { await apiKeysApi.delete(id); toast.success('Key deleted'); void loadApiKeys(); }
    catch { toast.error('Failed to delete key'); }
  };

  const webhookUrl = `${process.env['NEXT_PUBLIC_API_URL'] ?? 'https://yourdomain.com/api/v1'}/webhook/whatsapp/${tenant?.slug ?? ''}`;

  if (loading) {
    return <div className="flex justify-center pt-16"><div className="animate-spin rounded-full h-7 w-7 border-b-2 border-teal-600" /></div>;
  }

  return (
    <div className="flex flex-col h-full overflow-auto bg-gray-50">
      <div className="bg-white border-b border-gray-100 px-8 py-5 flex-shrink-0">
        <h1 className="text-xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your workspace configuration</p>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-52 flex-shrink-0 bg-white border-r border-gray-100 p-4 space-y-1 overflow-y-auto">
          {TABS.map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={cn('w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                activeTab === tab ? 'bg-teal-50 text-teal-700' : 'text-gray-600 hover:bg-gray-50')}>
              {tab}
            </button>
          ))}
          <div className="pt-4 border-t border-gray-100 mt-4">
            <div className="px-3 py-2">
              <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-2">Workspace</p>
              <p className="text-xs text-gray-600 font-medium">{authTenant?.name}</p>
              <code className="text-xs text-gray-400">{authTenant?.slug}</code>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-8">
          <div className="max-w-2xl space-y-6">

            {/* ── Business Profile ── */}
            {activeTab === 'Business Profile' && (
              <section className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
                <h2 className="text-base font-semibold text-gray-900 mb-1">Business Profile</h2>
                <p className="text-sm text-gray-500 mb-5">Shown to your team and used in reports.</p>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <Field label="Business Name">
                      <div className="relative"><Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input type="text" value={profileForm.businessName} onChange={(e) => setProfileForm((f) => ({ ...f, businessName: e.target.value }))} className={INPUT_ICON} /></div>
                    </Field>
                  </div>
                  <Field label="Business Email">
                    <div className="relative"><Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input type="email" value={profileForm.businessEmail} onChange={(e) => setProfileForm((f) => ({ ...f, businessEmail: e.target.value }))} className={INPUT_ICON} /></div>
                  </Field>
                  <Field label="Phone Number">
                    <div className="relative"><Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input type="tel" value={profileForm.businessPhone} onChange={(e) => setProfileForm((f) => ({ ...f, businessPhone: e.target.value }))} className={INPUT_ICON} /></div>
                  </Field>
                  <div className="col-span-2">
                    <Field label="Description">
                      <div className="relative"><FileText className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                        <textarea rows={3} value={profileForm.businessDescription} onChange={(e) => setProfileForm((f) => ({ ...f, businessDescription: e.target.value }))} className={cn(INPUT_ICON, 'resize-none')} /></div>
                    </Field>
                  </div>
                  <div className="col-span-2">
                    <Field label="Address">
                      <div className="relative"><MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input type="text" value={profileForm.businessAddress} onChange={(e) => setProfileForm((f) => ({ ...f, businessAddress: e.target.value }))} className={INPUT_ICON} /></div>
                    </Field>
                  </div>
                  <div className="col-span-2">
                    <Field label="Website">
                      <div className="relative"><Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input type="url" value={profileForm.businessWebsite} onChange={(e) => setProfileForm((f) => ({ ...f, businessWebsite: e.target.value }))} className={INPUT_ICON} /></div>
                    </Field>
                  </div>
                </div>
                <button onClick={() => { void saveProfile(); }} disabled={saving} className={cn(BTN_PRIMARY, 'mt-5')}>
                  {saving ? 'Saving…' : 'Save Profile'}
                </button>
              </section>
            )}

            {/* ── WhatsApp API ── */}
            {activeTab === 'WhatsApp API' && (
              <section className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
                <h2 className="text-base font-semibold text-gray-900 mb-1">WhatsApp API Configuration</h2>
                <p className="text-sm text-gray-500 mb-5">Connect your WhatsApp Business API via Meta Business Manager.</p>
                <div className="space-y-4">
                  <Field label="Phone Number ID">
                    <input type="text" value={waForm.phoneNumberId} placeholder="From Meta Business Manager" onChange={(e) => setWaForm((f) => ({ ...f, phoneNumberId: e.target.value }))} className={INPUT} />
                  </Field>
                  <Field label="WABA ID">
                    <input type="text" value={waForm.wabaId} placeholder="WhatsApp Business Account ID" onChange={(e) => setWaForm((f) => ({ ...f, wabaId: e.target.value }))} className={INPUT} />
                  </Field>
                  <Field label="Permanent Access Token">
                    <input type="password" value={waForm.accessToken} placeholder="Leave blank to keep existing" onChange={(e) => setWaForm((f) => ({ ...f, accessToken: e.target.value }))} className={INPUT} />
                  </Field>
                  <div className="bg-teal-50 border border-teal-200 rounded-xl p-4">
                    <p className="text-xs font-semibold text-teal-700 mb-2">Webhook URL</p>
                    <div className="flex items-center gap-2">
                      <code className="text-xs text-teal-800 break-all flex-1">{webhookUrl}</code>
                      <CopyButton value={webhookUrl} />
                    </div>
                    <p className="text-xs text-teal-600 mt-2 flex items-center">
                      Verify token: <code className="bg-teal-100 px-1.5 py-0.5 rounded ml-1">{tenant?.webhookVerifyToken}</code>
                      <CopyButton value={tenant?.webhookVerifyToken ?? ''} size="xs" />
                    </p>
                  </div>
                  <button onClick={() => { void saveWaConfig(); }} disabled={saving} className={BTN_PRIMARY}>
                    {saving ? 'Saving…' : 'Save Configuration'}
                  </button>
                </div>
              </section>
            )}

            {/* ── Team ── */}
            {activeTab === 'Team' && <TeamManagement />}

            {/* ── API Keys ── */}
            {activeTab === 'API Keys' && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">API Keys</h2>
                  <p className="text-sm text-gray-500">Use these keys to integrate with our REST API.</p>
                </div>

                {/* Created key reveal */}
                {createdKey && (
                  <div className="bg-teal-50 border border-teal-300 rounded-2xl p-5">
                    <div className="flex items-start gap-3">
                      <Key size={18} className="text-teal-600 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-teal-800">Your new API key — save it now</p>
                        <p className="text-xs text-teal-600 mb-3">This is the only time this key will be shown.</p>
                        <div className="flex items-center gap-2 bg-white border border-teal-200 rounded-xl px-3 py-2">
                          <code className="text-xs font-mono text-gray-800 flex-1 break-all">{createdKey}</code>
                          <CopyButton value={createdKey} />
                        </div>
                      </div>
                    </div>
                    <button onClick={() => setCreatedKey(null)} className="mt-3 text-xs text-teal-600 hover:text-teal-700 flex items-center gap-1">
                      <Check size={12} />I've saved this key
                    </button>
                  </div>
                )}

                {/* New key form */}
                <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
                  <h3 className="text-sm font-semibold text-gray-800 mb-3">Create New Key</h3>
                  <div className="flex items-center gap-3">
                    <input type="text" value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)}
                      placeholder="Key name (e.g. Production, Shopify)" className={cn(INPUT, 'flex-1')}
                      onKeyDown={(e) => e.key === 'Enter' && void createApiKey()} />
                    <button onClick={() => { void createApiKey(); }} className={BTN_PRIMARY}>
                      <Key size={13} className="inline mr-1.5" />Generate
                    </button>
                  </div>
                </div>

                {/* Keys list */}
                {apiKeysLoading ? (
                  <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-teal-600" /></div>
                ) : apiKeys.length === 0 ? (
                  <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center shadow-sm">
                    <Key size={28} className="mx-auto text-gray-300 mb-3" />
                    <p className="text-sm font-medium text-gray-500">No API keys yet</p>
                    <p className="text-xs text-gray-400 mt-1">Generate a key to start integrating</p>
                  </div>
                ) : (
                  <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden shadow-sm">
                    {apiKeys.map((k, i) => (
                      <div key={k.id} className={cn('flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 transition-colors', i > 0 && 'border-t border-gray-100')}>
                        <div className="w-8 h-8 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
                          <Key size={14} className={k.isActive ? 'text-teal-600' : 'text-gray-400'} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-gray-900">{k.name}</p>
                            <span className={cn('text-xs px-1.5 py-0.5 rounded-full font-medium', k.isActive ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600')}>
                              {k.isActive ? 'Active' : 'Revoked'}
                            </span>
                          </div>
                          <p className="text-xs text-gray-400 font-mono">{k.keyPrefix}…</p>
                          <p className="text-xs text-gray-400">
                            {k.lastUsedAt ? `Last used ${new Date(k.lastUsedAt).toLocaleDateString()}` : 'Never used'} · Created by {k.createdBy.name}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {k.isActive && (
                            <button onClick={() => { void revokeKey(k.id); }}
                              className="px-3 py-1.5 text-xs text-orange-600 bg-orange-50 hover:bg-orange-100 rounded-lg transition-colors font-medium">
                              Revoke
                            </button>
                          )}
                          <button onClick={() => { void deleteKey(k.id); }}
                            className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="bg-gray-50 border border-gray-200 rounded-2xl p-4">
                  <p className="text-xs font-semibold text-gray-700 mb-1.5 flex items-center gap-1.5"><Shield size={12} />Authentication</p>
                  <p className="text-xs text-gray-500">Include your API key in the request header:</p>
                  <code className="block mt-2 text-xs bg-gray-100 text-gray-800 px-3 py-2 rounded-lg font-mono">
                    X-Api-Key: wap_xxxxxxxxxxxxxxxx
                  </code>
                </div>
              </div>
            )}

            {/* ── Automation ── */}
            {activeTab === 'Automation' && (
              <section className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
                <h2 className="text-base font-semibold text-gray-900 mb-1">Auto-Reply</h2>
                <p className="text-sm text-gray-500 mb-5">Automatically reply when a new conversation starts.</p>
                <div className="space-y-4">
                  <label className="flex items-center gap-3 cursor-pointer"
                    onClick={() => setAutoForm((f) => ({ ...f, autoReply: !f.autoReply }))}>
                    <div className={cn('relative w-10 h-5 rounded-full transition-colors cursor-pointer', autoForm.autoReply ? 'bg-teal-600' : 'bg-gray-200')}>
                      <div className={cn('absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform', autoForm.autoReply && 'translate-x-5')} />
                    </div>
                    <span className="text-sm font-medium text-gray-700">Enable auto-reply for new conversations</span>
                  </label>
                  {autoForm.autoReply && (
                    <Field label="Auto-reply message">
                      <div className="relative"><Zap className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
                        <textarea rows={3} value={autoForm.autoReplyMessage}
                          placeholder="Hi! Thanks for reaching out. We'll get back to you shortly."
                          onChange={(e) => setAutoForm((f) => ({ ...f, autoReplyMessage: e.target.value }))}
                          className={cn(INPUT_ICON, 'resize-none')} /></div>
                    </Field>
                  )}
                  <button onClick={() => { void saveAuto(); }} disabled={saving} className={BTN_PRIMARY}>
                    {saving ? 'Saving…' : 'Save Settings'}
                  </button>
                </div>
              </section>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

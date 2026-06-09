'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Search, X, CheckCircle2, AlertCircle, RefreshCw, Clock,
  Settings, ChevronDown, Radio, Zap, Activity, Shield,
  Plug2, PlugZap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { channelsApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConnectedChannel {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  phoneNumber?: string;
}

interface ChannelDef {
  id: string;
  name: string;
  description: string;
  badge?: 'Popular' | 'Beta' | 'New';
  connectType: 'api' | 'oauth';
  oauthProvider?: 'facebook' | 'instagram' | 'tiktok';
  accentClass: string;
  accentBg: string;
  btnClass: string;
  btnLabel: string;
  features: string[];
}

const CHANNELS: ChannelDef[] = [
  {
    id: 'whatsapp-api',
    name: 'WhatsApp Business',
    description: 'Reach customers where they are. Send campaigns, automate support, and close deals at scale via the Meta Cloud API.',
    badge: 'Popular',
    connectType: 'api',
    accentClass: 'border-l-emerald-500',
    accentBg: 'bg-emerald-500',
    btnClass: 'bg-emerald-600 hover:bg-emerald-700 text-white',
    btnLabel: 'Connect via API',
    features: ['Broadcast campaigns to thousands', 'Automate replies with keywords', 'Rich media & template messages'],
  },
  {
    id: 'facebook',
    name: 'Facebook Messenger',
    description: 'Reply to Messenger conversations directly from your inbox. Manage all Facebook Page interactions in one place.',
    badge: 'Popular',
    connectType: 'oauth',
    oauthProvider: 'facebook',
    accentClass: 'border-l-blue-600',
    accentBg: 'bg-blue-600',
    btnClass: 'bg-[#1877F2] hover:bg-[#166FE5] text-white',
    btnLabel: 'Continue with Facebook',
    features: ['Auto-reply to page messages', 'Shared team inbox', 'Message labels & assignment'],
  },
  {
    id: 'instagram',
    name: 'Instagram',
    description: 'Manage DMs, story replies, and mention interactions. Convert followers into customers from one inbox.',
    connectType: 'oauth',
    oauthProvider: 'instagram',
    accentClass: 'border-l-pink-500',
    accentBg: 'bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400',
    btnClass: 'bg-gradient-to-r from-purple-600 via-pink-600 to-orange-500 hover:opacity-90 text-white',
    btnLabel: 'Continue with Instagram',
    features: ['DMs & story reply management', 'Comment-to-DM automation', 'Influencer workflow tools'],
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    description: 'Engage your TikTok audience through Business Messaging. Reply to DMs and automate follower conversations.',
    badge: 'Beta',
    connectType: 'oauth',
    oauthProvider: 'tiktok',
    accentClass: 'border-l-slate-900',
    accentBg: 'bg-slate-900',
    btnClass: 'bg-slate-900 hover:bg-slate-800 text-white',
    btnLabel: 'Continue with TikTok',
    features: ['Business DM management', 'Automated follower replies', 'Campaign conversation routing'],
  },
  {
    id: 'telegram',
    name: 'Telegram',
    description: 'Connect a Telegram Bot to handle customer support at scale. Full automation and team routing supported.',
    connectType: 'api',
    accentClass: 'border-l-sky-500',
    accentBg: 'bg-sky-500',
    btnClass: 'bg-sky-500 hover:bg-sky-600 text-white',
    btnLabel: 'Connect Bot',
    features: ['Custom bot integration', 'Group & private chat support', 'Instant message routing'],
  },
];

const TYPE_MAP: Record<string, string> = {
  'whatsapp-api': 'WHATSAPP',
  facebook: 'FACEBOOK_MESSENGER',
  instagram: 'INSTAGRAM',
  tiktok: 'TIKTOK',
  telegram: 'TELEGRAM',
};

// ─── SVG Icons ────────────────────────────────────────────────────────────────

function WhatsAppIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="fill-white flex-shrink-0">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function FacebookIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="fill-white flex-shrink-0">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function InstagramIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="fill-white flex-shrink-0">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
    </svg>
  );
}

function TikTokIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="fill-white flex-shrink-0">
      <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1V9.01a6.27 6.27 0 00-.79-.05 6.34 6.34 0 00-6.34 6.34 6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.33-6.34V8.69a8.17 8.17 0 004.78 1.52V6.76a4.85 4.85 0 01-1.01-.07z" />
    </svg>
  );
}

function TelegramIcon({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className="fill-white flex-shrink-0">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

function ChannelIcon({ ch, size = 'md' }: { ch: ChannelDef; size?: 'sm' | 'md' | 'lg' }) {
  const dims = { sm: 'w-8 h-8 rounded-lg', md: 'w-12 h-12 rounded-xl', lg: 'w-14 h-14 rounded-2xl' };
  const iconSizes = { sm: 15, md: 22, lg: 26 };
  return (
    <div className={cn(dims[size], ch.accentBg, 'flex items-center justify-center flex-shrink-0')}>
      {ch.id === 'whatsapp-api' && <WhatsAppIcon size={iconSizes[size]} />}
      {ch.id === 'facebook' && <FacebookIcon size={iconSizes[size]} />}
      {ch.id === 'instagram' && <InstagramIcon size={iconSizes[size]} />}
      {ch.id === 'tiktok' && <TikTokIcon size={iconSizes[size]} />}
      {ch.id === 'telegram' && <TelegramIcon size={iconSizes[size]} />}
    </div>
  );
}

// ─── Live Dot ─────────────────────────────────────────────────────────────────

function LiveDot({ color = 'emerald' }: { color?: 'emerald' | 'amber' | 'red' | 'gray' }) {
  const colors = {
    emerald: 'bg-emerald-500',
    amber: 'bg-amber-500',
    red: 'bg-red-500',
    gray: 'bg-gray-400',
  };
  return (
    <span className="relative flex h-2 w-2 flex-shrink-0">
      {color !== 'gray' && (
        <span className={cn('animate-ping absolute inline-flex h-full w-full rounded-full opacity-60', colors[color])} />
      )}
      <span className={cn('relative inline-flex rounded-full h-2 w-2', colors[color])} />
    </span>
  );
}

// ─── Modals ───────────────────────────────────────────────────────────────────

const OAUTH_INFO: Record<string, { permissions: string[] }> = {
  facebook: { permissions: ['Manage your Pages', 'Read and send Messenger messages', 'View Page insights'] },
  instagram: { permissions: ['Read and reply to Direct Messages', 'Manage story mentions', 'Access business profile'] },
  tiktok: { permissions: ['Access TikTok Business Messaging', 'Read and reply to messages', 'View message analytics'] },
};

function ModalShell({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200" onClick={e => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

function OAuthModal({ channel, onClose }: { channel: ChannelDef; onClose: () => void }) {
  const provider = channel.oauthProvider!;
  const info = OAUTH_INFO[provider];
  const { tenant } = useAuthStore();

  const handleConnect = () => {
    const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1';
    const url = new URL(`${API_URL}/channels/oauth/${provider}`);
    if (tenant?.id) url.searchParams.set('tenantId', tenant.id);
    window.location.href = url.toString();
  };

  return (
    <ModalShell onClose={onClose}>
      <div className="px-6 pt-6 pb-4 border-b border-gray-100">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <ChannelIcon ch={channel} size="lg" />
            <div>
              <h2 className="text-base font-bold text-gray-900">Connect {channel.name}</h2>
              <p className="text-xs text-gray-500 mt-0.5">OAuth authorization required</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1">
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="px-6 py-4 space-y-4">
        <p className="text-sm text-gray-600 leading-relaxed">
          {provider === 'facebook' && "You'll be redirected to Facebook to authorize access to your Pages and Messenger inbox."}
          {provider === 'instagram' && "You'll sign in with Instagram Business to enable DM and story reply management."}
          {provider === 'tiktok' && "You'll be redirected to TikTok to authorize your Business account for messaging."}
        </p>
        <div className="bg-gray-50 rounded-xl p-4 space-y-2.5">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Permissions requested</p>
          {info.permissions.map(p => (
            <div key={p} className="flex items-center gap-2.5">
              <CheckCircle2 size={13} className="text-teal-600 flex-shrink-0" />
              <span className="text-sm text-gray-700">{p}</span>
            </div>
          ))}
        </div>
        <div className="flex items-start gap-2 text-xs text-gray-500 bg-blue-50 px-3 py-2.5 rounded-xl">
          <AlertCircle size={12} className="text-blue-400 flex-shrink-0 mt-0.5" />
          <span>You can revoke access at any time from your {channel.name} settings.</span>
        </div>
      </div>
      <div className="px-6 pb-6 space-y-2">
        <button onClick={handleConnect} className={cn('w-full flex items-center justify-center gap-2.5 py-3 rounded-xl font-semibold text-sm transition-all', channel.btnClass)}>
          <ChannelIcon ch={channel} size="sm" />
          {channel.btnLabel}
        </button>
        <button onClick={onClose} className="w-full py-2.5 text-sm text-gray-400 hover:text-gray-600 font-medium">Cancel</button>
      </div>
    </ModalShell>
  );
}

function WhatsAppModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', phoneNumberId: '', wabaId: '', accessToken: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const waDef = CHANNELS[0];

  const handleSave = async () => {
    if (!form.name || !form.phoneNumberId || !form.wabaId || !form.accessToken) {
      setError('All fields are required.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await channelsApi.create({ name: form.name, type: 'WHATSAPP', phoneNumberId: form.phoneNumberId, wabaId: form.wabaId, accessToken: form.accessToken });
      onSaved();
      onClose();
    } catch (e) {
      const msg = e && typeof e === 'object' && 'response' in e ? (e as { response?: { data?: { message?: string } } }).response?.data?.message : undefined;
      setError(typeof msg === 'string' ? msg : 'Failed to connect.');
    } finally { setSaving(false); }
  };

  const fields = [
    { key: 'name' as const, label: 'Channel Name', placeholder: 'e.g. My WhatsApp Business' },
    { key: 'phoneNumberId' as const, label: 'Phone Number ID', placeholder: 'From Meta Business Manager' },
    { key: 'wabaId' as const, label: 'WABA ID', placeholder: 'WhatsApp Business Account ID' },
    { key: 'accessToken' as const, label: 'Access Token', placeholder: 'Meta system user access token', secret: true },
  ];

  return (
    <ModalShell onClose={onClose}>
      <div className="px-6 pt-6 pb-4 border-b border-gray-100">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <ChannelIcon ch={waDef} size="lg" />
            <div>
              <h2 className="text-base font-bold text-gray-900">Connect WhatsApp Business API</h2>
              <p className="text-xs text-gray-500 mt-0.5">Enter your Meta credentials</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1"><X size={16} /></button>
        </div>
      </div>
      <div className="px-6 py-4 space-y-3">
        {fields.map(f => (
          <div key={f.key}>
            <label className="text-xs font-semibold text-gray-500 block mb-1.5">{f.label}</label>
            <input
              type={f.secret ? 'password' : 'text'} placeholder={f.placeholder}
              value={form[f.key]} onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
              className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-colors"
            />
          </div>
        ))}
        {error && (
          <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 p-3 rounded-xl">
            <AlertCircle size={12} className="flex-shrink-0" />{error}
          </div>
        )}
      </div>
      <div className="px-6 pb-6 flex gap-2.5">
        <button onClick={onClose} className="flex-1 py-2.5 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600 font-medium">Cancel</button>
        <button onClick={() => { void handleSave(); }} disabled={saving} className="flex-1 py-2.5 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white rounded-xl font-semibold transition-colors">
          {saving ? 'Connecting…' : 'Connect'}
        </button>
      </div>
    </ModalShell>
  );
}

function TelegramModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [botToken, setBotToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { accessToken } = useAuthStore();
  const tgDef = CHANNELS[4];

  const handleSave = async () => {
    if (!botToken.trim()) { setError('Bot token is required.'); return; }
    setSaving(true);
    setError('');
    try {
      const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001/api/v1';
      const res = await fetch(`${API_URL}/channels/telegram/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken ?? ''}` },
        body: JSON.stringify({ botToken: botToken.trim() }),
      });
      if (!res.ok) {
        const data = await res.json() as { message?: string };
        throw new Error(data.message ?? 'Connection failed');
      }
      onSaved();
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : 'Connection failed'); }
    finally { setSaving(false); }
  };

  return (
    <ModalShell onClose={onClose}>
      <div className="px-6 pt-6 pb-4 border-b border-gray-100">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <ChannelIcon ch={tgDef} size="lg" />
            <div>
              <h2 className="text-base font-bold text-gray-900">Connect Telegram Bot</h2>
              <p className="text-xs text-gray-500 mt-0.5">Paste your BotFather token</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1"><X size={16} /></button>
        </div>
      </div>
      <div className="px-6 py-4 space-y-3">
        <div className="bg-sky-50 rounded-xl px-4 py-3 space-y-1">
          <p className="text-xs font-semibold text-sky-700">How to get your token:</p>
          <p className="text-xs text-sky-600">1. Open Telegram → search <code className="bg-sky-100 px-1 rounded">@BotFather</code></p>
          <p className="text-xs text-sky-600">2. Send <code className="bg-sky-100 px-1 rounded">/newbot</code> and follow the steps</p>
          <p className="text-xs text-sky-600">3. Copy the token BotFather provides</p>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-500 block mb-1.5">Bot Token</label>
          <input type="text" placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxYZ" value={botToken}
            onChange={e => setBotToken(e.target.value)}
            className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm font-mono bg-gray-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-colors" />
        </div>
        {error && (
          <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 p-3 rounded-xl">
            <AlertCircle size={12} className="flex-shrink-0" />{error}
          </div>
        )}
      </div>
      <div className="px-6 pb-6 flex gap-2.5">
        <button onClick={onClose} className="flex-1 py-2.5 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600 font-medium">Cancel</button>
        <button onClick={() => { void handleSave(); }} disabled={saving} className="flex-1 py-2.5 text-sm bg-sky-500 hover:bg-sky-600 disabled:opacity-60 text-white rounded-xl font-semibold transition-colors">
          {saving ? 'Verifying…' : 'Connect'}
        </button>
      </div>
    </ModalShell>
  );
}

// ─── Hero Section ─────────────────────────────────────────────────────────────

function HeroSection({ connected }: { connected: ConnectedChannel[] }) {
  const activeCount = connected.filter(c => c.isActive).length;

  return (
    <div className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-teal-950">
      {/* Dot grid */}
      <div className="absolute inset-0 opacity-[0.07]"
        style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
      {/* Gradient orbs */}
      <div className="absolute -top-20 -right-20 w-72 h-72 bg-teal-600/20 rounded-full blur-3xl" />
      <div className="absolute -bottom-10 left-1/3 w-56 h-56 bg-blue-600/10 rounded-full blur-3xl" />

      <div className="relative z-10 px-8 py-10">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-teal-400 uppercase tracking-widest">
                <Radio size={11} className="animate-pulse" /> Channel Management
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold text-white leading-tight mb-2">
              Connect & manage all your<br className="hidden sm:block" /> customer conversations
            </h1>
            <p className="text-slate-400 text-sm leading-relaxed max-w-lg">
              One unified inbox for WhatsApp, Instagram, Facebook, TikTok, and Telegram.
              Connect channels once and let your team handle everything from here.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 lg:flex-nowrap">
            <div className="flex items-center gap-2.5 bg-white/10 backdrop-blur-sm border border-white/10 rounded-2xl px-4 py-3 min-w-[110px]">
              <div className="w-8 h-8 bg-white/10 rounded-xl flex items-center justify-center">
                <Plug2 size={15} className="text-white" />
              </div>
              <div>
                <p className="text-xl font-bold text-white leading-none">{connected.length}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Connected</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 bg-white/10 backdrop-blur-sm border border-white/10 rounded-2xl px-4 py-3 min-w-[110px]">
              <div className="w-8 h-8 bg-emerald-500/20 rounded-xl flex items-center justify-center">
                <Activity size={15} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-white leading-none">{activeCount}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Active now</p>
              </div>
            </div>
            <div className="flex items-center gap-2.5 bg-white/10 backdrop-blur-sm border border-white/10 rounded-2xl px-4 py-3 min-w-[110px]">
              <div className="w-8 h-8 bg-teal-500/20 rounded-xl flex items-center justify-center">
                <Zap size={15} className="text-teal-400" />
              </div>
              <div>
                <p className="text-xl font-bold text-white leading-none">{CHANNELS.length}</p>
                <p className="text-[11px] text-slate-400 mt-0.5">Platforms</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Stats Bar ────────────────────────────────────────────────────────────────

function StatsBar({ connected }: { connected: ConnectedChannel[] }) {
  const activeCount = connected.filter(c => c.isActive).length;
  const notConnected = CHANNELS.length - connected.length;

  const stats = [
    { label: 'Total Platforms', value: CHANNELS.length, icon: <Shield size={16} className="text-slate-500" />, bg: 'bg-slate-50', border: 'border-slate-200' },
    { label: 'Connected', value: connected.length, icon: <Plug2 size={16} className="text-teal-600" />, bg: 'bg-teal-50', border: 'border-teal-200', highlight: true },
    { label: 'Active & Syncing', value: activeCount, icon: <Activity size={16} className="text-emerald-600" />, bg: 'bg-emerald-50', border: 'border-emerald-200' },
    { label: 'Not Connected', value: notConnected, icon: <PlugZap size={16} className="text-amber-600" />, bg: 'bg-amber-50', border: 'border-amber-200' },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 px-8 py-5 border-b border-gray-100 bg-white">
      {stats.map(s => (
        <div key={s.label} className={cn('rounded-2xl border px-4 py-3.5 flex items-center gap-3 transition-shadow hover:shadow-sm', s.bg, s.border)}>
          <div className={cn('w-9 h-9 rounded-xl flex items-center justify-center bg-white shadow-sm flex-shrink-0')}>
            {s.icon}
          </div>
          <div>
            <p className="text-2xl font-bold text-gray-900 leading-none">{s.value}</p>
            <p className="text-[11px] text-gray-500 mt-1 font-medium">{s.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Channel Card ─────────────────────────────────────────────────────────────

function ChannelCard({
  ch,
  connectedData,
  onConnect,
}: {
  ch: ChannelDef;
  connectedData?: ConnectedChannel;
  onConnect: () => void;
}) {
  const isConnected = !!connectedData;
  const isActive = connectedData?.isActive ?? false;

  return (
    <div className={cn(
      'group relative bg-white border rounded-2xl overflow-hidden transition-all duration-200',
      'hover:shadow-md hover:-translate-y-0.5',
      isConnected
        ? 'border-gray-200 shadow-sm'
        : 'border-gray-200 hover:border-gray-300',
    )}>
      {/* Platform accent bar */}
      <div className={cn('absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl', ch.accentBg)} />

      <div className="pl-5 pr-5 py-5">
        <div className="flex items-start gap-4">
          {/* Icon */}
          <div className={cn('transition-transform duration-200 group-hover:scale-105', !isConnected && 'opacity-90')}>
            <ChannelIcon ch={ch} size="md" />
          </div>

          {/* Main content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-gray-900 text-sm">{ch.name}</h3>
                  {ch.badge && (
                    <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full border',
                      ch.badge === 'Popular' && 'bg-amber-50 text-amber-700 border-amber-200',
                      ch.badge === 'Beta' && 'bg-purple-50 text-purple-700 border-purple-200',
                      ch.badge === 'New' && 'bg-teal-50 text-teal-700 border-teal-200',
                    )}>
                      {ch.badge}
                    </span>
                  )}
                </div>

                {isConnected ? (
                  <div className="mt-1.5 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <LiveDot color={isActive ? 'emerald' : 'amber'} />
                      <span className="text-xs font-semibold text-gray-700">
                        {connectedData.name || connectedData.phoneNumber || 'Connected'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-gray-400">
                      <span className="flex items-center gap-1">
                        <RefreshCw size={10} />
                        Syncing live
                      </span>
                      <span className="flex items-center gap-1">
                        <Shield size={10} />
                        Webhook healthy
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock size={10} />
                        Just now
                      </span>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed line-clamp-2 max-w-sm">
                    {ch.description}
                  </p>
                )}
              </div>

              {/* Status + action */}
              <div className="flex flex-col items-end gap-2.5 flex-shrink-0">
                {isConnected ? (
                  <>
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      {isActive ? 'Connected' : 'Inactive'}
                    </span>
                    <button
                      onClick={onConnect}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-all"
                    >
                      <Settings size={12} />
                      Manage
                    </button>
                  </>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-400 bg-gray-50 border border-gray-200 px-2.5 py-1 rounded-full">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-300" />
                      Not connected
                    </span>
                    <button
                      onClick={onConnect}
                      className={cn(
                        'flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold rounded-xl transition-all',
                        'shadow-sm hover:shadow group-hover:scale-105',
                        ch.btnClass,
                      )}
                    >
                      Connect
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Feature pills — shown only when disconnected */}
            {!isConnected && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {ch.features.map(f => (
                  <span key={f} className="inline-flex items-center gap-1 text-[10px] font-medium text-gray-500 bg-gray-50 border border-gray-100 px-2 py-0.5 rounded-full">
                    <span className="w-1 h-1 rounded-full bg-gray-400" />
                    {f}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── OAuth/Error handling ─────────────────────────────────────────────────────

const OAUTH_ERRORS: Record<string, string> = {
  not_configured: 'This channel is not configured on the server yet.',
  unsupported_provider: 'This provider is not supported.',
  auth_cancelled: 'Authorization was cancelled.',
  auth_failed: 'Connection failed. Please try again.',
};

const OAUTH_SUCCESS: Record<string, string> = {
  facebook: 'Facebook Messenger connected!',
  instagram: 'Instagram connected!',
  tiktok: 'TikTok connected!',
};

// ─── Main Page ────────────────────────────────────────────────────────────────

function ChannelsPageInner() {
  const searchParams = useSearchParams();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'connected' | 'disconnected'>('all');
  const [connected, setConnected] = useState<ConnectedChannel[]>([]);
  const [showWhatsApp, setShowWhatsApp] = useState(false);
  const [showTelegram, setShowTelegram] = useState(false);
  const [oauthChannel, setOauthChannel] = useState<ChannelDef | null>(null);

  const loadConnected = useCallback(async () => {
    try {
      const res = await channelsApi.list();
      setConnected(res.data as ConnectedChannel[]);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { void loadConnected(); }, [loadConnected]);

  useEffect(() => {
    if (!searchParams) return;
    const error = searchParams.get('error');
    const success = searchParams.get('success');
    const provider = searchParams.get('provider') ?? success ?? '';

    if (success) {
      toast.success(OAUTH_SUCCESS[success] ?? `${success} connected!`);
      void loadConnected();
    } else if (error) {
      const msg = OAUTH_ERRORS[error] ?? decodeURIComponent(error);
      const prefix = provider ? `${provider.charAt(0).toUpperCase() + provider.slice(1)}: ` : '';
      toast.error(`${prefix}${msg}`);
    }

    if (error || success) {
      const url = new URL(window.location.href);
      url.searchParams.delete('error');
      url.searchParams.delete('success');
      url.searchParams.delete('provider');
      window.history.replaceState({}, '', url.toString());
    }
  }, [searchParams, loadConnected]);

  const getConnectedData = (ch: ChannelDef): ConnectedChannel | undefined =>
    connected.find(c => c.type?.toUpperCase() === TYPE_MAP[ch.id]);

  const filtered = CHANNELS.filter(ch => {
    const isConn = !!getConnectedData(ch);
    if (statusFilter === 'connected' && !isConn) return false;
    if (statusFilter === 'disconnected' && isConn) return false;
    if (search) {
      const q = search.toLowerCase();
      return ch.name.toLowerCase().includes(q) || ch.description.toLowerCase().includes(q);
    }
    return true;
  });

  const connectedFirst = [...filtered].sort((a, b) => {
    const aConn = !!getConnectedData(a) ? 1 : 0;
    const bConn = !!getConnectedData(b) ? 1 : 0;
    return bConn - aConn;
  });

  const handleConnect = (ch: ChannelDef) => {
    if (ch.connectType === 'api') {
      if (ch.id === 'telegram') { setShowTelegram(true); return; }
      setShowWhatsApp(true);
      return;
    }
    if (ch.connectType === 'oauth') { setOauthChannel(ch); }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden bg-gray-50">
      <div className="flex-1 overflow-y-auto">
        {/* Hero */}
        <HeroSection connected={connected} />

        {/* Stats */}
        <StatsBar connected={connected} />

        {/* Toolbar */}
        <div className="px-8 pt-5 pb-4 bg-gray-50">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Search */}
            <div className="relative flex-1 max-w-xs">
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search channels…"
                className="w-full bg-white border border-gray-200 rounded-xl pl-9 pr-4 py-2.5 text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors shadow-sm"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Status filter */}
            <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl p-1 shadow-sm">
              {(['all', 'connected', 'disconnected'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setStatusFilter(f)}
                  className={cn(
                    'px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all',
                    statusFilter === f
                      ? 'bg-teal-600 text-white shadow-sm'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50',
                  )}
                >
                  {f === 'all' ? 'All' : f === 'connected' ? `Connected (${connected.length})` : 'Not Connected'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Channel list */}
        <div className="px-8 pb-8 space-y-3">
          {connectedFirst.length === 0 ? (
            <div className="text-center py-16 bg-white border border-dashed border-gray-200 rounded-2xl">
              <div className="w-12 h-12 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
                <Search size={20} className="text-gray-400" />
              </div>
              <p className="text-sm font-semibold text-gray-700">No channels match your search</p>
              <p className="text-xs text-gray-400 mt-1">Try a different filter or search term</p>
            </div>
          ) : (
            connectedFirst.map(ch => (
              <ChannelCard
                key={ch.id}
                ch={ch}
                connectedData={getConnectedData(ch)}
                onConnect={() => handleConnect(ch)}
              />
            ))
          )}
        </div>
      </div>

      {/* Modals */}
      {showWhatsApp && <WhatsAppModal onClose={() => setShowWhatsApp(false)} onSaved={() => { void loadConnected(); }} />}
      {showTelegram && <TelegramModal onClose={() => setShowTelegram(false)} onSaved={() => { void loadConnected(); }} />}
      {oauthChannel && <OAuthModal channel={oauthChannel} onClose={() => setOauthChannel(null)} />}
    </div>
  );
}

export default function ChannelsPage() {
  return <Suspense><ChannelsPageInner /></Suspense>;
}

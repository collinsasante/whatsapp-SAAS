'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Search, X, CheckCircle2, AlertCircle, RefreshCw, Clock,
  Settings, ChevronDown, Radio, Zap, Activity, Shield,
  Plug2, PlugZap, Plus, PowerOff, Power, QrCode, LogOut, TriangleAlert,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { channelsApi, facebookPagesApi, whatsappWebApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { cn } from '@/lib/utils';
import { getSocket, SocketEvent } from '@/lib/socket';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConnectedChannel {
  id: string;
  name: string;
  type: string;
  isActive: boolean;
  phoneNumber?: string;
  // WHATSAPP_WEB-only fields (flattened server-side from WhatsAppWebSession) --
  // undefined for every other channel type.
  sessionId?: string;
  whatsappWebStatus?: 'QR_PENDING' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'LOGGED_OUT' | 'ERROR';
  lastError?: string | null;
}

interface ChannelDef {
  id: string;
  name: string;
  description: string;
  badge?: 'Popular' | 'Beta' | 'New' | 'Coming Soon';
  connectType: 'api' | 'oauth' | 'qr';
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
    description: 'Reply to Messenger conversations directly from your inbox. Connect one or more Facebook Pages to your workspace.',
    badge: 'New',
    connectType: 'oauth',
    oauthProvider: 'facebook',
    accentClass: 'border-l-blue-600',
    accentBg: 'bg-blue-600',
    btnClass: 'bg-[#1877F2] hover:bg-[#166FE5] text-white',
    btnLabel: 'Continue with Facebook',
    features: ['Real-time inbox messaging', 'Connect multiple Pages', 'AI-assisted replies'],
  },
  {
    id: 'instagram',
    name: 'Instagram',
    description: 'Connect your Instagram professional account now to reserve it. DM and story-reply management are coming soon.',
    badge: 'Coming Soon',
    connectType: 'oauth',
    oauthProvider: 'instagram',
    accentClass: 'border-l-pink-500',
    accentBg: 'bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400',
    btnClass: 'bg-gradient-to-r from-purple-600 via-pink-600 to-orange-500 hover:opacity-90 text-white',
    btnLabel: 'Continue with Instagram',
    features: ['Account connection available now', 'DM inbox — coming soon', 'Story & comment tools — coming soon'],
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    description: "Connect your TikTok account now to verify it. Business Messaging requires TikTok's own platform approval, which isn't complete yet — connecting today only verifies your account, it doesn't yet enable sending or receiving DMs.",
    badge: 'Beta',
    connectType: 'oauth',
    oauthProvider: 'tiktok',
    accentClass: 'border-l-slate-900',
    accentBg: 'bg-slate-900',
    btnClass: 'bg-slate-900 hover:bg-slate-800 text-white',
    btnLabel: 'Continue with TikTok',
    features: ['Account verification available now', 'Business Messaging — pending TikTok approval', 'DM automation — not yet available'],
  },
  {
    id: 'telegram',
    name: 'Telegram',
    description: "Connect a Telegram Bot to verify it's live now. Full inbox messaging, group support, and automation are coming soon.",
    badge: 'Coming Soon',
    connectType: 'api',
    accentClass: 'border-l-sky-500',
    accentBg: 'bg-sky-500',
    btnClass: 'bg-sky-500 hover:bg-sky-600 text-white',
    btnLabel: 'Connect Bot',
    features: ['Bot token verified on connect', 'Message inbox — coming soon', 'Automation & routing — coming soon'],
  },
  {
    id: 'whatsapp-web',
    name: 'WhatsApp via QR',
    description: 'Link a personal WhatsApp number by scanning a QR code, like WhatsApp Web. Unofficial and against WhatsApp\'s Terms of Service — the linked number can be banned by WhatsApp at any time, with no recourse.',
    badge: 'Beta',
    connectType: 'qr',
    accentClass: 'border-l-amber-500',
    accentBg: 'bg-gradient-to-br from-emerald-500 to-teal-600',
    btnClass: 'bg-gray-900 hover:bg-black text-white',
    btnLabel: 'Connect via QR Code',
    features: ['Scan with your phone in seconds', 'Uses the same inbox, AI & automation', 'Unofficial — real ban risk, no SLA'],
  },
];

const TYPE_MAP: Record<string, string> = {
  'whatsapp-api': 'WHATSAPP',
  facebook: 'FACEBOOK_MESSENGER',
  instagram: 'INSTAGRAM',
  tiktok: 'TIKTOK',
  telegram: 'TELEGRAM',
  'whatsapp-web': 'WHATSAPP_WEB',
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
      {ch.id === 'whatsapp-web' && <QrCode size={iconSizes[size]} className="text-white" />}
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

// Reflects exactly what's requested in the real OAuth scope (channels.controller.ts) --
// not what the eventual messaging feature will need once it's built.
const OAUTH_INFO: Record<string, { permissions: string[] }> = {
  facebook: { permissions: ['See which Pages you manage', 'Read basic Page engagement info', 'Send and receive Messenger messages on your behalf'] },
  instagram: { permissions: ['View your linked Instagram professional account', 'See which Pages you manage'] },
  tiktok: { permissions: ['View your public TikTok profile (name, avatar)'] },
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
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      // Fetched via the authenticated API client (not a plain <a href>/
      // window.location navigation) since this route requires auth -- a raw
      // browser navigation can't attach the Bearer token. The actual
      // redirect to Facebook/Instagram/TikTok happens here, after we have
      // the real URL back.
      const res = await channelsApi.getOAuthUrl(provider);
      window.location.href = (res.data as { redirectUrl: string }).redirectUrl;
    } catch (e) {
      const msg = e && typeof e === 'object' && 'response' in e ? (e as { response?: { data?: { message?: string } } }).response?.data?.message : undefined;
      toast.error(typeof msg === 'string' ? msg : `Failed to start ${channel.name} connection.`);
      setConnecting(false);
    }
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
          {provider === 'facebook' && "You'll be redirected to Facebook to authorize Verz, then choose which Page(s) to connect. You can connect more than one."}
          {provider === 'instagram' && "You'll sign in with Instagram Business to connect and reserve your account. DM and story reply support is coming soon."}
          {provider === 'tiktok' && "You'll be redirected to TikTok to verify your account. This does not yet enable Business Messaging, which requires TikTok's own platform approval."}
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
        <button
          onClick={() => { void handleConnect(); }}
          disabled={connecting}
          className={cn('w-full flex items-center justify-center gap-2.5 py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed', channel.btnClass)}
        >
          <ChannelIcon ch={channel} size="sm" />
          {connecting ? 'Connecting…' : channel.btnLabel}
        </button>
        <button onClick={onClose} disabled={connecting} className="w-full py-2.5 text-sm text-gray-400 hover:text-gray-600 font-medium disabled:opacity-60">Cancel</button>
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

// ─── Facebook Page Picker ──────────────────────────────────────────────────────
// Real Page selection, replacing the old auto-connect-everything behavior --
// the OAuth callback now stops at fetching candidate Pages and stashes them
// server-side in a short-lived session; nothing is connected until the user
// explicitly picks which Page(s) here.

interface CandidatePage {
  id: string;
  name: string;
  alreadyConnected: boolean;
}

function FacebookPagePicker({ sessionId, onClose, onConnected }: { sessionId: string; onClose: () => void; onConnected: () => void }) {
  const [pages, setPages] = useState<CandidatePage[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await facebookPagesApi.session(sessionId);
        const data = res.data as { candidatePages: CandidatePage[] };
        if (cancelled) return;
        setPages(data.candidatePages);
        setSelected(new Set(data.candidatePages.filter(p => !p.alreadyConnected).map(p => p.id)));
      } catch {
        if (!cancelled) setError('This connection session has expired. Please reconnect from the Channels page.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleConnect = async () => {
    if (selected.size === 0) { setError('Select at least one Page.'); return; }
    setConnecting(true);
    setError('');
    try {
      await facebookPagesApi.select(sessionId, [...selected]);
      toast.success(selected.size === 1 ? 'Page connected!' : `${selected.size} Pages connected!`);
      onConnected();
      onClose();
    } catch (e) {
      const msg = e && typeof e === 'object' && 'response' in e ? (e as { response?: { data?: { message?: string } } }).response?.data?.message : undefined;
      setError(typeof msg === 'string' ? msg : 'Failed to connect the selected Page(s).');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <div className="px-6 pt-6 pb-4 border-b border-gray-100">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-gray-900">Connect Facebook Page</h2>
            <p className="text-xs text-gray-500 mt-0.5">Select the Page(s) you want to connect to Verz</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1"><X size={16} /></button>
        </div>
      </div>
      <div className="px-6 py-4 max-h-80 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" /></div>
        ) : pages.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No Facebook Pages found. Make sure your account manages at least one Page.</p>
        ) : (
          <div className="space-y-2">
            {pages.map(p => (
              <label key={p.id} className={cn(
                'flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-colors',
                selected.has(p.id) ? 'bg-blue-50 border-blue-200' : 'bg-white border-gray-100 hover:border-gray-200',
                p.alreadyConnected && 'opacity-60',
              )}>
                <input
                  type="checkbox"
                  checked={selected.has(p.id)}
                  onChange={() => toggle(p.id)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-gray-800 truncate block">{p.name}</span>
                  <span className="text-xs text-gray-400">Facebook Page{p.alreadyConnected ? ' · Already connected' : ''}</span>
                </div>
              </label>
            ))}
          </div>
        )}
        {error && (
          <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 p-3 rounded-xl mt-3">
            <AlertCircle size={12} className="flex-shrink-0" />{error}
          </div>
        )}
      </div>
      <div className="px-6 pb-6 flex gap-2.5">
        <button onClick={onClose} className="flex-1 py-2.5 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600 font-medium">Cancel</button>
        <button
          onClick={() => { void handleConnect(); }}
          disabled={connecting || loading || pages.length === 0}
          className="flex-1 py-2.5 text-sm bg-[#1877F2] hover:bg-[#166FE5] disabled:opacity-60 text-white rounded-xl font-semibold transition-colors"
        >
          {connecting ? 'Connecting…' : `Connect ${selected.size > 0 ? `(${selected.size})` : ''}`}
        </button>
      </div>
    </ModalShell>
  );
}

// ─── Facebook Pages Section ────────────────────────────────────────────────────
// Facebook can have multiple connected Pages (one Channel row each), unlike
// the other platforms' single-row ChannelCard -- gets its own dedicated
// section mirroring the WhatsApp Numbers row-list pattern (Settings page),
// the only existing precedent in this codebase for a real multi-account list.

function FacebookPagesSection({ pages, onChanged, onConnectMore }: { pages: ConnectedChannel[]; onChanged: () => void; onConnectMore: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const fbDef = CHANNELS.find(c => c.id === 'facebook')!;

  const handleToggle = async (id: string) => {
    setBusyId(id);
    try {
      await channelsApi.toggle(id);
      onChanged();
    } catch {
      toast.error('Failed to update this Page.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <div className="pl-5 pr-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ChannelIcon ch={fbDef} size="md" />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-gray-900 text-sm">Facebook Messenger</h3>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border bg-teal-50 text-teal-700 border-teal-200">New</span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{pages.length} Page{pages.length !== 1 ? 's' : ''} connected</p>
          </div>
        </div>
        <button
          onClick={onConnectMore}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs rounded-lg font-semibold transition-colors"
        >
          <Plus size={13} /> Connect another Page
        </button>
      </div>
      <div className="p-3 space-y-2">
        {pages.map(page => (
          <div key={page.id} className={cn('flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors', page.isActive ? 'bg-white border-gray-100' : 'bg-gray-50 border-gray-100')}>
            <LiveDot color={page.isActive ? 'emerald' : 'gray'} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-800 truncate">{page.name}</span>
                {!page.isActive && <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">Disconnected</span>}
              </div>
              <p className="text-xs text-gray-400 mt-0.5">Facebook Page</p>
            </div>
            <button
              onClick={() => { void handleToggle(page.id); }}
              disabled={busyId === page.id}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors disabled:opacity-50',
                page.isActive ? 'text-gray-500 hover:text-red-600 hover:bg-red-50' : 'text-teal-600 hover:bg-teal-50',
              )}
            >
              {page.isActive ? <PowerOff size={12} /> : <Power size={12} />}
              {page.isActive ? 'Disconnect' : 'Reconnect'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── WhatsApp via QR (unofficial linked-device) ────────────────────────────────
// Separate connection mechanism from the official Cloud API card above -- a
// live Baileys socket + session lifecycle, not an OAuth token exchange or a
// static credentials form. Never mixed with WhatsApp Business API internally:
// distinct channel type (WHATSAPP_WEB), distinct connect/manage UI here.

const WA_WEB_STATUS_META: Record<NonNullable<ConnectedChannel['whatsappWebStatus']>, { label: string; dot: 'emerald' | 'amber' | 'red' | 'gray' }> = {
  QR_PENDING: { label: 'Waiting for scan', dot: 'amber' },
  CONNECTING: { label: 'Connecting…', dot: 'amber' },
  CONNECTED: { label: 'Connected', dot: 'emerald' },
  RECONNECTING: { label: 'Reconnecting…', dot: 'amber' },
  LOGGED_OUT: { label: 'Logged out', dot: 'gray' },
  ERROR: { label: 'Connection error', dot: 'red' },
};

function WhatsAppQrModal({ onClose, onConnected }: { onClose: () => void; onConnected: () => void }) {
  const [step, setStep] = useState<'disclosure' | 'starting' | 'qr' | 'connected' | 'error'>('disclosure');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const waWebDef = CHANNELS.find(c => c.id === 'whatsapp-web')!;

  const handleStart = async () => {
    setStep('starting');
    setErrorMsg('');
    try {
      const res = await whatsappWebApi.startPairing();
      setSessionId(res.data.sessionId);
    } catch (e) {
      const msg = e && typeof e === 'object' && 'response' in e ? (e as { response?: { data?: { message?: string } } }).response?.data?.message : undefined;
      setErrorMsg(typeof msg === 'string' ? msg : 'Failed to start the pairing session.');
      setStep('error');
    }
  };

  // Listens tenant-wide (the events carry sessionId; every other session's
  // events for this tenant are just filtered out) -- matches how every other
  // realtime feature in this app listens, no server-side per-modal room.
  useEffect(() => {
    if (!sessionId) return;
    const socket = getSocket();

    const onQr = (data: { sessionId: string; qrDataUrl: string }) => {
      if (data.sessionId !== sessionId) return;
      setQrDataUrl(data.qrDataUrl);
      setStep('qr');
    };
    const onStatus = (data: { sessionId: string; status: string; phoneNumber?: string }) => {
      if (data.sessionId !== sessionId) return;
      if (data.status === 'CONNECTED') {
        setPhoneNumber(data.phoneNumber ?? null);
        setStep('connected');
        toast.success('WhatsApp connected!');
        onConnected();
      } else if (data.status === 'ERROR' || data.status === 'LOGGED_OUT') {
        setErrorMsg('The connection failed or was closed before pairing finished. Please try again.');
        setStep('error');
      }
    };

    socket.on(SocketEvent.WHATSAPP_WEB_QR, onQr);
    socket.on(SocketEvent.WHATSAPP_WEB_STATUS, onStatus);
    return () => {
      socket.off(SocketEvent.WHATSAPP_WEB_QR, onQr);
      socket.off(SocketEvent.WHATSAPP_WEB_STATUS, onStatus);
    };
  }, [sessionId, onConnected]);

  return (
    <ModalShell onClose={onClose}>
      <div className="px-6 pt-6 pb-4 border-b border-gray-100">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <ChannelIcon ch={waWebDef} size="lg" />
            <div>
              <h2 className="text-base font-bold text-gray-900">Connect WhatsApp via QR</h2>
              <p className="text-xs text-gray-500 mt-0.5">Unofficial, linked-device connection</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1"><X size={16} /></button>
        </div>
      </div>

      {step === 'disclosure' && (
        <>
          <div className="px-6 py-4 space-y-3">
            <div className="flex items-start gap-2.5 text-sm text-amber-900 bg-amber-50 border border-amber-200 px-4 py-3 rounded-xl">
              <TriangleAlert size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="space-y-1.5">
                <p className="font-semibold">This is not the official WhatsApp Business API.</p>
                <p className="text-amber-800 leading-relaxed">
                  It links your personal WhatsApp number the same way WhatsApp Web does. This works outside
                  WhatsApp&rsquo;s Terms of Service for businesses — WhatsApp can ban the linked number at any time,
                  without warning and with no recourse. Use a number you can afford to lose.
                </p>
              </div>
            </div>
            <div className="bg-gray-50 rounded-xl p-4 space-y-2">
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">What happens next</p>
              {[
                'A QR code appears below — open WhatsApp on your phone, go to Linked Devices, and scan it',
                'Once linked, incoming messages arrive in this same inbox — same AI, automation, and team routing',
                'You can disconnect or fully log out this number at any time from the Channels page',
              ].map(p => (
                <div key={p} className="flex items-start gap-2.5">
                  <CheckCircle2 size={13} className="text-teal-600 flex-shrink-0 mt-0.5" />
                  <span className="text-sm text-gray-700 leading-snug">{p}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="px-6 pb-6 space-y-2">
            <button
              onClick={() => { void handleStart(); }}
              className="w-full flex items-center justify-center gap-2.5 py-3 rounded-xl font-semibold text-sm bg-gray-900 hover:bg-black text-white transition-all"
            >
              I understand the risks — show me a QR code
            </button>
            <button onClick={onClose} className="w-full py-2.5 text-sm text-gray-400 hover:text-gray-600 font-medium">Cancel</button>
          </div>
        </>
      )}

      {step === 'starting' && (
        <div className="px-6 py-14 flex flex-col items-center justify-center gap-3">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900" />
          <p className="text-sm text-gray-500">Starting a secure pairing session…</p>
        </div>
      )}

      {step === 'qr' && (
        <>
          <div className="px-6 py-6 flex flex-col items-center gap-4">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt="Scan with WhatsApp to connect" className="w-56 h-56 rounded-xl border border-gray-200 p-2" />
            ) : (
              <div className="w-56 h-56 rounded-xl border border-gray-200 flex items-center justify-center">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900" />
              </div>
            )}
            <div className="text-center space-y-1">
              <p className="text-sm font-semibold text-gray-800">Scan with your phone</p>
              <p className="text-xs text-gray-500 max-w-xs">
                WhatsApp → Settings → Linked Devices → Link a Device. The code refreshes automatically if it expires.
              </p>
            </div>
          </div>
          <div className="px-6 pb-6">
            <button onClick={onClose} className="w-full py-2.5 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600 font-medium">
              Close (pairing continues in the background)
            </button>
          </div>
        </>
      )}

      {step === 'connected' && (
        <div className="px-6 py-10 flex flex-col items-center gap-3 text-center">
          <div className="w-12 h-12 bg-emerald-50 rounded-2xl flex items-center justify-center">
            <CheckCircle2 size={24} className="text-emerald-600" />
          </div>
          <p className="text-sm font-bold text-gray-900">WhatsApp connected!</p>
          {phoneNumber && <p className="text-xs text-gray-500">{phoneNumber}</p>}
          <button onClick={onClose} className="mt-2 px-5 py-2.5 text-sm bg-gray-900 hover:bg-black text-white rounded-xl font-semibold transition-colors">
            Done
          </button>
        </div>
      )}

      {step === 'error' && (
        <>
          <div className="px-6 py-4">
            <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 p-3 rounded-xl">
              <AlertCircle size={12} className="flex-shrink-0" />{errorMsg}
            </div>
          </div>
          <div className="px-6 pb-6 flex gap-2.5">
            <button onClick={onClose} className="flex-1 py-2.5 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600 font-medium">Cancel</button>
            <button onClick={() => { setStep('disclosure'); }} className="flex-1 py-2.5 text-sm bg-gray-900 hover:bg-black text-white rounded-xl font-semibold transition-colors">
              Try again
            </button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

function WhatsAppWebSection({ sessions, onChanged, onConnectMore }: { sessions: ConnectedChannel[]; onChanged: () => void; onConnectMore: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const waWebDef = CHANNELS.find(c => c.id === 'whatsapp-web')!;

  const handleDisconnect = async (sessionId: string) => {
    setBusyId(sessionId);
    try {
      await whatsappWebApi.disconnect(sessionId);
      onChanged();
    } catch {
      toast.error('Failed to disconnect this number.');
    } finally { setBusyId(null); }
  };

  const handleLogout = async (sessionId: string) => {
    if (!window.confirm('Log out this number? You\'ll need to scan a new QR code to reconnect it.')) return;
    setBusyId(sessionId);
    try {
      await whatsappWebApi.logout(sessionId);
      onChanged();
    } catch {
      toast.error('Failed to log out this number.');
    } finally { setBusyId(null); }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <div className="pl-5 pr-5 py-4 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ChannelIcon ch={waWebDef} size="md" />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-gray-900 text-sm">WhatsApp via QR</h3>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full border bg-purple-50 text-purple-700 border-purple-200">Beta · Unofficial</span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{sessions.length} number{sessions.length !== 1 ? 's' : ''} linked</p>
          </div>
        </div>
        <button
          onClick={onConnectMore}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 hover:bg-black text-white text-xs rounded-lg font-semibold transition-colors"
        >
          <Plus size={13} /> Link another number
        </button>
      </div>
      <div className="p-3 space-y-2">
        {sessions.map(s => {
          const meta = WA_WEB_STATUS_META[s.whatsappWebStatus ?? 'ERROR'];
          const isConnected = s.whatsappWebStatus === 'CONNECTED';
          const canReconnectLater = s.whatsappWebStatus === 'CONNECTED' || s.whatsappWebStatus === 'RECONNECTING';
          return (
            <div key={s.id} className={cn('flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors', isConnected ? 'bg-white border-gray-100' : 'bg-gray-50 border-gray-100')}>
              <LiveDot color={meta.dot} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-800 truncate">{s.phoneNumber ?? s.name}</span>
                  <span className={cn(
                    'text-[10px] font-semibold px-1.5 py-0.5 rounded',
                    meta.dot === 'emerald' && 'bg-emerald-50 text-emerald-700',
                    meta.dot === 'amber' && 'bg-amber-50 text-amber-700',
                    meta.dot === 'red' && 'bg-red-50 text-red-700',
                    meta.dot === 'gray' && 'bg-gray-100 text-gray-500',
                  )}>
                    {meta.label}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5">{s.lastError ? s.lastError : 'Unofficial linked device'}</p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {canReconnectLater && (
                  <button
                    onClick={() => { void handleDisconnect(s.sessionId!); }}
                    disabled={busyId === s.sessionId}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-gray-500 hover:text-amber-700 hover:bg-amber-50 transition-colors disabled:opacity-50"
                  >
                    <PowerOff size={12} /> Disconnect
                  </button>
                )}
                {(canReconnectLater) && (
                  <button
                    onClick={() => { void handleLogout(s.sessionId!); }}
                    disabled={busyId === s.sessionId}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-gray-500 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
                  >
                    <LogOut size={12} /> Log out
                  </button>
                )}
                {!canReconnectLater && (
                  <button
                    onClick={onConnectMore}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg text-teal-600 hover:bg-teal-50 transition-colors"
                  >
                    <QrCode size={12} /> Scan again
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
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
                      ch.badge === 'Coming Soon' && 'bg-gray-50 text-gray-600 border-gray-200',
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
  const [showWhatsAppWebQr, setShowWhatsAppWebQr] = useState(false);
  const [oauthChannel, setOauthChannel] = useState<ChannelDef | null>(null);
  const [facebookPickerSession, setFacebookPickerSession] = useState<string | null>(null);

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

  // Real Page-selection flow: the OAuth callback redirects here with
  // ?picker=facebook&session=<id> instead of auto-connecting every Page.
  useEffect(() => {
    if (!searchParams) return;
    const picker = searchParams.get('picker');
    const session = searchParams.get('session');
    if (picker === 'facebook' && session) {
      setFacebookPickerSession(session);
      const url = new URL(window.location.href);
      url.searchParams.delete('picker');
      url.searchParams.delete('session');
      window.history.replaceState({}, '', url.toString());
    }
  }, [searchParams]);

  const getConnectedData = (ch: ChannelDef): ConnectedChannel | undefined =>
    connected.find(c => c.type?.toUpperCase() === TYPE_MAP[ch.id]);

  // Facebook can have multiple connected Pages (one Channel row each) --
  // every other platform's card assumes a single row via getConnectedData
  // above, which only ever returns the first match.
  const facebookPages = connected.filter(c => c.type?.toUpperCase() === 'FACEBOOK_MESSENGER');
  // Same multi-account shape as Facebook Pages: a workspace can link more
  // than one WhatsApp Web number.
  const whatsAppWebSessions = connected.filter(c => c.type?.toUpperCase() === 'WHATSAPP_WEB');

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
    if (ch.connectType === 'qr') { setShowWhatsAppWebQr(true); return; }
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
              ch.id === 'facebook' && facebookPages.length > 0 ? (
                <FacebookPagesSection
                  key={ch.id}
                  pages={facebookPages}
                  onChanged={() => { void loadConnected(); }}
                  onConnectMore={() => setOauthChannel(ch)}
                />
              ) : ch.id === 'whatsapp-web' && whatsAppWebSessions.length > 0 ? (
                <WhatsAppWebSection
                  key={ch.id}
                  sessions={whatsAppWebSessions}
                  onChanged={() => { void loadConnected(); }}
                  onConnectMore={() => setShowWhatsAppWebQr(true)}
                />
              ) : (
                <ChannelCard
                  key={ch.id}
                  ch={ch}
                  connectedData={getConnectedData(ch)}
                  onConnect={() => handleConnect(ch)}
                />
              )
            ))
          )}
        </div>
      </div>

      {/* Modals */}
      {showWhatsApp && <WhatsAppModal onClose={() => setShowWhatsApp(false)} onSaved={() => { void loadConnected(); }} />}
      {showTelegram && <TelegramModal onClose={() => setShowTelegram(false)} onSaved={() => { void loadConnected(); }} />}
      {showWhatsAppWebQr && <WhatsAppQrModal onClose={() => setShowWhatsAppWebQr(false)} onConnected={() => { void loadConnected(); }} />}
      {oauthChannel && <OAuthModal channel={oauthChannel} onClose={() => setOauthChannel(null)} />}
      {facebookPickerSession && (
        <FacebookPagePicker
          sessionId={facebookPickerSession}
          onClose={() => setFacebookPickerSession(null)}
          onConnected={() => { void loadConnected(); }}
        />
      )}
    </div>
  );
}

export default function ChannelsPage() {
  return <Suspense><ChannelsPageInner /></Suspense>;
}

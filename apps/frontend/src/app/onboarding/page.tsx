'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight, CheckCircle2, Smartphone, Sparkles, ExternalLink,
  Loader2, Eye, EyeOff, Check, MessageSquare, Zap, BarChart3, Globe,
  CheckCircle, AlertCircle,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { tenantApi } from '@/lib/api';
import toast from 'react-hot-toast';

const STEPS = [
  { id: 1, icon: Smartphone, label: 'Connect WhatsApp' },
  { id: 2, icon: Sparkles, label: "All Set!" },
];

interface MetaProfile {
  displayName?: string;
  businessName?: string;
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  websites?: string[];
  vertical?: string;
}

// ─── Step 1: Connect WhatsApp ─────────────────────────────────────────────────
function StepWhatsApp({
  data,
  onChange,
  onFetched,
  fetching,
  setFetching,
  fetched,
}: {
  data: { phoneNumberId: string; wabaId: string; accessToken: string };
  onChange: (k: string, v: string) => void;
  onFetched: (p: MetaProfile) => void;
  fetching: boolean;
  setFetching: (v: boolean) => void;
  fetched: MetaProfile | null;
}) {
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tryFetchProfile = async () => {
    if (!data.phoneNumberId || !data.accessToken) return;
    setFetching(true);
    setError(null);
    try {
      const profileRes = await fetch(
        `https://graph.facebook.com/v18.0/${data.phoneNumberId}/whatsapp_business_profile?fields=about,address,description,email,websites,vertical&access_token=${data.accessToken}`,
      );
      const nameRes = await fetch(
        `https://graph.facebook.com/v18.0/${data.phoneNumberId}?fields=display_phone_number,verified_name&access_token=${data.accessToken}`,
      );
      if (!profileRes.ok || !nameRes.ok) throw new Error('Invalid credentials');
      const profile = await profileRes.json() as Record<string, unknown>;
      const nameData = await nameRes.json() as Record<string, unknown>;
      onFetched({
        displayName: nameData.verified_name as string | undefined,
        about: profile.about as string | undefined,
        address: profile.address as string | undefined,
        description: profile.description as string | undefined,
        email: profile.email as string | undefined,
        websites: profile.websites as string[] | undefined,
        vertical: profile.vertical as string | undefined,
      });
    } catch {
      setError('Could not verify credentials. Please check your Phone Number ID and Access Token.');
    } finally {
      setFetching(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Connect your WhatsApp</h2>
        <p className="text-gray-500 mt-1 text-sm">Enter your credentials from Meta Business Manager. We'll pull your business profile automatically.</p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone Number ID</label>
          <input
            value={data.phoneNumberId}
            onChange={e => onChange('phoneNumberId', e.target.value)}
            placeholder="1234567890"
            className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50 focus:bg-white"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">WhatsApp Business Account ID</label>
          <input
            value={data.wabaId}
            onChange={e => onChange('wabaId', e.target.value)}
            placeholder="9876543210"
            className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50 focus:bg-white"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Permanent Access Token</label>
          <div className="relative">
            <input
              type={showToken ? 'text' : 'password'}
              value={data.accessToken}
              onChange={e => onChange('accessToken', e.target.value)}
              placeholder="EAAxxxx..."
              className="w-full border border-gray-300 rounded-xl px-4 py-3 pr-10 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50 focus:bg-white"
            />
            <button type="button" onClick={() => setShowToken(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1">Use a System User permanent token from Meta Business Manager.</p>
        </div>

        {/* Verify button */}
        {data.phoneNumberId && data.accessToken && !fetched && (
          <button
            onClick={() => { void tryFetchProfile(); }}
            disabled={fetching}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {fetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            {fetching ? 'Verifying…' : 'Verify & Fetch Profile'}
          </button>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
            <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
            <p className="text-xs text-red-600">{error}</p>
          </div>
        )}

        {/* Fetched profile preview */}
        {fetched && (
          <div className="p-4 bg-green-50 border border-green-200 rounded-xl space-y-1.5">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-4 h-4 text-green-600" />
              <p className="text-sm font-semibold text-green-800">Profile fetched successfully</p>
            </div>
            {fetched.displayName && <p className="text-xs text-green-700"><span className="font-medium">Name:</span> {fetched.displayName}</p>}
            {fetched.vertical && <p className="text-xs text-green-700"><span className="font-medium">Category:</span> {fetched.vertical}</p>}
            {fetched.about && <p className="text-xs text-green-700"><span className="font-medium">About:</span> {fetched.about}</p>}
          </div>
        )}

        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
          <p className="text-xs text-blue-700 font-medium mb-1">Where to find these?</p>
          <a
            href="https://business.facebook.com/latest/whatsapp-manager"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
          >
            Open Meta Business Manager <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Step 2: All Set ──────────────────────────────────────────────────────────
function StepAllSet({ name }: { name: string }) {
  const FEATURES = [
    { icon: MessageSquare, label: 'Inbox ready', desc: 'Start chatting with customers' },
    { icon: Zap, label: 'Automation enabled', desc: 'Set up auto-replies & chatbots' },
    { icon: BarChart3, label: 'Analytics live', desc: 'Track message performance' },
    { icon: Globe, label: 'Campaigns unlocked', desc: 'Broadcast to your contacts' },
  ];
  return (
    <div className="space-y-6 text-center">
      <div className="flex justify-center">
        <div className="relative">
          <div className="w-20 h-20 bg-gradient-to-br from-teal-400 to-emerald-500 rounded-full flex items-center justify-center shadow-lg">
            <Sparkles className="w-9 h-9 text-white" />
          </div>
          <div className="absolute -top-1 -right-1 w-6 h-6 bg-yellow-400 rounded-full flex items-center justify-center">
            <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
          </div>
        </div>
      </div>
      <div>
        <h2 className="text-2xl font-bold text-gray-900">You're all set, {name}!</h2>
        <p className="text-gray-500 mt-1 text-sm">Your WhatsApp Business platform is ready. Here's what you can do:</p>
      </div>
      <div className="grid grid-cols-2 gap-3 text-left">
        {FEATURES.map(f => (
          <div key={f.label} className="flex items-start gap-3 p-3 bg-white rounded-xl border border-gray-100 shadow-sm">
            <div className="w-8 h-8 bg-teal-50 rounded-lg flex items-center justify-center flex-shrink-0">
              <f.icon className="w-4 h-4 text-teal-600" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">{f.label}</p>
              <p className="text-xs text-gray-500">{f.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function OnboardingPage() {
  const router = useRouter();
  const { user, tenant, setAuth, accessToken } = useAuthStore();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetched, setFetched] = useState<MetaProfile | null>(null);

  const [form, setForm] = useState({
    phoneNumberId: '',
    wabaId: '',
    accessToken: '',
  });

  useEffect(() => {
    if (tenant?.onboardingCompleted === true) {
      router.replace('/dashboard');
    }
  }, [tenant, router]);

  const setField = useCallback((k: string, v: string) => {
    setForm(p => ({ ...p, [k]: v }));
    if (fetched) setFetched(null); // reset if credentials change
  }, [fetched]);

  const handleConnect = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { step: 2 };
      if (form.phoneNumberId) payload.phoneNumberId = form.phoneNumberId;
      if (form.wabaId) payload.wabaId = form.wabaId;
      if (form.accessToken) payload.accessToken = form.accessToken;
      // Save fetched profile fields
      if (fetched) {
        if (fetched.displayName) payload.businessName = fetched.displayName;
        if (fetched.vertical) payload.businessCategory = fetched.vertical;
        if (fetched.description || fetched.about) payload.businessDescription = fetched.description ?? fetched.about;
        if (fetched.address) payload.businessAddress = fetched.address;
        if (fetched.websites?.[0]) payload.businessWebsite = fetched.websites[0];
        if (fetched.email) payload.businessEmail = fetched.email;
      }
      await tenantApi.updateOnboarding(payload);
      setStep(2);
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleFinish = async () => {
    setSaving(true);
    try {
      await tenantApi.updateOnboarding({ completed: true, step: 2 });
      if (tenant && user && accessToken) {
        setAuth(user, { ...tenant, onboardingCompleted: true }, accessToken);
      }
      router.replace('/dashboard');
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const isLastStep = step === STEPS.length;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-5 bg-white border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-teal-600 rounded-xl flex items-center justify-center">
            <svg className="w-4 h-4 text-white fill-current" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
            </svg>
          </div>
          <span className="font-bold text-gray-900">VerzChat</span>
        </div>
        {step < 2 && (
          <button
            onClick={() => router.replace('/dashboard')}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            Skip for now
          </button>
        )}
      </header>

      {/* Step indicators */}
      <div className="px-8 pt-6 pb-2">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center gap-0">
            {STEPS.map((s, i) => (
              <div key={s.id} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center gap-1">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                    step > s.id ? 'bg-teal-600 text-white' :
                    step === s.id ? 'bg-teal-600 text-white ring-4 ring-teal-100' :
                    'bg-gray-100 text-gray-400'
                  }`}>
                    {step > s.id ? <Check className="w-4 h-4" strokeWidth={3} /> : s.id}
                  </div>
                  <span className={`text-[10px] font-medium whitespace-nowrap ${step === s.id ? 'text-teal-600' : 'text-gray-400'}`}>{s.label}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`flex-1 h-0.5 mb-4 mx-1 transition-colors ${step > s.id ? 'bg-teal-500' : 'bg-gray-200'}`} />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 flex items-start justify-center px-4 pt-6 pb-12">
        <div className="w-full max-w-lg">
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8">
            <div className="min-h-[320px] flex flex-col">
              <div className="flex-1">
                {step === 1 && (
                  <StepWhatsApp
                    data={form}
                    onChange={setField}
                    onFetched={setFetched}
                    fetching={fetching}
                    setFetching={setFetching}
                    fetched={fetched}
                  />
                )}
                {step === 2 && <StepAllSet name={user?.name?.split(' ')[0] ?? 'there'} />}
              </div>

              {/* Navigation */}
              <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-100">
                <div />
                {!isLastStep ? (
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => { void handleConnect(); }}
                      disabled={saving || fetching}
                      className="flex items-center gap-2 px-6 py-2.5 bg-teal-600 text-white rounded-xl text-sm font-semibold hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      {fetched ? 'Connect & Continue' : 'Skip for now'}
                      {!saving && <ArrowRight className="w-4 h-4" />}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { void handleFinish(); }}
                    disabled={saving}
                    className="flex items-center gap-2 px-8 py-3 bg-teal-600 text-white rounded-xl text-sm font-bold hover:bg-teal-700 disabled:opacity-60 transition-colors shadow-lg shadow-teal-200 mx-auto"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    Go to Dashboard
                    {!saving && <ArrowRight className="w-4 h-4" />}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

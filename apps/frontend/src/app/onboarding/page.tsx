'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight, ArrowLeft, CheckCircle2, Building2, Smartphone, User2,
  CreditCard, Sparkles, ExternalLink, Loader2, Eye, EyeOff, ChevronRight,
  Check, MessageSquare, Zap, BarChart3, Globe,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { tenantApi } from '@/lib/api';
import toast from 'react-hot-toast';

// ─── constants ───────────────────────────────────────────────────────────────
const INDUSTRIES = ['E-commerce', 'Healthcare', 'Education', 'Real Estate', 'Finance & Banking', 'Retail', 'Travel & Hospitality', 'Food & Restaurant', 'Logistics', 'Media & Entertainment', 'Non-profit', 'Other'];
const TEAM_SIZES = ['Just me', '2–5', '6–20', '21–50', '51–200', '200+'];
const CATEGORIES = ['Auto', 'Beauty, Spa and Salon', 'Clothing and Apparel', 'Education', 'Entertainment', 'Event Planning and Service', 'Finance and Banking', 'Food and Grocery', 'Public Service', 'Hotel and Lodging', 'Medical and Health', 'Non-profit', 'Professional Services', 'Shopping and Retail', 'Travel and Transportation', 'Restaurant', 'Other'];
const COUNTRIES = [
  'Afghanistan','Albania','Algeria','Andorra','Angola','Antigua and Barbuda','Argentina','Armenia','Australia','Austria',
  'Azerbaijan','Bahamas','Bahrain','Bangladesh','Barbados','Belarus','Belgium','Belize','Benin','Bhutan',
  'Bolivia','Bosnia and Herzegovina','Botswana','Brazil','Brunei','Bulgaria','Burkina Faso','Burundi','Cabo Verde','Cambodia',
  'Cameroon','Canada','Central African Republic','Chad','Chile','China','Colombia','Comoros','Congo','Costa Rica',
  'Croatia','Cuba','Cyprus','Czech Republic','Denmark','Djibouti','Dominica','Dominican Republic','Ecuador','Egypt',
  'El Salvador','Equatorial Guinea','Eritrea','Estonia','Eswatini','Ethiopia','Fiji','Finland','France','Gabon',
  'Gambia','Georgia','Germany','Ghana','Greece','Grenada','Guatemala','Guinea','Guinea-Bissau','Guyana',
  'Haiti','Honduras','Hungary','Iceland','India','Indonesia','Iran','Iraq','Ireland','Israel',
  'Italy','Jamaica','Japan','Jordan','Kazakhstan','Kenya','Kiribati','Kuwait','Kyrgyzstan','Laos',
  'Latvia','Lebanon','Lesotho','Liberia','Libya','Liechtenstein','Lithuania','Luxembourg','Madagascar','Malawi',
  'Malaysia','Maldives','Mali','Malta','Marshall Islands','Mauritania','Mauritius','Mexico','Micronesia','Moldova',
  'Monaco','Mongolia','Montenegro','Morocco','Mozambique','Myanmar','Namibia','Nauru','Nepal','Netherlands',
  'New Zealand','Nicaragua','Niger','Nigeria','North Korea','North Macedonia','Norway','Oman','Pakistan','Palau',
  'Palestine','Panama','Papua New Guinea','Paraguay','Peru','Philippines','Poland','Portugal','Qatar','Romania',
  'Russia','Rwanda','Saint Kitts and Nevis','Saint Lucia','Saint Vincent and the Grenadines','Samoa','San Marino',
  'Sao Tome and Principe','Saudi Arabia','Senegal','Serbia','Seychelles','Sierra Leone','Singapore','Slovakia',
  'Slovenia','Solomon Islands','Somalia','South Africa','South Korea','South Sudan','Spain','Sri Lanka','Sudan',
  'Suriname','Sweden','Switzerland','Syria','Taiwan','Tajikistan','Tanzania','Thailand','Timor-Leste','Togo',
  'Tonga','Trinidad and Tobago','Tunisia','Turkey','Turkmenistan','Tuvalu','Uganda','Ukraine','United Arab Emirates',
  'United Kingdom','United States','Uruguay','Uzbekistan','Vanuatu','Vatican City','Venezuela','Vietnam',
  'Yemen','Zambia','Zimbabwe',
];

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: '/mo',
    description: 'For individuals getting started',
    color: 'border-gray-200',
    highlight: false,
    features: ['1 user', '1,000 conversations/mo', 'Basic inbox', 'WhatsApp templates', 'Community support'],
  },
  {
    id: 'starter',
    name: 'Starter',
    price: '$29',
    period: '/mo',
    description: 'For small teams',
    color: 'border-teal-200',
    highlight: false,
    features: ['3 users', '5,000 conversations/mo', 'Canned responses', 'Basic automation', 'Email support'],
  },
  {
    id: 'growth',
    name: 'Growth',
    price: '$79',
    period: '/mo',
    description: 'For growing businesses',
    color: 'border-teal-500',
    highlight: true,
    badge: 'Most Popular',
    features: ['10 users', 'Unlimited conversations', 'Chatbot flows', 'Advanced analytics', 'API access', 'Priority support'],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    description: 'For large organizations',
    color: 'border-purple-300',
    highlight: false,
    features: ['Unlimited users', 'Dedicated infra', 'Custom integrations', 'SLA guarantee', 'Dedicated manager'],
  },
];

const STEPS = [
  { id: 1, icon: Building2, label: 'Business Info' },
  { id: 2, icon: Smartphone, label: 'WhatsApp' },
  { id: 3, icon: User2, label: 'Profile' },
  { id: 4, icon: CreditCard, label: 'Choose Plan' },
  { id: 5, icon: Sparkles, label: "All Set!" },
];

// ─── Step 1: Business Info ────────────────────────────────────────────────────
function StepBusiness({ data, onChange }: { data: any; onChange: (k: string, v: string) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Tell us about your business</h2>
        <p className="text-gray-500 mt-1">This helps us personalise your experience.</p>
      </div>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Business Name</label>
          <input
            value={data.businessName}
            onChange={e => onChange('businessName', e.target.value)}
            placeholder="Acme Corp"
            className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500 bg-gray-50 focus:bg-white transition-colors"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Industry</label>
            <select
              value={data.industry}
              onChange={e => onChange('industry', e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50 focus:bg-white transition-colors appearance-none"
            >
              <option value="">Select industry</option>
              {INDUSTRIES.map(i => <option key={i}>{i}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Team Size</label>
            <div className="grid grid-cols-3 gap-1.5">
              {TEAM_SIZES.map(s => (
                <button
                  key={s}
                  onClick={() => onChange('teamSize', s)}
                  className={`py-2 rounded-lg text-xs font-medium border transition-colors ${
                    data.teamSize === s
                      ? 'bg-teal-600 border-teal-600 text-white'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-teal-300'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Country</label>
          <select
            value={data.country}
            onChange={e => onChange('country', e.target.value)}
            className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50 focus:bg-white transition-colors appearance-none"
          >
            <option value="">Select country</option>
            {COUNTRIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}

// ─── Step 2: Connect WhatsApp ─────────────────────────────────────────────────
function StepWhatsApp({ data, onChange }: { data: any; onChange: (k: string, v: string) => void }) {
  const [mode, setMode] = useState<'choose' | 'manual'>('choose');
  const [showToken, setShowToken] = useState(false);

  if (mode === 'choose') {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Connect your WhatsApp</h2>
          <p className="text-gray-500 mt-1">Link your WhatsApp Business account to start sending messages.</p>
        </div>
        <div className="space-y-3">
          <button
            onClick={() => window.open('https://business.facebook.com/latest/whatsapp-manager', '_blank')}
            className="w-full flex items-center gap-4 p-4 border-2 border-green-200 bg-green-50 hover:bg-green-100 rounded-2xl transition-colors text-left"
          >
            <div className="w-10 h-10 rounded-xl bg-green-500 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-white fill-current" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
              </svg>
            </div>
            <div className="flex-1">
              <p className="font-semibold text-gray-900 text-sm">Connect via Facebook</p>
              <p className="text-xs text-gray-500 mt-0.5">Fastest setup — connect directly through Meta Business Manager</p>
            </div>
            <ExternalLink className="w-4 h-4 text-gray-400 flex-shrink-0" />
          </button>

          <button
            onClick={() => setMode('manual')}
            className="w-full flex items-center gap-4 p-4 border-2 border-gray-200 hover:border-teal-300 bg-white rounded-2xl transition-colors text-left"
          >
            <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center flex-shrink-0">
              <Smartphone className="w-5 h-5 text-gray-500" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-gray-900 text-sm">Enter credentials manually</p>
              <p className="text-xs text-gray-500 mt-0.5">Paste your Phone Number ID, WABA ID and Access Token</p>
            </div>
            <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
          </button>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <p className="text-xs text-blue-700 font-medium mb-1">Don't have a WhatsApp Business API account?</p>
          <p className="text-xs text-blue-600">You can set this up later from Settings → WhatsApp API. Skip this step to explore the platform first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => setMode('choose')} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h2 className="text-2xl font-bold text-gray-900">WhatsApp credentials</h2>
          <p className="text-gray-500 text-sm mt-0.5">Find these in your Meta Business Manager → WhatsApp Manager.</p>
        </div>
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
          <p className="text-xs text-gray-400 mt-1">Generate a System User permanent token in Meta Business Manager for reliability.</p>
        </div>
      </div>
    </div>
  );
}

// ─── Step 3: Business Profile ─────────────────────────────────────────────────
function StepProfile({ data, onChange }: { data: any; onChange: (k: string, v: string) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Complete your profile</h2>
        <p className="text-gray-500 mt-1">This info shows on your WhatsApp Business profile.</p>
      </div>
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Business Category</label>
          <select
            value={data.businessCategory}
            onChange={e => onChange('businessCategory', e.target.value)}
            className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50 focus:bg-white appearance-none"
          >
            <option value="">Select category</option>
            {CATEGORIES.map(c => <option key={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Business Description</label>
          <textarea
            value={data.businessDescription}
            onChange={e => onChange('businessDescription', e.target.value)}
            rows={3}
            placeholder="We help businesses grow with WhatsApp marketing..."
            className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50 focus:bg-white resize-none"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Business Address</label>
          <input
            value={data.businessAddress}
            onChange={e => onChange('businessAddress', e.target.value)}
            placeholder="123 Main St, City, Country"
            className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50 focus:bg-white"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Website</label>
          <input
            value={data.businessWebsite}
            onChange={e => onChange('businessWebsite', e.target.value)}
            placeholder="https://yourcompany.com"
            className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-gray-50 focus:bg-white"
          />
        </div>
      </div>
    </div>
  );
}

// ─── Step 4: Plan ─────────────────────────────────────────────────────────────
function StepPlan({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Choose your plan</h2>
        <p className="text-gray-500 mt-1">Start free, upgrade anytime. No credit card required for Free.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {PLANS.map(plan => (
          <button
            key={plan.id}
            onClick={() => onSelect(plan.id)}
            className={`relative p-4 rounded-2xl border-2 text-left transition-all ${
              selected === plan.id
                ? plan.id === 'growth' ? 'border-teal-500 bg-teal-50' : 'border-teal-400 bg-teal-50/50'
                : plan.highlight ? 'border-teal-300' : plan.color
            }`}
          >
            {plan.badge && (
              <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-teal-600 text-white text-[10px] font-bold px-2.5 py-0.5 rounded-full whitespace-nowrap">
                {plan.badge}
              </span>
            )}
            {selected === plan.id && (
              <div className="absolute top-3 right-3">
                <CheckCircle2 className="w-4 h-4 text-teal-600" />
              </div>
            )}
            <div className="mb-2">
              <p className="font-bold text-gray-900">{plan.name}</p>
              <p className="text-xs text-gray-500">{plan.description}</p>
            </div>
            <p className="text-xl font-bold text-gray-900 mb-3">
              {plan.price}<span className="text-xs font-normal text-gray-400">{plan.period}</span>
            </p>
            <ul className="space-y-1">
              {plan.features.map(f => (
                <li key={f} className="flex items-center gap-1.5 text-xs text-gray-600">
                  <Check className="w-3 h-3 text-teal-500 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Step 5: All Set ──────────────────────────────────────────────────────────
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

  const [form, setForm] = useState({
    businessName: tenant?.name ?? '',
    industry: '',
    teamSize: '',
    country: '',
    phoneNumberId: '',
    wabaId: '',
    accessToken: '',
    businessCategory: '',
    businessDescription: '',
    businessAddress: '',
    businessWebsite: '',
    plan: 'free',
  });

  // Redirect away if already completed
  useEffect(() => {
    if (tenant?.onboardingCompleted === true) {
      router.replace('/dashboard');
    }
  }, [tenant, router]);

  const setField = useCallback((k: string, v: string) => {
    setForm(p => ({ ...p, [k]: v }));
  }, []);

  const saveStep = async (nextStep: number, extra?: Record<string, unknown>) => {
    setSaving(true);
    try {
      await tenantApi.updateOnboarding({
        step: nextStep,
        ...extra,
      });
    } catch {
      // non-blocking
    } finally {
      setSaving(false);
    }
  };

  const handleNext = async () => {
    if (step === 1) {
      await saveStep(2, {
        industry: form.industry,
        teamSize: form.teamSize,
        country: form.country,
      });
    } else if (step === 2) {
      const waPayload: Record<string, unknown> = {};
      if (form.phoneNumberId) waPayload.phoneNumberId = form.phoneNumberId;
      if (form.wabaId) waPayload.wabaId = form.wabaId;
      if (form.accessToken) waPayload.accessToken = form.accessToken;
      await saveStep(3, waPayload);
    } else if (step === 3) {
      await saveStep(4, {
        businessCategory: form.businessCategory,
        businessDescription: form.businessDescription,
        businessAddress: form.businessAddress,
        businessWebsite: form.businessWebsite,
      });
    } else if (step === 4) {
      await saveStep(5, { plan: form.plan });
    }
    setStep(s => s + 1);
  };

  const handleFinish = async () => {
    setSaving(true);
    try {
      const res = await tenantApi.updateOnboarding({ completed: true, step: 5, plan: form.plan });
      // Update auth store with completed state
      if (tenant && user && accessToken) {
        setAuth(user, { ...tenant, onboardingCompleted: true, plan: form.plan }, accessToken);
      }
      router.replace('/dashboard');
    } catch {
      toast.error('Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const canProceed = () => {
    if (step === 1) return !!form.businessName && !!form.industry && !!form.teamSize;
    return true; // steps 2–4 are optional (can skip)
  };

  const isLastStep = step === STEPS.length;
  const progress = ((step - 1) / (STEPS.length - 1)) * 100;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-8 py-5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-teal-600 rounded-xl flex items-center justify-center">
            <svg className="w-4 h-4 text-white fill-current" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
            </svg>
          </div>
          <span className="font-bold text-gray-900">WA Platform</span>
        </div>
        {step < 5 && (
          <button
            onClick={() => router.replace('/dashboard')}
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
          >
            Skip for now
          </button>
        )}
      </header>

      {/* Step indicators */}
      <div className="px-8 pb-2">
        <div className="max-w-xl mx-auto">
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
        <div className="w-full max-w-xl">
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8">
            {/* Step content */}
            <div className="min-h-[360px] flex flex-col">
              <div className="flex-1">
                {step === 1 && <StepBusiness data={form} onChange={setField} />}
                {step === 2 && <StepWhatsApp data={form} onChange={setField} />}
                {step === 3 && <StepProfile data={form} onChange={setField} />}
                {step === 4 && <StepPlan selected={form.plan} onSelect={v => setField('plan', v)} />}
                {step === 5 && <StepAllSet name={user?.name?.split(' ')[0] ?? 'there'} />}
              </div>

              {/* Navigation */}
              <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-100">
                {step > 1 && step < 5 ? (
                  <button
                    onClick={() => setStep(s => s - 1)}
                    className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
                  >
                    <ArrowLeft className="w-4 h-4" /> Back
                  </button>
                ) : <div />}

                {step < 5 ? (
                  <div className="flex items-center gap-3">
                    {step > 1 && (
                      <button
                        onClick={handleNext}
                        disabled={saving}
                        className="text-sm text-gray-400 hover:text-gray-600"
                      >
                        Skip
                      </button>
                    )}
                    <button
                      onClick={() => { void handleNext(); }}
                      disabled={!canProceed() || saving}
                      className="flex items-center gap-2 px-6 py-2.5 bg-teal-600 text-white rounded-xl text-sm font-semibold hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                      {step === 4 ? 'Continue' : 'Next'}
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

          {/* Step hint */}
          {step < 5 && (
            <p className="text-center text-xs text-gray-400 mt-4">
              Step {step} of {STEPS.length - 1} · You can change all of this later in Settings
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Mail, Lock, User, Phone, ArrowRight, Loader2 } from 'lucide-react';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { UserRole } from '@whatsapp-platform/shared-types';

function PasswordStrength({ password }: { password: string }) {
  const checks = [password.length >= 8, /[A-Z]/.test(password), /[0-9]/.test(password), /[^A-Za-z0-9]/.test(password)];
  const score = checks.filter(Boolean).length;
  const colors = ['bg-gray-200', 'bg-red-400', 'bg-orange-400', 'bg-yellow-400', 'bg-green-500'];
  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong'];
  if (!password) return null;
  return (
    <div className="mt-2">
      <div className="flex gap-1 mb-1">
        {[0, 1, 2, 3].map((i) => <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i < score ? colors[score] : 'bg-gray-200'}`} />)}
      </div>
      <p className={`text-xs ${score <= 1 ? 'text-red-500' : score === 2 ? 'text-orange-500' : score === 3 ? 'text-yellow-600' : 'text-green-600'}`}>{labels[score]}</p>
    </div>
  );
}

const COUNTRY_CODES = [
  { code: '+1', label: '🇺🇸 +1' }, { code: '+44', label: '🇬🇧 +44' }, { code: '+233', label: '🇬🇭 +233' },
  { code: '+234', label: '🇳🇬 +234' }, { code: '+27', label: '🇿🇦 +27' }, { code: '+254', label: '🇰🇪 +254' },
  { code: '+255', label: '🇹🇿 +255' }, { code: '+256', label: '🇺🇬 +256' }, { code: '+20', label: '🇪🇬 +20' },
  { code: '+212', label: '🇲🇦 +212' }, { code: '+33', label: '🇫🇷 +33' }, { code: '+49', label: '🇩🇪 +49' },
  { code: '+34', label: '🇪🇸 +34' }, { code: '+39', label: '🇮🇹 +39' }, { code: '+31', label: '🇳🇱 +31' },
  { code: '+46', label: '🇸🇪 +46' }, { code: '+47', label: '🇳🇴 +47' }, { code: '+45', label: '🇩🇰 +45' },
  { code: '+358', label: '🇫🇮 +358' }, { code: '+41', label: '🇨🇭 +41' }, { code: '+43', label: '🇦🇹 +43' },
  { code: '+32', label: '🇧🇪 +32' }, { code: '+351', label: '🇵🇹 +351' }, { code: '+48', label: '🇵🇱 +48' },
  { code: '+7', label: '🇷🇺 +7' }, { code: '+380', label: '🇺🇦 +380' }, { code: '+90', label: '🇹🇷 +90' },
  { code: '+971', label: '🇦🇪 +971' }, { code: '+966', label: '🇸🇦 +966' }, { code: '+972', label: '🇮🇱 +972' },
  { code: '+91', label: '🇮🇳 +91' }, { code: '+92', label: '🇵🇰 +92' }, { code: '+880', label: '🇧🇩 +880' },
  { code: '+94', label: '🇱🇰 +94' }, { code: '+86', label: '🇨🇳 +86' }, { code: '+81', label: '🇯🇵 +81' },
  { code: '+82', label: '🇰🇷 +82' }, { code: '+65', label: '🇸🇬 +65' }, { code: '+60', label: '🇲🇾 +60' },
  { code: '+62', label: '🇮🇩 +62' }, { code: '+63', label: '🇵🇭 +63' }, { code: '+66', label: '🇹🇭 +66' },
  { code: '+84', label: '🇻🇳 +84' }, { code: '+61', label: '🇦🇺 +61' }, { code: '+64', label: '🇳🇿 +64' },
  { code: '+55', label: '🇧🇷 +55' }, { code: '+52', label: '🇲🇽 +52' }, { code: '+54', label: '🇦🇷 +54' },
  { code: '+57', label: '🇨🇴 +57' }, { code: '+56', label: '🇨🇱 +56' }, { code: '+51', label: '🇵🇪 +51' },
];

export default function RegisterPage() {
  const router = useRouter();
  const { setAuth } = useAuthStore();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '', phoneNumber: '', countryCode: '+1' });
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirmPassword) { toast.error('Passwords do not match'); return; }
    setLoading(true);
    const fullPhone = form.phoneNumber ? `${form.countryCode}${form.phoneNumber.replace(/^\+/, '')}` : '';
    try {
      const res = await authApi.register(form.name, form.email, form.password, fullPhone || undefined);
      const { accessToken, user, tenant } = res.data as {
        accessToken: string;
        user: { id: string; email: string; name: string; role: UserRole; tenantId: string };
        tenant: { id: string; name: string; slug: string };
      };
      setAuth(user, tenant, accessToken);
      toast.success('Workspace created!');
      router.push('/onboarding');
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Registration failed'
        : 'Registration failed';
      toast.error(typeof message === 'string' ? message : 'Registration failed');
    } finally { setLoading(false); }
  };

  return (
    <div className="w-full max-w-[420px]">
      <div className="lg:hidden flex items-center gap-2.5 mb-8 justify-center">
        <div className="w-9 h-9 bg-teal-600 rounded-xl flex items-center justify-center">
          <svg className="w-5 h-5 text-white fill-current" viewBox="0 0 24 24">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
          </svg>
        </div>
        <span className="text-gray-900 font-bold text-lg">WA Platform</span>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Create your account</h1>
          <p className="text-gray-500 text-sm mt-1">Get started in under 2 minutes. No credit card needed.</p>
        </div>

        <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Full Name</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input type="text" required placeholder="Jane Smith" value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors bg-gray-50 focus:bg-white" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Work Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input type="email" required placeholder="jane@company.com" value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors bg-gray-50 focus:bg-white" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone Number <span className="text-gray-400 font-normal">(optional)</span></label>
            <div className="flex gap-2">
              <select value={form.countryCode} onChange={(e) => setForm((f) => ({ ...f, countryCode: e.target.value }))}
                className="w-28 px-2 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors bg-gray-50 focus:bg-white flex-shrink-0">
                {COUNTRY_CODES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
              <div className="relative flex-1">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input type="tel" placeholder="234 567 8900" value={form.phoneNumber}
                  onChange={(e) => setForm((f) => ({ ...f, phoneNumber: e.target.value }))}
                  className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors bg-gray-50 focus:bg-white" />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input type={showPassword ? 'text' : 'password'} required minLength={8} placeholder="Min 8 characters"
                value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                className="w-full pl-9 pr-10 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors bg-gray-50 focus:bg-white" />
              <button type="button" onClick={() => setShowPassword((v) => !v)} tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <PasswordStrength password={form.password} />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Confirm Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input type={showConfirm ? 'text' : 'password'} required placeholder="Repeat password"
                value={form.confirmPassword} onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                className={`w-full pl-9 pr-10 py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 transition-colors bg-gray-50 focus:bg-white ${form.confirmPassword && form.password !== form.confirmPassword ? 'border-red-300 focus:ring-red-500/20 focus:border-red-500' : 'border-gray-200 focus:ring-teal-500/20 focus:border-teal-500'}`} />
              <button type="button" onClick={() => setShowConfirm((v) => !v)} tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            {form.confirmPassword && form.password !== form.confirmPassword && (
              <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
            )}
          </div>

          <button type="submit" disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-teal-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-teal-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors mt-2">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating account...</> : <><span>Create Account</span><ArrowRight className="w-4 h-4" /></>}
          </button>
        </form>
      </div>

      <p className="text-center text-sm text-gray-500 mt-5">
        Already have an account?{' '}
        <Link href="/login" className="text-teal-600 font-semibold hover:underline">Sign in</Link>
      </p>
    </div>
  );
}

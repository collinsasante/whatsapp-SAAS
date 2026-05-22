'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Mail, Lock, ArrowRight, Loader2, ShieldCheck, RefreshCw, CheckCircle2, Building2 } from 'lucide-react';
import { authApi } from '@/lib/api';
import { disconnectSocket } from '@/lib/socket';
import { useAuthStore } from '@/store/auth.store';
import { UserRole } from '@whatsapp-platform/shared-types';

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

type Step = 'credentials' | 'otp' | 'unverified' | 'workspace-picker';
type Workspace = { id: string; name: string; logoUrl: string | null };

function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setAuth } = useAuthStore();

  const [step, setStep] = useState<Step>('credentials');
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // OTP / workspace-picker step state
  const [tempToken, setTempToken] = useState('');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [resending, setResending] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState('');
  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    const error = searchParams.get('error');
    if (error === 'google_not_configured') toast.error('Google login is not configured on this server.');
    else if (error === 'google_auth_failed') toast.error('Google sign-in failed. Please try again.');
    const verified = searchParams.get('verified');
    if (verified === '1') toast.success('Email verified! You can now sign in.');
  }, [searchParams]);

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await authApi.login(form.email, form.password);
      const data = res.data as
        | { requires2FA: true; tempToken: string }
        | { requiresWorkspaceSelection: true; workspaces: Workspace[]; tempToken: string }
        | { accessToken: string; user: object; tenant: object };

      if ('requiresWorkspaceSelection' in data) {
        setTempToken(data.tempToken);
        setWorkspaces(data.workspaces);
        setStep('workspace-picker');
      } else if ('requires2FA' in data) {
        setTempToken(data.tempToken);
        setStep('otp');
        setOtp(['', '', '', '', '', '']);
        setTimeout(() => otpRefs.current[0]?.focus(), 100);
      } else {
        const { accessToken, user, tenant } = data as {
          accessToken: string;
          user: { id: string; email: string; name: string; role: UserRole; tenantId: string };
          tenant: { id: string; name: string; onboardingCompleted: boolean };
        };
        setAuth(user, tenant, accessToken);
        disconnectSocket();
        router.replace('/dashboard');
      }
    } catch (err: unknown) {
      type ErrBody = { message?: string | { message?: string; code?: string; email?: string }; code?: string; email?: string };
      const errData = (err as { response?: { data?: ErrBody } })?.response?.data;
      // ForbiddenException with object payload is nested under errData.message
      const nested = errData?.message && typeof errData.message === 'object' ? errData.message : null;
      const code = nested?.code ?? errData?.code;
      if (code === 'email_not_verified') {
        setUnverifiedEmail(nested?.email ?? errData?.email ?? form.email);
        setStep('unverified');
      } else {
        const rawMsg = nested?.message ?? (typeof errData?.message === 'string' ? errData.message : undefined);
        toast.error(rawMsg ?? 'Login failed');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleOtpChange = (i: number, val: string) => {
    const cleaned = val.replace(/\D/g, '').slice(-1);
    const next = [...otp];
    next[i] = cleaned;
    setOtp(next);
    if (cleaned && i < 5) setTimeout(() => otpRefs.current[i + 1]?.focus(), 0);
  };

  const handleOtpKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[i] && i > 0) {
      otpRefs.current[i - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (text.length === 6) {
      setOtp(text.split(''));
      otpRefs.current[5]?.focus();
    }
  };

  const handleVerifyOtp = async () => {
    const code = otp.join('');
    if (code.length !== 6) { toast.error('Enter all 6 digits'); return; }
    setLoading(true);
    try {
      const res = await authApi.verify2FA(tempToken, code);
      const { accessToken, user, tenant } = res.data as {
        accessToken: string;
        user: { id: string; email: string; name: string; role: UserRole; tenantId: string };
        tenant: { id: string; name: string; slug: string };
      };
      setAuth(user, tenant, accessToken);
      disconnectSocket();
      toast.success(`Welcome back, ${(user as { name: string }).name}!`);
      router.replace('/dashboard');
    } catch (err: unknown) {
      const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Incorrect code';
      toast.error(typeof message === 'string' ? message : 'Incorrect code');
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setResending(true);
    try {
      // Re-submit login to trigger a fresh OTP
      const res = await authApi.login(form.email, form.password);
      const data = res.data as { requires2FA: true; tempToken: string };
      if ('requires2FA' in data) {
        setTempToken(data.tempToken);
        setOtp(['', '', '', '', '', '']);
        toast.success('A new code has been sent to your email');
        setTimeout(() => otpRefs.current[0]?.focus(), 100);
      }
    } catch {
      toast.error('Failed to resend code');
    } finally {
      setResending(false);
    }
  };

  const handleResendVerification = async () => {
    setResending(true);
    try {
      await authApi.resendVerification(unverifiedEmail);
      toast.success('Verification email sent — check your inbox');
    } catch {
      toast.error('Failed to send verification email');
    } finally {
      setResending(false);
    }
  };

  const handleSelectWorkspace = async (tenantId: string) => {
    setLoading(true);
    try {
      const res = await authApi.selectWorkspace(tempToken, tenantId);
      const { accessToken, user, tenant } = res.data as {
        accessToken: string;
        user: { id: string; email: string; name: string; role: UserRole; tenantId: string };
        tenant: { id: string; name: string; onboardingCompleted: boolean };
      };
      setAuth(user, tenant, accessToken);
      disconnectSocket();
      router.replace('/dashboard');
    } catch {
      toast.error('Failed to select workspace. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = () => { window.location.href = authApi.googleUrl(); };

  // ── STEP: WORKSPACE PICKER ────────────────────────────────────────────────
  if (step === 'workspace-picker') {
    return (
      <div className="w-full max-w-[420px]">
        <div className="lg:hidden flex items-center mb-8 justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="VerzChat" className="h-9" />
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <div className="flex items-center justify-center mb-5">
            <div className="w-14 h-14 bg-teal-50 rounded-2xl flex items-center justify-center">
              <Building2 className="w-7 h-7 text-teal-600" />
            </div>
          </div>
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Select a workspace</h1>
            <p className="text-gray-500 text-sm mt-2">
              Your email is linked to multiple workspaces. Choose one to continue.
            </p>
          </div>

          <div className="space-y-2.5">
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                onClick={() => void handleSelectWorkspace(ws.id)}
                disabled={loading}
                className="w-full flex items-center gap-3.5 px-4 py-3.5 border border-gray-200 rounded-xl hover:border-teal-400 hover:bg-teal-50/40 transition-all text-left disabled:opacity-50 group"
              >
                <div className="w-10 h-10 rounded-xl bg-teal-100 flex items-center justify-center flex-shrink-0 group-hover:bg-teal-200 transition-colors overflow-hidden">
                  {ws.logoUrl
                    ? <img src={ws.logoUrl} alt={ws.name} className="w-full h-full object-cover" />
                    : <span className="text-teal-700 font-bold text-base">{ws.name[0]?.toUpperCase()}</span>
                  }
                </div>
                <span className="flex-1 text-sm font-semibold text-gray-800 group-hover:text-teal-700 transition-colors truncate">{ws.name}</span>
                {loading ? <Loader2 className="w-4 h-4 animate-spin text-teal-500" /> : <ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-teal-500 transition-colors" />}
              </button>
            ))}
          </div>

          <button
            onClick={() => { setStep('credentials'); setWorkspaces([]); }}
            className="w-full text-sm text-gray-400 hover:text-gray-600 py-3 mt-3 transition-colors"
          >
            ← Back to sign in
          </button>
        </div>
      </div>
    );
  }

  // ── STEP: UNVERIFIED EMAIL ─────────────────────────────────────────────────
  if (step === 'unverified') {
    return (
      <div className="w-full max-w-[420px]">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
          <div className="w-14 h-14 bg-amber-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Mail className="w-7 h-7 text-amber-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Verify your email first</h1>
          <p className="text-sm text-gray-500 mb-1">We sent a verification link to:</p>
          <p className="text-sm font-semibold text-gray-800 mb-5">{unverifiedEmail}</p>
          <p className="text-xs text-gray-400 mb-6 leading-relaxed">
            Click the link in your email to activate your account. Check your spam folder if you don&apos;t see it.
          </p>
          <button
            onClick={() => void handleResendVerification()}
            disabled={resending}
            className="w-full flex items-center justify-center gap-2 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors mb-3 disabled:opacity-50"
          >
            {resending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Resend verification email
          </button>
          <button
            onClick={() => setStep('credentials')}
            className="w-full text-sm text-gray-400 hover:text-gray-600 py-2 transition-colors"
          >
            Back to sign in
          </button>
        </div>
      </div>
    );
  }

  // ── STEP: OTP ─────────────────────────────────────────────────────────────
  if (step === 'otp') {
    return (
      <div className="w-full max-w-[420px]">
        <div className="lg:hidden flex items-center mb-8 justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="VerzChat" className="h-9" />
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <div className="flex items-center justify-center mb-5">
            <div className="w-14 h-14 bg-teal-50 rounded-2xl flex items-center justify-center">
              <ShieldCheck className="w-7 h-7 text-teal-600" />
            </div>
          </div>
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-gray-900">Check your email</h1>
            <p className="text-gray-500 text-sm mt-2">
              We sent a 6-digit code to <span className="font-semibold text-gray-700">{form.email}</span>
            </p>
          </div>

          <div className="flex items-center justify-center gap-2 mb-6" onPaste={handleOtpPaste}>
            {otp.map((digit, i) => (
              <input
                key={i}
                ref={(el) => { otpRefs.current[i] = el; }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={(e) => handleOtpChange(i, e.target.value)}
                onKeyDown={(e) => handleOtpKeyDown(i, e)}
                className="w-11 h-13 text-center text-xl font-bold border-2 rounded-xl focus:outline-none focus:border-teal-500 transition-colors bg-gray-50 focus:bg-white"
                style={{ height: '52px' }}
              />
            ))}
          </div>

          <button
            onClick={() => void handleVerifyOtp()}
            disabled={loading || otp.join('').length < 6}
            className="w-full flex items-center justify-center gap-2 bg-teal-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-teal-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors mb-4"
          >
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Verifying...</> : <><CheckCircle2 className="w-4 h-4" /> Verify & Sign In</>}
          </button>

          <div className="flex items-center justify-between text-sm">
            <button
              onClick={() => void handleResendOtp()}
              disabled={resending}
              className="flex items-center gap-1.5 text-teal-600 hover:text-teal-700 font-medium disabled:opacity-50 transition-colors"
            >
              {resending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Resend code
            </button>
            <button
              onClick={() => { setStep('credentials'); setOtp(['', '', '', '', '', '']); }}
              className="text-gray-400 hover:text-gray-600 transition-colors"
            >
              Change email
            </button>
          </div>

          <p className="text-xs text-gray-400 text-center mt-4">
            Code expires in 10 minutes. Check your spam folder if you don&apos;t see it.
          </p>
        </div>
      </div>
    );
  }

  // ── STEP: CREDENTIALS ─────────────────────────────────────────────────────
  return (
    <div className="w-full max-w-[420px]">
      <div className="lg:hidden flex items-center mb-8 justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="VerzChat" className="h-9" />
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Sign in</h1>
          <p className="text-gray-500 text-sm mt-1">Welcome back — enter your credentials to continue.</p>
        </div>

        <button
          onClick={handleGoogle}
          type="button"
          className="w-full flex items-center justify-center gap-2.5 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors mb-4"
        >
          <GoogleIcon />
          Continue with Google
        </button>

        <div className="relative flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-xs text-gray-400 font-medium">or</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        <form onSubmit={(e) => { void handleCredentials(e); }} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="email" required placeholder="you@company.com"
                value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors bg-gray-50 focus:bg-white"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-gray-700">Password</label>
              <Link href="/forgot-password" className="text-xs text-teal-600 hover:underline">Forgot password?</Link>
            </div>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type={showPassword ? 'text' : 'password'} required placeholder="••••••••"
                value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                className="w-full pl-9 pr-10 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 transition-colors bg-gray-50 focus:bg-white"
              />
              <button type="button" onClick={() => setShowPassword((v) => !v)} tabIndex={-1}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors">
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading}
            className="w-full flex items-center justify-center gap-2 bg-teal-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-teal-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors mt-2">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in...</> : <><span>Sign In</span><ArrowRight className="w-4 h-4" /></>}
          </button>
        </form>
      </div>

      <p className="text-center text-sm text-gray-500 mt-5">
        Don&apos;t have a workspace?{' '}
        <Link href="/register" className="text-teal-600 font-semibold hover:underline">Create one free</Link>
      </p>
    </div>
  );
}

export default function LoginPageWrapper() {
  return <Suspense><LoginPage /></Suspense>;
}

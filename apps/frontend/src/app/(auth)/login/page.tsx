'use client';
import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Mail, Lock, ArrowRight, Loader2, RefreshCw, CheckCircle2, Building2 } from 'lucide-react';
import { authApi } from '@/lib/api';
import { auth, googleProvider } from '@/lib/firebase';
import { signInWithPopup } from 'firebase/auth';
import { disconnectSocket } from '@/lib/socket';
import { useAuthStore } from '@/store/auth.store';
import { UserRole } from '@whatsapp-platform/shared-types';
import { CodeInput, type CodeInputHandle, type CodeStatus } from '@/components/auth/CodeInput';

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

type Step = 'credentials' | 'pin' | 'pin-setup' | 'unverified' | 'workspace-picker';
type Workspace = { id: string; name: string; logoUrl: string | null };

// One live region under the tiles: what is happening, in as few words as possible.
function CodeFeedback({ status, message, verifying, success }: { status: CodeStatus; message: string; verifying: string; success: string }) {
  return (
    <div className="mt-4 flex h-5 items-center justify-center text-sm" role="status" aria-live="polite">
      {status === 'verifying' ? (
        <span className="inline-flex items-center gap-1.5 text-gray-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />{verifying}</span>
      ) : status === 'success' ? (
        <span className="inline-flex items-center gap-1.5 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />{success}</span>
      ) : message ? (
        <span className="text-red-600">{message}</span>
      ) : null}
    </div>
  );
}

function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setAuth } = useAuthStore();

  const [step, setStep] = useState<Step>('credentials');
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [tempToken, setTempToken] = useState('');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [pin, setPin] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [codeStatus, setCodeStatus] = useState<CodeStatus>('idle');
  const [codeMessage, setCodeMessage] = useState('');
  // A code that is being verified must never be submitted again (autofill, paste and Enter can all complete the same code).
  const submittingRef = useRef(false);
  const confirmRef = useRef<CodeInputHandle>(null);
  const [resending, setResending] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState('');

  useEffect(() => {
    if (!searchParams) return;
    const error = searchParams.get('error');
    if (error === 'google_not_configured') toast.error('Google login is not configured on this server.');
    else if (error === 'google_auth_failed') toast.error('Google sign-in failed. Please try again.');
    const verified = searchParams.get('verified');
    if (verified === '1') toast.success('Email verified! You can now sign in.');
  }, [searchParams]);

  const finishLogin = (data: { accessToken: string; user: { id: string; email: string; name: string; role: UserRole; tenantId: string }; tenant: { id: string; name: string; onboardingCompleted: boolean } }) => {
    setAuth(data.user, data.tenant, data.accessToken);
    disconnectSocket();
    toast.success(`Welcome back, ${data.user.name}!`);
    router.replace('/dashboard');
  };

  const handleCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await authApi.login(form.email, form.password);
      const data = res.data as
        | { requiresPin: true; tempToken: string }
        | { requiresPinSetup: true; tempToken: string }
        | { requiresWorkspaceSelection: true; workspaces: Workspace[]; tempToken: string }
        | { accessToken: string; user: { id: string; email: string; name: string; role: UserRole; tenantId: string }; tenant: { id: string; name: string; onboardingCompleted: boolean } };

      if ('requiresWorkspaceSelection' in data) {
        setTempToken(data.tempToken);
        setWorkspaces(data.workspaces);
        setStep('workspace-picker');
      } else if ('requiresPinSetup' in data) {
        setTempToken(data.tempToken);
        setPin('');
        setPinConfirm('');
        setStep('pin-setup');
      } else if ('requiresPin' in data) {
        setTempToken(data.tempToken);
        setPin('');
        setStep('pin');
      } else {
        finishLogin(data as Parameters<typeof finishLogin>[0]);
      }
    } catch (err: unknown) {
      type ErrBody = { message?: string | { message?: string; code?: string; email?: string }; code?: string; email?: string };
      const errData = (err as { response?: { data?: ErrBody } })?.response?.data;
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

  const resetCodeFeedback = () => { setCodeStatus('idle'); setCodeMessage(''); };

  const failCode = (message: string, clear: () => void) => {
    setCodeStatus('error');
    setCodeMessage(message);
    // Let the shake finish, then clear the tiles so the user can type again straight away.
    setTimeout(() => { clear(); setCodeStatus('idle'); }, 380);
  };

  const apiMessage = (err: unknown, fallback: string): string => {
    const message = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
    return typeof message === 'string' && message ? message : fallback;
  };

  const handleVerifyPin = async (submitted?: string) => {
    const code = submitted ?? pin;
    if (code.length !== 6 || submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    setCodeStatus('verifying');
    setCodeMessage('');
    try {
      const res = await authApi.verify2FA(tempToken, code);
      setCodeStatus('success');
      finishLogin(res.data as Parameters<typeof finishLogin>[0]);
      // submittingRef stays set: this screen is being left, nothing may submit again.
    } catch (err: unknown) {
      submittingRef.current = false;
      setLoading(false);
      failCode(apiMessage(err, 'Incorrect PIN'), () => setPin(''));
    }
  };

  const handleSetupPin = async (submittedConfirm?: string) => {
    const confirm = submittedConfirm ?? pinConfirm;
    if (pin.length !== 6 || confirm.length !== 6 || submittingRef.current) return;
    if (pin !== confirm) {
      failCode("PINs don't match", () => { setPinConfirm(''); confirmRef.current?.focus(); });
      return;
    }
    submittingRef.current = true;
    setLoading(true);
    setCodeStatus('verifying');
    setCodeMessage('');
    try {
      const res = await authApi.setupPin(tempToken, pin);
      setCodeStatus('success');
      finishLogin(res.data as Parameters<typeof finishLogin>[0]);
    } catch (err: unknown) {
      submittingRef.current = false;
      setLoading(false);
      failCode(apiMessage(err, 'Could not set the PIN'), () => setPinConfirm(''));
    }
  };

  const handleResendVerification = async () => {
    setResending(true);
    try {
      await authApi.resendVerification(unverifiedEmail);
      toast.success('Verification email sent, check your inbox');
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

  const handleGoogle = async () => {
    setLoading(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const idToken = await result.user.getIdToken();
      const res = await authApi.firebaseLogin(idToken);
      const data = res.data as { accessToken: string; expiresIn: number; user: { id: string; name: string; email: string; role: string; tenantId: string; avatarUrl?: string }; tenant: { id: string; name: string; plan: string; logoUrl?: string } };
      setAuth(data.user as Parameters<typeof setAuth>[0], data.tenant as Parameters<typeof setAuth>[1], data.accessToken);
      disconnectSocket();
      router.replace('/dashboard');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Google sign-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

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
                className="w-full flex items-center gap-3.5 px-4 py-3.5 border border-gray-200 rounded-xl hover:border-teal-400 hover:bg-teal-50 transition-all text-left disabled:opacity-50 group"
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

  // ── STEP: ENTER PIN ────────────────────────────────────────────────────────
  if (step === 'pin') {
    return (
      <div className="w-full max-w-[400px]">
        <div className="lg:hidden flex items-center mb-8 justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="VerzChat" className="h-9" />
        </div>
        <div className="auth-pearl rounded-3xl p-8 ring-1 ring-black/[0.05] shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_40px_-18px_rgba(15,23,42,0.2)]">
          <div className="mb-7 text-center">
            <h1 className="text-xl font-semibold text-gray-900">Enter your PIN</h1>
            <p className="mt-1.5 truncate text-sm text-gray-500">{form.email}</p>
          </div>

          <CodeInput
            aria-label="6-digit PIN"
            mask
            autoFocus
            value={pin}
            status={codeStatus}
            onChange={(next) => { setPin(next); if (codeMessage) setCodeMessage(''); }}
            onComplete={(code) => void handleVerifyPin(code)}
          />

          <CodeFeedback status={codeStatus} message={codeMessage} verifying="Verifying" success="Signed in" />

          <div className="mt-5 flex items-center justify-between text-xs">
            <Link href="/forgot-password" className="font-medium text-teal-700 transition-colors hover:text-teal-800">Forgot PIN?</Link>
            <button
              onClick={() => { setStep('credentials'); setPin(''); resetCodeFeedback(); submittingRef.current = false; setLoading(false); }}
              className="text-gray-500 transition-colors hover:text-gray-700"
            >
              Change account
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── STEP: SET UP PIN (first login) ─────────────────────────────────────────
  if (step === 'pin-setup') {
    return (
      <div className="w-full max-w-[400px]">
        <div className="lg:hidden flex items-center mb-8 justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="VerzChat" className="h-9" />
        </div>
        <div className="auth-pearl rounded-3xl p-8 ring-1 ring-black/[0.05] shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_40px_-18px_rgba(15,23,42,0.2)]">
          <div className="mb-7 text-center">
            <h1 className="text-xl font-semibold text-gray-900">Set your PIN</h1>
            <p className="mt-1.5 text-sm text-gray-500">Six digits, used each time you sign in.</p>
          </div>

          <div className="space-y-5">
            <div>
              <p className="mb-2 text-center text-xs font-medium text-gray-500">Choose</p>
              <CodeInput
                aria-label="Choose a 6-digit PIN"
                mask
                autoFocus
                value={pin}
                status="idle"
                onChange={(next) => { setPin(next); if (codeMessage) setCodeMessage(''); }}
                onComplete={() => confirmRef.current?.focus()}
              />
            </div>
            <div>
              <p className="mb-2 text-center text-xs font-medium text-gray-500">Confirm</p>
              <CodeInput
                ref={confirmRef}
                aria-label="Confirm your 6-digit PIN"
                mask
                value={pinConfirm}
                status={codeStatus}
                onChange={(next) => { setPinConfirm(next); if (codeMessage) setCodeMessage(''); }}
                onComplete={(code) => void handleSetupPin(code)}
              />
            </div>
          </div>

          <CodeFeedback status={codeStatus} message={codeMessage} verifying="Saving" success="Signed in" />

          <button
            onClick={() => { setStep('credentials'); setPin(''); setPinConfirm(''); resetCodeFeedback(); submittingRef.current = false; setLoading(false); }}
            className="mt-5 w-full text-center text-xs text-gray-500 transition-colors hover:text-gray-700"
          >
            Back to sign in
          </button>
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
          <p className="text-gray-500 text-sm mt-1">Welcome back, enter your credentials to continue.</p>
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

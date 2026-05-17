'use client';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Mail, Lock, ArrowRight, Loader2 } from 'lucide-react';
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

function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { setAuth } = useAuthStore();
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    const error = searchParams.get('error');
    if (error === 'google_not_configured') toast.error('Google login is not configured on this server.');
    else if (error === 'google_auth_failed') toast.error('Google sign-in failed. Please try again.');
    // Debug: show which logout path fired (visible to user, not just nginx)
    const r = searchParams.get('_r');
    if (r) toast.error(`DBG: logout via [${r}]`, { duration: 15000 });
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await authApi.login(form.email, form.password);
      const { accessToken, user, tenant } = res.data as {
        accessToken: string;
        user: { id: string; email: string; name: string; role: UserRole; tenantId: string };
        tenant: { id: string; name: string; slug: string };
      };
      setAuth(user, tenant, accessToken);
      // Kill any stale socket from an expired previous session before navigating.
      // Without this, the old socket's auth errors can fire the new SocketProvider's
      // handler and immediately log the user out of their fresh session.
      disconnectSocket();
      toast.success(`Welcome back, ${user.name}!`);
      router.push('/dashboard');
    } catch (err: unknown) {
      const message = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message ?? 'Login failed'
        : 'Login failed';
      toast.error(typeof message === 'string' ? message : 'Login failed');
    } finally { setLoading(false); }
  };

  const handleGoogle = () => { window.location.href = authApi.googleUrl(); };

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
          <h1 className="text-2xl font-bold text-gray-900">Sign in</h1>
          <p className="text-gray-500 text-sm mt-1">Welcome back — enter your credentials to continue.</p>
        </div>

        {/* Google */}
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

        <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
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

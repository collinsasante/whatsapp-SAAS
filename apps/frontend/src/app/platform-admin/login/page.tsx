'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Shield, Loader2, Eye, EyeOff, ArrowLeft, Mail } from 'lucide-react';
import { adminApi } from '@/lib/admin-api';

export default function AdminLoginPage() {
  const router = useRouter();
  const [view, setView] = useState<'login' | 'forgot' | 'forgot-sent'>('login');
  const [form, setForm] = useState({ email: '', password: '' });
  const [forgotEmail, setForgotEmail] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token } = await adminApi.login(form.email, form.password);
      console.log('[admin-login] got token from login response', { tokenPreview: `${token.slice(0, 12)}...${token.slice(-6)}`, length: token.length });
      localStorage.setItem('admin_token', token);
      console.log('[admin-login] stored in localStorage, readback:', localStorage.getItem('admin_token') === token);
      router.push('/platform-admin/dashboard');
    } catch (err) {
      setError((err as Error).message ?? 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const submitForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await adminApi.forgotPassword(forgotEmail);
      setView('forgot-sent');
    } catch (err) {
      setError((err as Error).message ?? 'Failed to send reset email');
    } finally {
      setLoading(false);
    }
  };

  const Logo = () => (
    <div className="flex items-center justify-center gap-2 mb-8">
      <div className="w-10 h-10 rounded-xl bg-teal-600 flex items-center justify-center">
        <Shield className="w-5 h-5 text-white" />
      </div>
      <span className="text-white text-xl font-semibold">Platform Admin</span>
    </div>
  );

  if (view === 'forgot-sent') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <Logo />
          <div className="bg-gray-900 rounded-2xl p-8 border border-gray-800 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-teal-600/20 flex items-center justify-center mx-auto">
              <Mail className="w-6 h-6 text-teal-400" />
            </div>
            <h2 className="text-white font-semibold">Check your email</h2>
            <p className="text-gray-400 text-sm">If <span className="text-white">{forgotEmail}</span> exists in the system, a password reset link has been sent.</p>
            <button onClick={() => setView('login')} className="text-teal-400 hover:text-teal-300 text-sm flex items-center gap-1 mx-auto">
              <ArrowLeft className="w-3 h-3" /> Back to login
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'forgot') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <Logo />
          <form onSubmit={submitForgot} className="bg-gray-900 rounded-2xl p-8 space-y-4 border border-gray-800">
            <button type="button" onClick={() => setView('login')} className="text-gray-500 hover:text-gray-300 flex items-center gap-1 text-sm mb-2">
              <ArrowLeft className="w-3 h-3" /> Back
            </button>
            <h1 className="text-white text-lg font-semibold">Reset password</h1>
            <p className="text-gray-400 text-sm">Enter your admin email and we'll send a reset link.</p>

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg px-3 py-2">{error}</div>
            )}

            <div className="space-y-1">
              <label className="text-gray-400 text-xs font-medium uppercase tracking-wide">Email</label>
              <input
                type="email" required value={forgotEmail}
                onChange={e => setForgotEmail(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                placeholder="admin@example.com"
              />
            </div>

            <button type="submit" disabled={loading}
              className="w-full bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white font-medium rounded-lg py-2.5 text-sm transition-colors flex items-center justify-center gap-2">
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              Send reset link
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <Logo />

        <form onSubmit={submit} className="bg-gray-900 rounded-2xl p-8 space-y-4 border border-gray-800">
          <h1 className="text-white text-lg font-semibold mb-2">Sign in</h1>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg px-3 py-2">{error}</div>
          )}

          <div className="space-y-1">
            <label className="text-gray-400 text-xs font-medium uppercase tracking-wide">Email</label>
            <input
              type="email" required value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
              placeholder="admin@example.com"
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-gray-400 text-xs font-medium uppercase tracking-wide">Password</label>
              <button type="button" onClick={() => setView('forgot')} className="text-teal-400 hover:text-teal-300 text-xs">
                Forgot password?
              </button>
            </div>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'} required value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 pr-10 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
                placeholder="••••••••"
              />
              <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading}
            className="w-full bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white font-medium rounded-lg py-2.5 text-sm transition-colors flex items-center justify-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            Sign in
          </button>
        </form>
      </div>
    </div>
  );
}

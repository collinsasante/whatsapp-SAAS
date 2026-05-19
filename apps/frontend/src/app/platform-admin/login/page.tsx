'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare, Eye, EyeOff, Loader2, Lock } from 'lucide-react';
import { platformAdminApi } from '@/lib/platform-admin-api';
import { useAdminStore } from '@/store/admin.store';

export default function AdminLoginPage() {
  const router = useRouter();
  const { token, setAuth, _hydrated } = useAdminStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (_hydrated && token) router.replace('/platform-admin/dashboard');
  }, [_hydrated, token, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await platformAdminApi.login(email, password);
      const { accessToken, admin } = res.data;
      localStorage.setItem('pa_token', accessToken);
      setAuth(accessToken, admin);
      router.replace('/platform-admin/dashboard');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(typeof msg === 'string' ? msg : 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#020917] px-4">
      {/* Grid bg */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: 'linear-gradient(rgba(20,184,166,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(20,184,166,0.04) 1px,transparent 1px)',
        backgroundSize: '60px 60px',
      }} />

      <div className="relative w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex w-12 h-12 rounded-2xl bg-gradient-to-br from-teal-400 to-teal-600 items-center justify-center mb-4 shadow-xl shadow-teal-500/30">
            <MessageSquare size={22} className="text-white" strokeWidth={2.5} />
          </div>
          <h1 className="text-2xl font-bold text-white">Platform Admin</h1>
          <p className="text-slate-500 text-sm mt-1">Sign in to your admin account</p>
        </div>

        <form onSubmit={submit} className="bg-white/[0.03] border border-white/10 rounded-2xl p-6 space-y-4">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-500/10 border border-red-500/25 text-red-400 text-sm">
              <Lock size={14} />
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoFocus
              placeholder="admin@verzchat.com"
              className="w-full bg-white/5 border border-white/12 rounded-xl px-3.5 py-2.5 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-teal-500/50 focus:bg-white/8 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Password</label>
            <div className="relative">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className="w-full bg-white/5 border border-white/12 rounded-xl px-3.5 py-2.5 pr-10 text-white text-sm placeholder-slate-600 focus:outline-none focus:border-teal-500/50 focus:bg-white/8 transition-colors"
              />
              <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors">
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 bg-teal-500 hover:bg-teal-400 disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition-all duration-200 shadow-lg shadow-teal-500/20 mt-2"
          >
            {loading && <Loader2 size={15} className="animate-spin" />}
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-slate-700 text-xs mt-6">Restricted access — authorized personnel only</p>
      </div>
    </div>
  );
}

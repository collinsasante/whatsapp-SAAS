'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Zap, Eye, EyeOff, AlertCircle, Shield } from 'lucide-react';
import { useAdminStore } from '@/store/admin.store';
import { adminAuthApi } from '@/lib/admin-api';

export default function AdminLoginPage() {
  const router = useRouter();
  const { setAuth } = useAdminStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    setError('');
    try {
      const res = await adminAuthApi.login({ email, password });
      const { accessToken, admin } = res.data as {
        accessToken: string;
        admin: { id: string; email: string; name: string; role: string };
      };
      setAuth(admin, accessToken);
      router.replace('/platform-admin');
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'response' in err
          ? (err as { response?: { data?: { message?: string } } }).response?.data?.message
          : undefined;
      setError(typeof msg === 'string' ? msg : 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left panel — dark branding (hidden on mobile) */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between p-12 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #0c1117 0%, #0f172a 50%, #1e1b4b 100%)' }}>
        {/* Background decoration */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-32 -right-32 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl" />
          <div className="absolute -bottom-32 -left-32 w-96 h-96 bg-indigo-600/8 rounded-full blur-3xl" />
        </div>

        {/* Logo */}
        <div className="relative flex items-center gap-3">
          <div className="w-9 h-9 bg-indigo-500 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/30">
            <Zap size={17} className="text-white" fill="white" />
          </div>
          <div>
            <p className="text-white text-base font-bold">VerzChat</p>
            <p className="text-white/30 text-[10px] uppercase tracking-widest">Admin Console</p>
          </div>
        </div>

        {/* Tagline */}
        <div className="relative">
          <h2 className="text-white text-3xl font-bold leading-tight mb-4">
            Manage your entire<br />
            <span className="text-indigo-400">messaging platform</span><br />
            from one place.
          </h2>
          <p className="text-white/40 text-sm leading-relaxed max-w-xs">
            Monitor workspaces, users, channels, and platform-wide settings with full audit logging.
          </p>
          <div className="mt-8 flex flex-col gap-3">
            {[
              'Full workspace management & impersonation',
              'Real-time analytics & growth metrics',
              'Platform-wide settings & configuration',
            ].map((item) => (
              <div key={item} className="flex items-center gap-2.5">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                <span className="text-white/50 text-xs">{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <p className="relative text-white/20 text-xs">Authorized access only. All actions are logged.</p>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-6 bg-slate-50">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center justify-center gap-2.5 mb-8">
            <div className="w-9 h-9 bg-indigo-500 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <Zap size={17} className="text-white" fill="white" />
            </div>
            <span className="text-slate-800 text-lg font-bold">VerzChat</span>
          </div>

          {/* Card */}
          <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/60 border border-slate-200/80 p-8">
            <div className="mb-7">
              <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center mb-4">
                <Shield size={18} className="text-indigo-600" />
              </div>
              <h1 className="text-slate-900 text-xl font-bold">Admin Sign In</h1>
              <p className="text-slate-500 text-sm mt-1">Sign in to access the admin console.</p>
            </div>

            {error && (
              <div className="flex items-center gap-2.5 bg-red-50 border border-red-200 rounded-xl px-3.5 py-3 mb-5">
                <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            )}

            <form onSubmit={(e) => { void handleLogin(e); }} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-700 font-medium mb-1.5">Email address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@platform.com"
                  required
                  autoFocus
                  className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-xl px-3.5 py-2.5 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-700 font-medium mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPwd ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-xl px-3.5 py-2.5 pr-11 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((v) => !v)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || !email || !password}
                className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2 mt-2 shadow-lg shadow-indigo-500/20"
              >
                {loading ? (
                  <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Signing in…</>
                ) : (
                  'Sign In'
                )}
              </button>
            </form>
          </div>

          <p className="text-center text-slate-400 text-xs mt-5">
            Restricted to authorized platform administrators only.
          </p>
        </div>
      </div>
    </div>
  );
}

'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldAlert, Eye, EyeOff, AlertCircle } from 'lucide-react';
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
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-rose-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-rose-900/40">
            <ShieldAlert size={22} className="text-white" />
          </div>
          <h1 className="text-white text-xl font-bold">Platform Admin</h1>
          <p className="text-gray-500 text-sm mt-1">Super Admin Console — Authorized Access Only</p>
        </div>

        {/* Card */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-2xl">
          {error && (
            <div className="flex items-center gap-2 bg-red-950/60 border border-red-900 rounded-xl px-3 py-2.5 mb-4">
              <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
              <p className="text-red-400 text-xs">{error}</p>
            </div>
          )}

          <form onSubmit={(e) => { void handleLogin(e); }} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1.5">Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@platform.com"
                required
                autoFocus
                className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-xl px-3.5 py-2.5 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-rose-600 focus:border-transparent transition-all"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 font-medium mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPwd ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-xl px-3.5 py-2.5 pr-10 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-rose-600 focus:border-transparent transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                >
                  {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !email || !password}
              className="w-full bg-rose-600 hover:bg-rose-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Signing in…</>
              ) : (
                'Sign in to Admin Console'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-gray-700 text-xs mt-6">
          This console is restricted to authorized platform administrators only.
        </p>
      </div>
    </div>
  );
}

'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare, Loader2, Eye, EyeOff } from 'lucide-react';
import toast from 'react-hot-toast';
import { adminAuthApi } from '@/lib/admin-api';
import { useAdminStore } from '@/store/admin.store';

export default function AdminLogin() {
  const router = useRouter();
  const setAuth = useAdminStore((s) => s.setAuth);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await adminAuthApi.login({ email, password });
      setAuth(res.data.admin, res.data.accessToken);
      router.replace('/admin/dashboard');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error(msg ?? 'Invalid credentials');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 mb-8 justify-center">
          <div className="w-8 h-8 rounded-lg bg-[#25D366] flex items-center justify-center">
            <MessageSquare size={16} className="text-white" strokeWidth={2.5} />
          </div>
          <span className="text-white font-bold text-lg tracking-tight">VerzChat</span>
          <span className="text-slate-500 text-sm ml-1">Control</span>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-7">
          <h1 className="text-white font-semibold text-base mb-1">Platform admin</h1>
          <p className="text-slate-500 text-sm mb-6">Restricted access. Authorised personnel only.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-3 py-2.5 placeholder-slate-600 focus:outline-none focus:border-[#25D366] focus:ring-1 focus:ring-[#25D366]/30 transition-colors"
                placeholder="admin@verzchat.com"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  className="w-full bg-slate-800 border border-slate-700 text-white text-sm rounded-lg px-3 py-2.5 pr-10 placeholder-slate-600 focus:outline-none focus:border-[#25D366] focus:ring-1 focus:ring-[#25D366]/30 transition-colors"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#1aad57] disabled:opacity-60 text-white font-semibold text-sm py-2.5 rounded-lg transition-colors mt-2"
            >
              {loading ? <Loader2 size={15} className="animate-spin" /> : null}
              Sign in
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-700 mt-5">
          This panel is not linked from the main app. Access is logged.
        </p>
      </div>
    </div>
  );
}

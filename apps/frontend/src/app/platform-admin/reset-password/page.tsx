'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Shield, Loader2, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { adminApi } from '@/lib/admin-api';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError('Passwords do not match'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setError('');
    setLoading(true);
    try {
      await adminApi.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError((err as Error).message ?? 'Reset failed. The link may have expired.');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="text-center space-y-3">
        <p className="text-red-400 text-sm">Invalid reset link.</p>
        <button onClick={() => router.push('/platform-admin/login')} className="text-teal-400 hover:text-teal-300 text-sm">Back to login</button>
      </div>
    );
  }

  if (done) {
    return (
      <div className="bg-gray-900 rounded-2xl p-8 border border-gray-800 text-center space-y-4">
        <div className="w-12 h-12 rounded-full bg-teal-600/20 flex items-center justify-center mx-auto">
          <CheckCircle2 className="w-6 h-6 text-teal-400" />
        </div>
        <h2 className="text-white font-semibold">Password updated</h2>
        <p className="text-gray-400 text-sm">Your password has been reset successfully.</p>
        <button onClick={() => router.push('/platform-admin/login')}
          className="w-full bg-teal-600 hover:bg-teal-500 text-white font-medium rounded-lg py-2.5 text-sm transition-colors">
          Sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="bg-gray-900 rounded-2xl p-8 space-y-4 border border-gray-800">
      <h1 className="text-white text-lg font-semibold">Set new password</h1>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-lg px-3 py-2">{error}</div>
      )}

      <div className="space-y-1">
        <label className="text-gray-400 text-xs font-medium uppercase tracking-wide">New Password</label>
        <div className="relative">
          <input
            type={showPw ? 'text' : 'password'} required value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 pr-10 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            placeholder="Min. 8 characters"
          />
          <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
            {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-gray-400 text-xs font-medium uppercase tracking-wide">Confirm Password</label>
        <input
          type="password" required value={confirm}
          onChange={e => setConfirm(e.target.value)}
          className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
          placeholder="Repeat password"
        />
      </div>

      <button type="submit" disabled={loading}
        className="w-full bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white font-medium rounded-lg py-2.5 text-sm transition-colors flex items-center justify-center gap-2">
        {loading && <Loader2 className="w-4 h-4 animate-spin" />}
        Update password
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 rounded-xl bg-teal-600 flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <span className="text-white text-xl font-semibold">Platform Admin</span>
        </div>
        <Suspense fallback={<div className="bg-gray-900 rounded-2xl p-8 border border-gray-800 text-center text-gray-400 text-sm">Loading...</div>}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}

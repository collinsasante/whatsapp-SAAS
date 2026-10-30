'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { adminApi } from '@/lib/admin-api';
import { AuthShell, Field, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, PasswordInput } from '@/components/admin/AuthShell';

function ResetForm() {
  const token = useSearchParams()?.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  if (!token) {
    return (
      <AuthShell title="This link cannot be used">
        <p className="text-sm text-gray-700">The reset link is missing or incomplete. Ask for a new one from the sign-in page.</p>
        <Link href="/platform-admin/login" className="inline-block mt-4 text-sm text-teal-700 hover:underline">Go to sign in</Link>
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title="Password updated">
        <p className="flex gap-2.5 text-sm text-gray-700"><CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" aria-hidden="true" />Your password has been changed. Sign in with the new one.</p>
        <Link href="/platform-admin/login" className="inline-block mt-4 text-sm font-medium text-teal-700 hover:underline">Go to sign in</Link>
      </AuthShell>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) { setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`); return; }
    if (password.length > MAX_PASSWORD_LENGTH) { setError(`Use at most ${MAX_PASSWORD_LENGTH} characters.`); return; }
    if (password !== confirm) { setError('The two passwords are different.'); return; }
    setError(''); setLoading(true);
    try {
      await adminApi.resetPassword(token, password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The password could not be changed. The link may have expired.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Choose a new password" description={`At least ${MIN_PASSWORD_LENGTH} characters. A few unrelated words make a strong one.`}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <p role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}
        <Field id="new-password" label="New password">
          <PasswordInput id="new-password" value={password} onChange={setPassword} autoComplete="new-password" />
        </Field>
        <Field id="confirm-password" label="Type it again">
          <PasswordInput id="confirm-password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        </Field>
        <button type="submit" disabled={loading} className="w-full inline-flex items-center justify-center gap-2 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-medium rounded-md py-2.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">
          {loading && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}Change password
        </button>
      </form>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div role="status" className="min-h-screen flex items-center justify-center"><Loader2 className="w-5 h-5 text-teal-600 animate-spin" aria-label="Loading" /></div>}>
      <ResetForm />
    </Suspense>
  );
}

'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, MailCheck } from 'lucide-react';
import { adminApi } from '@/lib/admin-api';
import { AuthShell, Field, PasswordInput, inputClass } from '@/components/admin/AuthShell';

type View = 'signin' | 'forgot' | 'sent';

function Submit({ loading, children }: { loading: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit" disabled={loading}
      className="w-full inline-flex items-center justify-center gap-2 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-medium rounded-md py-2.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  );
}

function ErrorLine({ message }: { message: string }) {
  if (!message) return null;
  return <p role="alert" className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">{message}</p>;
}

export default function AdminLoginPage() {
  const router = useRouter();
  const [view, setView] = useState<View>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const { token } = await adminApi.login(email.trim(), password);
      localStorage.setItem('admin_token', token);
      router.push('/platform-admin/dashboard');
    } catch (err) {
      setError(err instanceof Error && err.message !== 'Invalid credentials' ? err.message : 'That email and password do not match an active admin account.');
      setPassword('');
    } finally {
      setLoading(false);
    }
  };

  const sendReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await adminApi.forgotPassword(email.trim());
      setView('sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The reset email could not be sent.');
    } finally {
      setLoading(false);
    }
  };

  if (view === 'sent') {
    return (
      <AuthShell title="Check your email">
        <div className="space-y-4">
          <p className="flex gap-2.5 text-sm text-gray-700"><MailCheck className="w-5 h-5 text-teal-700 shrink-0" aria-hidden="true" />If an admin account exists for {email}, a reset link is on its way. It works for one hour.</p>
          <button onClick={() => { setView('signin'); setError(''); }} className="inline-flex items-center gap-1 text-sm text-teal-700 hover:underline"><ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />Back to sign in</button>
        </div>
      </AuthShell>
    );
  }

  if (view === 'forgot') {
    return (
      <AuthShell title="Reset your password" description="Enter your admin email and we will send you a link.">
        <form onSubmit={sendReset} className="space-y-4">
          <ErrorLine message={error} />
          <Field id="forgot-email" label="Email">
            <input id="forgot-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          </Field>
          <Submit loading={loading}>Send reset link</Submit>
          <button type="button" onClick={() => { setView('signin'); setError(''); }} className="inline-flex items-center gap-1 text-sm text-teal-700 hover:underline"><ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />Back to sign in</button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Sign in" description="Use your platform admin account.">
      <form onSubmit={signIn} className="space-y-4">
        <ErrorLine message={error} />
        <Field id="email" label="Email">
          <input id="email" type="email" required autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        </Field>
        <Field id="password" label="Password">
          <PasswordInput id="password" value={password} onChange={setPassword} autoComplete="current-password" />
        </Field>
        <div className="flex justify-end -mt-2">
          <button type="button" onClick={() => { setView('forgot'); setError(''); }} className="text-sm text-teal-700 hover:underline">Forgot your password?</button>
        </div>
        <Submit loading={loading}>Sign in</Submit>
      </form>
    </AuthShell>
  );
}

'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { authApi } from '@/lib/api';

type State = 'verifying' | 'success' | 'error';

function VerifyEmailPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token') ?? '';
  const [state, setState] = useState<State>('verifying');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!token) { setState('error'); setErrorMsg('No verification token found.'); return; }

    authApi.verifyEmail(token)
      .then(() => {
        setState('success');
        // Redirect to login with success flag after 3 seconds
        setTimeout(() => router.push('/login?verified=1'), 3000);
      })
      .catch((err: unknown) => {
        setState('error');
        const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
        setErrorMsg(msg ?? 'Verification failed. The link may have expired.');
      });
  }, [token, router]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-md w-full text-center">
        {state === 'verifying' && (
          <>
            <div className="w-16 h-16 bg-teal-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
              <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Verifying your email…</h1>
            <p className="text-sm text-gray-500">Please wait a moment.</p>
          </>
        )}

        {state === 'success' && (
          <>
            <div className="w-16 h-16 bg-teal-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
              <CheckCircle2 className="w-8 h-8 text-teal-600" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Email verified!</h1>
            <p className="text-sm text-gray-500 mb-5">
              Your account is now active. Redirecting you to sign in…
            </p>
            <Link href="/login?verified=1"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-xl transition-colors">
              Sign in now
            </Link>
          </>
        )}

        {state === 'error' && (
          <>
            <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
              <XCircle className="w-8 h-8 text-red-500" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 mb-2">Verification failed</h1>
            <p className="text-sm text-gray-500 mb-5">{errorMsg}</p>
            <div className="space-y-2">
              <Link href="/register"
                className="block w-full py-2.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-xl transition-colors text-center">
                Create a new account
              </Link>
              <Link href="/login"
                className="block text-sm text-gray-400 hover:text-gray-600 py-2 transition-colors">
                Back to sign in
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function VerifyEmailWrapper() {
  return <Suspense><VerifyEmailPage /></Suspense>;
}

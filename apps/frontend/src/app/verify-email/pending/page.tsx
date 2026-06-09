'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Mail, RefreshCw, Loader2, CheckCircle2 } from 'lucide-react';
import { authApi } from '@/lib/api';
import toast from 'react-hot-toast';

function VerifyEmailPendingPage() {
  const searchParams = useSearchParams();
  const email = searchParams?.get('email') ?? '';
  const [resending, setResending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleResend = async () => {
    if (!email) return;
    setResending(true);
    try {
      await authApi.resendVerification(email);
      setSent(true);
      toast.success('Verification email sent!');
    } catch {
      toast.error('Failed to resend. Please try again.');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-md w-full text-center">
        <div className="w-16 h-16 bg-teal-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
          <Mail className="w-8 h-8 text-teal-600" />
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-2">Check your email</h1>
        <p className="text-gray-500 text-sm mb-1">We sent a verification link to:</p>
        {email && <p className="text-sm font-semibold text-gray-800 mb-4">{email}</p>}

        <p className="text-sm text-gray-500 leading-relaxed mb-6">
          Click the link in your email to verify your address and activate your VerzChat account.
          The link expires in <strong>24 hours</strong>.
        </p>

        <div className="bg-gray-50 rounded-xl p-4 mb-6 text-left">
          <p className="text-xs font-semibold text-gray-600 mb-2">Didn&apos;t receive it?</p>
          <ul className="text-xs text-gray-500 space-y-1">
            <li>• Check your spam or junk folder</li>
            <li>• Make sure you typed the right email</li>
            <li>• Click &ldquo;Resend&rdquo; below to get a new link</li>
          </ul>
        </div>

        {sent ? (
          <div className="flex items-center justify-center gap-2 text-sm text-teal-600 font-medium mb-4">
            <CheckCircle2 className="w-4 h-4" />
            New link sent! Check your inbox.
          </div>
        ) : (
          <button
            onClick={() => void handleResend()}
            disabled={resending || !email}
            className="w-full flex items-center justify-center gap-2 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors mb-3 disabled:opacity-50"
          >
            {resending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Resend verification email
          </button>
        )}

        <Link href="/login" className="text-sm text-teal-600 hover:underline font-medium">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}

export default function VerifyEmailPendingWrapper() {
  return <Suspense><VerifyEmailPendingPage /></Suspense>;
}
